// en_IN groups by lakhs (3,81,102). Diff counts stay in thousands.
const DIFF_COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatDiffCount(count: number): string {
  return DIFF_COUNT_FORMAT.format(count);
}
