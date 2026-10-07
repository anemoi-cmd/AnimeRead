import { test, expect } from "@playwright/test";
const book = process.env.ANIMEREAD_TEST_BOOK;
test.skip(!book, "需要 ANIMEREAD_TEST_BOOK 指定用户漫画");
test("分组收录多卷、卷序、改名、重启恢复和解散不删书", async ({ page }) => {
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(book!);
  await expect(page.getByTestId("reading-location")).toHaveText("1 / 170");
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.locator(".cover-image")).toBeVisible();
  const data = await page.locator(".cover-image").evaluate(async (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = (image as HTMLImageElement).naturalWidth;
    canvas.height = (image as HTMLImageElement).naturalHeight;
    canvas.getContext("2d")!.drawImage(image as HTMLImageElement, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/jpeg"),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  // Separate records from the user's own cover exercise multi-volume metadata without inventing works.
  await page.getByLabel("导入书籍文件").setInputFiles(
    [2, 3].map((volume) => ({
      name: `用户漫画卷${volume}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from(data),
    })),
  );
  await expect(page.locator(".comic-page")).toBeVisible();
  await page.getByLabel("返回书架", { exact: true }).click();
  await page.getByRole("button", { name: "管理分组", exact: true }).click();
  await page.getByLabel("分组名称", { exact: true }).fill("與妳相戀到生命盡頭");
  await page.locator(".group-book-picker input").nth(0).check();
  await page.locator(".group-book-picker input").nth(1).check();
  await page.locator(".group-book-picker input").nth(2).check();
  await page.getByLabel("上移卷 3").click();
  const order = await page.locator(".volume-row > span").allTextContents();
  await page.getByRole("button", { name: "保存分组", exact: true }).click();
  await page.getByLabel("关闭分组管理").click();
  await expect(page.locator(".group-card")).toHaveCount(1);
  await expect(page.locator(".book-card:not(.group-card)")).toHaveCount(0);
  await page
    .getByRole("button", { name: "打开分组 與妳相戀到生命盡頭", exact: true })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(3);
  const titles = await page.locator(".book-card h3").allTextContents();
  expect(titles).toEqual(order.map((title) => title.replace(/^\d+\. /, "")));
  await page.getByRole("button", { name: "管理分组", exact: true }).click();
  await page.getByLabel("分组名称", { exact: true }).fill("我的漫画全集");
  await page.getByRole("button", { name: "保存分组", exact: true }).click();
  await page.getByLabel("关闭分组管理").click();
  await expect(page.locator(".shelf-heading h2")).toContainText("我的漫画全集");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!).groups?.[0]
            ?.name,
      ),
    )
    .toBe("我的漫画全集");
  await page.reload();
  await page.getByRole("button", { name: "管理分组", exact: true }).click();
  await expect(page.getByLabel("分组名称", { exact: true })).toHaveValue(
    "我的漫画全集",
  );
  await page.getByRole("button", { name: "删除分组", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!).groups
            .length,
      ),
    )
    .toBe(0);
  await page.getByLabel("关闭分组管理").click();
  await page.getByLabel("导入书籍文件").setInputFiles(book!);
  await expect(page.locator(".comic-page")).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();
});
