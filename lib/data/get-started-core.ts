// Pure rules for the Get started panel (no database, no server-only imports).

export type GetStartedState = {
  /** True only for the signed-in admin of a Stripe-billed Pro business that still has something left to do. */
  show: boolean;
  /** From the pricing slider at sign-up; null when absent. Never used for billing. */
  expectedWorkers: number | null;
  steps: {
    team: { done: boolean; count: number };
    customers: { done: boolean; count: number };
    jobs: { done: boolean; count: number };
  };
};

/** Pure: decides `show` and the step flags from the counts, the subscription source and the role. */
export function getStartedFrom(input: {
  isAdmin: boolean;
  stripeBilledPro: boolean;
  teamCount: number;
  customerCount: number;
  jobCount: number;
  expectedWorkers: unknown;
}): GetStartedState {
  const team = { done: input.teamCount >= 1, count: input.teamCount };
  const customers = { done: input.customerCount >= 1, count: input.customerCount };
  const jobs = { done: input.jobCount >= 1, count: input.jobCount };
  const expected =
    typeof input.expectedWorkers === 'number' &&
    Number.isInteger(input.expectedWorkers) &&
    input.expectedWorkers >= 1 &&
    input.expectedWorkers <= 999
      ? input.expectedWorkers
      : null;
  return {
    show: input.isAdmin && input.stripeBilledPro && !(team.done && customers.done && jobs.done),
    expectedWorkers: expected,
    steps: { team, customers, jobs },
  };
}

