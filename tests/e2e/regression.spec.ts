import { test, expect, type Page } from "@playwright/test";
import { ZipWriter, Uint8ArrayWriter, TextReader } from "@zip.js/zip.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { expectCurlMotion } from "../curl-motion.mjs";

const body = Array.from(
  { length: 180 },
  (_, i) =>
    `段落 ${i + 1}：这是分页、字号和键盘输入的回归验收文字。${"阅读位置应当稳定，操作不应触发浏览器菜单。".repeat(5)}`,
).join("\n");
const location = (page: Page) => page.getByTestId("reading-location");
async function textBook(page: Page) {
  await page.getByLabel("导入书籍文件").setInputFiles({
    name: "regression.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`第一章 验收\n${body}\n第二章 验收\n${body}`),
  });
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
}
test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:1420");
});
test.afterEach(async ({ page }) => {
  await expect(page.getByRole("alert")).toBeHidden();
});

test("无显卡增强能力仍能阅读，失效的已保存增强设置自动关闭", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined });
    localStorage.setItem(
      "animeread:reading:v1",
      JSON.stringify({
        version: 4,
        books: {},
        style: { enhanceEnabled: true, enhanceBackend: "anime4k" },
      }),
    );
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!).style
            .enhanceEnabled,
      ),
    )
    .toBe(false);
  await textBook(page);
  const before = await location(page).getAttribute("data-cfi");
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(location(page)).not.toHaveAttribute("data-cfi", before!);
  if (process.env.ANIMEREAD_TEST_BOOK) {
    await page.getByLabel("返回书架", { exact: true }).click();
    await page
      .getByLabel("导入书籍文件")
      .setInputFiles(process.env.ANIMEREAD_TEST_BOOK);
    await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
    await page.getByLabel("阅读设置", { exact: true }).click();
    await expect(page.getByLabel("超分画质", { exact: true })).toBeDisabled();
    await expect(
      page.getByLabel("超分画质", { exact: true }),
    ).not.toBeChecked();
    await expect(page.getByLabel("增强引擎")).toBeDisabled();
    await expect(page.getByLabel("滤镜预设")).toBeDisabled();
    await expect(page.getByLabel("新增滤镜类型")).toBeDisabled();
    await expect(page.getByLabel("画质对比")).toBeDisabled();
  }
});

test("CPU 软件适配器不冒充可用的 Anime4K 显卡", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter: async () => ({
          info: { description: "Google SwiftShader", isFallbackAdapter: true },
        }),
      },
    });
    localStorage.setItem(
      "animeread:reading:v1",
      JSON.stringify({
        version: 4,
        books: {},
        style: { enhanceEnabled: true },
      }),
    );
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("animeread:reading:v1")!).style
            .enhanceEnabled,
      ),
    )
    .toBe(false);
  await textBook(page);
  await expect(page.locator("foliate-view")).toBeVisible();
});

test("单页仿真的临时纸张保留小说文字层", async ({ page }) => {
  await textBook(page);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("单双页").selectOption("single");
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("下一页", { exact: true }).click();
  const overlay = page.locator(".curl-overlay");
  await expect(overlay).toBeVisible();
  await expect
    .poll(() => overlay.locator(".novel-page-snapshot").count())
    .toBeGreaterThan(2);
  const pages = await overlay
    .locator(".novel-page-snapshot")
    .evaluateAll((frames) =>
      frames.map((frame) => ({
        text: frame.shadowRoot?.querySelector("body")?.textContent?.length ?? 0,
      })),
    );
  // 前／后页和引擎复制的临时页都应有正文，不能只检查纸张在移动。
  expect(pages.every((item) => item.text > 100)).toBe(true);
  await expect(overlay).toHaveCount(0);
});

for (const motion of ["slide", "curl"])
  test(`小说 ${motion} 快照实际像素与原页面一致，不能只验证文字坐标`, async ({
    page,
  }) => {
    await textBook(page);
    await page.getByLabel("阅读进度").fill("350");
    await expect
      .poll(async () =>
        Number(await location(page).getAttribute("data-progress")),
      )
      .toBeGreaterThan(0.3);
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("翻页方式").selectOption(motion);
    await page.getByLabel("单双页").selectOption("double");
    await page.getByLabel("关闭阅读设置").click();
    await page.waitForTimeout(200);
    const surface = page.getByLabel("书籍正文");
    const before = await surface.screenshot();
    await page.evaluate(() => {
      const state = window as unknown as {
        pixelPages: { node: HTMLElement; css: string; className: string }[];
        pixelObserver: MutationObserver;
      };
      state.pixelPages = [];
      const host = document.querySelector(".reader-surface")!;
      state.pixelObserver = new MutationObserver(() => {
        for (const prep of host.querySelectorAll<HTMLElement>(":scope > div")) {
          if (
            prep.style.opacity !== "0" ||
            prep.className ||
            !prep.querySelector(".novel-page-snapshot")
          )
            continue;
          const node = prep.firstElementChild as HTMLElement;
          if (!state.pixelPages.some((item) => item.node === node))
            state.pixelPages.push({
              node,
              css: node.style.cssText,
              className: node.className,
            });
        }
      });
      state.pixelObserver.observe(host, { childList: true });
    });
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(
      page.locator(`.${motion === "curl" ? "curl" : "slide"}-overlay`),
    ).toBeVisible();
    const layers = await page.evaluate(() => {
      const host = document.querySelector(".reader-surface")!,
        paper = host.querySelector(".curl-overlay,.slide-overlay")!;
      return {
        spine: Number(getComputedStyle(host, "::after").zIndex),
        paper: Number(getComputedStyle(paper).zIndex),
      };
    });
    expect(layers.spine).toBeLessThan(layers.paper);
    await expect(
      page.locator(".turn-cover,.curl-overlay,.slide-overlay"),
    ).toHaveCount(0);
    const after = await surface.screenshot();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { pixelPages: unknown[] }).pixelPages.length,
      ),
    ).toBe(2);
    for (const [index, original] of [before, after].entries()) {
      await page.evaluate((index) => {
        const state = window as unknown as {
          pixelPages: { node: HTMLElement; css: string; className: string }[];
        };
        const item = state.pixelPages[index];
        item.node.style.cssText = item.css;
        item.node.className = item.className;
        const cover = document.createElement("div");
        cover.className = "turn-cover";
        cover.dataset.pixelCheck = "true";
        cover.append(item.node);
        document.querySelector(".reader-surface")!.append(cover);
        // 已移出文档的动画不会由 getAnimations 返回；重挂后取消并去掉位移。
        item.node.getAnimations().forEach((animation) => animation.cancel());
        item.node.style.setProperty("transform", "none", "important");
      }, index);
      const snapshot = await surface.screenshot();
      const difference = await page.evaluate(
        async ({ a, b }) => {
          const decode = (data: string) =>
            createImageBitmap(
              new Blob(
                [Uint8Array.from(atob(data), (char) => char.charCodeAt(0))],
                { type: "image/png" },
              ),
            );
          const [left, right] = await Promise.all([decode(a), decode(b)]);
          const canvas = document.createElement("canvas");
          canvas.width = left.width;
          canvas.height = left.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(left, 0, 0);
          const x = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(right, 0, 0);
          const y = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let sum = 0,
            changed = 0,
            ink = 0,
            pixels = 0;
          for (let row = 0; row < canvas.height; row++)
            for (let column = 0; column < canvas.width; column++) {
              // 静态书脊在动态纸张下方；只排除它的固定窄带。
              if (Math.abs(column - canvas.width / 2) < 30 * devicePixelRatio)
                continue;
              const i = (row * canvas.width + column) * 4;
              const delta = Math.max(
                Math.abs(x[i] - y[i]),
                Math.abs(x[i + 1] - y[i + 1]),
                Math.abs(x[i + 2] - y[i + 2]),
              );
              if (
                Math.max(
                  Math.abs(x[i] - x[0]),
                  Math.abs(x[i + 1] - x[1]),
                  Math.abs(x[i + 2] - x[2]),
                ) > 24
              )
                ink++;
              sum += delta;
              pixels++;
              if (delta > 24) changed++;
            }
          left.close();
          right.close();
          return { ink, mean: sum / pixels, fraction: changed / pixels };
        },
        { a: original.toString("base64"), b: snapshot.toString("base64") },
      );
      if (difference.mean >= 0.5 || difference.fraction >= 0.005) {
        await test.info().attach(`page-${index}-original`, {
          body: original,
          contentType: "image/png",
        });
        await test.info().attach(`page-${index}-snapshot`, {
          body: snapshot,
          contentType: "image/png",
        });
        await test.info().attach(`page-${index}-difference`, {
          body: JSON.stringify(difference),
          contentType: "application/json",
        });
      }
      expect(difference.ink).toBeGreaterThan(2000);
      expect(difference.mean).toBeLessThan(0.5);
      expect(difference.fraction).toBeLessThan(0.005);
      await page
        .locator("[data-pixel-check]")
        .evaluate((node) => node.remove());
    }
    await page.evaluate(() =>
      (
        window as unknown as { pixelObserver: MutationObserver }
      ).pixelObserver.disconnect(),
    );
  });

test("实录雨声反复开关复用解码缓存并停止声音节点", async ({ page }) => {
  await textBook(page);
  await page.evaluate(() => {
    const state = window as Window & {
      rainAudio: {
        started: number;
        stopped: number;
        decoded: number;
        fetched: number;
        duration: number;
      };
    };
    state.rainAudio = {
      started: 0,
      stopped: 0,
      decoded: 0,
      fetched: 0,
      duration: 0,
    };
    const fetchOriginal = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).includes("/audio/rain.ogg"))
        state.rainAudio.fetched++;
      return fetchOriginal(...args);
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args) {
      state.rainAudio.decoded++;
      return Reflect.apply(decode, this, args);
    };
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) {
      state.rainAudio.started++;
      state.rainAudio.duration = this.buffer!.duration;
      return Reflect.apply(start, this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      state.rainAudio.stopped++;
      return Reflect.apply(stop, this, args);
    };
  });
  await page.getByLabel("阅读设置", { exact: true }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByLabel("雨声", { exact: true }).check();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { rainAudio: { started: number } }).rainAudio
              .started,
        ),
      )
      .toBe(i);
    await page.getByLabel("雨声", { exact: true }).uncheck();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { rainAudio: { stopped: number } }).rainAudio
              .stopped,
        ),
      )
      .toBe(i);
  }
  expect(
    await page.evaluate(
      () => (window as Window & { rainAudio: unknown }).rainAudio,
    ),
  ).toEqual({ started: 3, stopped: 3, decoded: 1, fetched: 1, duration: 30 });
});

test("小说 iframe 键鼠、前后卷页、字体和 Esc 全屏回归", async ({ page }) => {
  await textBook(page);
  for (const key of [
    "ArrowDown",
    "ArrowRight",
    "PageDown",
    " ",
    "Enter",
    "ArrowLeft",
    "ArrowUp",
    "PageUp",
  ]) {
    await expect(
      page.locator(".turn-cover, .curl-overlay, .slide-overlay"),
    ).toHaveCount(0);
    const before = await location(page).getAttribute("data-cfi");
    await page.evaluate((key) => {
      const view = document.querySelector("foliate-view") as HTMLElement & {
        renderer: { getContents(): { doc: Document }[] };
      };
      const doc = view.renderer.getContents()[0].doc;
      doc.dispatchEvent(
        new doc.defaultView!.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, key);
    await expect(location(page)).not.toHaveAttribute("data-cfi", before!);
  }
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("系统字体").selectOption("SimSun");
  await page.getByLabel("字号", { exact: true }).fill("28");
  await page.getByRole("button", { name: "加粗" }).click();
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(page, () =>
    page.getByLabel("下一页", { exact: true }).click(),
  );
  await expectCurlMotion(page, () =>
    page.getByLabel("上一页", { exact: true }).click(),
  );
  await page.getByLabel("全屏", { exact: true }).click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as HTMLElement & {
      renderer: { getContents(): { doc: Document }[] };
    };
    const doc = view.renderer.getContents()[0].doc;
    doc.dispatchEvent(
      new doc.defaultView!.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator("foliate-view")).toBeVisible();
});

test("PDF 真实画布与可选择文字仍能阅读和缩放", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++)
    pdf.addPage([400, 500]).drawText(`Reader regression page ${i + 1}`, {
      x: 25,
      y: 400,
      size: 16,
      font,
    });
  await page.getByLabel("导入书籍文件").setInputFiles({
    name: "regression.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(location(page)).toHaveText("1 / 3");
  await expect(page.locator(".textLayer")).toContainText("Reader regression");
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(location(page)).toHaveText("2 / 3");
  await page.getByLabel("上一页", { exact: true }).click();
  await expect(location(page)).toHaveText("1 / 3");
  await page.getByLabel("阅读设置", { exact: true }).click();
  const before = await page
    .locator(".pdf-page")
    .evaluate((node) => node.getBoundingClientRect().width);
  await page.getByLabel("缩放", { exact: true }).fill("2");
  await expect
    .poll(() =>
      page
        .locator(".pdf-page")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeGreaterThan(before * 1.8);
  await page.getByLabel("缩放", { exact: true }).fill("1");
  await page.getByLabel("单双页").selectOption("double");
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("阅读顺序").selectOption("rtl");
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(
    page,
    () => page.getByLabel("下一页", { exact: true }).click(),
    true,
  );
  await expect(location(page)).toHaveText("2 / 3");
  await expect(page.locator(".pdf-page")).toHaveCount(2);
  const second = page.locator('.fixed-page-slot[data-page="1"]');
  const third = page.locator('.fixed-page-slot[data-page="2"]');
  await expect(second.locator(".textLayer")).toContainText("page 2");
  await expect(third.locator(".textLayer")).toContainText("page 3");
  const bounds = await Promise.all(
    [second, third].map((slot) =>
      slot.evaluate((node) => node.getBoundingClientRect().left),
    ),
  );
  expect(bounds[0]).toBeGreaterThan(bounds[1]);
  await expectCurlMotion(
    page,
    () => page.getByLabel("上一页", { exact: true }).click(),
    true,
  );
  await expect(location(page)).toHaveText("1 / 3");
  await expect(page.locator(".pdf-page")).toHaveCount(1);
});

test("小说双栏真实排版、书脊卷页与阅读锚点保留", async ({ page }) => {
  await textBook(page);
  await page.getByLabel("阅读进度").fill("350");
  await expect
    .poll(async () =>
      Number(await location(page).getAttribute("data-progress")),
    )
    .toBeGreaterThan(0.3);
  const anchor = await location(page).getAttribute("data-cfi");
  const columnWidth = () =>
    page.evaluate(() => {
      const view = document.querySelector("foliate-view") as HTMLElement & {
        renderer: { getContents(): { doc: Document }[] };
      };
      const doc = view.renderer.getContents()[0].doc;
      return parseFloat(
        doc.defaultView!.getComputedStyle(doc.documentElement).columnWidth,
      );
    });
  await page.getByLabel("阅读设置", { exact: true }).click();
  await expect
    .poll(columnWidth)
    .toBeGreaterThan(
      await page
        .getByLabel("书籍正文")
        .evaluate((host) => host.clientWidth * 0.7),
    );
  const singleWidth = await columnWidth();
  await page.getByLabel("单双页").selectOption("double");
  await expect.poll(columnWidth).toBeLessThan(singleWidth * 0.6);
  if (anchor) await expect(location(page)).toHaveAttribute("data-cfi", anchor);
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("关闭阅读设置").click();
  await expectCurlMotion(
    page,
    () => page.getByLabel("下一页", { exact: true }).click(),
    true,
  );
  await expectCurlMotion(
    page,
    () => page.getByLabel("上一页", { exact: true }).click(),
    true,
  );
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("单双页").selectOption("single");
  await expect.poll(columnWidth).toBeGreaterThan(singleWidth * 0.9);
});

test("全屏设置可打开，外观选项和引擎解释仅放在各自入口", async ({ page }) => {
  await textBook(page);
  await page.getByLabel("全屏", { exact: true }).click();
  await page.getByLabel("全屏阅读设置").click();
  await expect(page.locator(".preferences")).toBeVisible();
  await expect(page.locator(".preferences")).not.toContainText(
    /软件外观|背景图片|主题配色/,
  );
  await expect(page.getByLabel("单双页")).toBeVisible();
  await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("书籍正文").focus();
  await page.keyboard.press("Control+Comma");
  await expect(page.locator(".preferences")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar")).toBeVisible();
  if (await page.getByLabel("关闭阅读设置").isVisible())
    await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("返回书架", { exact: true }).click();
  await page.getByRole("button", { name: "使用说明", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "使用说明" })).toContainText(
    "只有 A 改变尺寸",
  );
  await expect(page.getByRole("dialog", { name: "使用说明" })).toContainText(
    "滤镜是处理步骤",
  );
});

test("普通 EPUB 的小说分类、脚本隔离与目录仍正确", async ({ page }) => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const entries = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "book.opf":
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB 回归验收</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
    "nav.xhtml":
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">验收章节</a></li></ol></nav></body></html>',
    "c1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>验收</title></head><body><script>parent.window.BOOK_SCRIPT_EXECUTED=true</script><h1>验收章节</h1>${body
      .split("\n")
      .map((line) => `<p>${line}</p>`)
      .join("")}</body></html>`,
  };
  for (const [path, content] of Object.entries(entries))
    await writer.add(path, new TextReader(content));
  const buffer = await writer.close();
  await page.getByLabel("导入书籍文件").setInputFiles({
    name: "regression.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from(buffer),
  });
  await expect(location(page)).toHaveAttribute("data-quote", /验收/);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { BOOK_SCRIPT_EXECUTED?: boolean })
          .BOOK_SCRIPT_EXECUTED,
    ),
  ).toBeUndefined();
  await page.getByLabel("目录", { exact: true }).click();
  await expect(page.locator(".toc-list")).toContainText("验收章节");
  await page.getByLabel("返回书架", { exact: true }).click();
  await page
    .locator(".shelf-tabs button")
    .filter({ hasText: /^小说$/ })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(1);
});
