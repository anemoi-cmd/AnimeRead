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
