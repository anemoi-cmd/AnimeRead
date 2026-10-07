import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  copyFile,
  rename,
  unlink,
  access,
  readFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { expectCurlMotion } from "../tests/curl-motion.mjs";
import { cacheDirectory, verificationDirectory } from "./tool-paths.mjs";

const bookPath = process.env.ANIMEREAD_TEST_BOOK;
if (!bookPath)
  throw new Error("请设置 ANIMEREAD_TEST_BOOK，指向你自己的漫画 EPUB");
const executable = resolve("AnimeRead.exe");
const directory = resolve(cacheDirectory, `comic-qa-${Date.now()}`);
await mkdir(verificationDirectory, { recursive: true });
await mkdir(directory, { recursive: true });
const child = spawn(executable, [], {
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
const report = {
  executable,
  book: bookPath,
  started: new Date().toISOString(),
  checks: [],
  errors: [],
};
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
  const location = page.getByTestId("reading-location");
  async function check(name, operation) {
    const start = performance.now();
    try {
      const detail = await operation();
      report.checks.push({
        name,
        passed: true,
        milliseconds: Math.round(performance.now() - start),
        detail,
      });
      console.log("PASS", name, detail ?? "");
    } catch (error) {
      report.checks.push({ name, passed: false, error: error.message });
      console.error("FAIL", name, error.message);
    }
  }
  let book;
  await check("Windows 原生底座和系统字体", async () => {
    const health = await invoke("health");
    expect(health.version).toBe(
      JSON.parse(await readFile("package.json", "utf8")).version,
    );
    expect(health.platform).toBe("windows");
    const fonts = await invoke("system_fonts");
    expect(fonts).toContain("Microsoft YaHei");
    return { version: health.version, fonts: fonts.length };
  });
  await check("原生导入真实漫画 EPUB，并分类到漫画", async () => {
    [book] = await invoke("import_paths", { paths: [bookPath] });
    expect(book.category).toBe("comic");
    await page.reload();
    await page.locator(".book-card").click();
    await expect(location).toHaveText("1 / 170");
    await expect(page.locator(".comic-page")).toBeVisible();
    return {
      category: book.category,
      pages: 170,
      fingerprint: book.fingerprint,
      origin: page.url(),
    };
  });
  await check("移动、改名与重复文件合并，进度和书签保留", async () => {
    await page.getByLabel("阅读进度").fill("250");
    await expect(location).toHaveText("43 / 170");
    await page.getByLabel("添加书签").click();
    await page.waitForTimeout(250);
    const copy = resolve(directory, "copy.epub"),
      moved = resolve(directory, "renamed.epub");
    await copyFile(bookPath, copy);
    let [imported] = await invoke("import_paths", { paths: [copy] });
    expect(imported.id).toBe(book.id);
    await rename(copy, moved);
    [imported] = await invoke("import_paths", { paths: [moved] });
    expect(imported.id).toBe(book.id);
    expect(imported.path).toContain("renamed.epub");
    expect((await invoke("load_library")).length).toBe(1);
    await page.reload();
    await expect(page.locator(".book-card")).toHaveCount(1);
    await page.locator(".book-card").click();
    await expect(location).toHaveText("43 / 170");
    await page.getByLabel("目录", { exact: true }).click();
    await expect(page.getByRole("button", { name: "书签 (1)" })).toBeVisible();
    await page.getByLabel("目录", { exact: true }).click();
    await invoke("import_paths", { paths: [bookPath] });
    await unlink(moved);
    await page.reload();
    await page.locator(".book-card").click();
    await expect(location).toHaveText("43 / 170");
    return {
      singleRecord: true,
      renamedLocation: true,
      progress: 43,
      bookmarkPreserved: true,
    };
  });
  await check("实际文件随机读取的边界和关闭句柄", async () => {
    const source = await invoke("open_book", { id: book.id });
    const bytes = await page.evaluate(
      async (sourceId) =>
        Array.from(
          new Uint8Array(
            await window.__TAURI_INTERNALS__.invoke("read_source", {
              sourceId,
              offset: "0",
              length: 4,
            }),
          ),
        ),
      source.sourceId,
    );
    expect(bytes.slice(0, 2)).toEqual([80, 75]);
    for (const args of [
      { offset: "0", length: 8388609 },
      { offset: String(Number(source.size) + 1), length: 4 },
    ]) {
      let rejected = false;
      try {
        await invoke("read_source", { sourceId: source.sourceId, ...args });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    }
    await invoke("close_source", { sourceId: source.sourceId });
    let rejected = false;
    try {
      await invoke("read_source", {
        sourceId: source.sourceId,
        offset: "0",
        length: 4,
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    return {
      zipMagic: true,
      maxRead: "8 MiB",
      eofRejected: true,
      closedRejected: true,
    };
  });
  await check("本机 Windows 缩放初值和独占全屏 Esc", async () => {
    await page.getByLabel("阅读进度").fill("296");
    await expect(location).toHaveText("51 / 170");
    await page.getByLabel("阅读设置", { exact: true }).click();
    const dpi = await page.evaluate(() => devicePixelRatio);
    expect(
      Number(await page.getByLabel("缩放", { exact: true }).inputValue()),
    ).toBe(dpi);
    await page.getByLabel("关闭阅读设置").click();
    await page.getByLabel("全屏", { exact: true }).click();
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".reading-footer")).toBeHidden();
    expect(await invoke("plugin:window|is_fullscreen", { label: "main" })).toBe(
      true,
    );
    await expect
      .poll(() =>
        page
          .locator(".comic-page")
          .evaluate(
            (image) =>
              image.getBoundingClientRect().height /
              image.closest(".reader-surface").clientHeight,
          ),
      )
      .toBeGreaterThan(0.98);
    const fullWidth = await page
      .locator(".comic-page")
      .evaluate((image) => image.getBoundingClientRect().width);
    await page.getByLabel("全屏阅读设置").click();
    await expect(page.locator(".preferences")).toBeVisible();
    await expect(page.getByLabel("超分画质")).toBeVisible();
    expect(
      await page
        .locator(".comic-page")
        .evaluate((image) => image.getBoundingClientRect().width),
    ).toBeCloseTo(fullWidth, 1);
    await page.getByLabel("关闭阅读设置").click();
    await page.screenshot({
      path: resolve(verificationDirectory, "comic-fullscreen.png"),
    });
    await page.keyboard.press("Escape");
    await expect(page.locator(".topbar")).toBeVisible();
    expect(await invoke("plugin:window|is_fullscreen", { label: "main" })).toBe(
      false,
    );
    await expect(page.locator(".comic-page")).toBeVisible();
    return {
      windowsScale: dpi,
      uiHidden: true,
      nativeFullscreen: true,
      escKeepsBook: true,
    };
  });
  await check("原生鼠标拖动进度、书签删除和可见雨景", async () => {
    const slider = page.getByLabel("阅读进度"),
      box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, {
      steps: 24,
    });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await location.getAttribute("data-progress")))
      .toBeGreaterThan(0.65);
    await page.getByLabel("目录", { exact: true }).click();
    await page.getByRole("button", { name: "书签 (1)" }).click();
    await page.getByLabel(/删除书签/).click();
    await expect(page.getByRole("button", { name: "书签 (0)" })).toBeVisible();
    await page.getByLabel("目录", { exact: true }).click();
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("雨景", { exact: true }).check();
    await expect
      .poll(() =>
        page.locator(".rain-canvas").evaluate((canvas) => {
          const data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let visible = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 40) visible++;
          return visible;
        }),
      )
      .toBeGreaterThan(1000);
    await page.getByLabel("关闭阅读设置").click();
    await page.getByLabel("全屏", { exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator(".comic-page")
          .evaluate(
            (image) =>
              image.getBoundingClientRect().height /
              image.closest(".reader-surface").clientHeight,
          ),
      )
      .toBeGreaterThan(0.98);
    await page.screenshot({
      path: resolve(verificationDirectory, "comic-rain-fullscreen.png"),
    });
    await page.keyboard.press("Escape");
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("雨景", { exact: true }).uncheck();
    await page.getByLabel("关闭阅读设置").click();
    return { mouseDrag: true, bookmarkDeleted: true, rainPixels: true };
  });
  await check("原生单页和双页，左右顺序正反卷页均有实际动画", async () => {
    const turns = [];
    for (const layout of ["single", "double"]) {
      for (const direction of ["ltr", "rtl"]) {
        await page.getByLabel("阅读进度").fill("290");
        await expect(location).toHaveText("50 / 170");
        await page.getByLabel("阅读设置", { exact: true }).click();
        await page.getByLabel("单双页").selectOption(layout);
        await page.getByLabel("阅读顺序").selectOption(direction);
        await page.getByLabel("翻页方式").selectOption("curl");
        await page.getByLabel("关闭阅读设置").click();
        for (const turn of ["下一页", "上一页"]) {
          const motion = await expectCurlMotion(
            page,
            () => page.getByLabel(turn, { exact: true }).click(),
            layout === "double",
            layout === "double" && direction === "ltr"
              ? resolve(
                  verificationDirectory,
                  `curl-double-${turn === "下一页" ? "next" : "previous"}.png`,
                )
              : undefined,
          );
          await expect(location).toHaveText(
            `${turn === "上一页" ? 50 : layout === "double" ? 52 : 51} / 170`,
          );
          turns.push({ layout, direction, turn, ...motion });
        }
      }
    }
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("single");
    await page.getByLabel("阅读顺序").selectOption("ltr");
    await page.getByLabel("翻页方式").selectOption("slide");
    await page.getByLabel("关闭阅读设置").click();
    return { turns, halfPageWidthVerified: true };
  });
  await page.getByLabel("阅读进度").fill("0");
  await expect(location).toHaveText("1 / 170");
  await page.getByLabel("阅读设置", { exact: true }).click();
  const original = await page
    .locator(".comic-page")
    .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
  const samplePixels = () =>
    page.locator(".comic-page").evaluate((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, 160, 160);
      return Array.from(context.getImageData(0, 0, 160, 160).data);
    });
  const baseline = await samplePixels();
  const adapterInfo = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({
      powerPreference: "high-performance",
    });
    return adapter
      ? {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          description: adapter.info.description,
          fallback: adapter.info.isFallbackAdapter,
        }
      : undefined;
  });
  expect(adapterInfo?.vendor).toMatch(/nvidia/i);
  report.webgpu = adapterInfo;
  for (const backend of ["anime4k", "waifu2x"]) {
    for (const preset of process.argv.includes("--full-gpu")
      ? ["A", "B", "C", "A+A", "A+B", "A+C", "C+A", "C+B+A"]
      : ["A", "B", "C", "A+C"]) {
      await check(`${backend} 真实漫画滤镜 ${preset}`, async () => {
        await page.getByLabel("超分画质").uncheck();
        await page.getByLabel("增强引擎").selectOption(backend);
        await page.getByLabel("滤镜预设").selectOption(preset);
        await page.getByLabel("超分画质").check();
        await expect(page.locator(".comic-page")).toHaveAttribute(
          "data-filters",
          preset,
          { timeout: 120000 },
        );
        const factor =
          2 ** preset.split("+").filter((mode) => mode === "A").length;
        const size = await page
          .locator(".comic-page")
          .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
        expect(size).toEqual(original.map((n) => n * factor));
        await expect(page.getByRole("alert")).toBeHidden();
        const pixels = await samplePixels();
        let difference = 0,
          visible = 0;
        for (let i = 0; i < pixels.length; i++)
          if (i % 4 !== 3) {
            difference += Math.abs(pixels[i] - baseline[i]);
            if (pixels[i] > 10 && pixels[i] < 245) visible++;
          }
        difference /= pixels.length * 0.75;
        expect(difference).toBeGreaterThan(0.005);
        expect(visible).toBeGreaterThan(1000);
        return {
          input: original,
          output: size,
          filters: preset,
          meanPixelDifference: difference,
          nonBlankChannels: visible,
          device:
            backend === "anime4k"
              ? adapterInfo
              : (await invoke("enhancement_runtime")).device,
        };
      });
    }
  }
  await page.getByLabel("超分画质").uncheck();
  await expect
    .poll(() =>
      page.locator(".comic-page").evaluate((image) => image.naturalWidth),
    )
    .toBe(original[0]);
  await page.getByLabel("关闭阅读设置").click();
  await check("黑白正文页 Anime4K 叠加、过期增强取消、原图恢复", async () => {
    await page.getByLabel("阅读进度").fill("296");
    await expect(location).toHaveText("51 / 170");
    const input = await page
      .locator(".comic-page")
      .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("增强引擎").selectOption("anime4k");
    await page.getByLabel("滤镜预设").selectOption("A+B");
    await page.getByLabel("超分画质").check();
    await expect(page.locator(".comic-page")).toHaveAttribute(
      "data-filters",
      "A+B",
      { timeout: 120000 },
    );
    expect(
      await page
        .locator(".comic-page")
        .evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    ).toEqual(input.map((n) => n * 2));
    await page.getByLabel("超分画质").uncheck();
    await expect
      .poll(() =>
        page.locator(".comic-page").evaluate((image) => image.naturalWidth),
      )
      .toBe(input[0]);
    await page.getByLabel("滤镜预设").selectOption("A+A");
    await page.getByLabel("超分画质").check();
    await page.waitForTimeout(80);
    await page.getByLabel("超分画质").uncheck();
    await expect
      .poll(
        () =>
          page.locator(".comic-page").evaluate((image) => image.naturalWidth),
        { timeout: 15000 },
      )
      .toBe(input[0]);
    await expect(page.getByRole("alert")).toBeHidden();
    await page.getByLabel("关闭阅读设置").click();
    await page.screenshot({
      path: resolve(verificationDirectory, "comic-native.png"),
    });
    return {
      input,
      enhanced: input.map((n) => n * 2),
      cancellationRestoresOriginal: true,
    };
  });
  await check("自定义三层 Anime4K 滤镜按顺序执行", async () => {
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("增强引擎").selectOption("anime4k");
    await page.getByLabel("滤镜预设").selectOption("B+C");
    await page.getByLabel("新增滤镜类型").selectOption("A");
    await page.getByLabel("添加滤镜", { exact: true }).click();
    await page.getByLabel("上移滤镜 3").click();
    await page.getByLabel("超分画质").check();
    await expect(page.locator(".comic-page")).toHaveAttribute(
      "data-filters",
      "B+A+C",
      { timeout: 120000 },
    );
    const output = await page
      .locator(".comic-page")
      .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
    expect(output).toEqual([2252, 3200]);
    await page.getByLabel("超分画质").uncheck();
    await expect
      .poll(() =>
        page.locator(".comic-page").evaluate((image) => image.naturalWidth),
      )
      .toBe(1126);
    await page.getByLabel("关闭阅读设置").click();
    return { filters: "B+A+C", output, customOrder: true };
  });
  await check("Waifu2x 关闭增强取消任务并恢复原图", async () => {
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("增强引擎").selectOption("waifu2x");
    await page.getByLabel("滤镜预设").selectOption("A+A");
    await page.getByLabel("超分画质").check();
    await page.waitForTimeout(150);
    await page.getByLabel("超分画质").uncheck();
    await expect
      .poll(
        () =>
          page.locator(".comic-page").evaluate((image) => image.naturalWidth),
        { timeout: 15000 },
      )
      .toBe(1126);
    await expect(page.getByRole("alert")).toBeHidden();
    await page.getByLabel("关闭阅读设置").click();
    return { originalWidth: 1126, canceled: true };
  });
  await check(
    "GPU 推理期间连续翻页，原图先显示且旧页不能覆盖新页",
    async () => {
      await page.getByLabel("阅读进度").fill("480");
      await expect(location).toHaveText("82 / 170");
      await page.getByLabel("阅读设置", { exact: true }).click();
      await page.getByLabel("增强引擎").selectOption("waifu2x");
      await page.getByLabel("滤镜预设").selectOption("A+A");
      await page.getByLabel("翻页方式").selectOption("instant");
      await page.getByLabel("超分画质").check();
      await expect(page.locator(".reading-heading")).toContainText("正在增强");
      await page.getByLabel("关闭阅读设置").click();
      const start = performance.now();
      for (let index = 0; index < 3; index++) {
        await page.getByLabel("下一页", { exact: true }).click();
        await expect(location).toHaveText(`${83 + index} / 170`, {
          timeout: 2000,
        });
        await expect(page.locator(".comic-page")).toHaveAttribute(
          "data-page",
          String(82 + index),
        );
      }
      const elapsed = Math.round(performance.now() - start);
      expect(elapsed).toBeLessThan(3000);
      const sourceWidth = await page
        .locator(".comic-page")
        .evaluate((image) => image.naturalWidth);
      expect(sourceWidth).toBe(1126);
      await page.waitForTimeout(800);
      await expect(page.locator(".comic-page")).toHaveAttribute(
        "data-page",
        "84",
      );
      await page.getByLabel("阅读设置", { exact: true }).click();
      await page.getByLabel("超分画质").uncheck();
      await expect(page.getByRole("alert")).toBeHidden();
      await page.getByLabel("关闭阅读设置").click();
      return {
        navigationMilliseconds: elapsed,
        consecutiveTurns: 3,
        originalWidth: sourceWidth,
        sourcePage: 85,
      };
    },
  );
  await check("原生双页、阅读方向、完整全屏和单页还原", async () => {
    await page.getByLabel("阅读进度").fill("296");
    await expect(location).toHaveText("51 / 170");
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("double");
    await page.getByLabel("阅读顺序").selectOption("rtl");
    await page.getByLabel("关闭阅读设置").click();
    await expect(page.locator(".comic-page")).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .locator(".comic-spread")
          .evaluate((spread) => getComputedStyle(spread).flexDirection),
      )
      .toBe("row-reverse");
    const bounds = await page.locator(".comic-page").evaluateAll((images) =>
      images.map((image) => ({
        page: image.dataset.page,
        x: image.getBoundingClientRect().x,
        ratio:
          image.getBoundingClientRect().width /
          image.getBoundingClientRect().height,
        source: image.naturalWidth / image.naturalHeight,
      })),
    );
    expect(bounds[0].x).toBeGreaterThan(bounds[1].x);
    for (const bound of bounds)
      expect(bound.ratio).toBeCloseTo(bound.source, 2);
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(location).toHaveText("53 / 170");
    await page.getByLabel("上一页", { exact: true }).click();
    await expect(location).toHaveText("51 / 170");
    await page.getByLabel("全屏", { exact: true }).click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect
      .poll(() =>
        page
          .locator(".comic-spread")
          .evaluate(
            (spread) =>
              spread.getBoundingClientRect().height /
              spread.parentElement.clientHeight,
          ),
      )
      .toBeGreaterThan(0.9);
    await page.screenshot({
      path: resolve(verificationDirectory, "comic-double-fullscreen.png"),
    });
    await page.keyboard.press("Escape");
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("single");
    await page.getByLabel("关闭阅读设置").click();
    await expect(page.locator(".comic-page")).toHaveCount(1);
    return {
      doublePages: bounds.map((bound) => bound.page),
      direction: "rtl",
      sourceAspectPreserved: true,
    };
  });
  if (process.argv.includes("--stress")) {
    await check("GPU 队列突发、超限拒绝和取消后恢复", async () => {
      const detail = await page.evaluate(async () => {
        const invoke = (command, args, options) =>
          window.__TAURI_INTERNALS__.invoke(command, args, options);
        const image = document.querySelector(".comic-page");
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        const bytes = await blob.arrayBuffer();
        const request = (filters, input = bytes) =>
          invoke("enhance_image", input, {
            headers: { "x-animeread-filters": JSON.stringify(filters) },
          }).then(
            () => "completed",
            (error) => String(error),
          );
        const burst = Array.from({ length: 16 }, () => request(["C"]));
        await new Promise((resolve) => setTimeout(resolve, 150));
        await invoke("cancel_enhancements", {});
        const results = await Promise.all(burst);
        const oversized = await request(["A", "A", "A", "A"]);
        const invalid = await request(["D"]);
        const tooLarge = await request(
          ["C"],
          new Uint8Array(16 * 1024 * 1024 + 1).buffer,
        );
        const recovered = await request(["C"]);
        return { burst: results, oversized, invalid, tooLarge, recovered };
      });
      expect(detail.burst.some((value) => value.includes("队列已满"))).toBe(
        true,
      );
      expect(detail.burst.some((value) => value.includes("已取消"))).toBe(true);
      expect(detail.oversized).toContain("8000 万");
      expect(detail.invalid).toContain("无效");
      expect(detail.tooLarge).toContain("16 MiB");
      expect(detail.recovered).toBe("completed");
      return { ...detail, maximumQueuedJobs: 8, requests: 16 };
    });
    for (const backend of ["anime4k", "waifu2x"])
      await check(`${backend} 开启时 30 次连续翻页和取消恢复`, async () => {
        await page.getByLabel("阅读进度").fill("296");
        await expect(location).toHaveText("51 / 170");
        await page.getByLabel("阅读设置", { exact: true }).click();
        await page.getByLabel("增强引擎").selectOption(backend);
        await page.getByLabel("滤镜预设").selectOption("A+A");
        await page.getByLabel("超分画质").check();
        await page.getByLabel("关闭阅读设置").click();
        const started = performance.now();
        for (let index = 0; index < 30; index++) {
          await page.getByLabel("下一页", { exact: true }).click();
          await expect(location).toHaveText(`${52 + index} / 170`, {
            timeout: 2000,
          });
          await expect(page.locator(".comic-page")).toHaveAttribute(
            "data-page",
            String(51 + index),
          );
        }
        const elapsed = Math.round(performance.now() - started);
        expect(elapsed).toBeLessThan(15000);
        await page.getByLabel("阅读设置", { exact: true }).click();
        await page.getByLabel("超分画质").uncheck();
        await page.getByLabel("关闭阅读设置").click();
        await expect(page.getByRole("alert")).toBeHidden();
        return { turns: 30, elapsed, finalSourcePage: 81 };
      });
    await check("Anime4K 上下阅读快速往返后增强恢复，无卷页干扰", async () => {
      await page.getByLabel("阅读进度").fill("296");
      await expect(location).toHaveText("51 / 170");
      await page.getByLabel("阅读设置", { exact: true }).click();
      await page.getByLabel("增强引擎").selectOption("anime4k");
      await page.getByLabel("滤镜预设").selectOption("C+B+A");
      await page.getByLabel("翻页方式").selectOption("curl");
      await page.getByLabel("阅读顺序").selectOption("ttb");
      await page.getByLabel("超分画质").check();
      await page.getByLabel("关闭阅读设置").click();
      await expect(location).toHaveText("51 / 170");
      await page.getByLabel("下一页", { exact: true }).click();
      await expect(location).toHaveText("52 / 170");
      await page.getByLabel("上一页", { exact: true }).click();
      await expect(location).toHaveText("51 / 170");
      await expect(
        page.locator('.vertical-page[data-page="50"] .comic-page'),
      ).toHaveAttribute("data-filters", "C+B+A", { timeout: 120000 });
      await expect(page.locator(".curl-overlay")).toHaveCount(0);
      expect(await page.locator(".vertical-page").count()).toBeLessThanOrEqual(
        5,
      );
      await page.getByLabel("阅读设置", { exact: true }).click();
      await page.getByLabel("超分画质").uncheck();
      await page.getByLabel("阅读顺序").selectOption("ltr");
      await page.getByLabel("翻页方式").selectOption("instant");
      await page.getByLabel("关闭阅读设置").click();
      await page.getByLabel("阅读进度").fill("473");
      await expect(location).toHaveText("81 / 170");
      return { restoredEnhancement: true, maximumNodes: 5, curlDisabled: true };
    });
    await check("500 次原生来源开关、1000 次读取及导入边界", async () => {
      const started = performance.now();
      await page.evaluate(async (id) => {
        const invoke = (command, args) =>
          window.__TAURI_INTERNALS__.invoke(command, args);
        for (let batch = 0; batch < 20; batch++) {
          const sources = await Promise.all(
            Array.from({ length: 25 }, () => invoke("open_book", { id })),
          );
          await Promise.all(
            sources.flatMap((source) =>
              [0, Number(source.size) - 4].map((offset) =>
                invoke("read_source", {
                  sourceId: source.sourceId,
                  offset: String(offset),
                  length: 4,
                }),
              ),
            ),
          );
          await Promise.all(
            sources.map((source) =>
              invoke("close_source", { sourceId: source.sourceId }),
            ),
          );
        }
      }, book.id);
      let rejection = "";
      try {
        await invoke("import_paths", { paths: Array(201).fill(bookPath) });
      } catch (error) {
        rejection = String(error);
      }
      expect(rejection).toContain("200");
      await expect(location).toHaveText("81 / 170");
      await expect(page.getByRole("alert")).toBeHidden();
      return {
        sourceCycles: 500,
        reads: 1000,
        concurrentSources: 25,
        milliseconds: Math.round(performance.now() - started),
        importLimitEnforced: true,
      };
    });
  }
  await check("真实封面、六色主题、背景图片持久化和阅读计时", async () => {
    await page.getByLabel("返回书架", { exact: true }).click();
    await expect(page.locator(".cover-image")).toBeVisible();
    const cover = await page
      .locator(".cover-image")
      .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
    expect(cover[1] / cover[0]).toBeCloseTo(1600 / 1120, 1);
    await expect(
      page.getByText("本地阅读 · 离线可用", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("阅读进度与设置保存在本机", { exact: true }),
    ).toHaveCount(0);
    const stats = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("animeread:reading:v1")),
    );
    expect(stats.totalReadingMillis).toBeGreaterThan(1000);
    expect(stats.books[book.id].readingMillis).toBeGreaterThan(1000);
    await page.getByRole("button", { name: "外观设置", exact: true }).click();
    await expect(page.locator(".palette-options button")).toHaveCount(6);
    await page.getByLabel("暮紫主题").click();
    const coverBytes = await page
      .locator(".cover-image")
      .evaluate(async (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg"),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      });
    await page.getByLabel("选择背景图片或视频文件").setInputFiles({
      name: "用户漫画封面.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(coverBytes),
    });
    await expect(page.locator(".app-shell")).toHaveClass(/has-wallpaper/);
    await page.getByLabel("关闭外观设置").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("animeread:reading:v1")).appearance
              .palette,
        ),
      )
      .toBe("violet");
    await page.reload();
    await expect(page.locator(".app-shell")).toHaveClass(/has-wallpaper/);
    await expect(page.locator(".cover-image")).toBeVisible();
    await page.screenshot({
      path: resolve(verificationDirectory, "library-v04.png"),
    });
    return {
      cover,
      totalMillis: stats.totalReadingMillis,
      bookMillis: stats.books[book.id].readingMillis,
      palette: "violet",
      backgroundRestored: true,
    };
  });
  await check("Windows 分组保存、重载、解散和书籍完整性", async () => {
    await page.getByRole("button", { name: "管理分组", exact: true }).click();
    await page
      .getByLabel("分组名称", { exact: true })
      .fill("與妳相戀到生命盡頭 · 全集");
    await page.locator(".group-book-picker input").check();
    await page.getByRole("button", { name: "保存分组", exact: true }).click();
    await page.getByLabel("关闭分组管理").click();
    await expect(page.locator(".group-card")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("animeread:reading:v1")).groups?.[0]
              ?.name,
        ),
      )
      .toBe("與妳相戀到生命盡頭 · 全集");
    await page.reload();
    await expect(page.locator(".group-card")).toHaveCount(1);
    await page.locator(".group-card").click();
    await expect(page.locator(".book-card")).toHaveCount(1);
    await page.getByRole("button", { name: "管理分组", exact: true }).click();
    await page.getByRole("button", { name: "删除分组", exact: true }).click();
    await page.getByLabel("关闭分组管理").click();
    await expect(page.locator(".book-card:not(.group-card)")).toHaveCount(1);
    expect((await invoke("load_library"))[0].id).toBe(book.id);
    await page.screenshot({
      path: resolve(verificationDirectory, "groups-v04.png"),
    });
    return {
      saved: true,
      reloadRestored: true,
      dissolvingKeepsOriginalBook: true,
    };
  });
  await check("丢失原文件的书目仍能右键删除", async () => {
    const temporary = resolve(directory, "to-delete.epub");
    await copyFile(bookPath, temporary);
    await invoke("import_paths", { paths: [temporary] });
    await unlink(temporary);
    await page.reload();
    await page.locator(".book-card").click();
    await expect(page.getByRole("alert")).toContainText("不存在");
    await page.getByLabel("返回书架", { exact: true }).click();
    await page.locator(".book-card").click({ button: "right" });
    await page.getByRole("menuitem", { name: "从书架删除" }).click();
    await expect(page.locator(".book-card")).toHaveCount(0);
    expect((await invoke("load_library")).length).toBe(0);
    await access(bookPath);
    return { missingRecordRemoved: true, originalFileIntact: true };
  });
} finally {
  await writeFile(
    resolve(verificationDirectory, "comic-native-results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  child.kill();
}
console.log(
  JSON.stringify({
    passed: report.checks.filter((check) => check.passed).length,
    total: report.checks.length,
    errors: report.errors,
  }),
);
if (report.checks.some((check) => !check.passed) || report.errors.length)
  process.exitCode = 1;
