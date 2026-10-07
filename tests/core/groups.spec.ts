import { expect, test } from "vitest";
import {
  normalizeGroups,
  remapGroups,
  saveGroup,
  autoGroupBooks,
} from "../../src/book-groups";
test("分组保存只移动成员，卷序保留，重复导入和改地址仍保持归组", () => {
  const initial = [{ id: "first", name: "原分组", bookIds: ["old", "second"] }];
  const groups = saveGroup(initial, {
    id: "new",
    name: "新分组",
    bookIds: ["second", "old"],
  });
  expect(groups[0].bookIds).toEqual([]);
  expect(groups[1].bookIds).toEqual(["second", "old"]);
  expect(
    remapGroups(groups, [{ id: "merged", aliases: ["old"] }])[1].bookIds,
  ).toEqual(["second", "merged"]);
  expect(initial[0].bookIds).toEqual(["old", "second"]);
  expect(
    normalizeGroups([
      { id: "a", name: " 空格 ", bookIds: ["x", "x", 4] },
      { id: "a", name: "重复", bookIds: ["y"] },
      null,
    ])[0],
  ).toMatchObject({ id: "a", name: "空格", bookIds: ["x"] });
});
test("同名卷自动收录、自然卷序、改标题及手工排除不会被重新加入", () => {
  const books = [10, 2, 1].map((volume) => ({
    id: String(volume),
    name: `[玩玩的恋爱关系]卷${volume}.epub`,
  }));
  const other = { id: "other", name: "玩玩的恋爱关系外传.epub" };
  const groups = autoGroupBooks(
    [{ id: "series", name: "玩玩的恋爱关系", bookIds: [] }],
    [...books, other],
  );
  expect(groups[0].bookIds).toEqual(["1", "2", "10"]);
  expect(autoGroupBooks(groups, books)).toBe(groups);
  const excluded = { ...groups[0], bookIds: ["10", "1"], excludedIds: ["2"] };
  expect(autoGroupBooks([excluded], books)[0].bookIds).toEqual(["10", "1"]);
  const manual = [{ ...excluded, autoMatch: false }];
  expect(
    autoGroupBooks(manual, [
      ...books,
      { id: "3", name: "玩玩的恋爱关系 第三卷.txt" },
    ]),
  ).toBe(manual);
  expect(
    autoGroupBooks(groups, [{ id: "4", name: "metadata.epub" }], {
      "4": { title: "玩玩的恋爱关系 - 04" },
    })[0].bookIds,
  ).toEqual(["1", "2", "10", "4"]);
});
test("五万卷与五百分组的归并保留全部成员且不重复", () => {
  const groups = Array.from({ length: 500 }, (_, index) => ({
    id: `g${index}`,
    name: `分组${index}`,
    bookIds: Array.from({ length: 100 }, (_, page) => `b${index * 100 + page}`),
  }));
  const mapped = remapGroups(
    groups,
    Array.from({ length: 50000 }, (_, index) => ({
      id: `id${index}`,
      aliases: [`b${index}`],
    })),
  );
  const members = mapped.flatMap((group) => group.bookIds);
  expect(members).toHaveLength(50000);
  expect(new Set(members).size).toBe(50000);
  expect(mapped[499].bookIds[99]).toBe("id49999");
});
