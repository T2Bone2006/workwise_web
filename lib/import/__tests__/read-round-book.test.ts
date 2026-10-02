import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blankExtractedCustomerRow,
  type ExtractedCustomerRow,
} from '@/lib/import/extracted-customer-row';
import {
  readRoundBookCore,
  ROUND_BOOK_ERRORS,
  validateRoundBookInput,
  type PageCall,
  type PageReader,
  type RoundBookInput,
  type RoundBookLogEntry,
} from '@/lib/import/round-book-core';

vi.mock('@/lib/ai/model', () => ({
  ROUND_BOOK_AI_MODEL: 'claude-sonnet-5-5',
  supportsEffort: () => true,
}));

const photo = (name = 'page.jpg', mime = 'image/jpeg', size = 1000) => ({
  bytes: new Uint8Array(size),
  mime,
  name,
});

function customer(name: string, over: Partial<ExtractedCustomerRow> = {}): ExtractedCustomerRow {
  return { ...blankExtractedCustomerRow(0), status: '', name, address: '1 High St', postcode: 'TN23 5CD', ...over };
}

function call(...names: string[]): PageCall {
  return { customers: names.map((n) => customer(n)), tokensInput: 100, tokensOutput: 50, latencyMs: 10 };
}

describe('validateRoundBookInput', () => {
  it('refuses HEIC with the save-as-JPG message', () => {
    const input: RoundBookInput = { kind: 'photos', files: [photo('IMG_1.HEIC', 'image/heic')] };
    expect(validateRoundBookInput(input, 0)).toBe(ROUND_BOOK_ERRORS.heic);
  });
  it('refuses HEIC when the browser gave no mime type', () => {
    const input: RoundBookInput = { kind: 'photos', files: [photo('IMG_1.heic', '')] };
    expect(validateRoundBookInput(input, 0)).toBe(ROUND_BOOK_ERRORS.heic);
  });
  it('refuses 11 photos and 0 photos', () => {
    const eleven: RoundBookInput = { kind: 'photos', files: Array.from({ length: 11 }, () => photo()) };
    expect(validateRoundBookInput(eleven, 0)).toBe(ROUND_BOOK_ERRORS.photoCount);
    expect(validateRoundBookInput({ kind: 'photos', files: [] }, 0)).toBe(ROUND_BOOK_ERRORS.photoCount);
  });
  it('accepts exactly 10', () => {
    const ten: RoundBookInput = { kind: 'photos', files: Array.from({ length: 10 }, () => photo()) };
    expect(validateRoundBookInput(ten, 0)).toBeNull();
  });
  it('refuses a photo over 8 MB and an unsupported type', () => {
    expect(
      validateRoundBookInput({ kind: 'photos', files: [photo('big.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1)] }, 0)
    ).toBe(ROUND_BOOK_ERRORS.tooBig);
    expect(validateRoundBookInput({ kind: 'photos', files: [photo('a.gif', 'image/gif')] }, 0)).toBe(
      ROUND_BOOK_ERRORS.wrongType
    );
  });
  it('stops at 30 photo reads a day', () => {
    const three: RoundBookInput = { kind: 'photos', files: [photo(), photo(), photo()] };
    expect(validateRoundBookInput(three, 27)).toBeNull();
    expect(validateRoundBookInput(three, 28)).toBe(ROUND_BOOK_ERRORS.dailyLimit);
  });
  it('checks typed text', () => {
    expect(validateRoundBookInput({ kind: 'text', text: '   ' }, 0)).toBe(ROUND_BOOK_ERRORS.noText);
    expect(validateRoundBookInput({ kind: 'text', text: 'x'.repeat(20_001) }, 0)).toBe(
      ROUND_BOOK_ERRORS.tooMuchText
    );
    expect(validateRoundBookInput({ kind: 'text', text: 'x'.repeat(20_000) }, 0)).toBeNull();
  });
});

describe('readRoundBookCore', () => {
  let logged: RoundBookLogEntry[];
  const log = async (entry: RoundBookLogEntry) => {
    logged.push(entry);
  };
  beforeEach(() => {
    logged = [];
  });

  it('joins pages in order and renumbers rows from 0', async () => {
    const pages = [call('Ann Page1'), call('Bob Page2', 'Cy Page2')];
    let i = 0;
    const readPage: PageReader = async () => pages[i++]!;
    const result = await readRoundBookCore({
      input: { kind: 'photos', files: [photo('1.jpg'), photo('2.jpg')] },
      readPage,
      log,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rows.map((r) => r.name)).toEqual(['Ann Page1', 'Bob Page2', 'Cy Page2']);
    expect(result.rows.map((r) => r.row_index)).toEqual([0, 1, 2]);
    expect(result.rawRows[0]).toMatchObject({ Name: 'Ann Page1', Postcode: 'TN23 5CD' });
    expect(result.pagesRead).toBe(2);
    expect(result.pagesFailed).toBe(0);
  });

  it('one page failing still returns the others', async () => {
    const readPage: PageReader = async (page) =>
      page.kind === 'photo' && page.bytes.byteLength === 2000 ? null : call('Ann');
    const result = await readRoundBookCore({
      input: { kind: 'photos', files: [photo('1.jpg', 'image/jpeg', 1000), photo('2.jpg', 'image/jpeg', 2000)] },
      readPage,
      log,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rows).toHaveLength(1);
    expect(result.pagesRead).toBe(1);
    expect(result.pagesFailed).toBe(1);
  });

  it('every page failing, or no customers found, is the "couldn\'t read any" error', async () => {
    const failed = await readRoundBookCore({
      input: { kind: 'photos', files: [photo()] },
      readPage: async () => null,
      log,
    });
    expect(failed).toEqual({ success: false, error: ROUND_BOOK_ERRORS.nothingRead });
    const empty = await readRoundBookCore({
      input: { kind: 'text', text: 'hello' },
      readPage: async () => call(),
      log,
    });
    expect(empty).toEqual({ success: false, error: ROUND_BOOK_ERRORS.nothingRead });
  });

  it('typed notes make one read', async () => {
    const readPage = vi.fn<PageReader>(async () => call('Ann'));
    const result = await readRoundBookCore({ input: { kind: 'text', text: ' Ann, 1 High St ' }, readPage, log });
    expect(result.success).toBe(true);
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage.mock.calls[0]![0]).toEqual({ kind: 'text', text: 'Ann, 1 High St' });
  });

  it('never logs names, addresses or text — only kind, page, size and counts', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    await readRoundBookCore({
      input: { kind: 'photos', files: [photo('Secret Customers.jpg')] },
      readPage: async () => call('Zebediah Quillfeather'),
      log,
    });
    const everything = JSON.stringify([logged, spies.map((s) => s.mock.calls)]);
    expect(everything).not.toMatch(/Zebediah|Quillfeather|High St|TN23|Secret Customers/);
    expect(logged[0]).toMatchObject({ kind: 'photos', page: 0, rows: 1 });
    spies.forEach((s) => s.mockRestore());
  });
});

describe('round-book headings', () => {
  it('drops nameless non-customer rows (street headings) but keeps named ones', async () => {
    const heading = customer('', { is_customer_row: false });
    const total = customer('TOTAL', { is_customer_row: false });
    const result = await readRoundBookCore({
      input: { kind: 'text', text: 'x' },
      readPage: async () => ({ customers: [heading, customer('Ann'), total], tokensInput: 1, tokensOutput: 1, latencyMs: 1 }),
      log: async () => {},
    });
    expect(result.success && result.rows.map((r) => r.name)).toEqual(['Ann', 'TOTAL']);
  });
});
