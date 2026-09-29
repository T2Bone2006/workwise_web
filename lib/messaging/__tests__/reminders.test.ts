import { describe, expect, it } from 'vitest';
import {
  planReminders,
  reminderTargetDate,
  type ReminderCustomer,
  type ReminderVisit,
} from '@/lib/messaging/reminders';
import { visitServiceTitle } from '@/lib/rounds/visit-title';

const DATE = '2026-10-28';

function visit(
  overrides: Partial<ReminderVisit> & Pick<ReminderVisit, 'id'>,
): ReminderVisit {
  return {
    customer_id: 'cust-1',
    service_agreement_id: 'agr-1',
    status: 'assigned',
    scheduled_date: DATE,
    scheduled_time: '09:00',
    address: '12 High Street',
    postcode: 'SW1A 1AA',
    route_position: 1,
    custom_fields: { rounds: { service_name: 'Window clean' } },
    job_description: 'Window clean',
    agreement_reminder_enabled: true,
    ...overrides,
  };
}

function customer(
  overrides: Partial<ReminderCustomer> = {},
): ReminderCustomer {
  return {
    id: 'cust-1',
    is_active: true,
    visit_reminders: true,
    preferred_channel: null,
    phone_e164: '+447700900123',
    ...overrides,
  };
}

function plan(
  visits: ReminderVisit[],
  extras: {
    customers?: Map<string, ReminderCustomer>;
    remindersEnabled?: boolean;
    toldAboutJobIds?: Set<string>;
  } = {},
) {
  const customers =
    extras.customers ?? new Map([['cust-1', customer()]]);
  return planReminders({
    visits,
    customers,
    remindersEnabled: extras.remindersEnabled ?? true,
    toldAboutJobIds: extras.toldAboutJobIds ?? new Set(),
  });
}

describe('planReminders', () => {
  it('skips a customer with reminders off', () => {
    expect(
      plan([visit({ id: 'j1' })], {
        customers: new Map([
          ['cust-1', customer({ visit_reminders: false })],
        ]),
      }),
    ).toEqual([]);
  });

  it('one plan for two agreements at the same house on the same day', () => {
    const plans = plan([
      visit({
        id: 'j-window',
        service_agreement_id: 'agr-w',
        route_position: 1,
        scheduled_time: '09:00',
        custom_fields: { rounds: { service_name: 'Window clean' } },
        job_description: 'Window clean',
      }),
      visit({
        id: 'j-gutters',
        service_agreement_id: 'agr-g',
        route_position: 1,
        scheduled_time: '09:30',
        custom_fields: { rounds: { service_name: 'Gutters' } },
        job_description: 'Gutters',
      }),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      customerId: 'cust-1',
      date: DATE,
      jobIds: ['j-gutters', 'j-window'],
      dedupeKey: `reminder:${DATE}:j-gutters`,
      address: '12 High Street',
      services: ['Window clean', 'Gutters'],
      time: '09:00',
    });
  });

  it('two plans when the same customer has two addresses that day', () => {
    const plans = plan([
      visit({
        id: 'j1',
        address: '12 High Street',
        postcode: 'SW1A 1AA',
        route_position: 1,
      }),
      visit({
        id: 'j2',
        address: '5 Park Lane',
        postcode: 'W1K 1AA',
        route_position: 2,
        custom_fields: { rounds: { service_name: 'Gutters' } },
      }),
    ]);

    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.address)).toEqual([
      '12 High Street',
      '5 Park Lane',
    ]);
    expect(plans.map((p) => p.jobIds)).toEqual([['j1'], ['j2']]);
  });

  it('skips a one-off job with no service_agreement_id', () => {
    expect(
      plan([visit({ id: 'j1', service_agreement_id: null })]),
    ).toEqual([]);
  });

  it('skips visits that are not assigned', () => {
    expect(
      plan([
        visit({ id: 'done', status: 'completed' }),
        visit({ id: 'cancelled', status: 'cancelled' }),
        visit({ id: 'started', status: 'in_progress' }),
      ]),
    ).toEqual([]);
  });

  it('skips landline-only and preferred_channel none', () => {
    expect(
      plan([visit({ id: 'j1' })], {
        customers: new Map([
          ['cust-1', customer({ phone_e164: '+441234567890' })],
        ]),
      }),
    ).toEqual([]);

    expect(
      plan([visit({ id: 'j2' })], {
        customers: new Map([
          ['cust-1', customer({ preferred_channel: 'none' })],
        ]),
      }),
    ).toEqual([]);
  });

  it('skips a visit when the agreement has reminders off; keeps the other at the house', () => {
    const plans = plan([
      visit({
        id: 'j-off',
        service_agreement_id: 'agr-off',
        agreement_reminder_enabled: false,
        route_position: 1,
        scheduled_time: '09:00',
        custom_fields: { rounds: { service_name: 'Gutters' } },
      }),
      visit({
        id: 'j-on',
        service_agreement_id: 'agr-on',
        agreement_reminder_enabled: true,
        route_position: 1,
        scheduled_time: '09:30',
        custom_fields: { rounds: { service_name: 'Window clean' } },
      }),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      jobIds: ['j-on'],
      services: ['Window clean'],
    });
  });

  it('drops the whole stop when any job was already told about a change', () => {
    expect(
      plan(
        [
          visit({ id: 'j1', route_position: 1 }),
          visit({
            id: 'j2',
            route_position: 1,
            scheduled_time: '09:30',
            custom_fields: { rounds: { service_name: 'Gutters' } },
          }),
        ],
        { toldAboutJobIds: new Set(['j2']) },
      ),
    ).toEqual([]);
  });
});

describe('reminderTargetDate and dedupe keys', () => {
  it('adds days across the clocks change and keeps keys stable', () => {
    expect(reminderTargetDate('2026-10-25', 3)).toBe('2026-10-28');
    expect(reminderTargetDate('2026-10-25', 3)).toBe(
      reminderTargetDate('2026-10-25', 3),
    );

    const visits = [visit({ id: 'j1' })];
    const first = plan(visits);
    const second = plan(visits);
    expect(first[0]?.dedupeKey).toBe(`reminder:${DATE}:j1`);
    expect(second[0]?.dedupeKey).toBe(first[0]?.dedupeKey);
  });
});

describe('visitServiceTitle', () => {
  it('prefers custom_fields.rounds.service_name, else job_description, else Visit', () => {
    expect(
      visitServiceTitle({
        custom_fields: { rounds: { service_name: 'Window clean' } },
        job_description: 'Ignored',
      }),
    ).toBe('Window clean');
    expect(
      visitServiceTitle({
        custom_fields: {},
        job_description: 'Gutters',
      }),
    ).toBe('Gutters');
    expect(visitServiceTitle({})).toBe('Visit');
  });
});

describe('remindersEnabled', () => {
  it('returns nothing when business reminders are off', () => {
    expect(
      plan([visit({ id: 'j1' })], { remindersEnabled: false }),
    ).toEqual([]);
  });
});
