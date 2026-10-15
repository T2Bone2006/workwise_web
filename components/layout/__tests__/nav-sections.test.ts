import { describe, expect, it } from 'vitest';
import { buildNavSections, workerSectionTitle } from '@/components/layout/nav-sections';
import {
  employeeFeatures,
  featuresFromProducts,
  withWorkerBlock,
  type TenantFeatures,
} from '@/lib/data/tenant-features';
import type { TenantProducts } from '@/lib/data/tenant-products';

const products = (over: Partial<TenantProducts>): TenantProducts => ({
  products: [],
  isPro: false,
  hasRounds: false,
  hasLite: false,
  primary: null,
  trialEndsAt: null,
  source: 'subscriptions',
  ...over,
});

const hrefs = (features: TenantFeatures) =>
  buildNavSections(features).flatMap((section) => section.items.map((item) => item.href));

describe('buildNavSections for workers', () => {
  it('gives an employee the four worker tabs and nothing from the office', () => {
    const sections = buildNavSections(employeeFeatures('Acme Locks'));
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBeUndefined();
    expect(hrefs(employeeFeatures('Acme Locks'))).toEqual([
      '/worker',
      '/worker/calendar',
      '/worker/jobs',
      '/worker/profile',
    ]);
  });

  it('gives a subcontractor with no plan the worker block (titled) and Settings', () => {
    const features = withWorkerBlock(featuresFromProducts(products({})), 'Acme Locks');
    const sections = buildNavSections(features);
    expect(sections[0].title).toBe('Work for Acme Locks');
    expect(sections[0].product).toBe('worker');
    expect(hrefs(features)).toEqual(['/worker', '/worker/calendar', '/worker/jobs', '/worker/profile', '/settings']);
  });

  it('shows the worker block and then the Lite block once Lite is bought', () => {
    const features = withWorkerBlock(
      featuresFromProducts(products({ products: ['lite'], hasLite: true, primary: 'lite' })),
      'Acme Locks',
    );
    const sections = buildNavSections(features);
    expect(sections.map((s) => s.product ?? 'settings')).toEqual(['worker', 'lite', 'settings']);
    expect(sections[1].title).toBe('Lite');
    expect(hrefs(features).filter((h) => h === '/dashboard')).toHaveLength(0);
  });

  it('leaves everyone who is not a worker exactly as before', () => {
    const pro = featuresFromProducts(products({ products: ['pro'], isPro: true, primary: 'pro' }));
    expect(hrefs(pro)).toContain('/jobs');
    expect(hrefs(pro)).toContain('/jobs/calendar');
    expect(hrefs(pro)).not.toContain('/worker');
    const rounds = featuresFromProducts(products({ products: ['rounds'], hasRounds: true, primary: 'rounds' }));
    expect(hrefs(rounds)).toContain('/calendar');
    expect(hrefs(rounds)).not.toContain('/worker');
    const lite = featuresFromProducts(products({ products: ['lite'], hasLite: true, primary: 'lite' }));
    expect(hrefs(lite)).not.toContain('/worker');
  });
});

describe('workerSectionTitle', () => {
  it('names the employer, or falls back to a short word for a very long name', () => {
    expect(workerSectionTitle('Acme Locks')).toBe('Work for Acme Locks');
    expect(workerSectionTitle('A Very Long Business Name Limited')).toBe('Work');
    expect(workerSectionTitle(null)).toBe('Work');
    expect(workerSectionTitle('  ')).toBe('Work');
  });
});
