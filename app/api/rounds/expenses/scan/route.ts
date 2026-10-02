import { unexpected } from '@/lib/api/direct-debit-request';
import { requireExpensesApi } from '@/lib/api/expenses-request';
import { firstZodError, roundsJson } from '@/lib/api/rounds-request';
import { scanReceiptCore } from '@/lib/expenses/read-receipt';
import { clientMutationIdSchema } from '@/lib/validations/expenses';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Multipart overhead on top of the 8 MB photo. Refused before the body is parsed. */
const MAX_BODY_BYTES = 9 * 1024 * 1024;

const SCAN_ERROR = {
  too_big: { status: 413, error: 'That photo is too big (8 MB max).' },
  wrong_type: { status: 415, error: 'Use a photo or a PDF.' },
  daily_limit: {
    status: 429,
    error: "That's a lot of receipts for one day — try again tomorrow.",
  },
  storage_failed: { status: 503, error: "Couldn't save that. Try again." },
  save_failed: { status: 503, error: "Couldn't save that. Try again." },
} as const;

function mimeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return '';
}

/** Scan a receipt photo into a To check draft. A replay returns the existing row. */
export async function POST(request: Request) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;

  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return roundsJson({ error: SCAN_ERROR.too_big.error }, 413);
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return roundsJson({ error: 'Add a photo.' }, 400);

    const clientMutationId = clientMutationIdSchema.safeParse(form.get('clientMutationId'));
    if (!clientMutationId.success) {
      return roundsJson({ error: firstZodError(clientMutationId.error) }, 400);
    }

    const result = await scanReceiptCore(auth.ctx.admin, {
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      clientMutationId: clientMutationId.data,
      file: { bytes: new Uint8Array(await file.arrayBuffer()), mime: mimeOf(file), name: file.name },
    });
    if (!result.ok) {
      const mapped = SCAN_ERROR[result.error];
      return roundsJson({ error: mapped.error }, mapped.status);
    }
    return roundsJson(
      { expenseId: result.expenseId, read: result.read, replay: result.replay },
      result.replay ? 200 : 201,
    );
  } catch (err) {
    return unexpected('POST /api/rounds/expenses/scan', err);
  }
}
