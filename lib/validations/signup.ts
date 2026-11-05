import { z } from 'zod';

const ukPhoneRegex = /^(\+44|0)[0-9\s]{9,13}$/;
const ukPostcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;

const phoneField = z
  .string()
  .trim()
  .refine((val) => val === '' || ukPhoneRegex.test(val), 'Please enter a valid UK mobile number');
const postcodeField = z
  .string()
  .trim()
  .refine((val) => val === '' || ukPostcodeRegex.test(val), 'Please enter a valid UK postcode');

const shape = {
  plan: z.enum(['rounds', 'lite', 'both']),
  interval: z.enum(['month', 'year']),
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(120),
  fullName: z.string().trim().min(2, 'Please enter your name').max(120),
  email: z.string().trim().min(1, 'Email is required').email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  /**
   * Mobile and postcode are optional at sign-up: a shorter form is finished more often, and both can be added later in
   * Settings. The account set-up already copes without them (an empty phone, no home postcode). If given, they must
   * still be valid.
   */
  phone: phoneField,
  postcode: postcodeField,
  /** Lite only: what the business does, for the chatbot. Shown when the plan includes Lite. */
  trade: z.string().trim().max(80).optional().or(z.literal('')),
  /** A customer code or a partner code. The referral cookie is read server-side when this is empty. */
  ref: z.string().trim().max(16, "That referral code isn't recognised.").optional().or(z.literal('')),
};

/** What the server stores: a blank mobile or postcode becomes "not given", and the rest is tidied. */
export const signupSchema = z.object({
  ...shape,
  phone: phoneField.transform((val) => (val === '' ? undefined : val.replace(/\s/g, ''))),
  postcode: postcodeField.transform((val) => (val === '' ? undefined : val.toUpperCase())),
});

/** The browser's check of the same fields. (There is no "confirm password": the eye on the box shows what was typed.) */
export const signupFormSchema = z.object(shape);

export type SignupInput = z.input<typeof signupSchema>;
export type SignupFormInput = z.input<typeof signupFormSchema>;
export type SignupValues = z.output<typeof signupSchema>;
