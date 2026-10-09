import { z } from 'zod';

const ukPhoneRegex = /^(\+44|0)[0-9\s]{9,13}$/; // same as lib/validations/signup.ts

export const proSignupSchema = z.object({
  tier: z.enum(['starter', 'growth', 'pro']),
  interval: z.enum(['month', 'year']),
  /** From the pricing slider; advice only. Empty or garbage becomes undefined; a whole number 1–999 when present. */
  workers: z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 999 ? n : undefined;
  }, z.number().int().min(1).max(999).optional()),
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(120),
  fullName: z.string().trim().min(2, 'Please enter your name').max(120),
  email: z.string().trim().min(1, 'Email is required').email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  phone: z
    .string()
    .trim()
    .regex(ukPhoneRegex, 'Please enter a valid UK mobile number')
    .transform((val) => val.replace(/\s/g, '')),
  trade: z.string().trim().min(2, 'Tell us what your business does').max(80),
  /** From ?ref=; the referral cookie is read server-side. */
  ref: z.string().trim().max(16).optional().or(z.literal('')),
});

/** Client-only: the same fields with a plain numeric `workers` (the browser holds a number) plus confirmPassword.
 *  startProSignup still reads proSignupSchema, which also accepts the string a form posts. */
export const proSignupFormSchema = proSignupSchema
  .omit({ workers: true })
  .extend({
    workers: z.number().int().min(1).max(999).optional(),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ProSignupInput = z.input<typeof proSignupSchema>;
export type ProSignupFormInput = z.input<typeof proSignupFormSchema>;
export type ProSignupValues = z.output<typeof proSignupSchema>;
