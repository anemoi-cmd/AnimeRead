/** 页面缩略图：按需生成、同页去重，最多两张同时生成，避免与阅读抢资源。
 * 结果为约 320 像素高的 JPEG 对象 URL，只在本书打开期间保留，关书时释放。
 */
export const THUMBNAIL_HEIGHT = 320;
export class ThumbnailStore {
  private cache = new Map<number, Promise<string>>();
  private urls = new Set<string>();
  private running = 0;
  private waiting: (() => void)[] = [];
  private disposed = false;
  constructor(private draw: (index: number) => Promise<OffscreenCanvas>) {}
  get(index: number) {
    let thumbnail = this.cache.get(index);
    if (!thumbnail) {
      thumbnail = this.create(index);
      thumbnail.catch(() => this.cache.delete(index));
      this.cache.set(index, thumbnail);
    }
    return thumbnail;
  }
  private async create(index: number) {
    if (this.running >= 2)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    try {
      if (this.disposed) throw new Error("书籍已关闭");
      const canvas = await this.draw(index);
      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: 0.8,
      });
      if (this.disposed) throw new Error("书籍已关闭");
      const url = URL.createObjectURL(blob);
      this.urls.add(url);
      return url;
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
  dispose() {
    this.disposed = true;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.cache.clear();
    for (const wake of this.waiting.splice(0)) wake();
  }
}
/** 把一张图片高质量缩到缩略图高度。 */
export async function imageThumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob, {
    resizeHeight: THUMBNAIL_HEIGHT,
    resizeQuality: "medium",
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
