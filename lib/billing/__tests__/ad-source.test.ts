import { describe, expect, it } from 'vitest';
import { adMetadata, tallyAdSignups } from '../ad-source';

describe('adMetadata', () => {
  it('keeps clean tags under their Stripe names', () => {
    const tags: Record<string, string> = {
      utm_source: 'facebook',
      utm_campaign: 'founding-half-price',
      utm_content: 'lite',
    };
    expect(adMetadata((tag) => tags[tag])).toEqual({
      ad_source: 'facebook',
      ad_campaign: 'founding-half-price',
      ad_content: 'lite',
    });
  });

  it('is empty for an ordinary sign-up', () => {
    expect(adMetadata(() => null)).toEqual({});
    expect(adMetadata(() => '')).toEqual({});
  });

  it('drops anything that is not a short slug', () => {
    const tags: Record<string, unknown> = {
      utm_source: 'face book<script>',
      utm_campaign: 'x'.repeat(51),
      utm_content: 'rounds',
    };
    expect(adMetadata((tag) => tags[tag])).toEqual({ ad_content: 'rounds' });
  });
});

describe('tallyAdSignups', () => {
  it('counts started and paid per ad, most started first', () => {
    const rows = tallyAdSignups(
      [
        { adContent: 'lite', signupIntentId: 'a' },
        { adContent: 'rounds', signupIntentId: 'b' },
        { adContent: 'rounds', signupIntentId: 'c' },
        { adContent: null, signupIntentId: null },
      ],
      new Set(['a', 'c']),
    );
    expect(rows).toEqual([
      { ad: 'rounds', started: 2, paid: 1 },
      { ad: 'lite', started: 1, paid: 1 },
      { ad: 'unknown', started: 1, paid: 0 },
    ]);
  });
});
