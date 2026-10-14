import { describe, expect, it } from 'vitest';
import { countSegments } from '@/lib/messaging/gsm';
import {
  WORKER_JOB_TEXT_ALLOWANCE,
  groupSentJobs,
  jobAlertEmail,
  jobAlertSms,
  proTierForJobTexts,
  shouldEmailJobAlert,
  shouldTextJobAlert,
  toSentJob,
  ukMobileForAlert,
  type SentJob,
} from '@/lib/jobs/worker-job-alert';

function job(over: Partial<SentJob> = {}): SentJob {
  return {
    id: 'job-1',
    workerId: 'w1',
    referenceNumber: 'WW-1',
    postcode: 'SW1A 1AA',
    scheduledDate: '2026-10-15',
    scheduledTime: '09:00:00',
    customerName: 'Jane Smith',
    ...over,
  };
}

describe('worker job text allowance', () => {
  it('is one text a day for 25 days, for the workers the plan includes', () => {
    expect(WORKER_JOB_TEXT_ALLOWANCE).toEqual({ starter: 250, growth: 875, pro: 1750 });
  });

  it('picks the highest entitled Pro tier and ignores Rounds', () => {
    expect(
      proTierForJobTexts([
        { product: 'rounds', status: 'active' },
        { product: 'starter', status: 'active' },
        { product: 'growth', status: 'canceled' },
      ]),
    ).toBe('starter');
    expect(
      proTierForJobTexts([
        { product: 'starter', status: 'active' },
        { product: 'pro', status: 'manual' },
      ]),
    ).toBe('pro');
    expect(proTierForJobTexts([{ product: 'lite', status: 'active' }])).toBeNull();
  });
});

describe('job alert wording', () => {
  it('groups one send into one list per worker, soonest first', () => {
    const groups = groupSentJobs([
      job({ id: 'b', workerId: 'dave', scheduledTime: '11:00:00' }),
      job({ id: 'c', workerId: 'pete' }),
      job({ id: 'a', workerId: 'dave', scheduledTime: '08:00:00' }),
    ]);
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('emails a short list and does not include the address', () => {
    const { subject, html } = jobAlertEmail({
      businessName: 'RS Locksmiths',
      jobs: [job(), job({ id: 'job-2', customerName: 'Sam <script>', postcode: 'E1 6AN' })],
    });
    expect(subject).toBe('2 new jobs from RS Locksmiths');
    expect(html).toContain('15 Oct, 09:00 · SW1A 1AA · Jane Smith');
    expect(html).toContain('Sam &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('access');
  });

  it('keeps the text to one segment even with a long business name', () => {
    const short = jobAlertSms('RS Locksmiths', 5);
    expect(short).toBe('RS Locksmiths: 5 new jobs. Open the app.');
    expect(countSegments(short).segments).toBe(1);

    const long = jobAlertSms(`${'Locksmith '.repeat(20)}`, 12);
    expect(countSegments(long).segments).toBe(1);
    expect(long).toBe('12 new jobs. Open the app.');
  });

  it('texts a UK mobile only, and emails unless they turned email off', () => {
    expect(ukMobileForAlert('07700 900123')).toBe('+447700900123');
    expect(ukMobileForAlert('020 7946 0000')).toBeNull();
    expect(shouldTextJobAlert({ notifySms: false, hasUkMobile: true, allowance: 250 })).toBe(false);
    expect(shouldTextJobAlert({ notifySms: true, hasUkMobile: true, allowance: 250 })).toBe(true);
    expect(shouldTextJobAlert({ notifySms: true, hasUkMobile: false, allowance: 250 })).toBe(false);
    expect(shouldTextJobAlert({ notifySms: true, hasUkMobile: true, allowance: null })).toBe(false);
    expect(shouldEmailJobAlert({ notifyEmail: true, hasEmail: true, allowanceUsedUp: false })).toBe(true);
    expect(shouldEmailJobAlert({ notifyEmail: false, hasEmail: true, allowanceUsedUp: false })).toBe(false);
    expect(shouldEmailJobAlert({ notifyEmail: false, hasEmail: true, allowanceUsedUp: true })).toBe(true);
    expect(shouldEmailJobAlert({ notifyEmail: false, hasEmail: false, allowanceUsedUp: true })).toBe(false);
  });

  it('reads the customer name off the send row', () => {
    expect(
      toSentJob({
        id: 'abc123456789',
        reference_number: ' WW-9 ',
        assigned_worker_id: 'w1',
        postcode: 'SW1A 1AA',
        scheduled_date: '2026-10-15',
        scheduled_time: '09:00:00',
        customers: [{ name: ' Jane ' }],
      }),
    ).toMatchObject({ referenceNumber: 'WW-9', customerName: 'Jane', workerId: 'w1' });
    expect(toSentJob({ id: 'x', reference_number: null, assigned_worker_id: null })).toBeNull();
  });
});
