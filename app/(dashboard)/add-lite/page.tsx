import { redirect } from 'next/navigation';
import { AddLiteView, type AddLiteOffer } from '@/components/billing/add-lite-view';
import { previewPlanChangeAction } from '@/lib/actions/billing';
import { addLiteInterval, shouldShowAddLite } from '@/lib/data/add-lite-nudge';
import { getPlanSummary } from '@/lib/billing/manage';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';

export default async function AddLitePage() {
  if (!(await shouldShowAddLite())) redirect('/settings?tab=billing');

  const interval = await addLiteInterval();
  const tenantId = await getTenantIdForCurrentUser();
  const preview = await previewPlanChangeAction({ plan: 'both', interval });
  let summary: Awaited<ReturnType<typeof getPlanSummary>> | null = null;
  if (tenantId) {
    try {
      summary = await getPlanSummary(tenantId);
    } catch (err) {
      console.error('[add-lite]', err instanceof Error ? err.name : 'Error');
    }
  }

  const foundingLine =
    summary?.kind === 'stripe' && summary.discount?.label.startsWith('Founding') ? summary.discount.label : null;

  let offer: AddLiteOffer | null = null;
  let loadError: string | null = null;
  if (!preview.ok) {
    loadError = preview.error;
  } else if (preview.kind !== 'up_now') {
    loadError = 'Adding Lite isn’t available on this plan.';
  } else {
    offer = {
      todayPence: preview.todayPence,
      thenLabel: preview.thenLabel,
      effectiveDate: preview.effectiveDate,
      interval,
      foundingLine,
      nonce: crypto.randomUUID(),
    };
  }

  return <AddLiteView offer={offer} loadError={loadError} />;
}
