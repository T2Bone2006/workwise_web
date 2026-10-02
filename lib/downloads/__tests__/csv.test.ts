import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { toCsv, whole } from '@/lib/downloads/csv';
import { textFile, zipFiles } from '@/lib/downloads/zip';

const body = (csv: string) => csv.replace(/^﻿/, '');

describe('toCsv', () => {
  it('starts with a BOM so Excel reads UTF-8 (£ and accents)', () => {
    const csv = toCsv(['Name'], [['Zoë £5']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(body(csv)).toBe('Name\r\nZoë £5\r\n');
  });

  it('quotes commas, quotes and line breaks, and doubles inner quotes', () => {
    expect(body(toCsv(['A', 'B'], [['one, two', 'say "hi"'], ['line\nbreak', 'x']]))).toBe(
      'A,B\r\n"one, two","say ""hi"""\r\n"line\nbreak",x\r\n',
    );
  });

  it('writes numbers with two decimals, negatives as numbers, and empties as nothing', () => {
    expect(body(toCsv(['n'], [[12], [-5], [0.1 + 0.2], [null], [undefined], [Number.NaN]]))).toBe(
      'n\r\n12.00\r\n-5.00\r\n0.30\r\n\r\n\r\n\r\n',
    );
  });

  it('guards text that a spreadsheet would run as a formula', () => {
    const one = (text: string) => body(toCsv(['t'], [[text]])).split('\r\n')[1];
    expect(one('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(one('+1+1')).toBe("'+1+1");
    expect(one('-1+1')).toBe("'-1+1");
    expect(one('@cmd')).toBe("'@cmd");
    expect(one('\tx')).toBe("'\tx");
    // A leading carriage return is guarded, and then quoted because it is a line break.
    expect(body(toCsv(['t'], [['\rx']]))).toBe("t\r\n\"'\rx\"\r\n");
  });

  it('leaves ordinary text and real numbers alone', () => {
    const one = (v: string | number) => body(toCsv(['t'], [[v]])).split('\r\n')[1];
    expect(one('safe')).toBe('safe');
    expect(one('a=b')).toBe('a=b');
    expect(one('Mr -Smith')).toBe('Mr -Smith');
    expect(one(-5)).toBe('-5.00');
  });

  it('keeps an empty table as just its header', () => {
    expect(body(toCsv(['A', 'B'], []))).toBe('A,B\r\n');
  });

  it('whole() writes a count without decimals', () => {
    expect(whole(3)).toBe('3');
    expect(whole(7.9)).toBe('7');
  });
});

describe('zipFiles', () => {
  it('round-trips files and keeps UTF-8 text intact', () => {
    const zip = zipFiles([
      textFile('README.txt', 'Hello — £5\n'),
      { name: 'receipts/a.jpg', bytes: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const out = unzipSync(zip);
    expect(Object.keys(out).sort()).toEqual(['README.txt', 'receipts/a.jpg']);
    expect(strFromU8(out['README.txt'])).toBe('Hello — £5\n');
    expect([...out['receipts/a.jpg']]).toEqual([1, 2, 3, 4]);
  });
});
