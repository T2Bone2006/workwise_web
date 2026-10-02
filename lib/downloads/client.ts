export type DownloadResult = { ok: true } | { ok: false; error: string; tooMany?: boolean; invoiceCount?: number };

/**
 * Fetch a ZIP and save it. Done with fetch (not a plain link) so a refusal such
 * as "pick a quarter" shows as a message instead of a page of JSON.
 */
export async function downloadZip(url: string): Promise<DownloadResult> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    return { ok: false, error: "Couldn't make the download. Check your connection and try again." };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; invoiceCount?: number };
    return {
      ok: false,
      error: body.error ?? "Couldn't make the download. Try again.",
      tooMany: res.status === 409,
      invoiceCount: body.invoiceCount,
    };
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'workwise.zip';
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return { ok: true };
}
