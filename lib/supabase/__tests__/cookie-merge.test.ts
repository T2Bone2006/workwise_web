import { describe, expect, it } from 'vitest';
import { mergeCookies } from '@/lib/supabase/cookie-merge';

describe('mergeCookies', () => {
  it('keeps every cookie the browser sent when the response set none', () => {
    const merged = mergeCookies([{ name: 'sb-access', value: 'a' }, { name: 'theme', value: 'dark' }], []);
    expect(merged).toEqual([{ name: 'sb-access', value: 'a' }, { name: 'theme', value: 'dark' }]);
  });

  it('lets a refreshed cookie on the response replace the stale one from the request', () => {
    const merged = mergeCookies(
      [{ name: 'sb-access', value: 'old' }, { name: 'theme', value: 'dark' }],
      [{ name: 'sb-access', value: 'new' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.name === 'sb-access')?.value).toBe('new');
    expect(merged.find((c) => c.name === 'theme')?.value).toBe('dark');
  });

  it('adds cookies that only the response has', () => {
    expect(mergeCookies([], [{ name: 'sb-access', value: 'x' }])).toEqual([{ name: 'sb-access', value: 'x' }]);
  });

  it('is empty when both are empty', () => {
    expect(mergeCookies([], [])).toEqual([]);
  });
});
