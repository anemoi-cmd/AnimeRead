import { test, expect } from "vitest";
import { decodeText, splitChapters } from "../../src/reader/text-chapters";

test("TXT UTF-8、GB18030、UTF-16 与章节边界", () => {
  expect(decodeText(new TextEncoder().encode("中文验收"), "auto").text).toBe(
    "中文验收",
  );
  expect(
    decodeText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), "auto").text,
  ).toBe("中文");
  expect(
    decodeText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]), "auto")
      .text,
  ).toBe("中文");
  expect(
    decodeText(new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]), "auto")
      .text,
  ).toBe("中文");
  expect(
    splitChapters("第一章 验收\n甲\n第二章 验收\n乙").map(
      (chapter) => chapter.title,
    ),
  ).toEqual(["第一章 验收", "第二章 验收"]);
});
