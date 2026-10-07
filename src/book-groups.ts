export interface BookGroup {
  id: string;
  name: string;
  bookIds: string[];
  autoMatch?: boolean;
  excludedIds?: string[];
}
/** A volume belongs to one group; the ID list also stores its manual reading order. */
export function normalizeGroups(value: unknown): BookGroup[] {
  if (!Array.isArray(value)) return [];
  const usedGroups = new Set<string>(),
    usedBooks = new Set<string>();
  return value.flatMap((item): BookGroup[] => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      usedGroups.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim()
    )
      return [];
    usedGroups.add(item.id);
    const bookIds = Array.isArray(item.bookIds)
      ? item.bookIds.filter((id: unknown): id is string => {
          if (typeof id !== "string" || !id || usedBooks.has(id)) return false;
          usedBooks.add(id);
          return true;
        })
      : [];
    return [
      {
        id: item.id,
        name: item.name.trim().slice(0, 80),
        bookIds,
        autoMatch: item.autoMatch !== false,
        excludedIds: Array.isArray(item.excludedIds)
          ? ([
              ...new Set(
                item.excludedIds.filter(
                  (id: unknown) =>
                    typeof id === "string" && !bookIds.includes(id),
                ),
              ),
            ] as string[])
          : [],
      },
    ];
  });
}
export function saveGroup(groups: BookGroup[], group: BookGroup) {
  const ids = new Set(group.bookIds);
  const next = groups.map((item) =>
    item.id === group.id
      ? group
      : { ...item, bookIds: item.bookIds.filter((id) => !ids.has(id)) },
  );
  if (!next.some((item) => item.id === group.id)) next.push(group);
  return normalizeGroups(next);
}
export function remapGroups(
  groups: BookGroup[],
  books: { id: string; aliases?: string[] }[],
) {
  const aliases = new Map(
    books.flatMap((book) =>
      (book.aliases ?? []).map((alias) => [alias, book.id] as const),
    ),
  );
  return normalizeGroups(
    groups.map((group) => ({
      ...group,
      bookIds: group.bookIds.map((id) => aliases.get(id) ?? id),
      excludedIds: group.excludedIds?.map((id) => aliases.get(id) ?? id),
    })),
  );
}

function seriesKey(name: string) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(
      /(?:第\s*)?[零〇一二三四五六七八九十百\d]+\s*[卷巻册集部]|[卷巻册集部]\s*[零〇一二三四五六七八九十百\d]+|\bvol(?:ume)?\.?\s*\d+/gi,
      "",
    )
    .replace(/[\s_\-–—]+\d{1,3}\s*$/, "")
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}
/** Match complete series names; never steal manually assigned or excluded volumes. */
export function autoGroupBooks(
  groups: BookGroup[],
  books: { id: string; name: string }[],
  titles: Record<string, { title?: string }> = {},
) {
  const occupied = new Set(groups.flatMap((group) => group.bookIds));
  const bySeries = new Map(
    groups
      .filter((group) => group.autoMatch !== false)
      .map((group) => [seriesKey(group.name), group]),
  );
  const additions = new Map<string, typeof books>();
  for (const book of books) {
    if (occupied.has(book.id)) continue;
    const group =
      bySeries.get(seriesKey(book.name)) ??
      bySeries.get(seriesKey(titles[book.id]?.title ?? ""));
    if (!group || group.excludedIds?.includes(book.id)) continue;
    occupied.add(book.id);
    const list = additions.get(group.id) ?? [];
    list.push(book);
    additions.set(group.id, list);
  }
  if (!additions.size) return groups;
  const collator = new Intl.Collator("zh-CN", { numeric: true });
  return groups.map((group) => {
    const found = additions.get(group.id);
    return found
      ? {
          ...group,
          bookIds: [
            ...group.bookIds,
            ...found
              .sort((a, b) => collator.compare(a.name, b.name))
              .map((book) => book.id),
          ],
        }
      : group;
  });
}
