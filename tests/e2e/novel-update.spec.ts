import { test, expect, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
const directory = process.env.ANIMEREAD_TEST_NOVELS;
const novels = directory
  ? readdirSync(directory)
      .filter((name) => name.endsWith(".epub"))
      .map((name) => resolve(directory, name))
  : [];
const location = (page: Page) => page.getByTestId("reading-location");
async function dimensions(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as HTMLElement & {
      renderer: { getContents(): { doc: Document }[] };
    };
    const doc = view.renderer.getContents()[0].doc;
    return {
      column: parseFloat(
        doc.defaultView!.getComputedStyle(doc.documentElement).columnWidth,
      ),
      host: document.querySelector(".reader-surface")!.clientWidth,
      family: doc.defaultView!.getComputedStyle(doc.body).fontFamily,
    };
  });
}
async function open(page: Page, file: string) {
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(file);
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await page.getByLabel("阅读进度").fill("350");
  await expect
    .poll(async () =>
      Number(await location(page).getAttribute("data-progress")),
    )
    .toBeGreaterThan(0.3);
}
test.afterEach(async ({ page }) => {
  await expect(page.getByRole("alert")).toBeHidden();
});
for (const file of novels)
  test(`用户小说 ${file.split(/[\\/]/).pop()} 正文、封面、最近阅读`, async ({
    page,
  }) => {
    await open(page, file);
    expect((await dimensions(page)).column).toBeGreaterThan(500);
    await page.getByLabel("返回书架", { exact: true }).click();
    await expect(page.locator(".recent-book img")).toBeVisible();
    await expect(page.locator(".recent-book time")).toBeVisible();
    expect(
      await page
        .locator(".recent-book img")
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(100);
  });
for (const motion of ["instant", "slide", "curl"])
  for (const layout of ["single", "double"])
    test(`初次全屏 ${motion}/${layout} 自动铺满且锚点保持`, async ({
      page,
    }) => {
      test.skip(!novels.length, "需要用户小说目录");
      await open(page, novels[0]);
      await page.getByLabel("阅读设置", { exact: true }).click();
      await page.getByLabel("翻页方式").selectOption(motion);
      await page.getByLabel("单双页").selectOption(layout);
      await page.getByLabel("关闭阅读设置").click();
      const anchor = await location(page).getAttribute("data-cfi");
      await page.getByLabel("全屏", { exact: true }).click();
      const columns = layout === "double" ? 2 : 1;
      await expect
        .poll(async () => {
          const d = await dimensions(page);
          return (d.column * columns) / d.host;
        })
        .toBeGreaterThan(0.82);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await expect
        .poll(async () => {
          const d = await dimensions(page);
          return (d.column * columns) / d.host;
        })
        .toBeGreaterThan(0.86);
      await expect(location(page)).toHaveAttribute("data-cfi", anchor!);
      await page.keyboard.press("Escape");
      await expect(page.locator(".topbar")).toBeVisible();
    });
for (const kind of ["novel", "comic"])
  for (const direction of ["ltr", "rtl"])
    for (const layout of ["single", "double"])
      test(`共用鼠标输入 ${kind}/${direction}/${layout} 左右点击、右键无翻页、拖动跟随与回弹`, async ({
        page,
      }) => {
        test.skip(
          kind === "novel" ? !novels.length : !process.env.ANIMEREAD_TEST_BOOK,
          "需要用户作品",
        );
        await open(
          page,
          kind === "novel" ? novels[0] : process.env.ANIMEREAD_TEST_BOOK!,
        );
        await page.getByLabel("阅读设置", { exact: true }).click();
        await page.getByLabel("阅读顺序").selectOption(direction);
        await page.getByLabel("单双页").selectOption(layout);
        await page.getByLabel("翻页方式").selectOption("curl");
        await page.getByLabel("关闭阅读设置").click();
        await page.waitForTimeout(200);
        const surface = page.getByLabel("书籍正文"),
          bounds = (await surface.boundingBox())!;
        const read = () =>
          location(page).getAttribute(
            kind === "novel" ? "data-cfi" : "data-progress",
          );
        const before = await read();
        await surface.click({
          position: { x: bounds.width * 0.8, y: bounds.height * 0.8 },
        });
        await expect.poll(read).not.toBe(before);
        await expect(page.locator(".curl-overlay")).toHaveCount(0);
        await expect(surface).not.toHaveAttribute("aria-busy", "true");
        const next = await read();
        await surface.click({
          button: "right",
          position: { x: bounds.width * 0.8, y: bounds.height * 0.8 },
        });
        await page.waitForTimeout(200);
        expect(await read()).toBe(next);
        await surface.click({
          position: { x: bounds.width * 0.2, y: bounds.height * 0.8 },
        });
        await expect.poll(read).not.toBe(next);
        await expect(page.locator(".curl-overlay")).toHaveCount(0);
        await expect(surface).not.toHaveAttribute("aria-busy", "true");
        const origin = await read();
        // Text itself is selectable; a page drag starts in its outer margin.
        const dragStart = kind === "novel" ? 0.99 : 0.9;
        const drag = async (fraction: number) => {
          await page.mouse.move(
            bounds.x + bounds.width * dragStart,
            bounds.y + bounds.height * 0.8,
          );
          await page.mouse.down();
          await page.mouse.move(
            bounds.x + bounds.width * (dragStart - fraction),
            bounds.y + bounds.height * 0.8,
            { steps: 8 },
          );
          await expect(page.locator(".curl-overlay")).toHaveAttribute(
            "data-state",
            "user_fold",
          );
          await expect
            .poll(async () =>
              Number(
                await page
                  .locator(".curl-overlay")
                  .getAttribute("data-progress"),
              ),
            )
            .toBeCloseTo(fraction, 1);
          await page.mouse.up();
          await expect(page.locator(".curl-overlay")).toHaveCount(0);
          await expect(surface).not.toHaveAttribute("aria-busy", "true");
        };
        await drag(0.2);
        expect(await read()).toBe(origin);
        await drag(0.7);
        await expect.poll(read).not.toBe(origin);
        if (kind === "novel" && direction === "ltr" && layout === "single") {
          await page.evaluate(async () => {
            const view = document.querySelector(
              "foliate-view",
            ) as HTMLElement & {
              getSectionFractions(): number[];
              goToFraction(fraction: number): Promise<void>;
            };
            await view.goToFraction(view.getSectionFractions()[3] - 0.000001);
          });
          const sectionOf = () =>
            page.evaluate(
              () =>
                (
                  document.querySelector("foliate-view") as unknown as {
                    lastLocation: { section: { current: number } };
                  }
                ).lastLocation.section.current,
            );
          const section = await sectionOf();
          await drag(0.7);
          await expect.poll(sectionOf).not.toBe(section);
        }
      });

test("自动分组已有卷与新卷、手工排除、卷封面轮换", async ({ page }) => {
  test.skip(novels.length < 4, "需要四卷用户小说");
  await page.goto("http://127.0.0.1:1420");
  await page.getByLabel("导入书籍文件").setInputFiles(novels.slice(0, 3));
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await page.getByLabel("返回书架", { exact: true }).click();
  await page.getByRole("button", { name: "管理分组", exact: true }).click();
  await page.getByLabel("分组名称", { exact: true }).fill("玩玩的恋爱关系");
  await page.getByRole("button", { name: "保存分组", exact: true }).click();
  await expect(page.locator(".volume-row")).toHaveCount(3);
  await page.getByLabel("从分组移除卷 2").click();
  await page.getByRole("button", { name: "保存分组", exact: true }).click();
  await page.getByLabel("关闭分组管理").click();
  await expect(page.locator(".group-volume-count")).toHaveText("2 卷");
  await page.getByLabel("导入书籍文件").setInputFiles(novels[3]);
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await page.getByLabel("返回书架", { exact: true }).click();
  await expect(page.locator(".group-volume-count")).toHaveText("3 卷");
  const cover = page.locator(".group-card .cover-image");
  await expect(cover).toBeVisible();
  const before = await cover.getAttribute("data-cover-book");
  await page.getByLabel("打开分组 玩玩的恋爱关系").click();
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.getByLabel("返回全部分组").click();
  await expect(cover).not.toHaveAttribute("data-cover-book", before!);
  await expect(page.locator(".book-card:not(.group-card)")).toHaveCount(1);
});

test("首页自定义文字、视频壁纸循环与重启恢复，读书时卸载", async ({ page }) => {
  test.skip(!novels.length, "需要用户小说");
  await open(page, novels[0]);
  await page.getByLabel("返回书架", { exact: true }).click();
  // A short local WebM exercises the real decoder and IndexedDB, not a mocked URL.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const stream = canvas.captureStream(10),
      chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const done = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });
    recorder.start();
    for (let i = 0; i < 10; i++) {
      canvas.getContext("2d")!.fillStyle = i % 2 ? "#547660" : "#386c9a";
      canvas.getContext("2d")!.fillRect(0, 0, 64, 64);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    const blob = await done;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByLabel("欢迎语", { exact: true }).fill("今天也读一会儿");
  await page.getByLabel("副标题", { exact: true }).fill("我的阅读空间");
  await page.getByLabel("选择背景图片或视频文件").setInputFiles({
    name: "wallpaper.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await page.getByLabel("关闭外观设置").click();
  await expect(
    page.getByRole("heading", { name: "今天也读一会儿" }),
  ).toBeVisible();
  await expect(page.locator("video.video-wallpaper")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  expect(
    await page
      .locator("video")
      .evaluate(
        (video) =>
          (video as HTMLVideoElement).muted && (video as HTMLVideoElement).loop,
      ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "今天也读一会儿" }),
  ).toBeVisible();
  await expect(page.locator("video.video-wallpaper")).toBeVisible();
  await page.getByLabel("导入书籍文件").setInputFiles(novels[0]);
  await expect(page.getByText("正在打开…", { exact: true })).toBeHidden();
  await expect(page.locator("video")).toHaveCount(0);
});

test("仿真快照维持系统字体、粗斜体，准备时始终覆盖旧页", async ({ page }) => {
  test.skip(!novels.length, "需要用户小说");
  await open(page, novels[0]);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("系统字体").selectOption("SimSun");
  await page.getByRole("button", { name: "加粗", exact: true }).click();
  await page.getByRole("button", { name: "斜体", exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("关闭阅读设置").click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const host = document.querySelector(".reader-surface")!;
    (window as unknown as { turnCovered: boolean[] }).turnCovered = [];
    const observer = new MutationObserver(() => {
      if (
        host.querySelector(".curl-overlay") ||
        host.querySelector(".turn-cover")
      )
        (window as unknown as { turnCovered: boolean[] }).turnCovered.push(
          !!host.querySelector(".turn-cover"),
        );
    });
    observer.observe(host, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 2000);
  });
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(page.locator(".curl-overlay")).toBeVisible();
  const typography = await page
    .locator(".curl-overlay .curl-sheet .novel-page-snapshot p")
    .first()
    .evaluate((span) => {
      const css = span.ownerDocument.defaultView!.getComputedStyle(span);
      return {
        family: css.fontFamily,
        weight: css.fontWeight,
        style: css.fontStyle,
        synthesis: css.fontSynthesis,
      };
    });
  expect(typography.family).toContain("SimSun");
  expect(typography.weight).toBe("700");
  expect(typography.style).toBe("italic");
  expect(typography.synthesis).toContain("weight");
  await expect(page.locator(".curl-overlay")).toHaveCount(0);
  const samples = await page.evaluate(
    () => (window as unknown as { turnCovered: boolean[] }).turnCovered,
  );
  expect(samples.length).toBeGreaterThan(1);
  expect(samples.every(Boolean)).toBe(true);
});

for (const motion of ["instant", "slide", "curl"])
  test(`小说双页常驻书脊 ${motion}，文字正常拖选`, async ({ page }) => {
    test.skip(!novels.length, "需要用户小说");
    await open(page, novels[0]);
    await page.getByLabel("阅读设置", { exact: true }).click();
    await page.getByLabel("单双页").selectOption("double");
    await page.getByLabel("翻页方式").selectOption(motion);
    await page.getByLabel("关闭阅读设置").click();
    await expect(page.locator(".novel-spread")).toBeVisible();
    expect(
      await page
        .locator(".novel-spread")
        .evaluate((node) => getComputedStyle(node, "::after").content),
    ).toBe('""');
    await page.waitForTimeout(250);
    const points = await page.evaluate(() => {
      const view = document.querySelector("foliate-view") as HTMLElement & {
        renderer: { getContents(): { doc: Document }[] };
      };
      const doc = view.renderer.getContents()[0].doc,
        frame = doc.defaultView!.frameElement!.getBoundingClientRect(),
        host = document
          .querySelector(".reader-surface")!
          .getBoundingClientRect();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT),
        range = doc.createRange();
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent!;
        for (let start = 0; start < text.length - 8; start++) {
          if (!/\S{8}/u.test(text.slice(start, start + 8))) continue;
          range.setStart(node, start);
          range.setEnd(node, start + 8);
          const rects = range.getClientRects();
          if (rects.length !== 1) continue;
          const r = rects[0];
          const x = r.left + frame.left,
            y = r.top + frame.top;
          if (
            x > host.left + 5 &&
            x + r.width < host.right - 5 &&
            y > host.top + 40 &&
            y + r.height < host.bottom - 5
          )
            return { x: x + 1, y: y + r.height / 2, end: x + r.width - 1 };
        }
      }
      throw new Error("没有可选择的正文");
    });
    const before = await location(page).getAttribute("data-cfi");
    // Raw trusted mouse events avoid Playwright's HTML drag probe injecting
    // scripts into a deliberately sandboxed book iframe. Security stays enabled.
    const input = await page.context().newCDPSession(page);
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: points.x,
      y: points.y,
    });
    await input.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      x: points.x,
      y: points.y,
    });
    for (let step = 1; step <= 8; step++)
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        x: points.x + ((points.end - points.x) * step) / 8,
        y: points.y,
      });
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      clickCount: 1,
      x: points.end,
      y: points.y,
    });
    await input.detach();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              document.querySelector("foliate-view") as HTMLElement & {
                renderer: { getContents(): { doc: Document }[] };
              }
            ).renderer
              .getContents()[0]
              .doc.getSelection()
              ?.toString()
              .trim().length ?? 0,
        ),
      )
      .toBeGreaterThan(3);
    await expect(page.locator(".curl-overlay,.slide-overlay")).toHaveCount(0);
    await expect(location(page)).toHaveAttribute("data-cfi", before!);
  });

for (const scale of [1, 1.25, 1.5])
  test.describe(`系统像素比例 ${scale}`, () => {
    test.use({ deviceScaleFactor: scale });
    for (const layout of ["single", "double"])
      for (const motion of ["slide", "curl"])
        test(`小说 ${motion}/${layout} 完整可见页保留两端对齐`, async ({
          page,
        }) => {
          test.skip(!novels.length, "需要用户小说");
          await page.setViewportSize({ width: 1600, height: 1000 });
          await open(page, novels[0]);
          await page.getByLabel("阅读设置", { exact: true }).click();
          await page.getByLabel("翻页方式").selectOption(motion);
          await page.getByLabel("单双页").selectOption(layout);
          if (scale === 1.25) {
            await page.getByLabel("系统字体").selectOption("SimSun");
            await page
              .getByRole("button", { name: "加粗", exact: true })
              .click();
            await page
              .getByRole("button", { name: "斜体", exact: true })
              .click();
          }
          await page.getByLabel("关闭阅读设置").click();
          await page.waitForTimeout(250);
          const original = await page.evaluate(() => {
            const view = document.querySelector(
              "foliate-view",
            ) as HTMLElement & {
              renderer: { getContents(): { doc: Document }[] };
              lastLocation: { range: Range };
            };
            const doc = view.renderer.getContents()[0].doc,
              fr = doc.defaultView!.frameElement!.getBoundingClientRect(),
              hr = document
                .querySelector(".reader-surface")!
                .getBoundingClientRect();
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT),
              glyph = doc.createRange(),
              out: { text: string; x: number; y: number }[] = [];
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const text = node.textContent!;
              for (let i = 0; i < text.length; i++) {
                if (!text[i].trim()) continue;
                glyph.setStart(node, i);
                glyph.setEnd(node, i + 1);
                const r = glyph.getBoundingClientRect(),
                  x = r.left + fr.left - hr.left,
                  y = r.top + fr.top - hr.top;
                if (
                  r.width &&
                  x >= 0 &&
                  x < hr.width &&
                  y >= 0 &&
                  y < hr.height
                )
                  out.push({ text: text[i], x, y });
              }
            }
            const host = document.querySelector(".reader-surface")!;
            const state = window as unknown as {
              aligned: { text: string; x: number; y: number }[];
            };
            state.aligned = [];
            const observer = new MutationObserver(() => {
              if (state.aligned.length) return;
              const cover = host.querySelector(".turn-cover");
              if (!cover) return;
              const origin = host.getBoundingClientRect(),
                range = document.createRange();
              const body = cover
                .querySelector(".novel-page-snapshot")
                ?.shadowRoot?.querySelector("body");
              if (!body) return;
              const walker = document.createTreeWalker(
                body,
                NodeFilter.SHOW_TEXT,
              );
              let node: Node | null;
              while ((node = walker.nextNode()))
                for (let i = 0; i < node.textContent!.length; i++) {
                  if (!node.textContent![i].trim()) continue;
                  range.setStart(node, i);
                  range.setEnd(node, i + 1);
                  const r = range.getBoundingClientRect();
                  const x = r.left - origin.left,
                    y = r.top - origin.top;
                  if (
                    !r.width ||
                    x < 0 ||
                    x >= origin.width ||
                    y < 0 ||
                    y >= origin.height
                  )
                    continue;
                  state.aligned.push({
                    text: node.textContent![i],
                    x,
                    y,
                  });
                }
              if (state.aligned.length) observer.disconnect();
            });
            observer.observe(host, { childList: true, subtree: true });
            setTimeout(() => observer.disconnect(), 2000);
            return out;
          });
          // 旧测试只取开头 60 字，漏掉长行末尾逐渐累积的对齐误差。
          // 验证完整可见页，并覆盖单双页、粗斜体和常见系统像素比例。
          expect(original.length).toBeGreaterThan(200);
          await page.getByLabel("下一页", { exact: true }).click();
          await expect(
            page.locator(`.${motion === "curl" ? "curl" : "slide"}-overlay`),
          ).toBeVisible();
          const snapshot = await page.evaluate(
            () =>
              (
                window as unknown as {
                  aligned: { text: string; x: number; y: number }[];
                }
              ).aligned,
          );
          expect(snapshot.length).toBe(original.length);
          for (let i = 0; i < original.length; i++) {
            expect(snapshot[i].text).toBe(original[i].text);
            expect(Math.abs(snapshot[i].x - original[i].x)).toBeLessThan(0.55);
            expect(Math.abs(snapshot[i].y - original[i].y)).toBeLessThan(0.55);
          }
          await expect(
            page.locator(".curl-overlay,.slide-overlay"),
          ).toHaveCount(0);
        });
  });

test("小说上下阅读滚轮、拖动、整屏快捷键、锚点和动画隔离", async ({ page }) => {
  test.skip(!novels.length, "需要用户小说");
  await open(page, novels[0]);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("单双页").selectOption("double");
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await expect(page.getByLabel("翻页方式")).toBeDisabled();
  await expect(page.getByLabel("单双页")).toBeDisabled();
  await page.getByLabel("关闭阅读设置").click();
  const read = () =>
    page.evaluate(() => {
      const v = document.querySelector("foliate-view") as HTMLElement & {
        renderer: {
          start: number;
          size: number;
          getAttribute(name: string): string;
        };
        lastLocation: { section: { current: number } };
      };
      return {
        start: v.renderer.start,
        size: v.renderer.size,
        flow: v.renderer.getAttribute("flow"),
        section: v.lastLocation.section.current,
      };
    });
  await expect.poll(async () => (await read()).flow).toBe("scrolled");
  await page.waitForTimeout(250);
  await expect(page.locator(".novel-spread")).toHaveCount(0);
  await page.getByLabel("下一页", { exact: true }).click();
  await page.waitForTimeout(200);
  const aligned = await read();
  const b = (await page.getByLabel("书籍正文").boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2);
  await page.mouse.wheel(0, 143);
  await expect
    .poll(async () => (await read()).start)
    .toBeGreaterThan(aligned.start + 100);
  await page.mouse.move(b.x + b.width - 3, b.y + b.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 3, b.y + b.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await read()).start)
    .toBeGreaterThan(aligned.start + 200);
  await page.keyboard.press("PageDown");
  await expect
    .poll(async () => {
      const r = await read();
      return Math.abs(r.start / r.size - Math.round(r.start / r.size));
    })
    .toBeLessThan(0.01);
  await expect(
    page.locator(".curl-overlay,.slide-overlay,.turn-cover"),
  ).toHaveCount(0);
  await page.getByLabel("上一页", { exact: true }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  const progress = Number(await location(page).getAttribute("data-progress"));
  expect(progress).toBeGreaterThan(0);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("阅读顺序").selectOption("ltr");
  await expect(page.getByLabel("单双页")).toBeEnabled();
  await page.getByLabel("关闭阅读设置").click();
  await expect(page.locator(".novel-spread")).toBeVisible();
});

test("小说前置 SVG 插画每页都能前后卷页", async ({ page }) => {
  test.skip(!novels.length, "需要用户小说");
  await open(page, novels[0]);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("关闭阅读设置").click();
  await page.getByLabel("目录", { exact: true }).click();
  await page.getByRole("button", { name: "插图", exact: true }).click();
  await expect(page.locator(".reading-heading > span").first()).toHaveText(
    "插图",
  );
  await page.getByLabel("目录", { exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            document.querySelector("foliate-view") as HTMLElement & {
              renderer: { getContents(): { doc: Document }[] };
            }
          ).renderer
            .getContents()[0]
            .doc.querySelectorAll("svg image").length,
      ),
    )
    .toBeGreaterThan(2);
  for (const action of ["下一页", "下一页", "上一页"]) {
    await page.getByLabel(action, { exact: true }).click();
    await expect(page.locator(".curl-overlay")).toBeVisible();
    expect(
      await page
        .locator(".curl-overlay .novel-page-snapshot svg image")
        .count(),
    ).toBeGreaterThan(0);
    await expect(page.locator(".curl-overlay")).toHaveCount(0);
  }
});

test("上下阅读从封面和插图跨到正文，章节边界、拖动与书末可返回", async ({
  page,
}) => {
  test.skip(!novels.length, "需要用户小说");
  await open(page, novels[0]);
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("翻页方式").selectOption("curl");
  await page.getByLabel("阅读顺序").selectOption("ttb");
  await page.getByLabel("关闭阅读设置").click();
  const read = () =>
    page.evaluate(() => {
      const v = document.querySelector("foliate-view") as HTMLElement & {
        renderer: {
          start: number;
          size: number;
          viewSize: number;
          getContents(): { index: number }[];
        };
      };
      const r = v.renderer;
      return {
        index: r.getContents()[0].index,
        start: r.start,
        end: Math.max(0, r.viewSize - r.size),
      };
    });
  const go = async (index: number) => {
    await page.waitForTimeout(150);
    await page.evaluate(async (index) => {
      const v = document.querySelector("foliate-view") as HTMLElement & {
        goTo(index: number): Promise<void>;
      };
      await v.goTo(index);
    }, index);
    // 此处直接调用分页器，绕过应用导航队列；等待先前拖动的换章事务结束。
    await page.waitForTimeout(150);
  };
  await go(0);
  await page.getByLabel("上一页", { exact: true }).click();
  expect((await read()).index).toBe(0);
  await page.waitForTimeout(150);
  await page.getByLabel("下一页", { exact: true }).click();
  await expect.poll(async () => (await read()).index).toBe(1);
  const b = (await page.getByLabel("书籍正文").boundingBox())!;
  await page.mouse.move(b.x + b.width - 3, b.y + b.height * 0.7);
  // 第一次滚轮到插图末尾，第二次跨章；防止 SVG 整章锚点把位置拉回页首。
  await page.mouse.wheel(0, 100000);
  await expect
    .poll(async () => Math.abs((await read()).start - (await read()).end))
    .toBeLessThan(2);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await read()).index).toBe(2);
  await page.waitForTimeout(150);
  await page.mouse.wheel(0, 100000);
  await expect
    .poll(async () => Math.abs((await read()).start - (await read()).end))
    .toBeLessThan(2);
  // 拖动跨章后 iframe 被替换，鼠标事件必须仍可到达稳定的主文档。
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 3, b.y + b.height * 0.5, { steps: 3 });
  await expect.poll(async () => (await read()).index).toBe(3);
  await page.mouse.move(b.x + b.width - 3, b.y + b.height * 0.4, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(".turn-pointer")).toHaveCount(0);
  await go(3);
  await page.mouse.move(b.x + b.width - 3, b.y + b.height * 0.5);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await read()).index).toBe(2);
  await page.waitForTimeout(150);
  await page.getByLabel("下一页", { exact: true }).click();
  await expect.poll(async () => (await read()).index).toBe(3);
  await page.getByLabel("上一页", { exact: true }).click();
  await expect.poll(async () => (await read()).index).toBe(2);
  const last = await page.evaluate(
    () =>
      (
        document.querySelector("foliate-view") as HTMLElement & {
          book: { sections: unknown[] };
        }
      ).book.sections.length - 1,
  );
  await go(last);
  await page.mouse.wheel(0, 100000);
  await expect
    .poll(async () => Math.abs((await read()).start - (await read()).end))
    .toBeLessThan(2);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(180);
  await page.getByLabel("下一页", { exact: true }).click();
  expect((await read()).index).toBe(last);
  const before = (await read()).start;
  await page.getByLabel("上一页", { exact: true }).click();
  await expect
    .poll(async () => {
      const current = await read();
      return current.index < last || current.start < before;
    })
    .toBe(true);
  await expect(
    page.getByLabel("上一页", { exact: true }).locator(".lucide-arrow-left"),
  ).toBeVisible();
  await expect(
    page.getByLabel("下一页", { exact: true }).locator(".lucide-arrow-right"),
  ).toBeVisible();
  await expect(
    page.locator(".curl-overlay,.slide-overlay,.turn-cover"),
  ).toHaveCount(0);
});
