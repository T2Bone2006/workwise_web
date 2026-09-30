import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import {
  getCustomerById,
  getCustomerJobStats,
  getCustomerWorkerFields,
} from '@/lib/data/customers';
import { getRecentJobsForCustomer } from '@/lib/data/jobs';
import { getRoundsCustomerById } from '@/lib/data/rounds/customers';
import {
  getAgreementsForCustomer,
  type AgreementListRow,
} from '@/lib/data/rounds/agreements';
import {
  getUpcomingVisitsForCustomer,
  getRecentVisitsForCustomer,
  type VisitRow,
} from '@/lib/data/rounds/visits';
import { getCustomerPortalInviteState } from '@/lib/actions/customers';
import { usesProCrm, usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { CustomerDetailView } from '@/components/customers/customer-detail-view';
import { CustomerDeleteButton } from '@/components/customers/customer-delete-button';
import { CustomerWorkerFieldsCard } from '@/components/customers/customer-worker-fields-card';
import { RevokeCustomerPortalAccessButton } from '@/components/customers/customers-table';
import { AgreementsCard } from '@/components/rounds/agreements-card';
import {
  CustomerVisitsCard,
  type ForecastVisitRow,
} from '@/components/rounds/customer-visits-card';
import { createClient } from '@/lib/supabase/server';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { compareYmd, todayInLondon } from '@/lib/rounds/dates';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { CustomerPlacesMapCard } from '@/components/rounds/customer-places-map';
import { forecastVisits, type AgreementSchedule } from '@/lib/rounds/recurrence';
import type { RoundsSettings } from '@/lib/rounds/settings';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { SetBreadcrumbName } from '@/components/layout/page-breadcrumb';
import { CalendarDays, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CustomerDetailsCard, CustomerSendCard } from '@/components/rounds/customer-details-card';
import { CustomerSectionTitle } from '@/components/rounds/customer-section-title';
import { getCustomerLedger } from '@/lib/data/payments/ledger';
import { CustomerMoneyCard } from '@/components/payments/customer-money-card';
import { getCustomerDirectDebit } from '@/lib/data/direct-debit/customer';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import { CustomerActivity } from '@/components/rounds/customer-activity';
import { CustomerMessagesCard } from '@/components/messaging/customer-messages-card';
import { getCustomerRecentMessages } from '@/lib/data/messaging/threads';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { contactChoiceFromColumn } from '@/lib/messaging/channel';
import { flagToChoice } from '@/lib/messaging/customer-flag';
import { splitHouse } from '@/lib/rounds/house';

function NextVisitBox({
  dateLabel,
  overdue,
  services,
  money,
}: {
  dateLabel: string | null;
  overdue: boolean;
  services: { id: string; title: string }[];
  money: string | null;
}) {
  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-2">
        <CustomerSectionTitle
          icon={CalendarDays}
          title="Next visit"
          tone={overdue ? 'rose' : 'amber'}
          hint={dateLabel ?? 'Nothing booked'}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visit booked yet.</p>
        ) : (
          <ul className="space-y-1">
            {services.map((service) => (
              <li key={service.id} className="text-sm font-medium">
                {service.title}
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
          <p className="text-xs text-muted-foreground">This visit</p>
          <p className="text-lg font-semibold">{money ?? '—'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function formatVisitDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function forecastRowsForCustomer(
  agreements: AgreementListRow[],
  upcoming: VisitRow[],
  settings: RoundsSettings,
): ForecastVisitRow[] {
  const today = todayInLondon();
  const rows: ForecastVisitRow[] = [];
  for (const agreement of agreements) {
    const booked = new Set(
      upcoming
        .filter((visit) => visit.service_agreement_id === agreement.id)
        .map((visit) => visit.agreement_occurrence_date)
        .filter((date): date is string => date != null),
    );
    const schedule: AgreementSchedule = {
      id: agreement.id,
      frequency_days: agreement.frequency_days,
      next_due_date: agreement.next_due_date,
      preferred_weekday: agreement.preferred_weekday,
      preferred_time: agreement.preferred_time,
      schedule_mode: agreement.schedule_mode,
      status: agreement.status,
      paused_until: agreement.paused_until,
    };
    for (const visit of forecastVisits(schedule, settings, today, booked)) {
      rows.push({
        id: `forecast-${agreement.id}-${visit.occurrenceDate}`,
        job_description: agreement.title,
        scheduled_date: visit.scheduledDate,
        scheduled_time: agreement.preferred_time,
        quoted_amount: agreement.price,
      });
    }
  }
  return rows;
}

interface CustomerDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { id: customerId } = await params;
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) {
    redirect(paths.customers);
  }

  if (usesRoundsCrm(products)) {
    const [
      { customer, error: customerError },
      { agreements, error: agreementsError },
      { visits: upcoming, error: upcomingError },
      { visits: recent, error: recentError },
      settings,
      ledgerResult,
      directDebit,
      messaging,
    ] = await Promise.all([
      getRoundsCustomerById(tenantId, customerId),
      getAgreementsForCustomer(tenantId, customerId),
      getUpcomingVisitsForCustomer(tenantId, customerId),
      getRecentVisitsForCustomer(tenantId, customerId),
      createClient().then((supabase) => getRoundsSettings(supabase, tenantId)),
      createClient().then((supabase) => getCustomerLedger(supabase, tenantId, customerId)),
      // Direct Debit shows only when the business has it On (D10).
      createClient().then(async (supabase) =>
        (await getDirectDebitState(supabase, tenantId)) === 'on'
          ? getCustomerDirectDebit(supabase, tenantId, customerId)
          : null,
      ),
      createClient().then(async (supabase) => {
        const [messagingSettings, recentMessages, flags] = await Promise.all([
          getMessagingSettings(supabase, tenantId),
          getCustomerRecentMessages(supabase, tenantId, customerId),
          supabase
            .from('customers')
            .select('visit_reminders, payment_chasers, payment_thanks, messaging_opt_out_at')
            .eq('tenant_id', tenantId)
            .eq('id', customerId)
            .maybeSingle(),
        ]);
        if (flags.error) console.error('[customer messages]', flags.error);
        return { messagingSettings, recentMessages, flags: flags.data };
      }),
    ]);

    if (customerError || !customer) {
      redirect(paths.customers);
    }

    const sendsInvoice = customer.payment_terms === 'invoice';
    const forecast = forecastRowsForCustomer(agreements, upcoming, settings);
    const today = todayInLondon();
    const nextDate = [...upcoming, ...forecast]
      .map((visit) => visit.scheduled_date)
      .filter((date): date is string => Boolean(date))
      .sort((a, b) => compareYmd(a, b))[0] ?? null;
    const nextOverdue = nextDate != null && compareYmd(nextDate, today) < 0;
    const live = agreements.filter((agreement) => agreement.status === 'active');
    const places = live
      .filter((agreement) => agreement.lat != null && agreement.lng != null)
      .map((agreement) => ({
        id: agreement.id,
        title: agreement.title,
        address: agreement.address,
        postcode: agreement.postcode,
        lat: agreement.lat as number,
        lng: agreement.lng as number,
      }));
    const primary = live[0] ?? agreements[0] ?? null;
    const priceFormat = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    });
    const nextServices = nextDate
      ? [
          ...upcoming
            .filter((visit) => visit.scheduled_date === nextDate)
            .map((visit) => ({
              id: visit.id,
              title: visit.job_description || 'Visit',
              amount: visit.quoted_amount,
            })),
          ...forecast
            .filter((visit) => visit.scheduled_date === nextDate)
            .map((visit) => ({
              id: visit.id,
              title: visit.job_description || 'Visit',
              amount: visit.quoted_amount,
            })),
        ]
      : [];
    const nextAmounts = nextServices
      .map((service) => service.amount)
      .filter((amount): amount is number => amount != null);
    const nextMoney =
      nextAmounts.length === 0
        ? null
        : priceFormat.format(nextAmounts.reduce((sum, amount) => sum + amount, 0));
    const place = [primary?.address, primary?.postcode].filter(Boolean).join(', ') || customer.address;

    return (
      <div className="space-y-6">
        <SetBreadcrumbName id={customerId} name={customer.name} />
        <HistoryBackButton fallbackHref={paths.customers} />
        <PageGradientHeader
          eyebrow={
            customer.is_active
              ? sendsInvoice
                ? 'Sends invoice'
                : undefined
              : 'Inactive'
          }
          title={customer.name}
          subtitle={
            !customer.is_active
              ? 'Inactive — they stay on file but drop off the round'
              : place || undefined
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {customer.is_active ? (
                <CustomerDeleteButton
                  customerId={customerId}
                  customerName={customer.name}
                  useDeactivate
                  redirectTo={paths.customers}
                />
              ) : null}
            </div>
          }
        />

        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {ledgerResult.ledger ? (
              <CustomerMoneyCard
                ledger={ledgerResult.ledger}
                payLinkAvailable
                directDebit={directDebit}
              />
            ) : null}
            <CustomerDetailsCard
              customer={customer}
              house={
                customer.address
                  ? splitHouse(customer.address)
                  : primary
                    ? { address: primary.address, postcode: primary.postcode }
                    : { address: null, postcode: null }
              }
            />
            <CustomerSendCard
              customerId={customerId}
              phoneE164={customer.phone_e164}
              messaging={{
                contactChoice: contactChoiceFromColumn(customer.preferred_channel),
                visitReminders: flagToChoice(messaging.flags?.visit_reminders),
                paymentChasers: flagToChoice(messaging.flags?.payment_chasers),
                paymentThanks: flagToChoice(messaging.flags?.payment_thanks),
                remindersEnabled: messaging.messagingSettings.reminders_enabled,
                chasersEnabled: messaging.messagingSettings.chasers_enabled,
                thanksEnabled: messaging.messagingSettings.payment_thanks_enabled,
                reminderDaysBefore: messaging.messagingSettings.reminder_days_before,
                chaseFirstDays: messaging.messagingSettings.chase_first_days,
                chaseSecondDays: messaging.messagingSettings.chase_second_days,
              }}
            />
            <AgreementsCard
              customerId={customerId}
              agreements={agreements}
              fetchError={agreementsError?.message ?? null}
            />
            <CustomerVisitsCard
              upcoming={upcoming}
              forecast={forecast}
              recent={recent}
              upcomingError={upcomingError?.message ?? null}
              recentError={recentError?.message ?? null}
            />
          </div>
          <div className="min-w-0 space-y-6">
            <NextVisitBox
              dateLabel={
                nextDate
                  ? nextOverdue
                    ? `Was ${formatVisitDay(nextDate)}`
                    : formatVisitDay(nextDate)
                  : null
              }
              overdue={nextOverdue}
              services={nextServices.map(({ id, title }) => ({ id, title }))}
              money={nextMoney}
            />
            <CustomerMessagesCard
              name={customer.name}
              phoneE164={customer.phone_e164}
              optedOut={
                typeof messaging.flags?.messaging_opt_out_at === 'string' &&
                messaging.flags.messaging_opt_out_at.trim() !== ''
              }
              recent={messaging.recentMessages}
            />
            {places.length > 0 ? (
              <Card className="glass-card min-w-0 overflow-hidden border-border/80">
                <CardHeader className="pb-2">
                  <CustomerSectionTitle icon={MapPin} title="Where they are" tone="sky" />
                </CardHeader>
                <CardContent className="min-w-0">
                  <CustomerPlacesMapCard places={places} />
                </CardContent>
              </Card>
            ) : null}
            <CustomerActivity
              visits={recent}
              payments={ledgerResult.ledger?.payments ?? []}
              notes={customer.notes}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!usesProCrm(products)) {
    redirect('/dashboard');
  }

  const [
    { customer, error: customerError },
    { stats, error: statsError },
    { jobs: recentJobs, error: jobsError },
    portalState,
    { data: workerFields },
  ] = await Promise.all([
    getCustomerById(tenantId, customerId),
    getCustomerJobStats(tenantId, customerId),
    getRecentJobsForCustomer(tenantId, customerId, 10),
    getCustomerPortalInviteState(customerId),
    getCustomerWorkerFields(tenantId, customerId),
  ]);

  const hasPortalUser = portalState.success && portalState.hasPortalUser;

  if (customerError || !customer) {
    redirect(paths.customers);
  }

  return (
    <div className="space-y-6">
      <SetBreadcrumbName id={customerId} name={customer.name} />
      <div className="flex items-center gap-4">
        <HistoryBackButton fallbackHref={paths.customers} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">
            {customer.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer details and job history
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasPortalUser && (
            <RevokeCustomerPortalAccessButton customerId={customerId} />
          )}
          <CustomerDeleteButton
            customerId={customerId}
            customerName={customer.name}
            useDeactivate
          />
        </div>
      </div>

      <CustomerDetailView
        customer={customer}
        stats={stats}
        recentJobs={recentJobs}
        statsError={statsError}
        jobsError={jobsError}
      />

      <CustomerWorkerFieldsCard
        customerId={customerId}
        initialFields={workerFields.fields}
        newKeys={workerFields.newKeys}
        neverConfigured={workerFields.neverConfigured}
      />
    </div>
  );
}
