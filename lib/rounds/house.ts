import { ukPostcodeSchema } from '@/lib/validations/rounds/agreement';

/**
 * A customer's address is kept on `customers.billing_address` as one line
 * ("12 Elm Road, SW1A 1AA"), which is the shape an invoice bill-to needs.
 * Each service keeps its own copy so visits carry an address.
 */
export function joinHouse(address: string, postcode: string): string | null {
  const line = address.trim();
  if (!line) return null;
  const parsed = ukPostcodeSchema.safeParse(postcode);
  const pc = parsed.success ? parsed.data : postcode.trim();
  return pc ? `${line}, ${pc}` : line;
}

/** Splits the stored line back into the two fields the forms use. */
export function splitHouse(
  line: string | null | undefined,
): { address: string; postcode: string } {
  const text = (line ?? '').trim();
  if (!text) return { address: '', postcode: '' };

  const cut = text.lastIndexOf(',');
  if (cut === -1) return { address: text, postcode: '' };

  const tail = ukPostcodeSchema.safeParse(text.slice(cut + 1));
  if (!tail.success) return { address: text, postcode: '' };
  return { address: text.slice(0, cut).trim(), postcode: tail.data };
}
