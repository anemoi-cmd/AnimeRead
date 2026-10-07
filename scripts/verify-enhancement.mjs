import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { cacheDirectory, verificationDirectory } from "./tool-paths.mjs";

const bookPath = process.env.ANIMEREAD_TEST_BOOK;
if (!bookPath) throw new Error("请设置 ANIMEREAD_TEST_BOOK 指向漫画 EPUB");
const baseline = process.argv.includes("--baseline");
const directory = resolve(cacheDirectory, `enhancement-qa-${Date.now()}`);
await mkdir(directory, { recursive: true });
await mkdir(verificationDirectory, { recursive: true });
const child = spawn(resolve("AnimeRead.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    ANIMEREAD_DATA_DIR: resolve(directory, "data"),
    WEBVIEW2_USER_DATA_FOLDER: resolve(directory, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=9228 --force-high-performance-gpu",
  },
});
let browser;
const report = { started: new Date().toISOString(), checks: [], errors: [] };
async function saveQuality(frame, caption, name) {
  const quality = await frame.evaluate(async (node, caption) => {
    const original = node.querySelector(".quality-original");
    const enhanced = node.querySelector(".comic-page");
    const scale = enhanced.naturalWidth / original.naturalWidth;
    const canvas = document.createElement("canvas");
    canvas.width = 1840;
    canvas.height = 952;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, image] of [original, enhanced].entries()) {
      const factor = index ? scale : 1;
      context.drawImage(
        image,
        380 * factor,
        600 * factor,
        460 * factor,
        460 * factor,
        index * 920,
        32,
        920,
        920,
      );
    }
    context.fillStyle = "#222";
    context.font = "20px Microsoft YaHei";
    context.fillText("原图 · 相同区域放大", 12, 24);
    context.fillText(caption, 932, 24);
    const left = context.getImageData(0, 32, 920, 920).data;
    const right = context.getImageData(920, 32, 920, 920).data;
    let difference = 0;
    for (let i = 0; i < left.length; i++)
      if (i % 4 !== 3) difference += Math.abs(left[i] - right[i]);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return {
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      difference: difference / (left.length * 0.75),
    };
  }, caption);
  await writeFile(
    resolve(verificationDirectory, name),
    Buffer.from(quality.bytes),
  );
  expect(quality.difference).toBeGreaterThan(0.05);
  return quality.difference;
}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9228");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser) throw new Error("原生 WebView2 未启动");
  const page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => report.errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "给阅读，留一点时间。" }),
  ).toBeVisible();
  const invoke = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  report.health = await invoke("health");
  await invoke("import_paths", { paths: [bookPath] });
  await page.reload();
  await page.locator(".book-card").click();
  await expect(page.locator(".comic-page")).toBeVisible();
  await page.getByLabel("阅读进度").fill("296");
  await expect(page.getByTestId("reading-location")).toHaveText("51 / 170");
  await page.getByLabel("阅读设置", { exact: true }).click();
  const enable = page.getByLabel("超分画质", { exact: true });
  await page.getByLabel("增强引擎").selectOption("anime4k");
  await page.getByLabel("翻页方式").selectOption("instant");
  for (const preset of baseline ? ["A"] : ["A", "B", "C+B+A"]) {
    await enable.uncheck();
    await page.getByLabel("滤镜预设").selectOption(preset);
    await expect(page.locator(".comic-page")).not.toHaveAttribute(
      "data-enhanced",
      "true",
    );
    await page.evaluate(() => {
      const metrics = (window.__enhancementMetrics = {
        intervals: [],
        bounds: [],
        running: true,
        last: performance.now(),
        start: performance.now(),
      });
      const frame = (now) => {
        if (!metrics.running) return;
        metrics.intervals.push(now - metrics.last);
        metrics.last = now;
        const image = document.querySelector(".comic-page");
        if (image) {
          const rect = image.getBoundingClientRect();
          metrics.bounds.push({
            width: rect.width,
            height: rect.height,
            enhanced: image.dataset.enhanced === "true",
          });
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const start = performance.now();
    await enable.check();
    await expect(page.locator(".comic-page")).toHaveAttribute(
      "data-filters",
      preset,
      { timeout: 120000 },
    );
    const milliseconds = Math.round(performance.now() - start);
    await page.waitForTimeout(700);
    const detail = await page.evaluate(() => {
      const metrics = window.__enhancementMetrics;
      metrics.running = false;
      const intervals = metrics.intervals.slice(1).sort((a, b) => a - b);
      const original = metrics.bounds.find((bound) => !bound.enhanced);
      const enhanced = metrics.bounds.findLast((bound) => bound.enhanced);
      const image = document.querySelector(".comic-page");
      return {
        output: [image.naturalWidth, image.naturalHeight],
        originalBounds: original,
        enhancedBounds: enhanced,
        p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
        maximumFrameMs: intervals.at(-1),
        longFrames: intervals.filter((ms) => ms > 50).length,
        samples: intervals.length,
      };
    });
    if (!baseline) {
      expect(detail.enhancedBounds.width).toBeCloseTo(
        detail.originalBounds.width,
        1,
      );
      expect(detail.enhancedBounds.height).toBeCloseTo(
        detail.originalBounds.height,
        1,
      );
      await expect(page.getByRole("alert")).toBeHidden();
    }
    report.checks.push({ preset, milliseconds, ...detail });
    if (!baseline && preset === "A")
      report.checks.at(-1).meanPixelDifference = await saveQuality(
        page.locator(".image-frame"),
        "Anime4K · A",
        "quality-anime4k-A.png",
      );
    console.log(JSON.stringify(report.checks.at(-1)));
  }
  if (!baseline) {
    await page.getByLabel("画质对比").check();
    await page.getByLabel("关闭阅读设置").click();
    const divider = page.getByRole("slider", { name: "原图与增强分界线" });
    await expect(divider).toBeVisible();
    const frame = page.locator(".image-frame");
    const box = await frame.boundingBox();
    const split = await divider.boundingBox();
    await page.mouse.move(
      split.x + split.width / 2,
      split.y + split.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.28, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    expect(Number(await divider.getAttribute("aria-valuenow"))).toBeCloseTo(
      28,
      0,
    );
    await expect(page.getByTestId("reading-location")).toHaveText("51 / 170");
    await page.screenshot({
      path: resolve(verificationDirectory, "quality-comparison.png"),
    });
    report.comparison = {
      split: Number(await divider.getAttribute("aria-valuenow")),
      pageUnchanged: true,
    };
    report.comparison.meanPixelDifference = await saveQuality(
      frame,
      "Anime4K · C+B+A",
      "quality-detail.png",
    );
    await page.waitForTimeout(5000);
    const start = performance.now();
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(page.getByTestId("reading-location")).toHaveText("52 / 170");
    report.navigationMilliseconds = Math.round(performance.now() - start);
    await expect(page.locator(".comic-page")).toHaveAttribute(
      "data-filters",
      "C+B+A",
      { timeout: 120000 },
    );
    report.nextPageEnhancementMilliseconds = Math.round(
      performance.now() - start,
    );
    await expect(page.getByRole("alert")).toBeHidden();
    await page.getByLabel("阅读进度").fill("296");
    await expect(page.getByTestId("reading-location")).toHaveText("51 / 170");
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("增强引擎").selectOption("waifu2x");
    await page.getByLabel("滤镜预设").selectOption("A");
    const waifuStart = performance.now();
    await expect(page.locator(".comic-page")).toHaveAttribute(
      "data-filters",
      "A",
      { timeout: 120000 },
    );
    report.waifu2x = {
      milliseconds: Math.round(performance.now() - waifuStart),
      meanPixelDifference: await saveQuality(
        frame,
        "Waifu2x · A",
        "quality-waifu2x-A.png",
      ),
    };
    await expect(page.getByRole("alert")).toBeHidden();
    await page.getByLabel("增强引擎").selectOption("anime4k");
    await page.getByLabel("滤镜预设").selectOption("C+B+A");
    await page.getByLabel("关闭阅读设置").click();
    await expect(page.locator(".comic-page")).toHaveAttribute(
      "data-filters",
      "C+B+A",
      { timeout: 120000 },
    );
    if (process.argv.includes("--stress")) {
      const input = await page
        .locator(".quality-original")
        .evaluate(async (image) => {
          const canvas = document.createElement("canvas");
          canvas.width = 2560;
          canvas.height = 3640;
          canvas
            .getContext("2d")
            .drawImage(image, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        });
      const started = performance.now();
      await page.getByLabel("导入书籍文件").setInputFiles({
        name: "gpu-boundary.png",
        mimeType: "image/png",
        buffer: Buffer.from(input),
      });
      await expect(page.getByTestId("reading-location")).toHaveText("1 / 1");
      await expect(page.locator(".comic-page")).toHaveAttribute(
        "data-filters",
        "C+B+A",
        { timeout: 120000 },
      );
      const output = await page
        .locator(".comic-page")
        .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
      expect(output).toEqual([5120, 7280]);
      await expect(page.getByRole("alert")).toBeHidden();
      report.largeImage = {
        input: [2560, 3640],
        output,
        milliseconds: Math.round(performance.now() - started),
        source:
          "User comic image enlarged only for the isolated GPU resource-boundary test",
      };
      console.log(JSON.stringify(report.largeImage));
    }
  }
  if (report.errors.length) throw new Error(report.errors.join("\n"));
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(
      verificationDirectory,
      `enhancement-${baseline ? "baseline" : (report.health?.version ?? "failed")}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  child.kill();
}
if (report.failure) console.error(report.failure);
