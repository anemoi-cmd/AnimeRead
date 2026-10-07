/** The cover stays alone. A seek keeps its exact source page as the lead page. */
export function spreadPages(page: number, count: number, double: boolean) {
  return double && page > 0 && page + 1 < count ? [page, page + 1] : [page];
}
export function turnPage(
  page: number,
  count: number,
  double: boolean,
  delta: number,
) {
  const step = double && page > 0 ? 2 : 1;
  return Math.max(0, Math.min(count - 1, page + step * delta));
}
