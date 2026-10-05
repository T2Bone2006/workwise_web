import { afterEach, describe, expect, it } from 'vitest';
import { makeWidgetSession, verifyWidgetSession } from '@/lib/widget/session';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CONV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-10-02T12:00:00.000Z');

describe('widget session', () => {
  const original = process.env.WIDGET_SESSION_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.WIDGET_SESSION_SECRET;
    else process.env.WIDGET_SESSION_SECRET = original;
  });

  it('accepts a token only for the widget and conversation it was made for, until it expires', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { token, expiresAt } = makeWidgetSession(CLIENT, CONV_A, NOW);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);

    expect(verifyWidgetSession(token, CLIENT, CONV_A, NOW)).toBe(true);
    expect(verifyWidgetSession(token, CLIENT, CONV_A, new Date(expiresAt.getTime() - 1000))).toBe(true);
    expect(verifyWidgetSession(token, CLIENT, CONV_B, NOW)).toBe(false);
    expect(verifyWidgetSession(token, OTHER, CONV_A, NOW)).toBe(false);
    expect(verifyWidgetSession(token, CLIENT, CONV_A, new Date(expiresAt.getTime() + 1000))).toBe(false);
  });

  it('rejects a token whose expiry was changed, because the mac no longer matches', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { token } = makeWidgetSession(CLIENT, CONV_A, NOW);
    const dot = token.indexOf('.');
    const shifted = `${Number(token.slice(0, dot)) + 60}${token.slice(dot)}`;
    expect(verifyWidgetSession(shifted, CLIENT, CONV_A, NOW)).toBe(false);
  });

  it('rejects a bad shape', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    for (const bad of ['abc', '', null, 42]) {
      expect(verifyWidgetSession(bad, CLIENT, CONV_A, NOW)).toBe(false);
    }
  });

  it('rejects every token when the secret is missing or blank', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { token } = makeWidgetSession(CLIENT, CONV_A, NOW);
    delete process.env.WIDGET_SESSION_SECRET;
    expect(verifyWidgetSession(token, CLIENT, CONV_A, NOW)).toBe(false);
    expect(() => makeWidgetSession(CLIENT, CONV_A, NOW)).toThrow(/WIDGET_SESSION_SECRET/);
    process.env.WIDGET_SESSION_SECRET = '   ';
    expect(verifyWidgetSession(token, CLIENT, CONV_A, NOW)).toBe(false);
  });

  it('rejects a token made under a different secret', () => {
    process.env.WIDGET_SESSION_SECRET = 'test-widget-secret';
    const { token } = makeWidgetSession(CLIENT, CONV_A, NOW);
    process.env.WIDGET_SESSION_SECRET = 'other-secret';
    expect(verifyWidgetSession(token, CLIENT, CONV_A, NOW)).toBe(false);
  });
});
