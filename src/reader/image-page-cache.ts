/** 漫画原图／增强图的数据缓存，不管理屏幕布局。
 * 只缓存压缩 Blob，限制总大小 48 MiB；相同任务去重，过期任务可取消。
 * 当前页与预处理后两页复用同一管线，避免快速翻页重复推理或积累解码图。
 */
import type { ByteSource, ReaderSnapshot, ReaderStyle } from "../reader-types";
import { native, readWhole } from "../file-sources";
import { invoke } from "@tauri-apps/api/core";
import { enhanceImage } from "../image-enhancement";
import type { BookArchive } from "./book-archive";
import { releaseAnime4k } from "../gpu/anime4k-client";

type PageData = { blob: Blob; enhancement?: ReaderSnapshot["enhancement"] };
/** Encoded cache and in-flight deduplication are shared by paged and strip views. */
export class ImagePages {
  private cache = new Map<string, PageData>();
  private pending = new Map<string, Promise<PageData>>();
  private bytes = 0;
  private disposed = false;
  private controller = new AbortController();
  private cancellation: Promise<void> = Promise.resolve();
  constructor(
    private source: ByteSource,
    private names: string[],
    private archive?: BookArchive,
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
  async load(
    index: number,
    style: ReaderStyle,
  ): Promise<{
    image: HTMLImageElement;
    enhancement?: ReaderSnapshot["enhancement"];
  }> {
    const data = await this.loadData(index, style);
    if (this.disposed) throw new Error("书籍已关闭");
    const image = await this.decode(data.blob, index);
    if (data.enhancement) {
      image.dataset.enhanced = "true";
      image.dataset.filters = data.enhancement.filters;
      image.dataset.scale = String(data.enhancement.scale);
    }
    return { image, enhancement: data.enhancement };
  }
  private key(index: number, style: ReaderStyle) {
    return `${index}:${style.enhanceEnabled ? style.enhanceBackend + ":" + style.filters.join("+") : "original"}`;
  }
  hasEnhanced(index: number, style: ReaderStyle) {
    return style.enhanceEnabled && this.cache.has(this.key(index, style));
  }
  async prefetch(indices: number[], style: ReaderStyle) {
    const signal = this.controller.signal;
    for (const index of indices) {
      if (this.disposed || signal.aborted) return;
      await this.loadData(index, style);
    }
  }
  private async loadData(index: number, style: ReaderStyle): Promise<PageData> {
    if (style.enhanceEnabled) await this.cancellation;
    if (this.disposed) throw new Error("书籍已关闭");
    const key = this.key(index, style);
    let data = this.cache.get(key);
    if (!data) {
      let pending = this.pending.get(key);
      if (!pending) {
        const signal = this.controller.signal;
        pending = this.read(index, style, signal)
          .then((value) => {
            if (this.disposed || signal.aborted) return value;
            while (
              this.bytes + value.blob.size > 48 * 1024 * 1024 &&
              this.cache.size
            ) {
              const oldest = this.cache.keys().next().value!;
              this.bytes -= this.cache.get(oldest)!.blob.size;
              this.cache.delete(oldest);
            }
            if (value.blob.size <= 48 * 1024 * 1024) {
              this.cache.set(key, value);
              this.bytes += value.blob.size;
            }
            return value;
          })
          .finally(() => {
            if (this.pending.get(key) === pending) this.pending.delete(key);
          });
        this.pending.set(key, pending);
      }
      data = await pending;
    } else {
      this.cache.delete(key);
      this.cache.set(key, data);
    }
    if (this.disposed) throw new Error("书籍已关闭");
    return data;
  }
  private async read(
    index: number,
    style: ReaderStyle,
    signal: AbortSignal,
  ): Promise<PageData> {
    signal.throwIfAborted();
    if (style.enhanceEnabled) {
      const original = await this.load(index, {
        ...style,
        enhanceEnabled: false,
      });
      const started = performance.now();
      signal.throwIfAborted();
      const enhanced = await enhanceImage(original.image, style, signal);
      signal.throwIfAborted();
      return {
        blob: enhanced.blob,
        enhancement: {
          scale: enhanced.scale,
          filters: style.filters.join("+"),
          device: enhanced.device,
          milliseconds: Math.round(performance.now() - started),
        },
      };
    }
    const bytes = this.archive
      ? await this.archive.read(this.names[index])
      : await readWhole(this.source, 64 * 1024 * 1024);
    const name = this.names[index] ?? this.source.info.name;
    const extension = name.split(".").pop()?.toLowerCase();
    const type = ["jpg", "jpeg"].includes(extension ?? "")
      ? "image/jpeg"
      : `image/${extension}`;
    const blob = new Blob([new Uint8Array(bytes).buffer], { type });
    return { blob };
  }
  async cancelPending() {
    this.controller.abort();
    this.controller = new AbortController();
    const keys = [...this.pending.keys()].filter(
      (key) => !key.endsWith(":original"),
    );
    for (const key of keys) this.pending.delete(key);
    this.cancellation = this.cancellation
      .catch(() => {})
      .then(async () => {
        if (native && keys.length) await invoke("cancel_enhancements");
      });
    await this.cancellation;
  }
  async dispose() {
    this.disposed = true;
    await this.cancelPending();
    releaseAnime4k();
    this.cache.clear();
    this.bytes = 0;
  }
}
