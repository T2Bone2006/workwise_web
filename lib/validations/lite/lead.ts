import { z } from 'zod';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'any'] as const;
export const widgetLeadSchema = z.object({
  clientId: z.string().uuid(),
  conversationId: z.string().uuid(),
  session: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(80),
  mobile: z.string().trim().min(10).max(20),
  postcode: z.string().trim().min(5).max(9),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  preferredDays: z.array(z.enum(DAY_KEYS)).max(7),
  note: z.string().trim().max(120).optional().or(z.literal('')),
  wantsBooking: z.boolean(),
});

export type WidgetLeadValues = z.infer<typeof widgetLeadSchema>;

export const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
