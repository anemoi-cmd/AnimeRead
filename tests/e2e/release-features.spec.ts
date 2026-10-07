import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { verificationDirectory } from "../../scripts/tool-paths.mjs";

const book = process.env.ANIMEREAD_TEST_BOOK;
async function openComic(page: Page) {
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(book!);
  await expect(page.getByTestId("reading-location")).toHaveText("1 / 170");
}
test("更新入口可关闭，浏览器预览不冒充可安装的桌面更新", async ({ page }) => {
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("button", { name: "软件更新", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "软件更新" })).toBeVisible();
  await expect(page.getByText("请在 Windows 阅读器内检查更新。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载并重启更新" }),
  ).toHaveCount(0);
  await page.getByLabel("关闭软件更新").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("真实漫画快慢卷页时长有明显差异、保存设置且不影响上下阅读", async ({
  page,
}) => {
  test.skip(!book, "需要用户漫画 EPUB");
  await openComic(page);
  const times: number[] = [];
  for (const duration of [150, 1200]) {
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("翻页方式").selectOption("curl");
    await page.getByLabel("仿真翻页时长").fill(String(duration));
    await page.getByLabel("关闭阅读设置").click();
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(page.locator(".curl-overlay")).toBeVisible();
    const start = performance.now();
    await expect(page.locator(".curl-overlay")).toHaveCount(0);
    times.push(performance.now() - start);
  }
  expect(times[1] - times[0]).toBeGreaterThan(300);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("animeread:reading:v1")!).style,
  );
  expect(saved.turnDuration).toBe(1200);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await expect(page.getByLabel("仿真翻页时长")).toHaveCount(0);
  await page.getByLabel("关闭阅读设置").click();
  const previous = await page.getByTestId("reading-location").innerText();
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(page.getByTestId("reading-location")).not.toHaveText(previous);
  await expect(page.locator(".curl-overlay")).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeHidden();
});
test("木纹进入漫画白色区域，卷页截图保留纹理和稳定页面框", async ({ page }) => {
  test.skip(!book, "需要用户漫画 EPUB");
  await openComic(page);
  await page.getByLabel("阅读进度").fill("300");
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("木纹", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("仿真翻页时长").fill("1500");
  await page.getByLabel("关闭阅读设置").click();
  const frame = page.locator(".image-frame").first();
  await expect(page.getByLabel("书籍正文")).toHaveAttribute(
    "data-paper",
    "wood",
  );
  await expect
    .poll(() =>
      frame.evaluate((node) => getComputedStyle(node).backgroundImage),
    )
    .toContain("data:image/png");
  const original = await frame.locator("img").evaluate((node) => {
    const image = node as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 30; y < canvas.height - 30; y += 10)
      for (let x = 30; x < canvas.width - 30; x += 10) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i] > 252 && pixels[i + 1] > 252 && pixels[i + 2] > 252)
          return { x: x / canvas.width, y: y / canvas.height };
      }
    throw new Error("找不到原漫画的白纸采样点");
  });
  const image = await frame.screenshot();
  const color = await page.evaluate(
    async ({ bytes, point }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const color = Array.from(
        context.getImageData(
          Math.round(point.x * canvas.width),
          Math.round(point.y * canvas.height),
          1,
          1,
        ).data,
      );
      bitmap.close();
      return color;
    },
    { bytes: Array.from(image), point: original },
  );
  expect(color[0]).toBeLessThan(235);
  expect(color[2]).toBeLessThan(185);
  await mkdir(verificationDirectory, { recursive: true });
  await frame.screenshot({
    path: resolve(verificationDirectory, "wood-paper.png"),
  });
  const paper = await page.locator(".comic-spread").boundingBox();
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(page.locator(".curl-overlay")).toBeVisible();
  const stage = await page.locator(".curl-stage").boundingBox();
  expect(stage!.width).toBeCloseTo(paper!.width, 1);
  expect(stage!.height).toBeCloseTo(paper!.height, 1);
  const snapshotColors = await page
    .locator(".turn-cover canvas")
    .first()
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return Array.from(canvas.getContext("2d")!.getImageData(1, 1, 1, 1).data);
    });
  expect(snapshotColors[2]).toBeLessThan(200);
  await expect(page.locator(".curl-overlay")).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeHidden();
});
