/** True only for a UK mobile in E.164: +447 followed by exactly 9 digits. */
export function isUkMobileE164(
  value: string | null | undefined,
): value is string {
  if (typeof value !== 'string') return false;
  return /^\+447\d{9}$/.test(value);
}

/** '+447700900123' -> '+44 77•• ••0123'. Anything else -> '•••'. For logs only. */
export function maskPhone(value: string | null | undefined): string {
  if (!isUkMobileE164(value)) return '•••';
  const nsn = value.slice(3); // 10 digits after +44
  return `+44 ${nsn.slice(0, 2)}•• ••${nsn.slice(6)}`;
}
