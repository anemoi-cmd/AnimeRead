/** 共用翻页事务：捕获旧页 → 遮罩 → 定位目标 → 准备新页 → 动画 → 清理。
 * 漫画复制实际显示像素；小说复制已排版 DOM 和样式。两种数据源只在
 * 捕获处不同，卷页、上一页、滑动与拖动提交／回弹都走同一事务。
 * 上下阅读绕过快照与动画，避免滚动位置被水平卷页状态改变。
 */
import { PageFlip } from "@vendor/page-flip/page-flip.module.js";
import type { ReaderStyle } from "../reader-types";
import { playPageSound } from "../ambience/reading-sounds";
import { THEME_COLORS, pageTurnDuration, type Theme } from "../reader-types";
import { paintPaper, paperBlendsInk } from "./paper-theme";
import type { TurnGesture } from "./reading-input";

interface PageSurface {
  element: HTMLElement;
  sheets: HTMLElement[];
  spread: boolean;
  width: number;
  height: number;
  left: number;
  top: number;
  anchor: string;
}

/** Rendering a new fixed page must retain the opaque old-page cover. */
export function replacePageContent(host: HTMLElement, ...nodes: Node[]) {
  const cover = host.querySelector(":scope > .turn-cover");
  host.replaceChildren(...nodes, ...(cover ? [cover] : []));
}

/** One transaction for both readers: cover, prepare, animate, commit/restore. */
export async function turnPageSurface(
  host: HTMLElement,
  style: ReaderStyle,
  delta: number,
  capture: () => PageSurface | undefined | Promise<PageSurface | undefined>,
  advance: () => Promise<void>,
  restore: () => Promise<void>,
  gesture?: TurnGesture,
) {
  if (gesture?.committed === false) return;
  const cover = document.createElement("div");
  // 动画消失后，取消拖动仍可能正在恢复原页。繁忙状态覆盖整个事务，
  // 让辅助工具与调用者只在页面和阅读锚点都稳定后继续操作。
  host.setAttribute("aria-busy", "true");
  try {
    const before =
      style.motion !== "instant" && style.direction !== "ttb"
        ? await capture()
        : undefined;
    if (before) {
      cover.className = "turn-cover";
      if (before.spread && host.classList.contains("novel-spread"))
        cover.classList.add("has-novel-spine");
      cover.style.background = THEME_COLORS[style.theme].background;
      before.element.style.cssText += `;position:absolute;left:${before.left}px;top:${before.top}px;width:${before.width}px;height:${before.height}px`;
      cover.append(before.element);
      host.append(cover);
    }
    await advance();
    const after = before ? await capture() : undefined;
    if (style.motion === "curl") {
      const committed = await curlPage(
        host,
        before,
        after,
        delta,
        style,
        gesture,
      );
      if (!committed) await restore();
    } else if (style.motion === "slide")
      await slidePage(host, before, after, delta, style);
  } finally {
    cover.remove();
    host.removeAttribute("aria-busy");
  }
}
export function captureFixedPage(
  host: HTMLElement,
  anchor: string,
): PageSurface | undefined {
  const paper = host.querySelector<HTMLElement>(
    ":scope > .comic-spread, :scope > .pdf-spread",
  );
  if (!paper) return;
  const slots = [
    ...paper.querySelectorAll<HTMLElement>(":scope > .fixed-page-slot"),
  ];
  if (!slots.length) return;
  // 捕获固定纸张（包含留白），而不是图片外接框。否则各页比例变化
  // 会改变动画尺寸，目标页最终从旧页尺寸跳回自身尺寸，形成浮动。
  const rect = paper.getBoundingClientRect();
  const parent = host.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const theme = (host.dataset.paper ?? "light") as Theme;
  const ratio = Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(8_000_000 / (rect.width * rect.height)),
  );
  const element = document.createElement("div");
  const sheets = slots.map((slot) => {
    const bound = slot.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(bound.width * ratio));
    canvas.height = Math.max(1, Math.ceil(bound.height * ratio));
    const context = canvas.getContext("2d");
    if (context) {
      paintPaper(context, theme, 0, 0, canvas.width, canvas.height, ratio);
      const source = slot.querySelector<HTMLImageElement | HTMLCanvasElement>(
        ".comic-page, canvas[aria-label]",
      );
      if (source) {
        const image = source.getBoundingClientRect();
        // 像素取整仅作用于画布分辨率；实际位置按原页面框换算，
        // 保持边距和原图比例。空白侧也生成同尺寸纸张。
        const scaleX = canvas.width / bound.width;
        const scaleY = canvas.height / bound.height;
        const x = (image.left - bound.left) * scaleX;
        const y = (image.top - bound.top) * scaleY;
        // 快照与静态图片使用相同的纹理原点；只合成显示效果，不改源文件。
        paintPaper(
          context,
          theme,
          x,
          y,
          image.width * scaleX,
          image.height * scaleY,
          ratio,
        );
        context.globalCompositeOperation = paperBlendsInk(theme)
          ? "multiply"
          : "source-over";
        context.drawImage(
          source,
          x,
          y,
          image.width * scaleX,
          image.height * scaleY,
        );
        context.globalCompositeOperation = "source-over";
      }
    }
    canvas.style.cssText =
      "width:100%;height:100%;display:block;object-fit:contain";
    const sheet = document.createElement("div");
    sheet.dataset.sourcePage = slot.dataset.page ?? "";
    sheet.style.cssText = `position:absolute;left:${((bound.left - rect.left) / rect.width) * 100}%;top:0;width:${(bound.width / rect.width) * 100}%;height:100%`;
    sheet.append(canvas);
    return sheet;
  });
  // 遮罩与动画纸张独立持有像素；把纸张交给卷页引擎时，旧页不会被
  // 从遮罩抽走。否则初始化的首个 RAF 之前会短暂露出空白或目标页。
  element.append(
    ...sheets.map((sheet) => {
      const copy = sheet.cloneNode(true) as HTMLElement;
      copy
        .querySelector("canvas")!
        .getContext("2d")
        ?.drawImage(sheet.querySelector("canvas")!, 0, 0);
      return copy;
    }),
  );
  return {
    element,
    sheets,
    spread: slots.length === 2,
    width: rect.width,
    height: rect.height,
    left: rect.left - parent.left,
    top: rect.top - parent.top,
    anchor,
  };
}

/** 保留浏览器已经排好的段落，而不是把正文重新拼成绝对定位的文字。
 * EPUB 的两端对齐会在字符间加入额外空间；旧文字串快照丢失这些空间，
 * 长行末尾可偏移十几像素。Shadow DOM 隔离软件样式，同时保留原 CSS、
 * 字体、段落和分页几何。快照不运行书内脚本，也不加载新的外部资源。
 */
export async function captureNovelPage(
  host: HTMLElement,
  doc: Document,
  anchor: string,
  style: ReaderStyle,
): Promise<PageSurface | undefined> {
  const iframe = doc.defaultView?.frameElement;
  if (!doc.body || !(iframe instanceof HTMLIFrameElement)) return;
  const css = doc.defaultView!.getComputedStyle(doc.documentElement);
  if (css.writingMode.startsWith("vertical")) return;
  // 避免超大 TXT 单章复制成多份 DOM；超过预算直接使用原页面即时切换。
  // 预算针对整个章节，不以截断文字来冒充完整快照。
  if (doc.documentElement.outerHTML.length > 1_048_576) return;
  const frameRect = iframe.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const clip = {
    left: hostRect.left,
    right: hostRect.right,
    top: hostRect.top,
    bottom: hostRect.bottom,
  };
  // iframe 的宽度覆盖整章，而分页器在外层容器裁切当前屏幕。只复制
  // iframe 而遗漏这层边界，会在页边距中露出相邻栏的文字。沿 Shadow
  // DOM 的实际祖先逐层取裁切交集，保留窗口、设置面板和单双页的几何。
  let parent: HTMLElement | null = iframe.parentElement;
  while (parent && parent !== host) {
    const bounds = parent.getBoundingClientRect();
    const overflow = getComputedStyle(parent);
    if (overflow.overflowX !== "visible") {
      clip.left = Math.max(clip.left, bounds.left);
      clip.right = Math.min(clip.right, bounds.right);
    }
    if (overflow.overflowY !== "visible") {
      clip.top = Math.max(clip.top, bounds.top);
      clip.bottom = Math.min(clip.bottom, bounds.bottom);
    }
    const tree = parent.getRootNode();
    parent =
      parent.parentElement ??
      (tree instanceof ShadowRoot ? (tree.host as HTMLElement) : null);
  }
  const rootRect = doc.documentElement.getBoundingClientRect();
  const rules = (list: CSSRuleList): string =>
    Array.from(list)
      .map((rule) => {
        if (rule.type === CSSRule.IMPORT_RULE) {
          const imported = (rule as CSSImportRule).styleSheet;
          return imported ? rules(imported.cssRules) : "";
        }
        if (rule.type === CSSRule.MEDIA_RULE) {
          const media = rule as CSSMediaRule;
          return doc.defaultView!.matchMedia(media.conditionText).matches
            ? rules(media.cssRules)
            : "";
        }
        if (rule.type === CSSRule.SUPPORTS_RULE) {
          const supports = rule as CSSSupportsRule;
          return CSS.supports(supports.conditionText)
            ? rules(supports.cssRules)
            : "";
        }
        if (rule.type === CSSRule.STYLE_RULE) {
          const styled = rule as CSSStyleRule;
          return `${styled.selectorText.replace(/:root\b/g, "html")} {${styled.style.cssText}}`;
        }
        // 已加载的 EPUB FontFace 由阅读器共享到主文档，避免重载字体引起闪动。
        return rule.type === CSSRule.FONT_FACE_RULE ? "" : rule.cssText;
      })
      .join("\n");
  let styles: string;
  try {
    styles = Array.from(doc.styleSheets)
      .map((sheet) => rules(sheet.cssRules))
      .join("\n");
  } catch {
    // 无法读取的第三方样式不能可靠复现，保留原页面而不制造错误快照。
    return;
  }
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelector("head")?.remove();
  // Document 中 html 的 overflow 作用于 iframe 视口；Shadow DOM 中的 html
  // 只是普通元素。如果原样保留 hidden，会把后续所有栏裁掉（文字坐标仍
  // 正确，像素却不可见）。由外层 frame 裁切视口，章节根允许分页栏溢出。
  root.style.setProperty("overflow", "visible", "important");
  // ShadowRoot 不是一个新 Document。显式保留原文档根节点的继承属性和
  // CSS 变量，防止软件的字体、text-rendering 或默认字号渗入快照。
  for (const property of [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-stretch",
    "font-synthesis",
    "font-kerning",
    "font-feature-settings",
    "font-variation-settings",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-rendering",
    "direction",
  ])
    root.style.setProperty(property, css.getPropertyValue(property));
  for (const property of css)
    if (property.startsWith("--"))
      root.style.setProperty(property, css.getPropertyValue(property));
  const background = THEME_COLORS[style.theme].background;
  const createFrame = (offset = 0) => {
    const viewport = document.createElement("div");
    // 普通矩形裁切沿用浏览器的文字绘制路径。clip-path 会额外合成整章，
    // Windows 上可能改变字形抗锯齿，还会扩大动画层的资源需求。
    viewport.style.cssText = `position:absolute;left:${clip.left - hostRect.left - offset}px;top:${clip.top - hostRect.top}px;width:${Math.max(0, clip.right - clip.left)}px;height:${Math.max(0, clip.bottom - clip.top)}px;overflow:hidden;pointer-events:none`;
    const frame = document.createElement("div");
    frame.className = "novel-page-snapshot";
    frame.style.cssText = `all:initial;display:block;position:absolute;left:${frameRect.left - clip.left}px;top:${frameRect.top - clip.top}px;width:${frameRect.width}px;height:${frameRect.height}px;overflow:hidden;pointer-events:none`;
    const shadow = frame.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("style");
    stylesheet.textContent =
      styles + "\n* { animation:none!important; transition:none!important; }";
    const pageRoot = root.cloneNode(true) as HTMLElement;
    // CSSOM 的 style 文本只保留有限有效位；多栏总宽度中每栏的微小舍入
    // 会累积为字形偏移。最后一次克隆后使用实际几何，避免再次序列化。
    pageRoot.style.setProperty("width", `${rootRect.width}px`, "important");
    pageRoot.style.setProperty("height", `${rootRect.height}px`, "important");
    shadow.append(stylesheet, pageRoot);
    viewport.append(frame);
    return viewport;
  };
  const element = document.createElement("div");
  element.style.cssText = `position:relative;width:100%;height:100%;overflow:hidden;background:${background}`;
  element.append(createFrame());
  const spread = style.comicLayout === "double";
  // 单页同样准备独立纸张，在源章节仍有效时完成图片解码。整页遮罩
  // 始终留在原处，直到卷页图层已有可显示的首帧。
  const sheets = Array.from({ length: spread ? 2 : 1 }, (_, index) => {
    const sheet = document.createElement("div");
    sheet.style.cssText = `position:absolute;left:${index * 50}%;width:${spread ? 50 : 100}%;height:100%;overflow:hidden;background:${background}`;
    sheet.append(createFrame((index * hostRect.width) / 2));
    return sheet;
  });
  const preparation = document.createElement("div");
  preparation.style.cssText = `position:absolute;inset:0;opacity:0;pointer-events:none;width:${hostRect.width}px;height:${hostRect.height}px`;
  preparation.append(element, ...sheets);
  host.append(preparation);
  try {
    // 在旧章节仍持有 Blob URL 时完成图片解码；随后移除／重挂父节点不会
    // 重新创建 iframe，也不会重新请求已被旧章节释放的图片或字体。
    const frames = [element, ...sheets].map(
      (page) => page.querySelector(".novel-page-snapshot")!.shadowRoot!,
    );
    await Promise.all(
      frames.flatMap((shadow) => [
        ...Array.from(shadow.querySelectorAll("img")).map((image) =>
          image.decode().catch(() => {}),
        ),
        ...Array.from(
          shadow.querySelectorAll<SVGImageElement>("svg image"),
        ).map(async (svg) => {
          const image = new Image();
          image.src = svg.href.baseVal;
          await image.decode().catch(() => {});
        }),
      ]),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  } finally {
    element.remove();
    sheets.forEach((sheet) => sheet.remove());
    preparation.remove();
  }
  sheets.forEach((sheet) => {
    sheet.style.position = "relative";
    sheet.style.left = "";
  });
  return {
    element,
    sheets,
    spread,
    width: hostRect.width,
    height: hostRect.height,
    left: 0,
    top: 0,
    anchor,
  };
}

async function curlPage(
  host: HTMLElement,
  before: PageSurface | undefined,
  after: PageSurface | undefined,
  delta: number,
  style: ReaderStyle,
  gesture?: TurnGesture,
) {
  if (
    style.direction === "ttb" ||
    !before ||
    !after ||
    before.anchor === after.anchor ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return gesture?.committed ?? true;
  if (style.pageTurnSound) playPageSound();
  const overlay = document.createElement("div");
  overlay.className = "curl-overlay";
  // opacity 保留真实布局，也不被小说隔离样式的 all:initial 重置；只有
  // 引擎的首帧就绪才显示，准备阶段由下方的完整旧页遮罩承接。
  overlay.style.opacity = "0";
  overlay.setAttribute("aria-hidden", "true");
  overlay.dataset.from = before.anchor;
  overlay.dataset.to = after.anchor;
  overlay.dataset.direction = style.direction;
  overlay.dataset.turn = delta > 0 ? "next" : "previous";
  const spread = !!(before.spread || after.spread);
  overlay.dataset.layout = spread ? "double" : "single";
  // 静态页面已提供完整单双页框，封面／末页也有固定空白侧。
  // 不再按图片比例更换几何、扩宽封面或重新计算书脊位置。
  const geometry = before;
  const width = geometry.width;
  const pageWidth = width / (spread ? 2 : 1);
  const stage = document.createElement("div");
  stage.className = "curl-stage";
  stage.style.cssText = `position:absolute;left:${geometry.left}px;top:${geometry.top}px;width:${width}px;height:${geometry.height}px`;
  overlay.style.background = THEME_COLORS[style.theme].background;
  stage.style.setProperty(
    "--curl-background",
    THEME_COLORS[style.theme].background,
  );
  overlay.append(stage);
  host.append(overlay);
  const forward = delta > 0 === (style.direction === "ltr");
  const oldSheets = spread ? before.sheets : [before.sheets[0]];
  const newSheets = spread ? after.sheets : [after.sheets[0]];
  const pages = forward
    ? [...oldSheets, ...newSheets]
    : [...newSheets, ...oldSheets];
  pages.forEach((page) => {
    page.classList.add("curl-sheet");
    page.style.width = `${pageWidth}px`;
    page.style.height = `${geometry.height}px`;
    page.style.background ||= THEME_COLORS[style.theme].background;
    stage.append(page);
  });
  let flip: PageFlip | undefined;
  let animationRequest = 0;
  let unsubscribe: (() => void) | undefined;
  const duration = pageTurnDuration(style.turnDuration);
  try {
    flip = new PageFlip(stage, {
      width: pageWidth,
      height: geometry.height,
      size: "fixed",
      startPage: forward ? 0 : oldSheets.length,
      flippingTime: duration,
      usePortrait: !spread,
      showCover: false,
      autoSize: false,
      maxShadowOpacity: 0.34,
      useMouseEvents: false,
      showPageCorners: false,
      // Mouse handlers are disabled. The upstream corner guard also rejects
      // programmatic flipPrev in portrait mode because x=10 is near the spine.
      disableFlipByClick: false,
      drawShadow: true,
    });
    await new Promise<void>((resolve) => {
      let started = false;
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      if (!gesture) timer = setTimeout(done, duration + 800);
      flip!.on("changeState", (event) => {
        overlay.dataset.state = String(event.data);
        if (event.data === "flipping" || event.data === "user_fold")
          started = true;
        if (started && event.data === "read") {
          done();
        }
      });
      flip!.on("init", () => {
        // Let the renderer establish its RAF clock before starting the motion.
        animationRequest = requestAnimationFrame(() => {
          overlay.style.opacity = "1";
          if (!gesture) {
            forward ? flip!.flipNext("bottom") : flip!.flipPrev("bottom");
            return;
          }
          const rect = flip!.getBoundsRect();
          const cornerY = gesture.y < 0.5 ? 1 : rect.height - 2;
          const controller = flip!.getFlipController();
          controller.start({
            x: rect.left + (forward ? rect.width - 1 : 1),
            y: rect.top + cornerY,
          });
          unsubscribe = gesture.subscribe(() => {
            const progress =
              gesture.committed === undefined
                ? gesture.progress
                : gesture.committed
                  ? Math.max(0.501, gesture.progress)
                  : Math.min(0.499, gesture.progress);
            const point = flip!.getRender().convertToGlobal({
              x: rect.pageWidth * (1 - 2 * Math.max(0.001, progress)),
              y: Math.max(
                1,
                Math.min(rect.height - 1, gesture.y * rect.height),
              ),
            });
            controller.fold(point);
            overlay.dataset.progress = String(progress);
            if (gesture.committed !== undefined) {
              timer = setTimeout(done, duration + 800);
              controller.stopMove();
            }
          });
        });
      });
      flip!.loadFromHTML(pages);
    });
  } finally {
    cancelAnimationFrame(animationRequest);
    unsubscribe?.();
    flip?.destroy();
    overlay.remove();
  }
  return gesture?.committed ?? true;
}

async function slidePage(
  host: HTMLElement,
  before: PageSurface | undefined,
  after: PageSurface | undefined,
  delta: number,
  style: ReaderStyle,
) {
  if (
    !before ||
    !after ||
    before.anchor === after.anchor ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  const overlay = document.createElement("div");
  overlay.className = "slide-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const distance =
    host.clientWidth * delta * (style.direction === "rtl" ? -1 : 1);
  for (const page of [before, after]) {
    page.element.style.cssText += `;position:absolute;left:${page.left}px;top:${page.top}px;width:${page.width}px;height:${page.height}px;background:${THEME_COLORS[style.theme].background}`;
    overlay.append(page.element);
  }
  host.append(overlay);
  host.dataset.turning = "true";
  try {
    const timing = {
      duration: 380,
      easing: "cubic-bezier(.22,.61,.36,1)",
      fill: "both" as const,
    };
    await Promise.all([
      before.element.animate(
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${-distance}px)` },
        ],
        timing,
      ).finished,
      after.element.animate(
        [
          { transform: `translateX(${distance}px)` },
          { transform: "translateX(0)" },
        ],
        timing,
      ).finished,
    ]);
  } finally {
    overlay.remove();
    delete host.dataset.turning;
  }
}
