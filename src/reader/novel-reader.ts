/** TXT／文字 EPUB 阅读器：CFI 是稳定阅读位置，屏幕页号只用于显示。
 * 样式与窗口变化进入同一重排队列，保留 CFI；导航等待重排完成后捕获
 * 原排版快照。上下模式直接滚动并跨章，不经过卷页／滑动动画。
 * 关闭时释放书内 Blob、字体、档案、观察器和共用输入绑定。
 */
import "@vendor/foliate-js/view.js";
import { EPUB } from "@vendor/foliate-js/epub.js";
import { collapse } from "@vendor/foliate-js/epubcfi.js";
import type {
  BookCategory,
  ByteSource,
  ReaderEngine,
  ReaderLocation,
  ReaderSnapshot,
  ReaderStyle,
  TocItem,
} from "../reader-types";
import { THEME_COLORS } from "../reader-types";
import { readWhole } from "../file-sources";
import { BookArchive } from "./book-archive";
import { bindReadingInput, type ReadingMove } from "./reading-input";
import { chapterHtml, decodeText, splitChapters } from "./text-chapters";
import { captureNovelPage, turnPageSurface } from "./page-transitions";
import type { TurnGesture } from "./reading-input";

interface BookSection {
  id: string;
  size: number;
  load(): Promise<string>;
  createDocument(): Promise<Document>;
  unload?(): void;
}
interface FoliateBook {
  sections: BookSection[];
  toc: TocItem[];
  metadata?: Record<string, unknown>;
  rendition?: { layout?: string };
  transformTarget?: EventTarget;
  destroy?(): void;
}
interface FoliateView extends HTMLElement {
  book: FoliateBook;
  isFixedLayout: boolean;
  renderer: HTMLElement & {
    setStyles?(style: string): void;
    getContents(): { doc: Document; index: number }[];
    scrollBy?(dx: number, dy: number): void | Promise<void>;
    start: number;
    size: number;
    viewSize: number;
  };
  lastLocation?: {
    cfi: string;
    fraction: number;
    section: { current: number };
    tocItem?: TocItem;
    range: Range;
  };
  open(book: FoliateBook): Promise<void>;
  init(options: {
    lastLocation?: string;
    showTextStart?: boolean;
  }): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  close(): void;
}

function plainMetadata(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(plainMetadata).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.name) return plainMetadata(record.name);
    return plainMetadata(
      record["zh-CN"] ?? record.zh ?? record.en ?? Object.values(record)[0],
    );
  }
  return "";
}

/** The CSP is inserted before a section's Blob URL is loaded. Book scripts never run. */
function sanitizeBookDocument(markup: string, type = "application/xhtml+xml") {
  const parserType =
    type === "image/svg+xml"
      ? "image/svg+xml"
      : type === "text/html"
        ? "text/html"
        : "application/xhtml+xml";
  let document = new DOMParser().parseFromString(markup, parserType);
  if (document.querySelector("parsererror") && parserType !== "image/svg+xml")
    document = new DOMParser().parseFromString(markup, "text/html");
  for (const element of document.querySelectorAll(
    "script, iframe, frame, object, embed, form, base, meta[http-equiv]",
  ))
    element.remove();
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        /^\s*(?:javascript|vbscript):/i.test(attribute.value)
      )
        element.removeAttribute(attribute.name);
      if (
        ["src", "poster", "srcset", "data"].includes(attribute.name) &&
        /^\s*(?:https?:)?\/\//i.test(attribute.value)
      )
        element.removeAttribute(attribute.name);
    }
  }
  const head = document.querySelector("head");
  if (head) {
    const meta = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "meta",
    );
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute(
      "content",
      "default-src 'none'; script-src 'none'; style-src 'self' blob: 'unsafe-inline'; img-src blob: data:; font-src blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'",
    );
    head.prepend(meta);
  }
  return new XMLSerializer().serializeToString(document);
}

export class NovelReader implements ReaderEngine {
  private view?: FoliateView;
  private book?: FoliateBook;
  private archive?: BookArchive;
  private textUrls = new Set<string>();
  private unbind = new Map<Document, () => void>();
  private unbindHost?: () => void;
  private snapshot: ReaderSnapshot;
  private disposed = false;
  private host?: HTMLElement;
  // Page boundaries change during reflow. Keep the reading anchor until the user
  // navigates, rather than repeatedly rounding it to the new page's first word.
  private readingAnchor?: string;
  private navigating = false;
  private requestedAnchor?: string;
  private observer?: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private layoutQueue = Promise.resolve();
  private turning = false;
  private resizePending = false;
  private layoutWidth = 0;
  private layoutHeight = 0;
  private sharedFonts = new Set<FontFace>();
  constructor(
    readonly source: ByteSource,
    private style: ReaderStyle,
    private update: (snapshot: ReaderSnapshot) => void,
    private move: ReadingMove,
    private enabled: () => boolean,
    private format: "txt" | "epub",
    category: BookCategory = "novel",
  ) {
    this.snapshot = {
      title: source.info.name.replace(/\.[^.]+$/, ""),
      author: "",
      format,
      category,
      toc: [],
      chapter: "",
      reflow: true,
    };
  }
  async open(host: HTMLElement, saved?: ReaderLocation) {
    this.host = host;
    if (this.format === "txt") {
      const { text, encoding } = decodeText(
        await readWhole(this.source),
        this.style.encoding,
      );
      if (!text.trim()) throw new Error("TXT 文件没有可读文字");
      this.snapshot.encoding = encoding;
      const chapters = splitChapters(text);
      const sections = chapters.map((chapter, index) => {
        const html = chapterHtml(chapter);
        let url: string | undefined;
        return {
          id: `txt:${index}`,
          size: new TextEncoder().encode(chapter.text).length,
          load: async () => {
            url ??= URL.createObjectURL(
              new Blob([html], { type: "text/html" }),
            );
            this.textUrls.add(url);
            return url;
          },
          createDocument: async () =>
            new DOMParser().parseFromString(html, "text/html"),
          unload: () => {
            if (url) {
              URL.revokeObjectURL(url);
              this.textUrls.delete(url);
              url = undefined;
            }
          },
        };
      });
      this.book = {
        sections,
        toc: chapters.map((chapter, index) => ({
          label: chapter.title,
          href: `txt:${index}`,
        })),
        metadata: { title: this.snapshot.title, language: "zh-CN" },
        ...{
          resolveHref: (href: string) => ({
            index: Number(href.split(":")[1]),
          }),
          splitTOCHref: (href: string) => [href, null],
          getTOCFragment: (document: Document) => document.body,
          isExternal: () => false,
        },
      };
    } else {
      this.archive = await new BookArchive(this.source).init();
      this.book = (await new EPUB(this.archive).init()) as FoliateBook;
      this.book.transformTarget?.addEventListener("data", (event) => {
        const detail = (event as CustomEvent).detail as {
          data: string | Blob | Promise<string | Blob>;
          type: string;
        };
        if (
          ["application/xhtml+xml", "text/html", "image/svg+xml"].includes(
            detail.type,
          )
        ) {
          detail.data = Promise.resolve(detail.data).then(async (value) =>
            sanitizeBookDocument(
              typeof value === "string" ? value : await value.text(),
              detail.type,
            ),
          );
        }
      });
    }
    if (!this.book.sections.length) throw new Error("EPUB 没有可读章节");
    this.snapshot.title =
      plainMetadata(this.book.metadata?.title) || this.snapshot.title;
    this.snapshot.author = plainMetadata(
      this.book.metadata?.author ?? this.book.metadata?.creator,
    );
    this.snapshot.toc = this.book.toc ?? [];
    this.snapshot.reflow = this.book.rendition?.layout !== "pre-paginated";
    this.view = document.createElement("foliate-view") as FoliateView;
    this.view.className = "foliate-surface";
    this.view.addEventListener("external-link", (event) =>
      event.preventDefault(),
    );
    this.view.addEventListener("load", (event) => {
      const { doc } = (event as CustomEvent).detail as { doc: Document };
      this.unbind.get(doc)?.();
      this.unbind.set(
        doc,
        bindReadingInput(
          doc,
          this.move,
          this.enabled,
          host,
          () => this.style.motion === "curl" && this.style.direction !== "ttb",
          this.scrollInput(),
        ),
      );
      void doc.fonts.ready.then(() => {
        if (this.disposed) return;
        doc.fonts.forEach((face) => {
          if (!document.fonts.has(face)) {
            document.fonts.add(face);
            this.sharedFonts.add(face);
          }
        });
      });
      this.view?.renderer
        .querySelectorAll("iframe")
        .forEach((frame) => frame.setAttribute("sandbox", "allow-same-origin"));
    });
    this.view.addEventListener("relocate", (event) => {
      if (this.disposed) return;
      const documents = new Set(
        this.view?.renderer.getContents().map(({ doc }) => doc),
      );
      if (documents.size)
        for (const [doc, unbind] of this.unbind) {
          if (!documents.has(doc)) {
            unbind();
            this.unbind.delete(doc);
          }
        }
      const detail = (event as CustomEvent).detail as NonNullable<
        FoliateView["lastLocation"]
      >;
      if (
        !this.readingAnchor ||
        this.navigating ||
        this.style.direction === "ttb"
      )
        this.readingAnchor = this.requestedAnchor ?? collapse(detail.cfi);
      this.snapshot = {
        ...this.snapshot,
        chapter:
          detail.tocItem?.label ??
          `第 ${(detail.section?.current ?? 0) + 1} 节`,
        location: {
          kind: "reflow",
          cfi: this.readingAnchor,
          section: detail.section?.current ?? 0,
          quote: detail.range?.toString().slice(0, 120) ?? "",
          progress: Number.isFinite(detail.fraction)
            ? Math.min(1, Math.max(0, detail.fraction))
            : 0,
        },
      };
      this.update({ ...this.snapshot });
    });
    host.replaceChildren(this.view);
    this.unbindHost = bindReadingInput(
      host,
      this.move,
      this.enabled,
      host,
      () => this.style.motion === "curl" && this.style.direction !== "ttb",
      this.scrollInput(),
    );
    await this.view.open(this.book);
    await this.applyStyle();
    this.readingAnchor =
      saved?.kind === "reflow" ? collapse(saved.cfi) : undefined;
    await this.view.init({
      lastLocation: saved?.kind === "reflow" ? saved.cfi : undefined,
      showTextStart: !saved,
    });
    if (!this.view.renderer.getContents().length)
      throw new Error("章节无法加载，请检查 EPUB 的正文资源");
    await this.applyStyle();
    this.readingAnchor =
      saved?.kind === "reflow" ? collapse(saved.cfi) : this.currentAnchor();
    this.update({ ...this.snapshot });
    this.observer = new ResizeObserver(() => {
      if (!this.layoutChanged()) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        if (this.turning || this.navigating) {
          this.resizePending = true;
          return;
        }
        if (!this.disposed)
          void this.setStyle(this.style).catch((error) =>
            console.warn("reflow resize", error),
          );
      }, 60);
    });
    this.observer.observe(host);
  }
  private async applyStyle() {
    if (!this.view) return;
    this.layoutWidth = this.host?.clientWidth ?? 800;
    this.layoutHeight = this.host?.clientHeight ?? 600;
    const renderer = this.view.renderer;
    const scrolled = this.style.direction === "ttb";
    renderer.setAttribute("flow", scrolled ? "scrolled" : "paginated");
    renderer.setAttribute("margin", `${this.style.margin}px`);
    renderer.setAttribute("gap", "4%");
    const columns = !scrolled && this.style.comicLayout === "double" ? 2 : 1;
    this.host?.classList.toggle(
      "novel-spread",
      columns === 2 && this.snapshot.reflow,
    );
    renderer.toggleAttribute("force-spread", columns === 2);
    renderer.setAttribute("max-column-count", String(columns));
    renderer.setAttribute(
      "max-inline-size",
      `${Math.max(120, (this.layoutWidth - this.style.margin * 2) / columns)}px`,
    );
    // The shared snapshot transition owns motion; never run two animations.
    renderer.removeAttribute("animated");
    const colors = THEME_COLORS[this.style.theme];
    const family = JSON.stringify(this.style.fontFamily);
    const css = `html,body { background:${colors.background}!important; color:${colors.foreground}!important; } body { font-family:${family},'Microsoft YaHei',sans-serif!important; font-size:${this.style.fontSize}px!important; line-height:${this.style.lineHeight}!important; font-weight:${this.style.bold ? "700" : "400"}!important; font-style:${this.style.italic ? "italic" : "normal"}!important; } p,li,td,div { font-family:inherit!important; font-size:inherit!important; line-height:inherit!important; font-weight:inherit!important; font-style:inherit!important; } p { margin-block:0.7em; overflow-wrap:break-word; } h1 { font-size:1.45em; line-height:1.5; margin-block:1em; } img,svg { max-inline-size:100%!important; object-fit:contain; } a { color:inherit; }`;
    renderer.setStyles?.(css);
    await Promise.all(renderer.getContents().map(({ doc }) => doc.fonts.ready));
  }
  async setStyle(style: ReaderStyle) {
    this.style = style;
    this.layoutQueue = this.layoutQueue
      .catch(() => {})
      .then(async () => {
        if (this.disposed) return;
        const location = this.readingAnchor ?? this.currentAnchor();
        await this.applyStyle();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (location && !this.disposed) await this.view?.goTo(location);
      });
    await this.layoutQueue;
  }
  private currentAnchor() {
    const cfi = this.view?.lastLocation?.cfi;
    return cfi ? collapse(cfi) : undefined;
  }
  private layoutChanged() {
    return (
      this.host?.clientWidth !== this.layoutWidth ||
      this.host?.clientHeight !== this.layoutHeight
    );
  }
  private scrollInput() {
    return {
      enabled: () => this.style.direction === "ttb",
      by: (dx: number, dy: number) => {
        void Promise.resolve(this.view?.renderer.scrollBy?.(dx, dy)).catch(
          (error) => console.warn("小说跨章节滚动失败", error),
        );
      },
    };
  }
  private async navigate(
    operation: () => Promise<void> | undefined,
    cfi?: string,
  ) {
    await this.layoutQueue;
    this.navigating = true;
    this.requestedAnchor = cfi;
    try {
      await operation();
    } finally {
      this.navigating = false;
      this.requestedAnchor = undefined;
      if (this.resizePending && !this.turning && !this.disposed) {
        this.resizePending = false;
        await this.setStyle(this.style);
      }
    }
  }
  private surface() {
    const location = this.view?.lastLocation,
      doc = this.view?.renderer.getContents()[0]?.doc;
    return this.host &&
      doc &&
      location &&
      this.style.motion !== "instant" &&
      this.style.direction !== "ttb"
      ? captureNovelPage(
          this.host,
          doc,
          `${location.section.current}:${this.view?.renderer.start}`,
          this.style,
        )
      : undefined;
  }
  private async turn(delta: number, gesture?: TurnGesture) {
    await this.layoutQueue;
    if (!this.host || this.disposed) return;
    // Closing a panel/fullscreen changes the viewport before the debounced
    // observer runs. Prepare that layout before capturing either page face.
    if (this.layoutChanged()) {
      clearTimeout(this.resizeTimer);
      await this.setStyle(this.style);
    }
    const anchor = this.currentAnchor();
    this.turning = true;
    try {
      await turnPageSurface(
        this.host,
        this.style,
        delta,
        () => this.surface(),
        async () => {
          const renderer = this.view?.renderer;
          // Manual scrolling may stop halfway through a viewport. Keyboard and
          // click navigation realign to a whole viewport before proceeding.
          const step =
            this.style.direction === "ttb" && renderer
              ? delta > 0
                ? (Math.floor((renderer.start + 1) / renderer.size) + 1) *
                    renderer.size -
                  renderer.start
                : renderer.start -
                  (Math.ceil((renderer.start - 1) / renderer.size) - 1) *
                    renderer.size
              : undefined;
          await this.navigate(() =>
            delta > 0 ? this.view?.next(step) : this.view?.prev(step),
          );
          await Promise.all(
            this.view?.renderer
              .getContents()
              .map(({ doc }) => doc.fonts.ready) ?? [],
          );
        },
        async () => {
          if (anchor && !this.disposed) await this.goTo(anchor);
        },
        gesture,
      );
    } finally {
      this.turning = false;
      if (this.resizePending && !this.disposed) {
        this.resizePending = false;
        await this.setStyle(this.style);
      }
    }
  }
  async next(gesture?: TurnGesture) {
    await this.turn(1, gesture);
  }
  async previous(gesture?: TurnGesture) {
    await this.turn(-1, gesture);
  }
  async goTo(target: string | number) {
    await this.navigate(
      () => this.view?.goTo(target),
      typeof target === "string" && target.startsWith("epubcfi(")
        ? collapse(target)
        : undefined,
    );
  }
  async goToProgress(progress: number) {
    await this.navigate(() =>
      this.view?.goToFraction(Math.max(0, Math.min(1, progress))),
    );
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.resizeTimer);
    this.observer?.disconnect();
    this.sharedFonts.forEach((face) => document.fonts.delete(face));
    this.sharedFonts.clear();
    this.unbind.forEach((unbind) => unbind());
    this.unbind.clear();
    this.unbindHost?.();
    this.host?.classList.remove("novel-spread");
    try {
      this.view?.close();
    } catch {
      /* The paginator may not have loaded its first document. */
    }
    this.view?.remove();
    this.book?.destroy?.();
    this.textUrls.forEach((url) => URL.revokeObjectURL(url));
    this.textUrls.clear();
    await this.archive?.close();
    await this.source.close();
  }
}
