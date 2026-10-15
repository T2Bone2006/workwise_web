import { describe, expect, it } from 'vitest';
import { shapeTeamBilling, showTeamLine } from '../team-billing-core';

describe('shapeTeamBilling', () => {
  it('monthly: 2 leads at £10 is £20 a month', () => {
    expect(shapeTeamBilling({ leadCount: 2, canAddLeads: true, interval: 'month', perLeadPence: 1000 })).toEqual({
      leadCount: 2, interval: 'month', perLeadPence: 1000, totalPence: 2000, canAddLeads: true,
    });
  });
  it('yearly: the figure is per year, not times twelve', () => {
    expect(shapeTeamBilling({ leadCount: 2, canAddLeads: true, interval: 'year', perLeadPence: 10000 }).totalPence).toBe(20000);
  });
  it('never goes negative or fractional', () => {
    expect(shapeTeamBilling({ leadCount: -3, canAddLeads: true, interval: 'month', perLeadPence: 1000 }).leadCount).toBe(0);
    expect(shapeTeamBilling({ leadCount: 2.9, canAddLeads: true, interval: 'month', perLeadPence: 1000 }).leadCount).toBe(2);
  });
});

describe('showTeamLine', () => {
  it('shows with leads or when the plan could take them, and not otherwise', () => {
    const base = { interval: null, perLeadPence: 1000, totalPence: 0 } as const;
    expect(showTeamLine({ ...base, leadCount: 0, canAddLeads: false })).toBe(false);
    expect(showTeamLine({ ...base, leadCount: 0, canAddLeads: true })).toBe(true);
    expect(showTeamLine({ ...base, leadCount: 1, canAddLeads: false })).toBe(true);
  });
});
