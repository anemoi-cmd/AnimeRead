/** 固定页面显示层：始终由原图比例决定大小，增强只替换像素。
 * 对比线裁切同坐标系的增强图，因此处理前后不会忽大忽小。
 * 分界线拥有自己的指针事件，避免拖动对比时触发共用翻页手势。
 */
export class ImageFrame {
  enhancement?: ReaderSnapshot["enhancement"];
  readonly element = document.createElement("div");
  readonly width: number;
  readonly height: number;
  private enhanced?: HTMLImageElement;
  private divider = document.createElement("button");
  private labels = document.createElement("div");
  private split = 50;
  constructor(private original: HTMLImageElement) {
    this.width = original.naturalWidth;
    this.height = original.naturalHeight;
    this.element.className = "image-frame";
    this.element.dataset.sourceWidth = String(this.width);
    this.element.dataset.sourceHeight = String(this.height);
    this.element.style.aspectRatio = `${this.width}/${this.height}`;
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
    this.divider.setAttribute("aria-valuenow", String(Math.round(this.split)));
  }
  enhance(
    image: HTMLImageElement,
    compare: boolean,
    enhancement?: ReaderSnapshot["enhancement"],
  ) {
    this.enhanced?.remove();
    this.enhanced = image;
    this.enhancement = enhancement;
    this.original.className = "quality-original";
    this.element.insertBefore(image, this.labels);
    this.compare(compare);
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
