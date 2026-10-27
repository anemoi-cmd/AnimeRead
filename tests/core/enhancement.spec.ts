import { expect, test } from "vitest";
import { enhancedSize } from "../../src/gpu/output-size";

test("超分输出按屏幕需要放大，不超过模型倍率也不小于原图", () => {
  // 小图放大到屏幕高度为止。
  expect(enhancedSize(800, 1200, 2, { width: 2560, height: 1600 })).toEqual({
    width: 1067,
    height: 1600,
  });
  // 屏幕足够大时停在模型倍率。
  expect(enhancedSize(800, 1200, 2, { width: 3840, height: 4000 })).toEqual({
    width: 1600,
    height: 2400,
  });
  // 原图高于屏幕：保持原尺寸，只做修复。
  expect(enhancedSize(2000, 3000, 2, { width: 1920, height: 1080 })).toEqual({
    width: 2000,
    height: 3000,
  });
  // 上下阅读只受宽度限制。
  expect(
    enhancedSize(700, 5000, 4, {
      width: 2100,
      height: Number.POSITIVE_INFINITY,
    }),
  ).toEqual({ width: 2100, height: 15000 });
  // 没有目标时按完整倍率。
  expect(enhancedSize(10, 20, 2)).toEqual({ width: 20, height: 40 });
});

test("按屏幕需要规划放大遍数，原图够大时不调用放大模型", async () => {
  const { neededFilters, fitRatio } = await import("../../src/gpu/output-size");
  const screen = { width: 1920, height: 1080 };
  // 现代扫描图比屏幕大：不放大；只选了 A 时不做任何处理。
  expect(neededFilters(["A"], fitRatio(2400, 3600, screen))).toEqual([]);
  expect(neededFilters(["C", "A"], fitRatio(2400, 3600, screen))).toEqual([
    "C",
  ]);
  // 只差一点（不足 10%）也不放大。
  expect(neededFilters(["A"], fitRatio(1000, 1000, screen))).toEqual([]);
  // 需要 1.1–2.2 倍：一遍；更小的旧图：两遍，最多四倍。
  expect(neededFilters(["A"], fitRatio(400, 700, screen))).toEqual(["A"]);
  expect(neededFilters(["A"], fitRatio(300, 420, screen))).toEqual(["A", "A"]);
  expect(neededFilters(["C", "A", "B"], 3)).toEqual(["C", "A", "A", "B"]);
  expect(neededFilters(["A", "A"], 1.5)).toEqual(["A"]);
  // 没有选 A 时不会凭空加入放大。
  expect(neededFilters(["B"], 4)).toEqual(["B"]);
  expect(fitRatio(100, 100)).toBe(Number.POSITIVE_INFINITY);
});
