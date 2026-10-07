import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_STYLE } from "../../src/reader-types";
import {
  loadMemory,
  mergeBookMemory,
  type ReadingMemory,
} from "../../src/reading-storage";

let saved = "";
beforeEach(() => {
  saved = "";
  vi.stubGlobal("localStorage", { getItem: () => saved });
});
afterEach(() => vi.unstubAllGlobals());

test("旧版本设置升级保留字体，移除失效图像选项，重置 Windows 缩放", () => {
  saved = JSON.stringify({
    style: {
      fontFamily: "SimSun",
      zoom: 0.8,
      imageFit: "height",
      enhanceScale: 2,
      filters: ["C", "bad", "A"],
    },
  });
  const memory = loadMemory();
  expect(memory.style.fontFamily).toBe("SimSun");
  expect(memory.style.zoom).toBe(DEFAULT_STYLE.zoom);
  expect(memory.style).not.toHaveProperty("imageFit");
  expect(memory.style).not.toHaveProperty("enhanceScale");
  expect(memory.style.filters).toEqual(["C", "A"]);
  expect(memory.style.turnDuration).toBe(400);
});

test("翻页速度和木纹主题持久化，损坏速度不会令翻页锁死", () => {
  saved = JSON.stringify({
    version: 4,
    style: { turnDuration: 250, theme: "wood" },
  });
  expect(loadMemory().style).toMatchObject({
    turnDuration: 250,
    theme: "wood",
  });
  for (const [invalid, expected] of [
    ["broken", 400],
    [-9, 150],
    [99999, 1500],
  ]) {
    saved = JSON.stringify({ version: 4, style: { turnDuration: invalid } });
    expect(loadMemory().style.turnDuration).toBe(expected);
  }
});

test("重复书目合并采用最新进度并保留两份记录的全部书签", () => {
  const location = { kind: "fixed" as const, page: 50, progress: 50 / 169 };
  const old = { id: "before-move", label: "原位置书签", location, created: 1 };
  const recent = {
    id: "after-move",
    label: "新位置书签",
    location,
    created: 2,
  };
  const memory: ReadingMemory = {
    style: DEFAULT_STYLE,
    books: {
      legacy: {
        title: "同一本书",
        lastRead: 1,
        location: { ...location, page: 10 },
        bookmarks: [old],
        readingMillis: 5000,
      },
      duplicate: {
        title: "同一本书",
        lastRead: 2,
        location,
        bookmarks: [old, recent],
        readingMillis: 6000,
      },
    },
  };
  const merged = mergeBookMemory(memory, [
    { id: "legacy", aliases: ["duplicate"] },
  ]);
  expect(Object.keys(merged.books)).toEqual(["legacy"]);
  expect(merged.books.legacy.location).toEqual(location);
  expect(merged.books.legacy.bookmarks.map((item) => item.id)).toEqual([
    "before-move",
    "after-move",
  ]);
  expect(memory.books.duplicate).toBeDefined();
  expect(merged.books.legacy.readingMillis).toBe(11000);
  expect(
    mergeBookMemory(merged, [
      { id: "legacy", aliases: ["legacy", "duplicate"] },
    ]).books.legacy.readingMillis,
  ).toBe(11000);
});

test("损坏的单条记录不影响有效书籍与设置，非法书签被忽略", () => {
  saved = JSON.stringify({
    version: 4,
    style: { fontFamily: "SimSun" },
    totalReadingMillis: "invalid",
    books: {
      broken: null,
      usable: {
        title: "保留的书",
        readingMillis: -10,
        location: { kind: "fixed", page: 2, progress: 9 },
        bookmarks: [
          null,
          { id: "bad", label: "无效", location: { kind: "fixed", page: -1 } },
          {
            id: "ok",
            label: "保留书签",
            location: { kind: "fixed", page: 2, progress: 0.3 },
            created: 2,
          },
        ],
      },
    },
  });
  const memory = loadMemory();
  expect(memory.style.fontFamily).toBe("SimSun");
  expect(Object.keys(memory.books)).toEqual(["usable"]);
  expect(memory.books.usable.location).toEqual({
    kind: "fixed",
    page: 2,
    progress: 1,
  });
  expect(memory.books.usable.bookmarks.map((bookmark) => bookmark.id)).toEqual([
    "ok",
  ]);
  expect(memory.books.usable.readingMillis).toBe(0);
  expect(memory.totalReadingMillis).toBe(0);
});

test("截断的设置 JSON 在恢复默认设置前保留原始备份", () => {
  saved = '{"books":';
  const backup = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => saved, setItem: backup });
  expect(loadMemory().style).toEqual(DEFAULT_STYLE);
  expect(backup).toHaveBeenCalledWith(
    expect.stringMatching(/^animeread:reading:v1:damaged:/),
    saved,
  );
});
