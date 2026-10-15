import { z } from 'zod';

export const widgetWebsiteSchema = z.object({ website: z.string().trim().min(3).max(200) });

export const widgetLookSchema = z.object({
  primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  greeting: z.string().trim().min(5).max(200),
});

export const widgetTextsSchema = z.object({
  signOffName: z.string().trim().min(1).max(40),
  ownerMobile: z.string().trim().max(20).optional().or(z.literal('')),
  followUpEnabled: z.boolean(),
  textMeToo: z.boolean(),
  notificationEmail: z.string().trim().email().max(200),
});

export type WidgetLookValues = z.infer<typeof widgetLookSchema>;
export type WidgetTextsValues = z.infer<typeof widgetTextsSchema>;
