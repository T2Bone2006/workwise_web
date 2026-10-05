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
import { CustomerHeader, type CustomerHeaderTag } from '@/components/rounds/customer-header';
import { NextVisitsCard, type NextVisit } from '@/components/rounds/next-visits-card';
import { forecastVisits, type AgreementSchedule } from '@/lib/rounds/recurrence';
import type { RoundsSettings } from '@/lib/rounds/settings';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { SetBreadcrumbName } from '@/components/layout/page-breadcrumb';
import { CustomerEditFields, CustomerSendCard } from '@/components/rounds/customer-details-card';
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
    const nextVisits: NextVisit[] = [
      ...upcoming.map((visit) => ({ ...visit, planned: false })),
      ...forecast.map((visit) => ({ ...visit, planned: true })),
    ]
      .filter((visit): visit is typeof visit & { scheduled_date: string } => Boolean(visit.scheduled_date))
      .sort((a, b) => compareYmd(a.scheduled_date, b.scheduled_date))
      .slice(0, 3)
      .map((visit) => ({
        id: visit.id,
        date: visit.scheduled_date,
        time: visit.scheduled_time,
        title: visit.job_description || 'Visit',
        amount: visit.quoted_amount,
        planned: visit.planned,
      }));
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
    const place = [primary?.address, primary?.postcode].filter(Boolean).join(', ') || customer.address;

    const optedOut =
      typeof messaging.flags?.messaging_opt_out_at === 'string' && messaging.flags.messaging_opt_out_at.trim() !== '';
    const tags: CustomerHeaderTag[] = [];
    if (!customer.is_active) tags.push({ tone: 'slate', label: 'Inactive' });
    if (customer.is_active && agreements.length > 0 && live.length === 0) {
      tags.push(
        agreements.every((agreement) => agreement.status === 'ended')
          ? { tone: 'slate', label: 'Ended' }
          : { tone: 'amber', label: 'Paused' },
      );
    }
    if (sendsInvoice) tags.push({ tone: 'violet', label: 'Sends invoice' });
    if (directDebit?.status === 'active') tags.push({ tone: 'emerald', label: 'Direct Debit' });
    if (directDebit?.status === 'pending' || directDebit?.status === 'setting_up') {
      tags.push({ tone: 'amber', label: 'Direct Debit pending' });
    }
    if (optedOut) tags.push({ tone: 'amber', label: 'Opted out of texts' });

    return (
      <div className="space-y-5">
        <SetBreadcrumbName id={customerId} name={customer.name} />
        <HistoryBackButton fallbackHref={paths.customers} />
        <CustomerHeader
          name={customer.name}
          place={place || null}
          phone={customer.phone}
          phoneE164={customer.phone_e164}
          email={customer.email}
          accessNotes={customer.access_notes}
          tags={tags}
          places={places}
          editPanel={
            <CustomerEditFields
              customer={customer}
              house={
                customer.address
                  ? splitHouse(customer.address)
                  : primary
                    ? { address: primary.address, postcode: primary.postcode }
                    : { address: null, postcode: null }
              }
            />
          }
          actions={
            customer.is_active ? (
              <CustomerDeleteButton
                customerId={customerId}
                customerName={customer.name}
                useDeactivate
                redirectTo={paths.customers}
              />
            ) : null
          }
        />

        {!customer.is_active ? (
          <p className="rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
            Inactive: they stay on file but drop off the round.
          </p>
        ) : null}

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
          {ledgerResult.ledger ? (
            <div className="min-w-0 lg:col-start-2 lg:row-start-1">
              <CustomerMoneyCard ledger={ledgerResult.ledger} payLinkAvailable directDebit={directDebit} />
            </div>
          ) : null}

          <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <NextVisitsCard customerId={customerId} visits={nextVisits} today={today} />
            <AgreementsCard
              customerId={customerId}
              agreements={agreements}
              fetchError={agreementsError?.message ?? null}
            />
            <div id="visits" className="scroll-mt-4">
              <CustomerVisitsCard
                upcoming={upcoming}
                forecast={forecast}
                recent={recent}
                upcomingError={upcomingError?.message ?? null}
                recentError={recentError?.message ?? null}
              />
            </div>
            <CustomerActivity
              visits={recent}
              payments={ledgerResult.ledger?.payments ?? []}
              notes={customer.notes}
            />
          </div>

          <div className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-2">
            <CustomerMessagesCard
              name={customer.name}
              phoneE164={customer.phone_e164}
              optedOut={optedOut}
              recent={messaging.recentMessages}
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
