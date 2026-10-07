import {
  DEFAULT_STYLE,
  pageTurnDuration,
  type ReaderLocation,
  type ReaderStyle,
} from "./reader-types";
import { DEFAULT_APPEARANCE, type Appearance } from "./appearance-settings";
import { normalizeGroups, remapGroups, type BookGroup } from "./book-groups";

export interface BookMemory {
  title?: string;
  author?: string;
  revision?: string;
  location?: ReaderLocation;
  lastRead?: number;
  readingMillis?: number;
  bookmarks: {
    id: string;
    label: string;
    location: ReaderLocation;
    created: number;
  }[];
}
export interface ReadingMemory {
  style: ReaderStyle;
  books: Record<string, BookMemory>;
  totalReadingMillis?: number;
  appearance?: Appearance;
  groups?: BookGroup[];
}
const KEY = "animeread:reading:v1";
function nonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, number))
    : 0;
}
function restoreLocation(value: unknown): ReaderLocation | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const progress = Math.min(1, nonNegative(item.progress));
  if (
    item.kind === "fixed" &&
    Number.isSafeInteger(item.page) &&
    Number(item.page) >= 0
  )
    return { kind: "fixed", page: Number(item.page), progress };
  if (
    item.kind === "reflow" &&
    typeof item.cfi === "string" &&
    item.cfi.startsWith("epubcfi(") &&
    Number.isSafeInteger(item.section) &&
    Number(item.section) >= 0
  )
    return {
      kind: "reflow",
      cfi: item.cfi,
      section: Number(item.section),
      quote: typeof item.quote === "string" ? item.quote : "",
      progress,
    };
}
function restoreBooks(value: unknown): Record<string, BookMemory> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const bookmarks: BookMemory["bookmarks"] = Array.isArray(item.bookmarks)
        ? item.bookmarks.flatMap((bookmark: Record<string, unknown> | null) => {
            if (
              !bookmark ||
              typeof bookmark.id !== "string" ||
              typeof bookmark.label !== "string"
            )
              return [];
            const location = restoreLocation(bookmark.location);
            return location
              ? [
                  {
                    id: bookmark.id,
                    label: bookmark.label,
                    location,
                    created: nonNegative(bookmark.created),
                  },
                ]
              : [];
          })
        : [];
      return [
        [
          id,
          {
            title: typeof item.title === "string" ? item.title : undefined,
            author: typeof item.author === "string" ? item.author : undefined,
            revision:
              typeof item.revision === "string" ? item.revision : undefined,
            lastRead: nonNegative(item.lastRead),
            readingMillis: nonNegative(item.readingMillis),
            location: restoreLocation(item.location),
            bookmarks,
          },
        ],
      ];
    }),
  );
}
export function loadMemory(): ReadingMemory {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const style = { ...DEFAULT_STYLE, ...(value.style ?? {}) };
    if (![2, 3, 4].includes(value.version)) style.zoom = DEFAULT_STYLE.zoom;
    style.comicLayout = style.comicLayout === "double" ? "double" : "single";
    for (const obsolete of [
      "imageFit",
      "enhanceScale",
      "enhanceNoise",
      "enhanceSoften",
    ])
      delete style[obsolete];
    style.fontSize = Math.max(12, Math.min(64, Number(style.fontSize) || 22));
    style.margin = Math.max(12, Math.min(120, Number(style.margin) || 48));
    style.lineHeight = Math.max(
      1.2,
      Math.min(2.6, Number(style.lineHeight) || 1.85),
    );
    style.zoom = Math.max(0.5, Math.min(3, Number(style.zoom) || 1));
    style.enhanceEnabled = style.enhanceEnabled === true;
    style.pageTurnSound = style.pageTurnSound !== false;
    style.turnDuration = pageTurnDuration(style.turnDuration);
    style.compare = style.compare === true;
    style.enhanceBackend =
      style.enhanceBackend === "waifu2x" ? "waifu2x" : "anime4k";
    style.filters =
      Array.isArray(style.filters) && style.filters.length > 0
        ? style.filters
            .filter((mode: unknown) => ["A", "B", "C"].includes(String(mode)))
            .slice(0, 4)
        : ["A"];
    if (!style.filters.length) style.filters = ["A"];
    if (!["light", "dark", "paper", "ink", "wood"].includes(style.theme))
      style.theme = DEFAULT_STYLE.theme;
    if (!["ltr", "rtl", "ttb"].includes(style.direction))
      style.direction = "ltr";
    if (!["instant", "slide", "curl"].includes(style.motion))
      style.motion = "slide";
    const appearance = { ...DEFAULT_APPEARANCE, ...value.appearance };
    appearance.backgroundKind =
      appearance.backgroundKind === "video" ? "video" : "image";
    for (const key of ["welcomeTitle", "welcomeSubtitle"] as const)
      appearance[key] =
        typeof appearance[key] === "string" && appearance[key].trim()
          ? appearance[key].trim().slice(0, 100)
          : DEFAULT_APPEARANCE[key];
    if (!/^#[0-9a-f]{6}$/i.test(appearance.customColor))
      appearance.customColor = DEFAULT_APPEARANCE.customColor;
    appearance.backgroundOpacity = Math.max(
      0,
      Math.min(0.65, Number(appearance.backgroundOpacity) || 0.25),
    );
    const books = restoreBooks(value.books);
    return {
      style,
      books,
      appearance,
      groups: normalizeGroups(value.groups),
      totalReadingMillis: nonNegative(value.totalReadingMillis),
    };
  } catch {
    try {
      const original = localStorage.getItem(KEY);
      if (original)
        localStorage.setItem(`${KEY}:damaged:${Date.now()}`, original);
    } catch {
      /* Storage may itself be unavailable or full. */
    }
    return { style: { ...DEFAULT_STYLE }, books: {} };
  }
}
export function saveMemory(value: ReadingMemory) {
  localStorage.setItem(KEY, JSON.stringify({ ...value, version: 4 }));
}

export function mergeBookMemory(
  memory: ReadingMemory,
  books: { id: string; aliases?: string[] }[],
): ReadingMemory {
  const merged = { ...memory.books };
  // Remove the earlier bundled browser examples while retaining user imports.
  const oldSamples = [
    "雨中的书店-UTF8.txt",
    "雨中的书店-GB18030.txt",
    "雨中的书店-UTF16LE.txt",
    "雨中的书店.epub",
    "多页中文.pdf",
    "扫描页.pdf",
    "河岸来信.cbz",
    "漫画单页.png",
  ];
  for (const id of Object.keys(merged))
    if (oldSamples.some((name) => id.startsWith(`browser-${name}-`)))
      delete merged[id];
  for (const book of books) {
    const candidates = [...new Set([book.id, ...(book.aliases ?? [])])]
      .map((id) => merged[id])
      .filter((value): value is BookMemory => !!value)
      .sort((a, b) => (b.lastRead ?? 0) - (a.lastRead ?? 0));
    if (candidates.length) {
      const bookmarks = [
        ...new Map(
          candidates
            .flatMap((value) => value.bookmarks ?? [])
            .map((bookmark) => [bookmark.id, bookmark]),
        ).values(),
      ];
      merged[book.id] = {
        ...candidates[0],
        bookmarks,
        readingMillis: candidates.reduce(
          (sum, value) => sum + (value.readingMillis ?? 0),
          0,
        ),
      };
    }
    for (const alias of book.aliases ?? [])
      if (alias !== book.id) delete merged[alias];
  }
  return {
    ...memory,
    books: merged,
    groups: remapGroups(memory.groups ?? [], books),
  };
}
