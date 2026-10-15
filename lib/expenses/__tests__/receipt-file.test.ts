import { describe, expect, it } from 'vitest';
import { decideReceiptFile, shrunkSize } from '@/lib/expenses/receipt-file';

const MB = 1024 * 1024;
const f = (name: string, type: string, size: number) => ({ name, type, size });

describe('decideReceiptFile', () => {
  it('sends small photos and PDFs as they are', () => {
    expect(decideReceiptFile(f('a.jpg', 'image/jpeg', 400 * 1024))).toEqual({ action: 'send' });
    expect(decideReceiptFile(f('a.pdf', 'application/pdf', 2 * MB))).toEqual({ action: 'send' });
  });
  it('shrinks big photos', () => {
    expect(decideReceiptFile(f('IMG.jpg', 'image/jpeg', 6 * MB))).toEqual({ action: 'shrink' });
    expect(decideReceiptFile(f('x.png', 'image/png', 2 * MB))).toEqual({ action: 'shrink' });
  });
  it('converts HEIC by type or by name instead of refusing it', () => {
    expect(decideReceiptFile(f('a.heic', 'image/heic', 1000))).toEqual({ action: 'convert' });
    expect(decideReceiptFile(f('A.HEIC', '', 1000))).toEqual({ action: 'convert' });
    expect(decideReceiptFile(f('b.heif', 'image/heif', 9 * MB))).toEqual({ action: 'convert' });
  });
  it('refuses a PDF over 4 MB and anything that is not a photo or PDF', () => {
    expect(decideReceiptFile(f('a.pdf', 'application/pdf', 4 * MB + 1)).action).toBe('refuse');
    expect(decideReceiptFile(f('a.gif', 'image/gif', 1000)).action).toBe('refuse');
    expect(decideReceiptFile(f('a.docx', '', 1000)).action).toBe('refuse');
  });
  it('trusts the file name when the browser gives no type', () => {
    expect(decideReceiptFile(f('a.jpeg', '', 1000))).toEqual({ action: 'send' });
    expect(decideReceiptFile(f('a.pdf', '', 1000))).toEqual({ action: 'send' });
  });
});

describe('shrunkSize', () => {
  it('scales the longer edge down to 2000 and keeps the shape', () => {
    expect(shrunkSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(shrunkSize(3000, 6000)).toEqual({ width: 1000, height: 2000 });
  });
  it('never enlarges', () => {
    expect(shrunkSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
