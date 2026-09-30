'use client';

import type { JSX } from 'react';
import { SearchableSelect } from '@/components/ui/searchable-select';

/**
 * Searchable picker of the business's customers (reuses the app's
 * SearchableSelect). The caller passes only customers who can be linked.
 */
export function CustomerPicker(props: {
  customers: { id: string; name: string }[];
  value: string | undefined;
  onChange: (customerId: string) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <SearchableSelect
      options={props.customers.map((c) => ({ value: c.id, label: c.name }))}
      value={props.value}
      onValueChange={props.onChange}
      placeholder="Choose a customer"
      searchPlaceholder="Search customers…"
      emptyText="No customers to link."
      disabled={props.disabled}
      className="w-full sm:w-64"
    />
  );
}
