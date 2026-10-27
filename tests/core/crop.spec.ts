import { expect, test } from "vitest";
import { findContentBox } from "../../src/reader/page-crop";

function page(
  width: number,
  height: number,
  background: number,
  box?: { x: number; y: number; w: number; h: number },
) {
  const gray = new Uint8ClampedArray(width * height).fill(background);
  if (box)
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x; x < box.x + box.w; x++)
        // 稀疏线条：像漫画格子而不是实心块。
        if ((x + y) % 3 === 0) gray[y * width + x] = 255 - background;
  return gray;
}

test("裁掉白色或黑色页边，留少量边距", () => {
  const white = findContentBox(
    page(200, 300, 250, { x: 30, y: 40, w: 140, h: 220 }),
    200,
    300,
  )!;
  expect(white.x).toBeGreaterThanOrEqual(26);
  expect(white.x).toBeLessThanOrEqual(30);
  expect(white.y).toBeGreaterThanOrEqual(36);
  expect(white.x + white.width).toBeGreaterThanOrEqual(170);
  expect(white.y + white.height).toBeGreaterThanOrEqual(260);
  expect(
    findContentBox(
      page(200, 300, 5, { x: 20, y: 20, w: 160, h: 250 }),
      200,
      300,
    ),
  ).not.toBeNull();
});

test("满版、彩色底、空白页和误判风险时不裁", () => {
  // 内容几乎铺满：不值得裁。
  expect(
    findContentBox(
      page(200, 300, 250, { x: 1, y: 1, w: 198, h: 298 }),
      200,
      300,
    ),
  ).toBeNull();
  // 灰色或彩色底：不是扫描白边。
  expect(
    findContentBox(
      page(200, 300, 128, { x: 30, y: 40, w: 140, h: 220 }),
      200,
      300,
    ),
  ).toBeNull();
  // 空白页。
  expect(findContentBox(page(200, 300, 250), 200, 300)).toBeNull();
  // 只剩一小块（例如角落页码）：多半误判，保留整页。
  expect(
    findContentBox(
      page(200, 300, 250, { x: 150, y: 260, w: 20, h: 20 }),
      200,
      300,
    ),
  ).toBeNull();
});
