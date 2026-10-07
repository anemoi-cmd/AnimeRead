import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verificationDirectory } from "../../scripts/tool-paths.mjs";

const book = process.env.ANIMEREAD_TEST_BOOK;
const position = (page: Page) => page.getByTestId("reading-location");

async function saveReport(name: string, detail: unknown) {
  await mkdir(verificationDirectory, { recursive: true });
  await writeFile(
    resolve(verificationDirectory, `stress-${name}.json`),
    JSON.stringify(detail, null, 2),
  );
}

test("损坏格式和连续开关阅读器后仍可恢复 TXT、PDF 错误可见", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:1420");
  for (const name of [
    "broken.pdf",
    "broken.epub",
    "broken.cbz",
    "broken.jpg",
  ]) {
    await page.getByLabel("导入书籍文件").setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("invalid book bytes"),
    });
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByLabel("返回书架", { exact: true }).click();
    await expect(page.getByRole("alert")).toBeHidden();
  }
  const text = Buffer.from(
    `第一章 压力验证\n${"页面关闭后仍应可以打开、翻页和恢复位置。\n".repeat(1000)}`,
  );
  const start = performance.now();
  for (let cycle = 0; cycle < 20; cycle++) {
    await page.getByLabel("导入书籍文件").setInputFiles({
      name: "stability.txt",
      mimeType: "text/plain",
      buffer: text,
    });
    await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
    await expect(position(page)).toHaveAttribute("data-quote", /页面关闭/);
    await page.getByLabel("下一页", { exact: true }).click();
    await page.getByLabel("返回书架", { exact: true }).click();
    await expect(page.locator("foliate-view")).toHaveCount(0);
    await expect(page.locator(".curl-overlay,.slide-overlay")).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeHidden();
  }
  expect(errors).toEqual([]);
  await saveReport("recovery", {
    passed: true,
    rejectedFormats: 4,
    textOpenCloseCycles: 20,
    milliseconds: Math.round(performance.now() - start),
    errors,
  });
});

test("真实漫画快速输入、100 次定位和阅读模式循环的资源有界", async ({
  page,
}) => {
  test.skip(!book, "需要 ANIMEREAD_TEST_BOOK 指向用户自己的漫画 EPUB");
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(book!);
  await expect(position(page)).toHaveText("1 / 170");
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("instant");
  await page.getByLabel("关闭阅读设置").click();
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const heap = async () => {
    await client.send("HeapProfiler.collectGarbage");
    const { metrics } = await client.send("Performance.getMetrics");
    return Object.fromEntries(
      metrics.map((item: { name: string; value: number }) => [
        item.name,
        item.value,
      ]),
    );
  };
  const start = performance.now();
  await page.getByLabel("书籍正文").focus();
  await page.evaluate(() => {
    for (let i = 0; i < 500; i++)
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await page.getByLabel("阅读进度").fill("500");
  await expect(position(page)).toHaveText("86 / 170");
  const baseline = await heap();
  for (let i = 0; i < 100; i++) {
    const value = (i * 73) % 1001;
    await page.getByLabel("阅读进度").fill(String(value));
    await expect(position(page)).toHaveText(
      `${Math.round((value / 1000) * 169) + 1} / 170`,
    );
    await expect(page.locator(".comic-page")).toHaveCount(1);
  }
  let maximumVerticalNodes = 0;
  for (let cycle = 0; cycle < 6; cycle++) {
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("阅读顺序").selectOption("ttb");
    await page
      .getByLabel("缩放", { exact: true })
      .fill(String(cycle % 2 ? 1.5 : 1));
    await page.getByLabel("关闭阅读设置").click();
    const target = (cycle * 151) % 1001;
    await page.getByLabel("阅读进度").fill(String(target));
    await expect(position(page)).toHaveText(
      `${Math.round((target / 1000) * 169) + 1} / 170`,
    );
    await expect
      .poll(() => page.locator(".vertical-page").count())
      .toBeLessThanOrEqual(5);
    maximumVerticalNodes = Math.max(
      maximumVerticalNodes,
      await page.locator(".vertical-page").count(),
    );
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("阅读顺序").selectOption(cycle % 2 ? "rtl" : "ltr");
    await page.getByLabel("单双页").selectOption("double");
    await page
      .getByLabel("翻页方式")
      .selectOption(cycle % 2 ? "curl" : "slide");
    await page.getByLabel("关闭阅读设置").click();
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(page.locator(".curl-overlay,.slide-overlay")).toBeVisible();
    await expect(page.locator(".curl-overlay,.slide-overlay")).toBeHidden();
    await page.getByLabel("上一页", { exact: true }).click();
    await expect(page.locator(".curl-overlay,.slide-overlay")).toBeVisible();
    await expect(page.locator(".curl-overlay,.slide-overlay")).toBeHidden();
    const sourcePage = Number(
      (await position(page).innerText()).split(" / ")[0],
    );
    await expect(page.locator(".comic-page")).toHaveCount(
      sourcePage === 1 || sourcePage === 170 ? 1 : 2,
    );
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("single");
    await page.getByLabel("翻页方式").selectOption("instant");
    await page.getByLabel("关闭阅读设置").click();
  }
  const final = await heap();
  expect(final.JSHeapUsedSize - baseline.JSHeapUsedSize).toBeLessThan(
    32 * 1024 * 1024,
  );
  await expect(page.getByRole("alert")).toBeHidden();
  expect(errors).toEqual([]);
  await saveReport("comic", {
    passed: true,
    burstKeyboardEvents: 500,
    seeks: 100,
    layoutCycles: 6,
    maximumVerticalNodes,
    baseline,
    final,
    milliseconds: Math.round(performance.now() - start),
    errors,
    scope:
      "Browser JS heap after forced GC; does not measure dedicated GPU VRAM",
  });
});

test("一千卷书架与分组分页保持有限封面、DOM 和可用搜索", async ({ page }) => {
  test.skip(!book, "需要 ANIMEREAD_TEST_BOOK 指向用户自己的漫画 EPUB");
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const active = new Set<string>();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const value = create(blob);
      active.add(value);
      return value;
    };
    URL.revokeObjectURL = (value) => {
      active.delete(value);
      revoke(value);
    };
    Object.defineProperty(window, "stressObjectUrls", {
      get: () => active.size,
    });
  });
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(book!);
  await expect(position(page)).toHaveText("1 / 170");
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.locator(".cover-image")).toBeVisible();
  const cover = await page.locator(".cover-image").evaluate(async (node) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 137;
    canvas.getContext("2d")!.drawImage(node as HTMLImageElement, 0, 0, 96, 137);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/jpeg", 0.75),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const start = performance.now();
  // These are temporary metadata/thumbnail loads, not claims to own a thousand distinct volumes.
  await page.getByLabel("导入书籍文件").setInputFiles(
    Array.from({ length: 1000 }, (_, i) => ({
      name: `用户卷压力-${String(i).padStart(4, "0")}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from(cover),
    })),
  );
  await expect(page.locator(".comic-page")).toBeVisible();
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(60);
  await expect(page.locator(".count-pill")).toHaveText("1001");
  let maximumUrls = 0;
  for (let group = 0; group < 16; group++) {
    await page
      .getByRole("navigation", { name: "书架分页" })
      .getByRole("button", { name: "下一组书籍", exact: true })
      .click();
    await expect
      .poll(() => page.locator(".book-card").count())
      .toBeLessThanOrEqual(60);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { stressObjectUrls: number }).stressObjectUrls,
        ),
      )
      .toBeLessThanOrEqual(61);
    maximumUrls = Math.max(
      maximumUrls,
      await page.evaluate(
        () =>
          (window as Window & { stressObjectUrls: number }).stressObjectUrls,
      ),
    );
  }
  await page.getByLabel("搜索书架").fill("用户卷压力-0999");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "管理分组", exact: true }).click();
  await expect(page.locator(".group-book-picker input")).toHaveCount(100);
  for (let group = 0; group < 10; group++) {
    await page
      .getByRole("navigation", { name: "分组书籍分页" })
      .getByRole("button", { name: "下一组书籍", exact: true })
      .click();
    await expect(page.locator(".group-book-picker input")).toHaveCount(
      group === 9 ? 1 : 100,
    );
  }
  await page.getByLabel("分组收录 用户卷压力-0999").check();
  await page.getByLabel("分组名称", { exact: true }).fill("压力测试卷组");
  await page.getByRole("button", { name: "保存分组", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("分组已保存");
  await page.getByLabel("关闭分组管理").click();
  await expect(page.locator(".group-card")).toHaveCount(1);
  await page.getByRole("button", { name: "打开分组 压力测试卷组" }).click();
  await expect(page.locator(".book-card h3")).toHaveText("用户卷压力-0999");
  expect(errors).toEqual([]);
  await saveReport("library", {
    passed: true,
    bookRecords: 1001,
    shelfPagesVisited: 17,
    maximumCardsPerPage: 60,
    maximumUrls,
    pickerPageSize: 100,
    searchAndGroupSave: true,
    milliseconds: Math.round(performance.now() - start),
    errors,
    scope:
      "Thumbnails derived in memory from the user's real cover; no sample works persisted",
  });
});
