/** 漫画原图／增强图的数据缓存，不管理屏幕布局。
 * 原图只缓存压缩 Blob（48 MiB）；增强图缓存显卡输出的 ImageBitmap，按像素
 * 计 192 MiB，淘汰时立即释放。相同任务去重，过期任务可取消。
 * 当前页与预处理后两页复用同一管线，避免快速翻页重复推理或积累解码图。
 */
import type { ByteSource, ReaderSnapshot, ReaderStyle } from "../reader-types";
import { native, readWhole } from "../file-sources";
import { invoke } from "@tauri-apps/api/core";
import { anime4kDevice, enhanceImage } from "../image-enhancement";
import type { BookArchive } from "./book-archive";
import { pauseAnime4k, warmAnime4k } from "../gpu/anime4k-client";
import {
  fitRatio,
  neededFilters,
  type EnhanceTarget,
} from "../gpu/output-size";

type Enhancement = NonNullable<ReaderSnapshot["enhancement"]>;
// 原图已足够清晰时只记录结论，没有位图，也不占缓存预算。
type Enhanced = { bitmap?: ImageBitmap; enhancement: Enhancement };
const ORIGINAL_BUDGET = 48 * 1024 * 1024;
const ENHANCED_BUDGET = 192 * 1024 * 1024;
const bitmapBytes = (bitmap?: ImageBitmap) =>
  bitmap ? bitmap.width * bitmap.height * 4 : 0;
/** 漫画页面节点：原图为 img，增强图为同尺寸显示的 canvas。 */
export type PageImage = HTMLImageElement | HTMLCanvasElement;

/** Encoded cache and in-flight deduplication are shared by paged and strip views. */
export class ImagePages {
  private originals = new Map<number, Blob>();
  private originalBytes = 0;
  private originalPending = new Map<number, Promise<Blob>>();
  private enhanced = new Map<string, Enhanced>();
  private enhancedBytes = 0;
  private enhancedPending = new Map<string, Promise<Enhanced>>();
  private disposed = false;
  private controller = new AbortController();
  private cancellation: Promise<void> = Promise.resolve();
  constructor(
    private source: ByteSource,
    private names: string[],
    private archive: BookArchive | undefined,
    private target: () => EnhanceTarget,
  ) {}
  private async decode(blob: Blob, index: number) {
    const url = URL.createObjectURL(blob),
      image = new Image();
    image.className = "comic-page";
    image.alt = `漫画第 ${index + 1} 页`;
    image.draggable = false;
    image.src = url;
    try {
      await image.decode();
      return image;
    } catch {
      throw new Error(
        `图片无法解码：${this.names[index] ?? this.source.info.name}`,
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  // 相邻页面提前解码好的原图；一个元素只能放进页面一次，取用即移除。
  private decoded = new Map<number, Promise<HTMLImageElement>>();
  async loadOriginal(index: number) {
    const ready = this.decoded.get(index);
    if (ready) {
      this.decoded.delete(index);
      return ready;
    }
    return this.decode(await this.original(index), index);
  }
  /** 阅读当前页时预先读取并解码前后页面，翻页时直接换上，不等解码。
   * 最多保留 4 张，超出的最旧一张丢弃。
   */
  preload(indices: number[]) {
    for (const index of indices) {
      if (this.disposed || this.decoded.has(index)) continue;
      const image = this.original(index).then((blob) =>
        this.decode(blob, index),
      );
      image.catch(() => this.decoded.delete(index));
      this.decoded.set(index, image);
    }
    while (this.decoded.size > 4)
      this.decoded.delete(this.decoded.keys().next().value!);
  }
  async load(
    index: number,
    style: ReaderStyle,
  ): Promise<{ image?: PageImage; enhancement?: Enhancement }> {
    if (!style.enhanceEnabled) return { image: await this.loadOriginal(index) };
    let data = await this.loadEnhanced(index, style);
    // 极大页面可能在交付前被并发预处理挤出缓存（已关闭的位图宽度为 0）。
    if (data.bitmap && !data.bitmap.width)
      data = await this.loadEnhanced(index, style);
    if (this.disposed) throw new Error("书籍已关闭");
    // 不需要增强：保留页面上的原图，只更新状态。
    if (!data.bitmap) return { enhancement: data.enhancement };
    // 立即复制到显示画布：缓存随后淘汰并关闭位图也不影响页面。
    const canvas = document.createElement("canvas");
    canvas.width = data.bitmap.width;
    canvas.height = data.bitmap.height;
    canvas.getContext("2d")!.drawImage(data.bitmap, 0, 0);
    canvas.className = "comic-page";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `漫画第 ${index + 1} 页（增强）`);
    canvas.dataset.enhanced = "true";
    canvas.dataset.filters = data.enhancement.filters;
    canvas.dataset.scale = String(data.enhancement.scale);
    return { image: canvas, enhancement: data.enhancement };
  }
  /** 目标尺寸按 64 像素取整，窗口微调不会让整本缓存失效。 */
  private key(index: number, style: ReaderStyle) {
    const target = this.target();
    const round = (value: number) =>
      Number.isFinite(value) ? Math.ceil(value / 64) * 64 : "auto";
    return `${index}:${style.enhanceBackend}:${style.filters.join("+")}:${round(target.width)}x${round(target.height)}`;
  }
  hasEnhanced(index: number, style: ReaderStyle) {
    return style.enhanceEnabled && this.enhanced.has(this.key(index, style));
  }
  /** 打开漫画或更换滤镜时预编译 Anime4K 模型，读者看原图时同步完成。
   * 先看当前页是否真的需要放大；原图已够清晰的书不唤醒显卡。
   */
  warm(style: ReaderStyle, index: number) {
    if (!style.enhanceEnabled || style.enhanceBackend !== "anime4k") return;
    void (async () => {
      const bitmap = await createImageBitmap(await this.original(index));
      const fit = fitRatio(bitmap.width, bitmap.height, this.target());
      bitmap.close();
      const filters = neededFilters(style.filters, fit);
      if (filters.length && !this.disposed && (await anime4kDevice()))
        warmAnime4k(filters);
    })().catch(() => {});
  }
  private turnGate?: { done: Promise<void>; open: () => void };
  /** 翻页动画与推理共用显卡：动画期间新任务等动画结束再开始，正在跑的
   * Anime4K 任务在块之间暂停。Waifu2x 是独立进程，只能推迟开始。
   */
  pause(paused: boolean) {
    pauseAnime4k(paused);
    if (paused && !this.turnGate) {
      let open!: () => void;
      const done = new Promise<void>((resolve) => (open = resolve));
      this.turnGate = { done, open };
    } else if (!paused && this.turnGate) {
      this.turnGate.open();
      this.turnGate = undefined;
    }
  }
  async prefetch(indices: number[], style: ReaderStyle) {
    const signal = this.controller.signal;
    for (const index of indices) {
      if (this.disposed || signal.aborted) return;
      await this.loadEnhanced(index, style);
    }
  }
  private async original(index: number) {
    if (this.disposed) throw new Error("书籍已关闭");
    const cached = this.originals.get(index);
    if (cached) {
      this.originals.delete(index);
      this.originals.set(index, cached);
      return cached;
    }
    let pending = this.originalPending.get(index);
    if (!pending) {
      pending = this.read(index)
        .then((blob) => {
          if (this.disposed) return blob;
          while (
            this.originalBytes + blob.size > ORIGINAL_BUDGET &&
            this.originals.size
          ) {
            const [oldest, value] = this.originals.entries().next().value!;
            this.originalBytes -= value.size;
            this.originals.delete(oldest);
          }
          if (blob.size <= ORIGINAL_BUDGET) {
            this.originals.set(index, blob);
            this.originalBytes += blob.size;
          }
          return blob;
        })
        .finally(() => {
          if (this.originalPending.get(index) === pending)
            this.originalPending.delete(index);
        });
      this.originalPending.set(index, pending);
    }
    return pending;
  }
  private async loadEnhanced(index: number, style: ReaderStyle) {
    await this.cancellation;
    if (this.disposed) throw new Error("书籍已关闭");
    const key = this.key(index, style);
    const cached = this.enhanced.get(key);
    if (cached) {
      this.enhanced.delete(key);
      this.enhanced.set(key, cached);
      return cached;
    }
    let pending = this.enhancedPending.get(key);
    if (!pending) {
      const signal = this.controller.signal;
      pending = this.enhance(index, style, signal)
        .then((value) => {
          if (this.disposed || signal.aborted) return value;
          const bytes = bitmapBytes(value.bitmap);
          while (
            this.enhancedBytes + bytes > ENHANCED_BUDGET &&
            this.enhanced.size
          )
            this.evict(this.enhanced.keys().next().value!);
          if (bytes <= ENHANCED_BUDGET) {
            this.enhanced.set(key, value);
            this.enhancedBytes += bytes;
          }
          return value;
        })
        .finally(() => {
          if (this.enhancedPending.get(key) === pending)
            this.enhancedPending.delete(key);
        });
      this.enhancedPending.set(key, pending);
    }
    return pending;
  }
  private evict(key: string) {
    const value = this.enhanced.get(key);
    if (!value) return;
    this.enhancedBytes -= bitmapBytes(value.bitmap);
    this.enhanced.delete(key);
    value.bitmap?.close();
  }
  private async enhance(
    index: number,
    style: ReaderStyle,
    signal: AbortSignal,
  ): Promise<Enhanced> {
    signal.throwIfAborted();
    const original = await this.original(index);
    await this.turnGate?.done;
    const started = performance.now();
    signal.throwIfAborted();
    const enhanced = await enhanceImage(original, style, this.target(), signal);
    if (enhanced.skipped) {
      signal.throwIfAborted();
      return {
        enhancement: {
          scale: 1,
          filters: style.filters.join("+"),
          milliseconds: Math.round(performance.now() - started),
          skipped: true,
        },
      };
    }
    if (signal.aborted) {
      enhanced.bitmap.close();
      signal.throwIfAborted();
    }
    return {
      bitmap: enhanced.bitmap,
      enhancement: {
        scale: Math.round(enhanced.scale * 100) / 100,
        filters: enhanced.filters.join("+"),
        device: enhanced.device,
        milliseconds: Math.round(performance.now() - started),
      },
    };
  }
  private async read(index: number) {
    const bytes = this.archive
      ? await this.archive.read(this.names[index])
      : await readWhole(this.source, 64 * 1024 * 1024);
    const name = this.names[index] ?? this.source.info.name;
    const extension = name.split(".").pop()?.toLowerCase();
    const type = ["jpg", "jpeg"].includes(extension ?? "")
      ? "image/jpeg"
      : `image/${extension}`;
    return new Blob([new Uint8Array(bytes).buffer], { type });
  }
  async cancelPending() {
    this.controller.abort();
    this.controller = new AbortController();
    const running = this.enhancedPending.size > 0;
    this.enhancedPending.clear();
    this.cancellation = this.cancellation
      .catch(() => {})
      .then(async () => {
        if (native && running) await invoke("cancel_enhancements");
      });
    await this.cancellation;
  }
  async dispose() {
    this.disposed = true;
    this.pause(false);
    // 只取消本书任务；Anime4K Worker 与已编译模型留给下一本书，闲置后自行释放。
    await this.cancelPending();
    for (const key of [...this.enhanced.keys()]) this.evict(key);
    this.originals.clear();
    this.decoded.clear();
    this.originalBytes = 0;
  }
}
