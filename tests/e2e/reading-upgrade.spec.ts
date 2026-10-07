import { test, expect } from "@playwright/test";
const book = process.env.ANIMEREAD_TEST_BOOK;
test.skip(!book, "需要 ANIMEREAD_TEST_BOOK 指定用户漫画 EPUB");
test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(book);
  await expect(page.getByTestId("reading-location")).toHaveText("1 / 170");
});
test.afterEach(async ({ page }) => {
  await expect(page.getByRole("alert")).toBeHidden();
});
for (const direction of ["ltr", "rtl"])
  test(`双页漫画 ${direction} 完整显示、顺序和上一组`, async ({ page }) => {
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("double");
    await page.getByLabel("阅读顺序").selectOption(direction);
    await page.getByLabel("翻页方式").selectOption("instant");
    await page.getByLabel("关闭阅读设置").click();
    await expect(page.locator(".comic-page")).toHaveCount(1);
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(page.getByTestId("reading-location")).toHaveText("2 / 170");
    await expect(page.locator(".comic-page")).toHaveCount(2);
    const layout = await page.locator(".comic-page").evaluateAll((images) =>
      images
        .map((node) => {
          const image = node as HTMLImageElement,
            rect = image.getBoundingClientRect();
          return {
            page: image.dataset.page,
            left: rect.left,
            ratio: rect.width / rect.height,
            original: image.naturalWidth / image.naturalHeight,
          };
        })
        .sort((a, b) => Number(a.page) - Number(b.page)),
    );
    expect(layout.map((item) => item.page)).toEqual(["1", "2"]);
    for (const item of layout) expect(item.ratio).toBeCloseTo(item.original, 2);
    expect(
      direction === "rtl"
        ? layout[0].left > layout[1].left
        : layout[0].left < layout[1].left,
    ).toBe(true);
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(page.getByTestId("reading-location")).toHaveText("4 / 170");
    await page.getByLabel("上一页", { exact: true }).click();
    await expect(page.getByTestId("reading-location")).toHaveText("2 / 170");
    await page.getByLabel("阅读进度").fill("1000");
    await expect(page.getByTestId("reading-location")).toHaveText("170 / 170");
    await expect(page.locator(".comic-page")).toHaveCount(1);
    await page.getByLabel("上一页", { exact: true }).click();
    await expect(page.getByTestId("reading-location")).toHaveText("168 / 170");
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("single");
    await expect(page.locator(".comic-page")).toHaveCount(1);
    await expect(page.getByTestId("reading-location")).toHaveText("168 / 170");
  });
test("读取真实封面、删除无用小字、主题背景持久化", async ({ page }) => {
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.locator(".cover-image")).toBeVisible();
  const image = await page.locator(".cover-image").evaluate((image) => ({
    width: (image as HTMLImageElement).naturalWidth,
    height: (image as HTMLImageElement).naturalHeight,
  }));
  expect(image.width).toBeGreaterThan(100);
  expect(image.height / image.width).toBeCloseTo(1600 / 1120, 1);
  await expect(
    page.getByText("本地阅读 · 离线可用", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("阅读进度与设置保存在本机", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByLabel("海蓝主题").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--theme-accent")
          .trim(),
      ),
    )
    .toBe("#386c9a");
  const backdrop = await page
    .locator(".cover-image")
    .evaluate(async (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = (image as HTMLImageElement).naturalWidth;
      canvas.height = (image as HTMLImageElement).naturalHeight;
      canvas.getContext("2d")!.drawImage(image as HTMLImageElement, 0, 0);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), "image/jpeg"),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
  await page.getByLabel("选择背景图片或视频文件").setInputFiles({
    name: "用户漫画封面.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(backdrop),
  });
  await expect(page.locator(".app-shell")).toHaveClass(/has-wallpaper/);
  await page.getByLabel("背景壁纸浓度").fill("0.45");
  await page.getByLabel("关闭外观设置").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!).appearance
            .backgroundOpacity,
      ),
    )
    .toBe(0.45);
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/has-wallpaper/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--theme-accent")
          .trim(),
      ),
    )
    .toBe("#386c9a");
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByRole("button", { name: "移除壁纸", exact: true }).click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/has-wallpaper/);
});
test("阅读计时离开书籍暂停，删除书目保留总阅读时间", async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!)
            .totalReadingMillis ?? 0,
      ),
    )
    .toBeGreaterThan(1000);
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.getByTestId("total-reading-time")).not.toHaveText("0 秒");
  await expect(page.locator(".book-reading-time")).not.toHaveText("阅读 0 秒");
  const time = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("animeread:reading:v1")!)
        .totalReadingMillis,
  );
  await page.waitForTimeout(1150);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("animeread:reading:v1")!)
          .totalReadingMillis,
    ),
  ).toBe(time);
  await page.locator(".book-card").click({ button: "right" });
  await page.getByRole("menuitem", { name: "从书架删除" }).click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("animeread:reading:v1")!)
          .totalReadingMillis,
    ),
  ).toBe(time);
});
