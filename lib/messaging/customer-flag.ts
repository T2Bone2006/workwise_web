/** Yes, No, or follow the business setting. Stored as true, false, or NULL. */
export type MessageChoice = 'default' | 'yes' | 'no';

export function choiceToFlag(choice: MessageChoice): boolean | null {
  if (choice === 'yes') return true;
  if (choice === 'no') return false;
  return null;
}

/** Anything that is not a real boolean is "not chosen" (business default). */
export function asCustomerFlag(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

export function flagToChoice(value: unknown): MessageChoice {
  const flag = asCustomerFlag(value);
  if (flag === true) return 'yes';
  if (flag === false) return 'no';
  return 'default';
}

/** NULL follows the business default. An explicit yes or no wins. */
export function resolveCustomerFlag(
  customer: boolean | null | undefined,
  businessDefault: boolean,
): boolean {
  if (customer === true) return true;
  if (customer === false) return false;
  return businessDefault;
}

export function businessDefaultLabel(on: boolean): string {
  return on ? 'Business default (on)' : 'Business default (off)';
}

export function messageChoiceOptions(businessOn: boolean): { value: MessageChoice; label: string }[] {
  return [
    { value: 'default', label: businessDefaultLabel(businessOn) },
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];
}
