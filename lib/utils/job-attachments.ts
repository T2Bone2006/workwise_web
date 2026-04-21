export type JobAttachmentRow = {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  attachment_type: string;
};

export function resolveJobAttachmentUrl(fileUrl: string): string {
  const raw = fileUrl.trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  if (!supabaseUrl) return raw;

  if (raw.startsWith('/storage/')) return `${supabaseUrl}${raw}`;
  if (raw.startsWith('storage/')) return `${supabaseUrl}/${raw}`;
  if (raw.startsWith('/')) return `${supabaseUrl}${raw}`;
  if (raw.includes('/')) return `${supabaseUrl}/storage/v1/object/public/${raw}`;
  return raw;
}

/** Map DB `attachment_type` to before/after buckets; everything else is ignored. */
export function attachmentPhotoGroup(
  attachmentType: string
): 'before' | 'after' | null {
  const t = attachmentType.trim().toLowerCase();
  if (t === 'before_photo' || t === 'before' || t.startsWith('before_')) return 'before';
  if (t === 'after_photo' || t === 'after' || t.startsWith('after_')) return 'after';
  return null;
}

export function isProbablyImage(att: JobAttachmentRow): boolean {
  const ft = att.file_type?.toLowerCase() ?? '';
  if (ft.startsWith('image/')) return true;
  const url = att.file_url.toLowerCase();
  return /\.(jpe?g|png|gif|webp|avif|heic|heif)(\?|$)/i.test(url);
}

export function splitJobAttachmentsForPhotos(rows: JobAttachmentRow[]): {
  before: JobAttachmentRow[];
  after: JobAttachmentRow[];
} {
  const before: JobAttachmentRow[] = [];
  const after: JobAttachmentRow[] = [];
  for (const row of rows) {
    const g = attachmentPhotoGroup(row.attachment_type);
    if (g === 'before') before.push(row);
    else if (g === 'after') after.push(row);
  }
  return { before, after };
}
