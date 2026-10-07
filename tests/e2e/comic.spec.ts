import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { expectCurlMotion } from "../curl-motion.mjs";

const book = process.env.ANIMEREAD_TEST_BOOK;
test.skip(!book, "需要 ANIMEREAD_TEST_BOOK 指定用户漫画 EPUB");
const position = (page: Page) => page.getByTestId("reading-location");
test.beforeEach(async ({ page }) => {
  expect(
    existsSync(book!),
    "请通过 ANIMEREAD_TEST_BOOK 指定本机漫画 EPUB",
  ).toBe(true);
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(book);
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await expect(position(page)).toHaveText("1 / 170");
  await expect(page.locator(".comic-page")).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await expect(page.getByRole("alert")).toBeHidden();
});

test("漫画 EPUB 自动分类、书脊顺序及右键删除", async ({ page }) => {
  await expect(page.locator(".breadcrumb")).toContainText("與妳相戀到生命盡頭");
  await expect(page.locator("foliate-view")).toHaveCount(0);
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await page
    .locator(".shelf-tabs button")
    .filter({ hasText: /^漫画$/ })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page
    .locator(".shelf-tabs button")
    .filter({ hasText: /^小说$/ })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page
    .locator(".shelf-tabs button")
    .filter({ hasText: /^漫画$/ })
    .click();
  await page.locator(".book-card").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "更多工具" })).toBeVisible();
  await expect(page.getByRole("menu")).not.toContainText(/另存为|打印|共享/);
  await page.getByRole("menuitem", { name: "从书架删除" }).click();
  await expect(page.locator(".book-card")).toHaveCount(0);
});

for (const direction of ["ltr", "rtl"])
  test(`curl single ${direction} 漫画正反翻页均有实际运动`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("阅读顺序").selectOption(direction);
    await page.getByLabel("翻页方式").selectOption("curl");
    await page.getByLabel("关闭阅读设置").click();
    await expectCurlMotion(page, () =>
      page.getByLabel("下一页", { exact: true }).click(),
    );
    await expect(position(page)).toHaveText("2 / 170");
    await expectCurlMotion(page, () =>
      page.getByLabel("上一页", { exact: true }).click(),
    );
    await expect(position(page)).toHaveText("1 / 170");
    expect(errors).toEqual([]);
  });

test("一次导入重复文件也只保留一个书架记录", async ({ page }) => {
  await page.getByLabel("导入书籍文件").setInputFiles([book, book]);
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(1);
});

test("即时翻页与完整滑动过渡有区别，所有漫画键鼠可用", async ({ page }) => {
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(page.locator(".slide-overlay")).toBeVisible();
  await expect(page.locator(".slide-overlay")).toBeHidden();
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("instant");
  await page.getByLabel("关闭阅读设置").click();
  const surface = page.getByLabel("书籍正文");
  await surface.focus();
  for (const key of ["ArrowDown", "ArrowRight", "PageDown", "Space", "Enter"]) {
    const before = await position(page).innerText();
    await page.keyboard.press(key);
    await expect(position(page)).not.toHaveText(before);
  }

  for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
    const before = await position(page).innerText();
    await page.keyboard.press(key);
    await expect(position(page)).not.toHaveText(before);
  }
  await expect(page.locator(".slide-overlay")).toHaveCount(0);
  const before = await position(page).innerText();
  const bounds = (await surface.boundingBox())!;
  await surface.click({
    position: { x: bounds.width * 0.8, y: bounds.height * 0.5 },
  });
  await expect(position(page)).not.toHaveText(before);
  await surface.click({
    position: { x: bounds.width * 0.2, y: bounds.height * 0.5 },
  });
  await expect(position(page)).toHaveText(before);
});

for (const direction of ["ltr", "rtl"]) {
  test(`curl double ${direction} 双页按书脊正反翻动一个纸张`, async ({
    page,
  }) => {
    await page.getByLabel("阅读进度").fill("290");
    await expect(position(page)).toHaveText("50 / 170");
    await expect(page.locator(".slide-overlay")).toBeHidden();
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("double");
    await page.getByLabel("阅读顺序").selectOption(direction);
    await page.getByLabel("翻页方式").selectOption("curl");
    await page.getByLabel("关闭阅读设置").click();
    await expect(page.locator(".comic-spread .comic-page")).toHaveCount(2);
    await expectCurlMotion(
      page,
      () => page.getByLabel("下一页", { exact: true }).click(),
      true,
    );
    await expect(position(page)).toHaveText("52 / 170");
    await expectCurlMotion(
      page,
      () => page.getByLabel("上一页", { exact: true }).click(),
      true,
    );
    await expect(position(page)).toHaveText("50 / 170");
    await page.getByLabel("阅读进度").fill("0");
    await expect(position(page)).toHaveText("1 / 170");
    await expectCurlMotion(
      page,
      () => page.getByLabel("下一页", { exact: true }).click(),
      true,
    );
    await expect(position(page)).toHaveText("2 / 170");
    await expectCurlMotion(
      page,
      () => page.getByLabel("上一页", { exact: true }).click(),
      true,
    );
    await expect(position(page)).toHaveText("1 / 170");
    await page.getByLabel("阅读进度").fill("990");
    await expect(position(page)).toHaveText("168 / 170");
    await expectCurlMotion(
      page,
      () => page.getByLabel("下一页", { exact: true }).click(),
      true,
    );
    await expect(position(page)).toHaveText("170 / 170");
    await expectCurlMotion(
      page,
      () => page.getByLabel("上一页", { exact: true }).click(),
      true,
    );
    await expect(position(page)).toHaveText("168 / 170");
  });
}

test("进度条、实际缩放和书签删除", async ({ page }) => {
  await page.getByLabel("阅读进度").fill("500");
  await expect(position(page)).toHaveText("86 / 170");
  await page.getByLabel("添加书签").click();
  await page.getByLabel("目录", { exact: true }).click();
  await page.getByRole("button", { name: "书签 (1)" }).click();
  await page.getByLabel(/删除书签/).click();
  await expect(page.getByRole("button", { name: "书签 (0)" })).toBeVisible();
  await page.getByLabel("目录", { exact: true }).click();
  await page.getByLabel("阅读设置", { exact: true }).click();
  await expect(page.getByLabel("适配方式")).toHaveCount(0);
  await expect(page.locator(".preferences .setting-note")).toHaveCount(0);
  await expect(page.locator(".preferences")).not.toContainText(
    /WebGPU|NVIDIA|了解引擎|软件外观|背景图片/,
  );
  await expect(page.getByLabel("超分画质")).toBeVisible();
  const width = await page
    .locator(".comic-page")
    .evaluate((image) => image.getBoundingClientRect().width);
  await page.getByLabel("缩放", { exact: true }).fill("2");
  await expect
    .poll(() =>
      page
        .locator(".comic-page")
        .evaluate((image) => image.getBoundingClientRect().width),
    )
    .toBeGreaterThan(width * 1.8);
});

test("翻书声只用于仿真前后翻页，关闭与上下模式静音", async ({ page }) => {
  await page.evaluate(() => {
    const state = window as Window & { pageSoundCount: number };
    state.pageSoundCount = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      state.pageSoundCount++;
      return Reflect.apply(start, this, args);
    };
  });
  const sounds = () =>
    page.evaluate(
      () => (window as Window & { pageSoundCount: number }).pageSoundCount,
    );
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("翻书声").check();
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(page, () =>
    page.getByLabel("下一页", { exact: true }).click(),
  );
  await expect.poll(sounds).toBe(1);
  await expectCurlMotion(page, () =>
    page.getByLabel("上一页", { exact: true }).click(),
  );
  await expect.poll(sounds).toBe(2);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻书声").uncheck();
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(page, () =>
    page.getByLabel("下一页", { exact: true }).click(),
  );
  expect(await sounds()).toBe(2);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻书声").check();
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(position(page)).toHaveText("3 / 170");
  await expect(page.locator(".curl-overlay")).toHaveCount(0);
  expect(await sounds()).toBe(2);
});

test("拖动进度滑块时保留最后位置，自定义滤镜可排序和删除", async ({ page }) => {
  const slider = page.getByLabel("阅读进度");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height / 2, {
    steps: 24,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await position(page).getAttribute("data-progress")),
    )
    .toBeGreaterThan(0.78);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("滤镜预设").selectOption("A+B");
  await page.getByLabel("新增滤镜类型").selectOption("C");
  await page.getByLabel("添加滤镜", { exact: true }).click();
  await expect(page.getByLabel("滤镜链")).toContainText("C · 降噪");
  await page.getByLabel("上移滤镜 3").click();
  await expect(page.getByLabel("滤镜链").locator("li")).toHaveText([
    "A · 超分",
    "C · 降噪",
    "B · 柔和线条",
  ]);
  await page.getByLabel("删除滤镜 2").click();
  await expect(page.getByLabel("滤镜预设")).toHaveValue("A+B");
});

test("旧版漫画 EPUB 的章节位置与书签升级为真实图片页", async ({ page }) => {
  await page.getByLabel("返回书架", { exact: true }).click();
  const id = (await page.locator(".book-card").getAttribute("data-book-id"))!;
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          !!JSON.parse(localStorage.getItem("animeread:reading:v1") ?? "{}")
            .books?.[id],
        id,
      ),
    )
    .toBe(true);
  const legacy = await page.evaluate((id) => {
    const saved = JSON.parse(localStorage.getItem("animeread:reading:v1")!);
    saved.version = 1;
    saved.style.zoom = 0.8;
    const location = {
      kind: "reflow",
      section: 50,
      cfi: "epubcfi(/6/102!/4/2)",
      quote: "",
      progress: 0.31,
    };
    saved.books[id].location = location;
    saved.books[id].bookmarks = [
      { id: "legacy-mark", label: "原来的第 51 页", location, created: 1 },
    ];
    return JSON.stringify(saved);
  }, id);
  // Install old persisted data before the new application boots, after unload flush.
  await page.addInitScript(
    (saved) => localStorage.setItem("animeread:reading:v1", saved),
    legacy,
  );
  await page.reload();
  await page.getByLabel("导入书籍文件").setInputFiles(book);
  await expect(position(page)).toHaveText("51 / 170");
  await page.getByLabel("目录", { exact: true }).click();
  await page.getByRole("button", { name: "书签 (1)" }).click();
  await page
    .getByRole("button", { name: "原来的第 51 页", exact: true })
    .click();
  await expect(position(page)).toHaveText("51 / 170");
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!).books[id]
            .bookmarks[0].location,
        id,
      ),
    )
    .toMatchObject({
      kind: "fixed",
      page: 50,
    });
});

test("上下滚动、拖动截页后快捷键对齐整页，虚拟页数量有限", async ({ page }) => {
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await expect(page.getByLabel("翻页方式")).toBeDisabled();
  await expect(page.getByLabel("单双页")).toBeDisabled();
  await page.getByLabel("关闭阅读设置").click();
  const surface = page.getByLabel("书籍正文");
  await expect(page.locator(".vertical-page img").first()).toBeVisible();
  await surface.evaluate((host) => {
    host.scrollTop = 125;
  });
  const rect = await surface.boundingBox();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + 220);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => surface.evaluate((host) => host.scrollTop))
    .toBeGreaterThan(200);
  await surface.focus();
  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText("2 / 170");
  await expect
    .poll(() =>
      surface.evaluate((host) =>
        Math.abs(
          host.querySelector('[data-page="1"]')!.getBoundingClientRect().top -
            host.getBoundingClientRect().top,
        ),
      ),
    )
    .toBeLessThan(3);
  await page.keyboard.press("ArrowUp");
  await expect(position(page)).toHaveText("1 / 170");
  await page.getByLabel("阅读进度").fill("900");
  await expect(position(page)).toHaveText("153 / 170");
  await expect
    .poll(() => page.locator(".vertical-page").count())
    .toBeLessThanOrEqual(5);
  await page.getByLabel("阅读进度").fill("1000");
  await expect(position(page)).toHaveText("170 / 170");
  await surface.focus();
  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText("170 / 170");
  await expect(page.locator(".curl-overlay")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(position(page)).toHaveText("169 / 170");
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("阅读顺序").selectOption("ltr");
  await expect(page.getByLabel("翻页方式")).toHaveValue("curl");
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(page, () =>
    page.getByLabel("上一页", { exact: true }).click(),
  );
});

test("从中间页切换上下阅读并更新滤镜时保留页码", async ({ page }) => {
  await page.getByLabel("阅读进度").fill("296");
  await expect(position(page)).toHaveText("51 / 170");
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await page.getByLabel("滤镜预设").selectOption("C+B+A");
  await page.getByLabel("关闭阅读设置").click();
  await expect(
    page.locator('.vertical-page[data-page="50"] img'),
  ).toBeVisible();
  await expect(position(page)).toHaveText("51 / 170");
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(position(page)).toHaveText("52 / 170");
  await page.getByLabel("上一页", { exact: true }).click();
  await expect(position(page)).toHaveText("51 / 170");
  await expect(page.locator(".curl-overlay")).toHaveCount(0);
  await expect
    .poll(() => page.locator(".vertical-page").count())
    .toBeLessThanOrEqual(5);
});

test("雨景有实际像素，全屏隐藏全部 UI，Esc 留在当前书籍", async ({ page }) => {
  await expect(page.getByLabel("切换雨景")).toHaveCount(0);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("雨景", { exact: true }).check();
  await expect
    .poll(() =>
      page.locator(".rain-canvas").evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        const data = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let pixels = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 40) pixels++;
        return pixels;
      }),
    )
    .toBeGreaterThan(1000);
  const rainMotion = await page
    .locator(".rain-canvas")
    .evaluate(async (node) => {
      const canvas = node as HTMLCanvasElement;
      const hashes: number[] = [];
      for (let frame = 0; frame < 6; frame++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 0;
        for (let i = 3; i < pixels.length; i += 32)
          hash = (hash * 31 + pixels[i]) | 0;
        hashes.push(hash);
      }
      return { hashes, pixels: canvas.width * canvas.height };
    });
  expect(new Set(rainMotion.hashes).size).toBeGreaterThan(2);
  expect(rainMotion.pixels).toBeLessThanOrEqual(3_000_000);
  await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("全屏", { exact: true }).click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".reading-footer")).toBeHidden();
  await expect(page.locator(".reading-heading")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".comic-page")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const frozen = await page
    .locator(".rain-canvas")
    .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(120);
  await expect
    .poll(() =>
      page
        .locator(".rain-canvas")
        .evaluate((node) => (node as HTMLCanvasElement).toDataURL()),
    )
    .toBe(frozen);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("雨景", { exact: true }).uncheck();
  await expect(page.locator(".rain-canvas")).toHaveCount(0);
  await page.getByLabel("雨景", { exact: true }).check();
  await expect(page.locator(".rain-canvas")).toBeVisible();
});

test("漫画上下模式可由小说继续使用，切回横向恢复单双页和动画", async ({
  page,
}) => {
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("单双页").selectOption("double");
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("导入书籍文件").setInputFiles({
    name: "mode-switch.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      `第一章 验证\n${"上下阅读不能锁死小说的单双页与动画。\n".repeat(300)}`,
    ),
  });
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await page.getByLabel("阅读设置", { exact: true }).click();
  await expect(page.getByLabel("阅读顺序")).toHaveValue("ttb");
  await expect(page.getByLabel("单双页")).toBeDisabled();
  await page.getByLabel("阅读顺序").selectOption("ltr");
  await expect(page.getByLabel("单双页")).toBeEnabled();
  await expect(page.getByLabel("单双页")).toHaveValue("double");
  await expect(page.getByLabel("阅读顺序")).toHaveValue("ltr");
  await expect(page.getByLabel("翻页方式")).toBeEnabled();
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(
    page,
    () => page.getByLabel("下一页", { exact: true }).click(),
    true,
  );
});
