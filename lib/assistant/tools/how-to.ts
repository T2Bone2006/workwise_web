import 'server-only';

import { z } from 'zod';
import { HOW_TO } from '@/lib/assistant/prompt';
import { defineTool, ok } from '@/lib/assistant/tools/types';

/** Where things are in WorkWise. Fetched only for how-to questions, so it isn't sent with every request. */
export const howTo = defineTool({
  name: 'how_to',
  description: 'Where things are in WorkWise and how they work, for how-to questions or when pointing them to a page.',
  product: 'any',
  status: 'Checking how WorkWise does that',
  schema: z.object({ topic: z.enum(['customers', 'calendar', 'payments', 'messages', 'expenses', 'settings', 'phone', 'lite', 'jobs', 'workers', 'network']) }),
  async run(_ctx, input) {
    return ok({ answer: HOW_TO[input.topic] });
  },
});
