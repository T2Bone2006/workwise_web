import { afterEach, describe, expect, it } from 'vitest';
import { leadActionUrl, litePaths, widgetSnippet } from '@/lib/navigation/lite-paths';

describe('litePaths', () => {
  it('builds a lead path', () => {
    expect(litePaths.lead('x')).toBe('/lite/leads/x');
  });

  it('keeps how-you-price under the widget page', () => {
    expect(litePaths.pricing).toBe('/lite/widget/pricing');
  });
});

describe('leadActionUrl and widgetSnippet', () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  });

  it('builds the one-tap lead URL without a doubled slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.joinworkwise.com/';
    expect(leadActionUrl('tok')).toBe('https://app.joinworkwise.com/lead/tok');
  });

  it('builds the widget snippet from the app URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(widgetSnippet('abc')).toBe(
      '<script src="http://localhost:3000/widget.js?id=abc" async></script>',
    );
  });

  it('keeps a single slash before widget.js when the app URL has a trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000/';
    expect(widgetSnippet('abc')).toBe(
      '<script src="http://localhost:3000/widget.js?id=abc" async></script>',
    );
  });
});
