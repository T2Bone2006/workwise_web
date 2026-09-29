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
import { frequencyLabel } from '@/lib/rounds/parse-frequency';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { CustomerPlacesMapCard } from '@/components/rounds/customer-places-map';
import { CustomerStatStrip } from '@/components/rounds/customer-stat-strip';
import { forecastVisits, type AgreementSchedule } from '@/lib/rounds/recurrence';
import type { RoundsSettings } from '@/lib/rounds/settings';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CustomerDetailsCard } from '@/components/rounds/customer-details-card';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import { getCustomerLedger } from '@/lib/data/payments/ledger';
import { CustomerMoneyCard } from '@/components/payments/customer-money-card';
import { CustomerActivity } from '@/components/rounds/customer-activity';
import { CustomerMessagesCard } from '@/components/messaging/customer-messages-card';
import { getCustomerRecentMessages } from '@/lib/data/messaging/threads';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { contactChoiceFromColumn } from '@/lib/messaging/channel';
import { splitHouse } from '@/lib/rounds/house';

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
      messaging,
    ] = await Promise.all([
      getRoundsCustomerById(tenantId, customerId),
      getAgreementsForCustomer(tenantId, customerId),
      getUpcomingVisitsForCustomer(tenantId, customerId),
      getRecentVisitsForCustomer(tenantId, customerId),
      createClient().then((supabase) => getRoundsSettings(supabase, tenantId)),
      createClient().then((supabase) => getCustomerLedger(supabase, tenantId, customerId)),
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

    const phone =
      formatUkPhoneDisplay(customer.phone_e164) ||
      customer.phone?.trim() ||
      null;
    const sendsInvoice = customer.payment_terms === 'invoice';
    const forecast = forecastRowsForCustomer(agreements, upcoming, settings);
    const today = todayInLondon();
    const nextDate = [...upcoming, ...forecast]
      .map((visit) => visit.scheduled_date)
      .filter((date): date is string => Boolean(date))
      .sort((a, b) => compareYmd(a, b))[0] ?? null;
    const nextOverdue = nextDate != null && compareYmd(nextDate, today) < 0;
    const live = agreements.filter((agreement) => agreement.status === 'active');
    const roundValue = live.reduce((sum, agreement) => sum + agreement.price, 0);
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

    return (
      <div className="space-y-6">
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
            [phone, customer.email, primary ? `${primary.address}, ${primary.postcode}` : null]
              .filter(Boolean)
              .join(' · ') || 'No phone, email, or address yet'
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

        <CustomerStatStrip
          nextVisit={nextDate ? formatVisitDay(nextDate) : 'None'}
          nextOverdue={nextOverdue}
          services={
            live.length === 0
              ? 'None'
              : live.length === 1
                ? frequencyLabel(live[0]!.frequency_days)
                : String(live.length)
          }
          price={live.length === 0 ? '—' : priceFormat.format(roundValue)}
          payment={sendsInvoice ? 'Sends invoice' : '—'}
        />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <CustomerDetailsCard
              customer={customer}
              house={
                customer.address
                  ? splitHouse(customer.address)
                  : primary
                    ? { address: primary.address, postcode: primary.postcode }
                    : { address: null, postcode: null }
              }
              messaging={{
                contactChoice: contactChoiceFromColumn(customer.preferred_channel),
                visitReminders: messaging.flags?.visit_reminders === true,
                paymentChasers: messaging.flags?.payment_chasers !== false,
                paymentThanks: messaging.flags?.payment_thanks !== false,
                remindersEnabled: messaging.messagingSettings.reminders_enabled,
                chasersEnabled: messaging.messagingSettings.chasers_enabled,
                thanksEnabled: messaging.messagingSettings.payment_thanks_enabled,
                reminderDaysBefore: messaging.messagingSettings.reminder_days_before,
              }}
            />
            {ledgerResult.ledger ? (
              <CustomerMoneyCard ledger={ledgerResult.ledger} payLinkAvailable />
            ) : null}
            <CustomerMessagesCard
              name={customer.name}
              phoneE164={customer.phone_e164}
              optedOut={
                typeof messaging.flags?.messaging_opt_out_at === 'string' &&
                messaging.flags.messaging_opt_out_at.trim() !== ''
              }
              recent={messaging.recentMessages}
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
            {places.length > 0 ? (
              <Card className="glass-card min-w-0 overflow-hidden border-border/80">
                <CardHeader className="pb-2">
                  <h2 className="text-lg font-semibold">Where they are</h2>
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
