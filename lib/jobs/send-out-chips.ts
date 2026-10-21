/** How many spreadsheet fields the "Send out jobs" dialog shows under each job. */
export const MAX_SOURCE_CHIPS = 4;

/**
 * The fields the dialog would show for one job: alphabetical by name, first few only.
 * The page trims to these up front so the other (often dozens of) fields are never sent to the browser.
 */
export function sourceChipEntries(fields: Record<string, string> | null | undefined): [string, string][] {
  return Object.entries(fields ?? {})
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_SOURCE_CHIPS);
}
