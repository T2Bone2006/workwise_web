import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/utils/admin';
import { listPartnerReferrals, type PartnerReferralRow } from '@/lib/billing/partner-referrals';
import { formatPence } from '@/lib/billing/plans';
import { markPartnerReferralPaid, setPartnerActive } from '@/lib/actions/partner-referrals';
import { AddPartnerForm } from '@/components/admin/add-partner-form';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  });
}

function money(pence: number | null): string {
  return pence == null ? '—' : formatPence(pence);
}

function ReferralTable({ rows }: { rows: PartnerReferralRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody has signed up with this code yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Business</th>
            <th className="py-2 pr-3 font-medium">Plan</th>
            <th className="py-2 pr-3 font-medium">Started</th>
            <th className="py-2 pr-3 font-medium">10% until</th>
            <th className="py-2 pr-3 font-medium">They paid</th>
            <th className="py-2 pr-3 font-medium">10%</th>
            <th className="py-2 pr-3 font-medium">You have sent</th>
            <th className="py-2 font-medium">Left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60 align-top">
              <td className="py-3 pr-3">
                <div className="font-medium">{row.businessName}</div>
                {row.email ? <div className="text-xs text-muted-foreground">{row.email}</div> : null}
              </td>
              <td className="py-3 pr-3">{row.plan}</td>
              <td className="py-3 pr-3 whitespace-nowrap">{formatDay(row.startedAt)}</td>
              <td className="py-3 pr-3 whitespace-nowrap">{formatDay(row.windowEndsAt)}</td>
              <td className="py-3 pr-3 tabular-nums">{money(row.collectedPence)}</td>
              <td className="py-3 pr-3 tabular-nums">{money(row.owedPence)}</td>
              <td className="py-3 pr-3 tabular-nums">{formatPence(row.paidPence)}</td>
              <td className="py-3">
                {row.outstandingPence == null ? (
                  <span className="text-muted-foreground">Couldn&apos;t read their payments</span>
                ) : row.outstandingPence > 0 ? (
                  <form action={markPartnerReferralPaid.bind(null, row.id)}>
                    <Button type="submit" size="sm">
                      Mark {formatPence(row.outstandingPence)} paid
                    </Button>
                  </form>
                ) : row.owedPence === 0 ? (
                  <span className="text-muted-foreground">Nothing yet</span>
                ) : (
                  <span className="text-muted-foreground">Marked paid</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PartnerReferralsPage() {
  const admin = await isAdmin();
  if (!admin) redirect('/dashboard');

  const { partners, error } = await listPartnerReferrals();

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Partner referrals"
        subtitle="People with no WorkWise account. A Rounds or Lite signup that uses their code gets the free month. They earn 10% of what that business pays you for 12 months. You pay them yourself."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add someone</CardTitle>
          <CardDescription>
            A short word they can say out loud, like SARAH. Customer referral codes still work when typed, and those pay a free month on that customer&apos;s bill instead of 10%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddPartnerForm />
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {partners.map((partner) => (
        <Card key={partner.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {partner.name}
                <span className="rounded-full border px-2 py-0.5 font-mono text-xs tracking-wide">{partner.code}</span>
                {partner.active ? null : (
                  <span className="text-xs font-normal text-muted-foreground">Switched off</span>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                {partner.payoutNote ? partner.payoutNote : 'No payment note yet.'}
                {partner.outstandingPence > 0 ? ` · ${formatPence(partner.outstandingPence)} still to send` : ''}
              </CardDescription>
            </div>
            <form action={setPartnerActive.bind(null, partner.id, !partner.active)}>
              <Button type="submit" variant="outline" size="sm">
                {partner.active ? 'Switch off' : 'Switch on'}
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            <ReferralTable rows={partner.referrals} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
