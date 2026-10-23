'use client';

import { useActionState } from 'react';
import { updateWebsiteRequest, type WebsiteAdminResult } from '@/lib/actions/website-offer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WEBSITE_STATUS_LABEL, WEBSITE_STATUSES, type WebsiteStatus } from '@/lib/website-offer';

const initial: WebsiteAdminResult | null = null;

const SELECT =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/** One Lite business: where its free website is, the live address and a note. Only the platform admin sees this. */
export function WebsiteRowForm({
  tenantId,
  status,
  liveUrl,
  notes,
}: {
  tenantId: string;
  status: WebsiteStatus | null;
  liveUrl: string | null;
  notes: string | null;
}) {
  const [state, action, pending] = useActionState(updateWebsiteRequest.bind(null, tenantId), initial);
  const id = `website-${tenantId}`;
  return (
    <form action={action} className="grid gap-2">
      <label htmlFor={`${id}-status`} className="sr-only">
        Website status
      </label>
      <select id={`${id}-status`} name="status" defaultValue={status ?? 'needs'} className={SELECT}>
        {WEBSITE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {WEBSITE_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-url`} className="sr-only">
        Live address
      </label>
      <Input id={`${id}-url`} name="liveUrl" defaultValue={liveUrl ?? ''} maxLength={300} placeholder="Live address" autoComplete="off" />
      <label htmlFor={`${id}-notes`} className="sr-only">
        Note
      </label>
      <Input id={`${id}-notes`} name="notes" defaultValue={notes ?? ''} maxLength={2000} placeholder="Note" autoComplete="off" />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {state?.ok ? <span className="text-xs text-(--tone-emerald-text)">Saved</span> : null}
        {state && !state.ok ? (
          <span role="alert" className="text-xs text-destructive">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
