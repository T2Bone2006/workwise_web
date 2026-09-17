import { z } from 'zod';

const ukPhoneRegex = /^(\+44|0)[0-9\s]{9,13}$/;
const ukPostcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;

export const signupSchema = z.object({
  product: z.enum(['rounds', 'lite']),
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters').max(120),
  fullName: z.string().trim().min(2, 'Please enter your name').max(120),
  email: z.string().trim().min(1, 'Email is required').email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  phone: z
    .string()
    .trim()
    .regex(ukPhoneRegex, 'Please enter a valid UK mobile number')
    .transform((val) => val.replace(/\s/g, '')),
  postcode: z
    .string()
    .trim()
    .regex(ukPostcodeRegex, 'Please enter a valid UK postcode')
    .transform((val) => val.toUpperCase()),
  /** Lite only: what the business does, for the chatbot. */
  trade: z.string().trim().max(80).optional().or(z.literal('')),
});

export type SignupInput = z.input<typeof signupSchema>;
export type SignupValues = z.output<typeof signupSchema>;
