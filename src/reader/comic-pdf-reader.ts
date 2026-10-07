import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
/** 固定页面阅读器：漫画使用源图片页号，PDF 使用 PDF.js 原排版。
 * 双页分组、页顶对齐与增强缓存以源页号为准，不受增强后图片尺寸影响。
 * 原图先显示，增强异步替换像素；翻页事务与小说共用，解码／PDF 渲染独立。
 */
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import type {
  ByteSource,
  ReaderEngine,
  ReaderLocation,
  ReaderSnapshot,
  ReaderStyle,
} from "../reader-types";
import { THEME_COLORS } from "../reader-types";
import { applyPaperTheme } from "./paper-theme";
import { ImagePages } from "./image-page-cache";
import { VerticalPages } from "./comic-scroll-reader";
import { ImageFrame } from "./image-page-view";
import { spreadPages, turnPage } from "./spread-layout";
import type { ComicEpub } from "./epub-inspection";
import { BookArchive } from "./book-archive";
import { bindReadingInput, type ReadingMove } from "./reading-input";
import {
  captureFixedPage,
  replacePageContent,
  turnPageSurface,
} from "./page-transitions";
import type { TurnGesture } from "./reading-input";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
export const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|avif|gif|bmp)$/i;
const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
class SourcePdfTransport extends pdfjs.PDFDataRangeTransport {
  constructor(
    private source: ByteSource,
    size: number,
    initial: Uint8Array,
    private failed: (error: unknown) => void,
  ) {
    super(size, initial, false);
  }
  requestDataRange(begin: number, end: number) {
    void this.source
      .readAt(begin, end - begin)
      .then((bytes) => this.onDataRange(begin, bytes))
      .catch(this.failed);
  }
}
export async function openSourcePdf(
  source: ByteSource,
  failed: (error: unknown) => void,
) {
  const size = Number(source.info.size);
  const initial = await source.readAt(0, Math.min(65536, size));
  return pdfjs.getDocument({
    range: new SourcePdfTransport(source, size, initial, failed),
    length: size,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 65536,
    cMapUrl: new URL("pdfjs/cmaps/", document.baseURI).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("pdfjs/standard_fonts/", document.baseURI)
      .href,
    wasmUrl: new URL("pdfjs/wasm/", document.baseURI).href,
  });
}

export class ComicPdfReader implements ReaderEngine {
  private host?: HTMLElement;
  private archive?: BookArchive;
  private names: string[] = [];
  private pdf?: PDFDocumentProxy;
  private pdfTask?: PDFDocumentLoadingTask;
  private renderTasks: RenderTask[] = [];
  private textLayers: TextLayer[] = [];
  private snapshot: ReaderSnapshot;
  private page = 0;
  private pages = 1;
  private unbind?: () => void;
  private observer?: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private images?: ImagePages;
  private vertical?: VerticalPages;
  private generation = 0;
  private disposed = false;
  private spread?: HTMLElement;
  private enhancingPage?: number;
  private frames = new WeakMap<HTMLElement, ImageFrame>();
  private prefetchTimer?: ReturnType<typeof setTimeout>;
  private turning = false;
  private resizePending = false;
  private async makeFrame(image: HTMLImageElement, index: number) {
    image.dataset.page = String(index);
    const frame = new ImageFrame(image);
    frame.element.dataset.page = String(index);
    this.frames.set(frame.element, frame);
    if (this.images?.hasEnhanced(index, this.style)) {
      const cached = await this.images.load(index, this.style);
      cached.image.dataset.page = String(index);
      frame.enhance(cached.image, this.style.compare, cached.enhancement);
    }
    return frame.element;
  }
  private schedulePrefetch() {
    clearTimeout(this.prefetchTimer);
    if (!this.images || !this.style.enhanceEnabled || this.disposed) return;
    const page = this.page,
      style = this.style;
    const last = Math.max(...spreadPages(page, this.pages, this.isDouble()));
    const indices = [last + 1, last + 2].filter((index) => index < this.pages);
    this.prefetchTimer = setTimeout(() => {
      if (!this.disposed && this.page === page && this.style === style)
        void this.images?.prefetch(indices, style).catch(() => {});
    }, 180);
  }

  constructor(
    readonly source: ByteSource,
    private style: ReaderStyle,
    private update: (snapshot: ReaderSnapshot) => void,
    private move: ReadingMove,
    private enabled: () => boolean,
    private format: "pdf" | "cbz" | "zip" | "image" | "epub",
    private fail: (error: unknown) => void,
    private initial?: { archive: BookArchive; comic?: ComicEpub },
  ) {
    this.snapshot = {
      title: source.info.name.replace(/\.[^.]+$/, ""),
      author: "",
      format,
      category: format === "pdf" ? "novel" : "comic",
      toc: [],
      chapter: "",
      reflow: false,
    };
  }
  async open(host: HTMLElement, saved?: ReaderLocation) {
    applyPaperTheme(host, this.style.theme);
    this.host = host;
    this.unbind = bindReadingInput(
      host,
      this.move,
      this.enabled,
      host,
      () => this.style.motion === "curl" && this.style.direction !== "ttb",
    );
    if (this.format === "pdf") {
      this.pdfTask = await openSourcePdf(this.source, (error) => {
        void this.pdfTask?.destroy();
        this.fail(error);
      });
      this.pdfTask.onPassword = () => {
        void this.pdfTask?.destroy();
        this.fail(new Error("此开发版尚不支持带密码的 PDF"));
      };
      this.pdf = await this.pdfTask.promise;
      this.pages = this.pdf.numPages;
      this.snapshot.toc = Array.from({ length: this.pages }, (_, index) => ({
        label: `第 ${index + 1} 页`,
        href: index,
      }));
      const metadata = await this.pdf.getMetadata().catch(() => undefined);
      if (metadata?.info) {
        const info = metadata.info as Record<string, unknown>;
        if (typeof info.Title === "string") this.snapshot.title = info.Title;
        if (typeof info.Author === "string") this.snapshot.author = info.Author;
      }
    } else if (this.format !== "image") {
      this.archive =
        this.initial?.archive ?? (await new BookArchive(this.source).init());
      if (this.initial?.comic) {
        this.names = this.initial.comic.pages.map((page) => page.path);
        this.snapshot.title = this.initial.comic.title || this.snapshot.title;
        this.snapshot.author = this.initial.comic.author;
      } else
        this.names = this.archive
          .names()
          .filter(
            (name) =>
              IMAGE_EXTENSION.test(name) && !name.startsWith("__MACOSX/"),
          )
          .sort(collator.compare);
      if (!this.names.length) throw new Error("压缩包里没有支持的漫画图片");
      this.pages = this.names.length;
      this.snapshot.toc = this.names.map((name, index) => ({
        label:
          this.initial?.comic?.pages[index].label ??
          name.split("/").pop() ??
          name,
        href: index,
      }));
    } else this.snapshot.toc = [{ label: "第 1 页", href: 0 }];
    const restored =
      saved?.kind === "fixed"
        ? saved.page
        : this.format === "epub" && saved?.kind === "reflow"
          ? saved.section
          : 0;
    this.page = Math.min(this.pages - 1, Math.max(0, restored));
    if (!this.pdf)
      this.images = new ImagePages(this.source, this.names, this.archive);
    await this.render();
    this.observer = new ResizeObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (!this.disposed) void this.resize().catch(this.fail);
      }, 120);
    });
    this.observer.observe(host);
  }
  private async renderPdf(generation: number) {
    const indexes = spreadPages(this.page, this.pages, this.isDouble());
    const pages = await Promise.all(
      indexes.map((index) => this.pdf!.getPage(index + 1)),
    );
    if (!this.host || this.disposed || generation !== this.generation) return;
    const bases = pages.map((page) => page.getViewport({ scale: 1 }));
    const frame = this.pageFrame();
    const columns = this.isDouble() ? 2 : 1;
    const viewports = pages.map((page, index) =>
      page.getViewport({
        scale: Math.min(
          frame.width / columns / bases[index].width,
          frame.height / bases[index].height,
        ),
      }),
    );
    const pixels = viewports.reduce(
      (sum, viewport) => sum + viewport.width * viewport.height,
      0,
    );
    const ratio = Math.min(
      devicePixelRatio || 1,
      2,
      Math.sqrt(16000000 / pixels),
    );
    const { spread, slots } = this.createSpread("pdf-spread", indexes);
    this.spread = spread;
    replacePageContent(this.host, spread);
    this.renderTasks = [];
    this.textLayers = [];
    await Promise.all(
      pages.map(async (page, index) => {
        const viewport = viewports[index];
        const scale = viewport.scale;
        const surface = document.createElement("div");
        surface.className = "pdf-page";
        surface.style.width = `${viewport.width}px`;
        surface.style.height = `${viewport.height}px`;
        surface.style.setProperty("--scale-factor", String(scale));
        surface.style.setProperty("--total-scale-factor", String(scale));
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.dataset.page = String(indexes[index]);
        canvas.setAttribute("aria-label", `PDF 第 ${indexes[index] + 1} 页`);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建 PDF 页面");
        const text = document.createElement("div");
        text.className = "textLayer";
        surface.append(canvas, text);
        slots[index].append(surface);
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        this.renderTasks.push(task);
        try {
          await task.promise;
        } catch (error) {
          if ((error as Error).name === "RenderingCancelledException")
            return "";
          throw error;
        }
        if (this.disposed || generation !== this.generation) return "";
        const content = await page.getTextContent();
        const layer = new pdfjs.TextLayer({
          textContentSource: content,
          container: text,
          viewport,
        });
        this.textLayers.push(layer);
        await layer.render();
      }),
    );
  }
  private publish() {
    const shown = spreadPages(this.page, this.pages, this.isDouble());
    this.snapshot = {
      ...this.snapshot,
      page: this.page + 1,
      pages: this.pages,
      chapter: `第 ${shown.map((page) => page + 1).join("–")} / ${this.pages} 页`,
      location: {
        kind: "fixed",
        page: this.page,
        progress: this.pages === 1 ? 1 : this.page / (this.pages - 1),
      },
    };
    this.update({ ...this.snapshot });
  }
  private async render() {
    if (!this.host || this.disposed) return;
    if (this.images && this.style.direction === "ttb") {
      this.spread = undefined;
      const destination = this.page;
      if (!this.vertical) {
        this.vertical = new VerticalPages(
          this.host,
          this.pages,
          async (index) => {
            const loaded = await this.images!.load(index, {
              ...this.style,
              enhanceEnabled: false,
            });
            // Populate attaches the node in its own microtask before enhancement starts.
            setTimeout(() => {
              if (index === this.page) this.enhanceVisible();
            }, 0);
            return this.makeFrame(loaded.image, index);
          },
          (index) => {
            if (this.page !== index) {
              this.generation++;
              this.enhancingPage = undefined;
              clearTimeout(this.prefetchTimer);
              this.snapshot.enhancement = undefined;
              this.snapshot.enhancing = false;
              void this.images?.cancelPending().catch(this.fail);
            }
            this.page = index;
            this.enhanceVisible();
            this.publish();
          },
          destination,
        );
        await this.vertical.resize(this.stripWidth());
      }
      await this.vertical.goTo(destination);
      this.enhanceVisible();
      return;
    }
    this.vertical?.dispose();
    this.vertical = undefined;
    const generation = ++this.generation;
    clearTimeout(this.prefetchTimer);
    void this.images?.cancelPending().catch(this.fail);
    this.enhancingPage = undefined;
    this.snapshot.enhancement = undefined;
    this.snapshot.enhancing = false;
    this.renderTasks.forEach((task) => task.cancel());
    this.textLayers.forEach((layer) => layer.cancel());
    if (this.pdf) {
      await this.renderPdf(generation);
    } else {
      const pages = spreadPages(this.page, this.pages, this.isDouble());
      const loaded = await Promise.all(
        pages.map(async (index) => {
          const value = await this.images!.load(index, {
            ...this.style,
            enhanceEnabled: false,
          });
          return this.makeFrame(value.image, index);
        }),
      );
      if (this.disposed || generation !== this.generation) return;
      const { spread, slots } = this.createSpread("comic-spread", pages);
      this.spread = spread;
      loaded.forEach((image, index) => slots[index].append(image));
      replacePageContent(this.host, this.spread);
      this.layoutSpread();
      this.host.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    if (this.disposed || generation !== this.generation) return;
    this.publish();
    this.enhanceVisible();
  }
  private isDouble() {
    return (
      (!!this.images || !!this.pdf) &&
      this.style.comicLayout === "double" &&
      this.style.direction !== "ttb"
    );
  }
  /** GPU work never belongs to the navigation promise. Results replace only live nodes. */
  private enhanceVisible() {
    if (
      !this.images ||
      !this.style.enhanceEnabled ||
      this.disposed ||
      this.enhancingPage === this.page
    )
      return;
    const nodes = this.vertical
      ? [
          ...(this.host?.querySelectorAll<HTMLElement>(
            `.vertical-page[data-page="${this.page}"] .image-frame`,
          ) ?? []),
        ]
      : [...(this.spread?.querySelectorAll<HTMLElement>(".image-frame") ?? [])];
    if (!nodes.length) return;
    const targets = nodes.filter((node) => !this.frames.get(node)?.enhancement);
    const page = this.page;
    this.enhancingPage = page;
    const generation = ++this.generation;
    const style = this.style;
    this.snapshot.enhancement = nodes
      .map((node) => this.frames.get(node)?.enhancement)
      .find(Boolean);
    this.snapshot.enhancing = targets.length > 0;
    this.publish();
    if (!targets.length) {
      this.schedulePrefetch();
      return;
    }
    void (async () => {
      if (this.disposed || generation !== this.generation || this.page !== page)
        return;
      await Promise.all(
        targets.map(async (target) => {
          const index = Number(
            target.dataset.page ?? target.parentElement?.dataset.page ?? page,
          );
          const loaded = await this.images!.load(index, style);
          if (
            this.disposed ||
            generation !== this.generation ||
            this.page !== page ||
            !target.isConnected
          )
            return;
          loaded.image.dataset.page = String(index);
          this.frames
            .get(target)
            ?.enhance(loaded.image, this.style.compare, loaded.enhancement);
          this.snapshot.enhancement = loaded.enhancement;
        }),
      );
    })()
      .catch((error) => {
        if (
          !this.disposed &&
          generation === this.generation &&
          (error as Error).name !== "AbortError"
        )
          this.fail(error);
      })
      .finally(() => {
        if (!this.disposed && generation === this.generation) {
          this.snapshot.enhancing = false;
          this.publish();
          this.schedulePrefetch();
        }
      });
  }
  private systemScale() {
    return Math.max(0.5, window.devicePixelRatio || 1);
  }
  private stripWidth() {
    return Math.max(
      100,
      ((this.host?.clientWidth ?? 800) * this.style.zoom) / this.systemScale(),
    );
  }
  /** 页面框只跟窗口、缩放和单双页有关，不从当前图片比例推导。
   * 每一页在固定框内等比适配，允许留白；无需扫描整本最大图片，
   * 也不拉伸人物和文字。静态页、遮罩与卷页始终共用这一套尺寸。
   */
  private pageFrame() {
    const scale = this.style.zoom / this.systemScale();
    return {
      width: Math.max(1, this.host!.clientWidth * scale),
      height: Math.max(1, this.host!.clientHeight * scale),
    };
  }
  private createSpread(className: string, indexes: number[]) {
    const spread = document.createElement("div");
    spread.className = className;
    const columns = this.isDouble() ? 2 : 1;
    const paperSlots = Array.from({ length: columns }, (_, index) => {
      const slot = document.createElement("div");
      slot.className = "fixed-page-slot";
      slot.dataset.slot = String(index);
      return slot;
    });
    spread.append(...paperSlots);
    // 双页的封面占书脊右侧（RTL 为左侧），末页占阅读起始侧。
    // 空白侧是真实固定页面框的一部分，不在动画时临时补位。
    const slots = indexes.map((page, index) => {
      let side = columns === 2 && page === 0 ? 1 : index;
      if (this.style.direction === "rtl") side = columns - 1 - side;
      const slot = paperSlots[side];
      slot.dataset.page = String(page);
      return slot;
    });
    this.layoutSpread(spread);
    return { spread, slots };
  }
  private layoutSpread(spread = this.spread) {
    if (!this.host || !spread) return;
    const frame = this.pageFrame();
    const columns = this.isDouble() ? 2 : 1;
    spread.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    spread.style.width = `${frame.width}px`;
    spread.style.height = `${frame.height}px`;
    spread.style.marginTop = `${Math.max(0, (this.host.clientHeight - frame.height) / 2)}px`;
    spread.style.background = THEME_COLORS[this.style.theme].background;
    const images = [...spread.querySelectorAll<HTMLElement>(".image-frame")];
    for (const image of images) {
      const width = Number(image.dataset.sourceWidth);
      const height = Number(image.dataset.sourceHeight);
      const scale = Math.min(
        frame.width / columns / width,
        frame.height / height,
      );
      image.style.width = `${width * scale}px`;
      image.style.height = `${height * scale}px`;
    }
  }
  private async resize() {
    if (this.turning) {
      this.resizePending = true;
      return;
    }
    if (this.vertical) await this.vertical.resize(this.stripWidth());
    else if (this.pdf) await this.render();
    else {
      this.layoutSpread();
    }
  }
  private async turn(delta: number, gesture?: TurnGesture) {
    const next = turnPage(this.page, this.pages, this.isDouble(), delta);
    if (this.vertical) {
      await this.vertical.goTo(next);
      return;
    }
    if (next === this.page) {
      this.host?.scrollTo({ top: 0, left: 0 });
      return;
    }
    if (!this.host) return;
    const previous = this.page;
    this.turning = true;
    try {
      await turnPageSurface(
        this.host,
        this.style,
        delta,
        () =>
          this.host
            ? captureFixedPage(this.host, `page:${this.page}`)
            : undefined,
        async () => {
          this.page = next;
          await this.render();
        },
        async () => {
          if (!this.disposed) {
            this.page = previous;
            await this.render();
          }
        },
        gesture,
      );
    } finally {
      this.turning = false;
      if (this.resizePending && !this.disposed) {
        this.resizePending = false;
        await this.resize();
      }
    }
  }
  async next(gesture?: TurnGesture) {
    await this.turn(1, gesture);
  }
  async previous(gesture?: TurnGesture) {
    await this.turn(-1, gesture);
  }
  async cancelPending() {
    this.generation++;
    await this.images?.cancelPending();
  }
  async goTo(target: string | number) {
    const page = Number(target);
    if (!Number.isFinite(page)) return;
    this.page = Math.min(this.pages - 1, Math.max(0, Math.round(page)));
    if (this.vertical) await this.vertical.goTo(this.page);
    else await this.render();
  }
  async goToProgress(progress: number) {
    await this.goTo(
      Math.round(Math.max(0, Math.min(1, progress)) * (this.pages - 1)),
    );
  }
  async setStyle(style: ReaderStyle) {
    const old = this.style;
    this.style = style;
    if (this.host) applyPaperTheme(this.host, style.theme);
    if (this.spread)
      this.spread.style.background = THEME_COLORS[style.theme].background;
    if (old.compare !== style.compare)
      this.host
        ?.querySelectorAll<HTMLElement>(".image-frame")
        .forEach((node) => this.frames.get(node)?.compare(style.compare));
    const pipelineChanged =
      old.enhanceEnabled !== style.enhanceEnabled ||
      old.enhanceBackend !== style.enhanceBackend ||
      old.filters.join("+") !== style.filters.join("+");
    if (
      old.direction !== style.direction ||
      old.comicLayout !== style.comicLayout ||
      pipelineChanged
    ) {
      await this.cancelPending();
      this.vertical?.dispose();
      this.vertical = undefined;
      this.enhancingPage = undefined;
      await this.render();
    } else if (old.zoom !== style.zoom) await this.resize();
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.prefetchTimer);
    this.generation++;
    clearTimeout(this.timer);
    this.observer?.disconnect();
    this.unbind?.();
    this.renderTasks.forEach((task) => task.cancel());
    this.textLayers.forEach((layer) => layer.cancel());
    this.vertical?.dispose();
    await this.images?.dispose();
    await this.pdfTask?.destroy();
    await this.archive?.close();
    await this.source.close();
    this.host?.replaceChildren();
  }
}
