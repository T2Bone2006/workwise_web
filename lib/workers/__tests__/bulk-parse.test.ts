import { describe, expect, it } from 'vitest';
import { BULK_MAX_ROWS, parseBulkWorkers, validateBulkRows, type BulkRow } from '@/lib/workers/bulk-parse';

describe('parseBulkWorkers', () => {
  it('reads an Excel or Sheets paste (tabs) with a header in any order', () => {
    const text = 'Phone\tName\tEmail\tPostcode\n07700 900123\tDave Mercer\tdave@example.com\tM3 2ER\n';
    const { rows, truncated, unknownHeaders } = parseBulkWorkers(text);
    expect(truncated).toBe(false);
    expect(unknownHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 1, name: 'Dave Mercer', phone: '07700 900123', postcode: 'M3 2ER', email: 'dave@example.com' });
  });

  it('reads a CSV with quoted fields that contain commas, quotes and line breaks', () => {
    const text = 'name,phone,postcode,email\n"Mercer, Dave",07700900123,M3 2ER,\n"Priya ""P"" Shah",07700900124,SW1A 1AA,priya@example.com\n';
    const { rows } = parseBulkWorkers(text);
    expect(rows.map((r) => r.name)).toEqual(['Mercer, Dave', 'Priya "P" Shah']);
    expect(rows[0].email).toBe('');
    const multi = parseBulkWorkers('name,phone,postcode,email\n"Tom\nKowalski",07700900125,M3 2ER,\n');
    expect(multi.rows[0].name).toBe('Tom\nKowalski');
  });

  it('reads columns by position when there is no header, and takes semicolons', () => {
    const { rows } = parseBulkWorkers('Dave Mercer;07700900123;M3 2ER;dave@example.com');
    expect(rows[0]).toMatchObject({ name: 'Dave Mercer', phone: '07700900123', postcode: 'M3 2ER', email: 'dave@example.com' });
  });

  it('skips blank lines and numbers the rest from 1', () => {
    const { rows } = parseBulkWorkers('Name\tPhone\tPostcode\n\nA One\t07700900001\tM3 2ER\n\n\nB Two\t07700900002\tM3 2ER\n');
    expect(rows.map((r) => r.line)).toEqual([1, 2]);
  });

  it('reports unknown headings and ignores those columns', () => {
    const { rows, unknownHeaders } = parseBulkWorkers('Name\tPhone\tPostcode\tShoe size\nA One\t07700900001\tM3 2ER\t9\n');
    expect(unknownHeaders).toEqual(['Shoe size']);
    expect(rows[0].email).toBe('');
  });

  it('keeps the first 100 rows and flags truncation', () => {
    const body = Array.from({ length: 150 }, (_, i) => `Worker ${i + 1}\t07700${String(900000 + i)}\tM3 2ER`).join('\n');
    const { rows, truncated } = parseBulkWorkers(`Name\tPhone\tPostcode\n${body}`);
    expect(rows).toHaveLength(BULK_MAX_ROWS);
    expect(truncated).toBe(true);
  });

  it('returns nothing for empty input', () => {
    expect(parseBulkWorkers('').rows).toEqual([]);
    expect(parseBulkWorkers('  \n \n').rows).toEqual([]);
  });
});

function row(over: Partial<{ name: string; phone: string; postcode: string; email: string; line: number }> = {}) {
  return { name: 'Dave Mercer', phone: '07700 900123', postcode: 'm3 2er', email: 'dave@example.com', line: 1, errors: [], ...over };
}

describe('validateBulkRows', () => {
  it('accepts a good row and returns the tidied values', () => {
    const [r] = validateBulkRows([row({ email: 'Dave@Example.com' })]);
    expect(r.errors).toEqual([]);
    expect(r.clean).toEqual({ name: 'Dave Mercer', phone: '07700900123', postcode: 'M3 2ER', email: 'dave@example.com' });
  });

  it('gives each problem in plain words', () => {
    const [name] = validateBulkRows([row({ name: '' })]);
    const [phone] = validateBulkRows([row({ phone: '12345' })]);
    const [postcode] = validateBulkRows([row({ postcode: 'nope' })]);
    const [email] = validateBulkRows([row({ email: 'not-an-email' })]);
    expect(name.errors).toEqual(['Needs a name']);
    expect(phone.errors).toEqual(["Phone number doesn't look right"]);
    expect(postcode.errors).toEqual(["Postcode doesn't look right"]);
    expect(email.errors).toEqual(["Email doesn't look right"]);
    expect(name.clean).toBeUndefined();
  });

  it('needs an email, because the invite email is how a worker gets their login', () => {
    const [r] = validateBulkRows([row({ email: '  ' })]);
    expect(r.errors).toEqual(['Needs an email so they can log in']);
    expect(r.clean).toBeUndefined();
  });

  it('gives the leading 0 back to a number Excel turned into a plain number', () => {
    const [r] = validateBulkRows([row({ phone: '7700900123' })]);
    expect(r.clean?.phone).toBe('07700900123');
    expect(validateBulkRows([row({ phone: '+447700900123' })])[0].errors).toEqual([]);
  });

  it('marks a repeated email or phone inside the batch against the first line', () => {
    const rows = validateBulkRows([
      row({ line: 1, email: 'a@example.com', phone: '07700900111' }),
      row({ line: 2, name: 'Other', email: 'a@example.com', phone: '07700900222' }),
      row({ line: 3, name: 'Third', email: 'c@example.com', phone: '07700900111' }),
    ]);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toEqual(['Same email as line 1']);
    expect(rows[2].errors).toEqual(['Same phone number as line 1']);
  });

  it('does not change its input', () => {
    const input: BulkRow[] = [row()];
    validateBulkRows(input);
    expect(input[0].clean).toBeUndefined();
  });
});
