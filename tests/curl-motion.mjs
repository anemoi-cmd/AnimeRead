import { expect } from "@playwright/test";

/** 从输入发生前采样完整动画，避免快速翻页在浏览器断言等待期间结束。
 * 同时用于浏览器和原生 WebView2，不修改阅读器速度或动画状态。
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<unknown>} turn
 * @param {boolean} double
 * @param {string | undefined} capture
 */
export async function expectCurlMotion(page, turn, double = false, capture) {
  await page.evaluate(() => {
    const motion = {
      started: false,
      done: false,
      samples: [],
      widths: [],
      stageWidth: 0,
      layout: "",
      sheets: 0,
    };
    let frame;
    const sample = () => {
      const node = document.querySelector(
        '.curl-overlay[data-state="flipping"]',
      );
      if (node) {
        motion.started = true;
        motion.stageWidth = node.querySelector(".curl-stage").offsetWidth;
        motion.layout = node.getAttribute("data-layout");
        motion.sheets = node.querySelectorAll(".curl-sheet").length;
        const sheets = [...node.querySelectorAll(".curl-sheet")].filter(
          (sheet) => getComputedStyle(sheet).display !== "none",
        );
        motion.samples.push(
          sheets
            .map((sheet) => `${sheet.style.transform}|${sheet.style.clipPath}`)
            .join(";"),
        );
        motion.widths.push(
          ...sheets.map((sheet) => parseFloat(getComputedStyle(sheet).width)),
        );
      } else if (motion.started) {
        motion.done = true;
        return;
      }
      frame = requestAnimationFrame(sample);
    };
    window.__readerMotionProbe = {
      motion,
      dispose: () => cancelAnimationFrame(frame),
    };
    frame = requestAnimationFrame(sample);
  });
  try {
    await turn();
    if (capture) {
      await expect
        .poll(() =>
          page.evaluate(() => window.__readerMotionProbe.motion.started),
        )
        .toBe(true);
      await page.screenshot({ path: capture });
    }
    await expect
      .poll(() => page.evaluate(() => window.__readerMotionProbe.motion.done))
      .toBe(true);
    const motion = await page.evaluate(() => window.__readerMotionProbe.motion);
    expect(motion.layout).toBe(double ? "double" : "single");
    if (double) expect(motion.sheets).toBe(4);
    expect(motion.samples.length).toBeGreaterThan(3);
    const movingFrames = new Set(motion.samples).size;
    expect(movingFrames).toBeGreaterThan(3);
    if (double)
      for (const width of motion.widths)
        expect(width).toBeCloseTo(motion.stageWidth / 2, 0);
    await expect(page.locator(".curl-overlay")).toBeHidden();
    await expect(page.getByLabel("书籍正文")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    return { movingFrames, frames: motion.samples.length, singleLeaf: double };
  } finally {
    await page.evaluate(() => {
      window.__readerMotionProbe?.dispose();
      delete window.__readerMotionProbe;
    });
  }
}
