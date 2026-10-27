/** 固定页面显示层：始终由原图比例决定大小，增强只替换像素。
 * 对比线裁切同坐标系的增强图，因此处理前后不会忽大忽小。
 * 分界线拥有自己的指针事件，避免拖动对比时触发共用翻页手势。
 */
export class ImageFrame {
  enhancement?: ReaderSnapshot["enhancement"];
  readonly element = document.createElement("div");
  readonly width: number;
  readonly height: number;
  private enhanced?: PageImage;
  private divider = document.createElement("button");
  private labels = document.createElement("div");
  private split = 50;
  // 显示原图的哪一块（裁白边／半页）。框的比例和排版尺寸都按这块计算。
  private view: ViewRect;
  constructor(private original: HTMLImageElement) {
    this.width = original.naturalWidth;
    this.height = original.naturalHeight;
    this.view = { x: 0, y: 0, width: this.width, height: this.height };
    this.element.className = "image-frame";
    this.setView(this.view);
    this.divider.className = "quality-divider";
    this.divider.type = "button";
    this.divider.setAttribute("role", "slider");
    this.divider.setAttribute("aria-label", "原图与增强分界线");
    this.divider.setAttribute("aria-valuemin", "0");
    this.divider.setAttribute("aria-valuemax", "100");
    this.divider.setAttribute("data-no-page", "");
    this.divider.innerHTML = '<span aria-hidden="true">‹ ›</span>';
    this.divider.onpointerdown = (event) => {
      event.stopPropagation();
      this.divider.setPointerCapture(event.pointerId);
      this.drag(event);
    };
    this.divider.onpointermove = (event) => {
      if (this.divider.hasPointerCapture(event.pointerId)) this.drag(event);
    };
    this.divider.onpointerup = (event) => {
      if (this.divider.hasPointerCapture(event.pointerId))
        this.divider.releasePointerCapture(event.pointerId);
    };
    this.divider.onkeydown = (event) => {
      const delta =
        event.key === "ArrowLeft" ? -2 : event.key === "ArrowRight" ? 2 : 0;
      if (!delta && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      this.setSplit(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 100
            : this.split + delta,
      );
    };
    this.labels.className = "quality-labels";
    this.labels.innerHTML = "<span>原图</span><span>增强</span>";
    this.element.append(original, this.labels, this.divider);
    this.compare(false);
  }
  private drag(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.element.getBoundingClientRect();
    this.setSplit(((event.clientX - rect.left) / rect.width) * 100);
  }
  private setSplit(value: number) {
    this.split = Math.max(0, Math.min(100, value));
    this.element.style.setProperty("--quality-split", `${this.split}%`);
    // 图片比框大（只露出一部分）时，裁切线要换算到整张图的坐标。
    const imageSplit =
      (((this.split / 100) * this.view.width + this.view.x) / this.width) * 100;
    this.element.style.setProperty("--quality-split-image", `${imageSplit}%`);
    this.divider.setAttribute("aria-valuenow", String(Math.round(this.split)));
  }
  enhance(
    image: PageImage,
    compare: boolean,
    enhancement?: ReaderSnapshot["enhancement"],
  ) {
    this.enhanced?.remove();
    this.enhanced = image;
    this.enhancement = enhancement;
    this.original.className = "quality-original";
    this.place(image);
    this.element.insertBefore(image, this.labels);
    this.compare(compare);
  }
  /** 只显示原图的一块：框按这块的尺寸排版，图片按比例放大并平移。 */
  setView(view: ViewRect) {
    this.view = view;
    this.element.dataset.sourceWidth = String(view.width);
    this.element.dataset.sourceHeight = String(view.height);
    this.element.style.aspectRatio = `${view.width}/${view.height}`;
    this.place(this.original);
    if (this.enhanced) this.place(this.enhanced);
    this.setSplit(this.split);
  }
  private place(image: PageImage) {
    const view = this.view;
    image.style.left = `${(-view.x / view.width) * 100}%`;
    image.style.top = `${(-view.y / view.height) * 100}%`;
    image.style.width = `${(this.width / view.width) * 100}%`;
    image.style.height = `${(this.height / view.height) * 100}%`;
  }
  /** 原图已足够清晰：记录结论，页面继续显示原图。 */
  keepOriginal(enhancement?: ReaderSnapshot["enhancement"]) {
    this.enhancement = enhancement;
  }
  compare(enabled: boolean) {
    const visible = enabled && !!this.enhanced;
    this.element.classList.toggle("is-comparing", visible);
    this.original.hidden = !!this.enhanced && !visible;
    this.divider.hidden = this.labels.hidden = !visible;
    this.setSplit(this.split);
  }
}
import type { ReaderSnapshot } from "../reader-types";
import type { PageImage } from "./image-page-cache";
import type { ViewRect } from "./page-crop";
