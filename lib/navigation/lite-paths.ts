/** NEXT_PUBLIC_APP_URL without a trailing slash. */
function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    throw new Error('NEXT_PUBLIC_APP_URL is not set');
  }
  return raw.replace(/\/+$/, '');
}

export const litePaths = {
  leads: '/lite',
  lead: (id: string) => `/lite/leads/${id}`,
  conversations: '/lite/conversations',
  conversation: (id: string) => `/lite/conversations/${id}`,
  widget: '/lite/widget',
  /** What the website chat learned about money. Opened from Widget, not a sidebar tab. */
  pricing: '/lite/widget/pricing',
  setup: '/lite/setup',
} as const;

/** The public one-tap page for a booking request (T11). Absolute, for emails and texts. */
export function leadActionUrl(rawToken: string): string {
  return `${appOrigin()}/lead/${rawToken}`;
}

/** The script tag a tradie gives their web person (T1). */
export function widgetSnippet(widgetId: string): string {
  return `<script src="${appOrigin()}/widget.js?id=${widgetId}" async></script>`;
}
