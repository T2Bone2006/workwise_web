import { countSegments, toGsm7 } from '@/lib/messaging/gsm';
import { isUkMobileE164 } from '@/lib/messaging/phone';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';

/** One text per working day (counted as 25) for each worker the plan includes. */
export const WORKER_JOB_TEXT_ALLOWANCE = {
  starter: 10 * 25,
  growth: 35 * 25,
  pro: 70 * 25,
} as const;

/** Sender name. A name cannot receive replies, so these never hit the customer inbox. */
export const WORKER_ALERT_SENDER = 'WorkWise';

const ENTITLED = new Set(['trialing', 'active', 'past_due', 'manual']);
const TIER_RANK = { starter: 1, growth: 2, pro: 3 } as const;

export type ProTextTier = keyof typeof WORKER_JOB_TEXT_ALLOWANCE;

export type SentJob = {
  id: string;
  workerId: string;
  referenceNumber: string;
  postcode: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  customerName: string | null;
};

export type SendJobRow = {
  id: string;
  reference_number: string | null;
  assigned_worker_id: string | null;
  postcode?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  customers?: { name?: string | null } | { name?: string | null }[] | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_EMAIL_LINES = 12;

export function workerJobTextAllowance(tier: string | null | undefined): number | null {
  if (tier === 'starter' || tier === 'growth' || tier === 'pro') {
    return WORKER_JOB_TEXT_ALLOWANCE[tier];
  }
  return null;
}

/** Highest entitled Pro tier. Same statuses as ENTITLED_STATUSES in tenant-products.ts. */
export function proTierForJobTexts(
  rows: readonly { product: string | null; status: string | null }[],
): ProTextTier | null {
  let best: ProTextTier | null = null;
  for (const row of rows) {
    if (!row.product || !row.status || !ENTITLED.has(row.status)) continue;
    if (row.product !== 'starter' && row.product !== 'growth' && row.product !== 'pro') continue;
    if (!best || TIER_RANK[row.product] > TIER_RANK[best]) best = row.product;
  }
  return best;
}

export function toSentJob(row: SendJobRow): SentJob | null {
  if (!row.assigned_worker_id) return null;
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
  const name = customer?.name?.trim() || null;
  return {
    id: row.id,
    workerId: row.assigned_worker_id,
    referenceNumber: row.reference_number?.trim() || row.id.slice(0, 8),
    postcode: row.postcode?.trim() || '',
    scheduledDate: row.scheduled_date ?? null,
    scheduledTime: row.scheduled_time ?? null,
    customerName: name,
  };
}

export function groupSentJobs(jobs: readonly SentJob[]): SentJob[][] {
  const map = new Map<string, SentJob[]>();
  for (const job of jobs) {
    const list = map.get(job.workerId) ?? [];
    list.push(job);
    map.set(job.workerId, list);
  }
  return [...map.values()].map(sortJobs);
}

function sortJobs(jobs: SentJob[]): SentJob[] {
  return [...jobs].sort((a, b) => {
    const byDate = (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? '');
    if (byDate !== 0) return byDate;
    const byTime = (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? '');
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function jobAlertSubject(businessName: string, count: number): string {
  const business = businessName.trim() || 'Your office';
  if (count === 1) return `New job from ${business}`;
  return `${count} new jobs from ${business}`;
}

export function jobAlertLine(job: SentJob): string {
  const when = formatWhen(job.scheduledDate, job.scheduledTime);
  const who = job.customerName || job.referenceNumber;
  return [when, job.postcode, who].filter((part) => part.length > 0).join(' · ');
}

/** One GSM-7 segment. A long business name is dropped so the text cannot become two. */
export function jobAlertSms(businessName: string, count: number): string {
  const jobs = count === 1 ? '1 new job' : `${count} new jobs`;
  const name = toGsm7(businessName).trim();
  const withName = name ? `${name}: ${jobs}. Open the app.` : `${jobs}. Open the app.`;
  if (countSegments(withName).segments === 1) return withName;
  return `${jobs}. Open the app.`;
}

export function ukMobileForAlert(phone: string | null | undefined): string | null {
  const e164 = normalizeUkPhoneE164(phone);
  return isUkMobileE164(e164) ? e164 : null;
}

export function jobAlertEmail(input: {
  businessName: string;
  jobs: readonly SentJob[];
}): { subject: string; html: string } {
  const count = input.jobs.length;
  const business = input.businessName.trim() || 'Your office';
  const subject = jobAlertSubject(business, count);
  const sorted = sortJobs([...input.jobs]);
  const shown = sorted.slice(0, MAX_EMAIL_LINES);
  const extra = sorted.length - shown.length;
  const items = shown.map((job) => `<li>${escapeHtml(jobAlertLine(job))}</li>`).join('');
  const more =
    extra > 0 ? `<p>and ${extra} more. Open the app to see them all.</p>` : '';
  const lead =
    count === 1
      ? `${escapeHtml(business)} sent you a job.`
      : `${escapeHtml(business)} sent you ${count} jobs.`;
  const html = `<p>${lead}</p><ul>${items}</ul>${more}<p>Open the WorkWise app to see them. You can turn these emails off in the app.</p>`;
  return { subject, html };
}

/**
 * Email goes when they left it on. It also goes when they asked for a text
 * and the month's allowance is used up, so that send is not silent.
 */
export function shouldEmailJobAlert(input: {
  notifyEmail: boolean;
  hasEmail: boolean;
  allowanceUsedUp: boolean;
}): boolean {
  if (!input.hasEmail) return false;
  return input.notifyEmail || input.allowanceUsedUp;
}

export function shouldTextJobAlert(input: {
  notifySms: boolean;
  hasUkMobile: boolean;
  allowance: number | null;
}): boolean {
  return input.notifySms && input.hasUkMobile && input.allowance != null && input.allowance >= 1;
}

function formatWhen(date: string | null, time: string | null): string {
  const parts: string[] = [];
  const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (match) {
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month >= 1 && month <= 12) parts.push(`${day} ${MONTHS[month - 1]}`);
  }
  if (time && /^\d{2}:\d{2}/.test(time)) parts.push(time.slice(0, 5));
  return parts.join(', ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
