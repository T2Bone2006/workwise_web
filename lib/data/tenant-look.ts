import { cache } from 'react';
import type { TenantProducts } from '@/lib/data/tenant-products';
import type { Look } from '@/components/look/use-look';

/** Every business is on the new look (see lookFromSettings). Kept as a function so the pages that ask do not change. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getTenantLook = cache(async (_products: TenantProducts): Promise<Look> => 'new');
