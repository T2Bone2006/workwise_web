import type { ZodError } from 'zod';

/** The first thing wrong with a form, in the words the schema gave it. */
export function firstZodErrorMessage(error: ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}
