import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ROUND_BOOK_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { roundBookSystemPrompt } from '@/lib/import/customer-extraction-prompt';
import {
  CustomerExtractionBatchSchema,
  type ExtractedCustomerRow,
} from '@/lib/import/extracted-customer-row';
import { todayInLondon } from '@/lib/rounds/dates';

export const MAX_ROUND_BOOK_PHOTOS = 10;
export const MAX_ROUND_BOOK_PHOTO_BYTES = 8 * 1024 * 1024;
import { MAX_ROUND_BOOK_TEXT_CHARS } from '@/lib/import/round-book-limits';
export { MAX_ROUND_BOOK_TEXT_CHARS };
/** Photo reads per business per London day (cost guard). */
export const ROUND_BOOK_DAILY_PHOTO_LIMIT = 30;
const AI_TIMEOUT_MS = 60_000;
const AI_ATTEMPTS = 2; // one try and one retry
const PHOTO_CONCURRENCY = 2;

export const ROUND_BOOK_ERRORS = {
  notRounds: 'Imports are part of Rounds.',
  notOwner: 'Only the account owner can do this.',
  photoCount: 'Add between 1 and 10 photos.',
  tooBig: 'That photo is too big (8 MB max).',
  heic: 'Save it as a JPG and try again.',
  wrongType: "That file type isn't supported. Use a photo (JPG or PNG) or a PDF.",
  noText: 'Paste some notes first.',
  tooMuchText: "That's too much text for one go — split it in two.",
  nothingRead: "We couldn't read any customers. Try clearer photos, or type them in.",
  dailyLimit: "That's a lot for one day — try again tomorrow, or send it to us.",
  failed: "Couldn't read that. Try again.",
} as const;

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export type RoundBookInput =
  | { kind: 'photos'; files: Array<{ bytes: Uint8Array; mime: string; name: string }> }
  | { kind: 'text'; text: string };

/** One page's worth of rows from the AI, or null when it could not be read. */
export type PageCall = {
  customers: ExtractedCustomerRow[];
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
};
export type PageReader = (
  page: { kind: 'photo'; bytes: Uint8Array; mime: PhotoMime } | { kind: 'text'; text: string }
) => Promise<PageCall | null>;

/** What gets logged per AI call: kind, page number and size only — never content. */
export type RoundBookLogEntry = {
  kind: 'photos' | 'text';
  page: number;
  bytes: number;
  rows: number;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
};

export type RoundBookResult =
  | {
      success: true;
      rows: ExtractedCustomerRow[];
      rawRows: Record<string, string>[];
      pagesRead: number;
      pagesFailed: number;
    }
  | { success: false; error: string };

/** The "what we read" view of one extracted row (there is no sheet row to show). */
export function rawRowFromExtracted(row: ExtractedCustomerRow): Record<string, string> {
  const labels: Array<[keyof ExtractedCustomerRow, string]> = [
    ['name', 'Name'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['address', 'Address'],
    ['postcode', 'Postcode'],
    ['service', 'Service'],
    ['price', 'Price'],
    ['frequency', 'How often'],
    ['preferred_weekday', 'Day'],
    ['last_visit_date', 'Last visit'],
    ['next_visit_date', 'Next visit'],
    ['balance_owed', 'Owes'],
    ['status', 'Status'],
    ['access_notes', 'Access'],
    ['notes', 'Notes'],
  ];
  const out: Record<string, string> = {};
  for (const [key, label] of labels) {
    const value = String(row[key] ?? '').trim();
    if (value) out[label] = value;
  }
  return out;
}

function mimeOf(file: { mime: string; name: string }): string {
  const type = file.mime.toLowerCase();
  if (type) return type;
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  return '';
}

/** Checks the input before any AI call; null means fine. */
export function validateRoundBookInput(input: RoundBookInput, photoReadsToday: number): string | null {
  if (input.kind === 'text') {
    const text = input.text.trim();
    if (!text) return ROUND_BOOK_ERRORS.noText;
    if (text.length > MAX_ROUND_BOOK_TEXT_CHARS) return ROUND_BOOK_ERRORS.tooMuchText;
    return null;
  }
  if (input.files.length < 1 || input.files.length > MAX_ROUND_BOOK_PHOTOS) {
    return ROUND_BOOK_ERRORS.photoCount;
  }
  for (const file of input.files) {
    const type = mimeOf(file);
    if (type === 'image/heic' || type === 'image/heif') return ROUND_BOOK_ERRORS.heic;
    if (!ACCEPTED_MIME.has(type)) return ROUND_BOOK_ERRORS.wrongType;
    if (file.bytes.byteLength > MAX_ROUND_BOOK_PHOTO_BYTES) return ROUND_BOOK_ERRORS.tooBig;
  }
  if (photoReadsToday + input.files.length > ROUND_BOOK_DAILY_PHOTO_LIMIT) {
    return ROUND_BOOK_ERRORS.dailyLimit;
  }
  return null;
}

/**
 * Runs the reads and assembles the result. No auth, no database: the caller
 * does the guard and the daily count, and passes the AI call and the logger
 * in. Nothing here stores or logs a photo, a name or an address.
 */
export async function readRoundBookCore(params: {
  input: RoundBookInput;
  readPage: PageReader;
  log: (entry: RoundBookLogEntry) => Promise<void>;
}): Promise<RoundBookResult> {
  const { input, readPage, log } = params;

  const kind: 'photos' | 'text' = input.kind;
  const bytes: number[] = [];
  let results: Array<PageCall | null>;

  if (input.kind === 'text') {
    const text = input.text.trim();
    bytes.push(text.length);
    results = [await readPage({ kind: 'text', text })];
  } else {
    // Two photos at a time; a failed one comes back null and the rest carry on.
    const files = input.files;
    results = new Array(files.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next;
        next += 1;
        const file = files[i]!;
        bytes[i] = file.bytes.byteLength;
        results[i] = await readPage({ kind: 'photo', bytes: file.bytes, mime: mimeOf(file) as PhotoMime });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, files.length) }, worker));
  }

  const rows: ExtractedCustomerRow[] = [];
  let pagesRead = 0;
  let pagesFailed = 0;
  for (let i = 0; i < results.length; i += 1) {
    const call = results[i];
    if (!call) {
      pagesFailed += 1;
      continue;
    }
    pagesRead += 1;
    // Street headings and page titles come back as nameless non-customers: noise in a round book.
    rows.push(...call.customers.filter((c) => c.is_customer_row || c.name.trim()));
    await log({
      kind,
      page: i,
      bytes: bytes[i] ?? 0,
      rows: call.customers.length,
      tokensInput: call.tokensInput,
      tokensOutput: call.tokensOutput,
      latencyMs: call.latencyMs,
    });
  }

  const renumbered = rows.map((row, index) => ({ ...row, row_index: index }));
  if (!renumbered.some((row) => row.is_customer_row)) {
    return { success: false, error: ROUND_BOOK_ERRORS.nothingRead };
  }

  return {
    success: true,
    rows: renumbered,
    rawRows: renumbered.map(rawRowFromExtracted),
    pagesRead,
    pagesFailed,
  };
}

function isRetryable(e: unknown): boolean {
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.APIConnectionError ||
    e instanceof Anthropic.InternalServerError
  ) {
    return true;
  }
  return (
    e instanceof Anthropic.APIError &&
    /grammar compilation/i.test(String((e as { message?: unknown }).message ?? ''))
  );
}

/** The real reader: structured output, 60 s timeout, one retry. Never logs the answer. */
export const readPageWithAi: PageReader = async (page) => {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  let content: Anthropic.ContentBlockParam[];
  if (page.kind === 'text') {
    content = [{ type: 'text', text: `Here is the list:\n\n${page.text}` }];
  } else {
    const data = Buffer.from(page.bytes).toString('base64');
    content = [
      page.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: page.mime, data } },
      { type: 'text', text: 'List every customer on this page.' },
    ];
  }
  const effort = supportsEffort(ROUND_BOOK_AI_MODEL) ? { effort: 'medium' as const } : {};

  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await anthropic.messages.parse(
        {
          model: ROUND_BOOK_AI_MODEL,
          max_tokens: 16000,
          system: roundBookSystemPrompt(todayInLondon()),
          messages: [{ role: 'user', content }],
          output_config: { ...effort, format: zodOutputFormat(CustomerExtractionBatchSchema) },
        },
        { timeout: AI_TIMEOUT_MS }
      );
      if (response.parsed_output) {
        return {
          customers: response.parsed_output.customers,
          tokensInput: response.usage.input_tokens,
          tokensOutput: response.usage.output_tokens,
          latencyMs: Date.now() - startedAt,
        };
      }
    } catch (e) {
      console.error('[readRoundBook] model call failed', {
        attempt,
        error: e instanceof Error ? e.name : 'unknown',
      });
      if (!isRetryable(e)) return null;
    }
  }
  return null;
};
