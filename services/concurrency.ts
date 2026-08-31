/**
 * Helpers for the chunked Supabase fetches used by the dashboard.
 *
 * Those fetches used to run strictly one-after-another inside a `for` loop, so a
 * store with a few thousand orders paid for dozens of sequential round-trips
 * before anything could render. Running a bounded number of them in parallel
 * keeps the request pattern identical while cutting the wall-clock wait.
 */

export const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return results;
};
