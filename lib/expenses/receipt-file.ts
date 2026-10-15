// Browser-side receipt file rules (no 'server-only': used by the Expenses page).
// The server accepts 8 MB (T6), but a Vercel request body tops out at 4.5 MB and
// the AI service refuses images over 5 MB, so big photos are shrunk before upload.

export const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const SHRINK_MAX_EDGE = 2000;
export const SHRINK_QUALITY = 0.85;

export type ReceiptFileDecision =
  | { action: 'send' }
  | { action: 'shrink' }
  | { action: 'convert' } // iPhone HEIC: turned into a JPEG here, then shrunk if still big
  | { action: 'refuse'; message: string };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** What to do with a chosen file before it goes to the server. */
export function decideReceiptFile(file: { name: string; type: string; size: number }): ReceiptFileDecision {
  const ext = extensionOf(file.name);
  const type = file.type.toLowerCase();

  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') {
    return { action: 'convert' };
  }
  if (type === 'application/pdf' || (type === '' && ext === 'pdf')) {
    return file.size > MAX_PDF_BYTES
      ? { action: 'refuse', message: 'That PDF is too big (4 MB max).' }
      : { action: 'send' };
  }
  const isImage = IMAGE_TYPES.has(type) || (type === '' && ['jpg', 'jpeg', 'png', 'webp'].includes(ext));
  if (!isImage) {
    return { action: 'refuse', message: "That file type isn't supported. Use a photo (JPG or PNG) or a PDF." };
  }
  return file.size > SHRINK_ABOVE_BYTES ? { action: 'shrink' } : { action: 'send' };
}

/** Scale (width, height) so the longer edge is at most `maxEdge`; never enlarges. */
export function shrunkSize(width: number, height: number, maxEdge = SHRINK_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Redraw a photo smaller, as a JPEG. Falls back to the original if the browser cannot decode it. */
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = shrunkSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // transparent PNGs would turn black as a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRINK_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export const HEIC_FAILED = "We couldn't convert that photo. Try sending it as a JPG instead.";

/** iPhone HEIC → JPEG, in the browser. The converter is only downloaded when someone picks a HEIC. */
export async function convertHeicToJpeg(file: File): Promise<File | null> {
  try {
    const { heicTo } = await import('heic-to');
    const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: SHRINK_QUALITY });
    return new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return null;
  }
}
