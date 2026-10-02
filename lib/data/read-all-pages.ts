export const PAGE_SIZE = 1000; // the database returns at most this many rows per request

type Row = Record<string, unknown>;

/** Reads every page, so a busy year is never silently cut at 1,000 rows. Any error throws. */
export async function readAllPages(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  errorMessage: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(errorMessage);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
