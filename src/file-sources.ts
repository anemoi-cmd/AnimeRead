import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ByteSource, LocalBook, SourceInfo } from "./reader-types";

export const native = isTauri();
const MAX_CHUNK = 4 * 1024 * 1024;

export class FileByteSource implements ByteSource {
  readonly info: SourceInfo;
  constructor(readonly file: File) {
    this.info = {
      id: `browser-${file.name}-${file.size}-${file.lastModified}`,
      sourceId: "",
      name: file.name,
      size: String(file.size),
      revision: `${file.size}-${file.lastModified}`,
      format: file.name.split(".").pop()?.toLowerCase() ?? "",
    };
  }
  async readAt(offset: number, length: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.file.size
    )
      throw new Error("读取范围无效");
    const result = new Uint8Array(
      await this.file.slice(offset, offset + length).arrayBuffer(),
    );
    signal?.throwIfAborted();
    return result;
  }
  async close() {}
}

class NativeByteSource implements ByteSource {
  private closed = false;
  constructor(readonly info: SourceInfo) {}
  async readAt(offset: number, length: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("书籍已关闭");
    const size = Number(this.info.size);
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > size
    )
      throw new Error("读取范围无效");
    const available = Math.min(length, size - offset);
    const chunks: Uint8Array[] = [];
    for (let cursor = 0; cursor < available; cursor += MAX_CHUNK) {
      signal?.throwIfAborted();
      const count = Math.min(MAX_CHUNK, available - cursor);
      const response = await invoke<ArrayBuffer | number[]>("read_source", {
        sourceId: this.info.sourceId,
        offset: String(offset + cursor),
        length: count,
      });
      const chunk = new Uint8Array(response);
      if (chunk.length !== count) throw new Error("文件读取长度不匹配");
      chunks.push(chunk);
    }
    signal?.throwIfAborted();
    const result = new Uint8Array(available);
    let cursor = 0;
    for (const chunk of chunks) {
      result.set(chunk, cursor);
      cursor += chunk.length;
    }
    return result;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await invoke("close_source", { sourceId: this.info.sourceId });
  }
}

export async function readWhole(source: ByteSource, limit = 128 * 1024 * 1024) {
  const size = Number(source.info.size);
  if (!Number.isSafeInteger(size) || size > limit)
    throw new Error(
      `此模式最多读取 ${Math.round(limit / 1024 / 1024)} MiB，请使用较小文件`,
    );
  return source.readAt(0, size);
}
export const loadNativeLibrary = () => invoke<LocalBook[]>("load_library");
export const pickNativeBooks = () => invoke<LocalBook[]>("pick_books");
export const importNativePaths = (paths: string[]) =>
  invoke<LocalBook[]>("import_paths", { paths });
export const removeNativeBook = (id: string) => invoke("remove_book", { id });
export const openNativeBook = async (id: string) =>
  new NativeByteSource(await invoke<SourceInfo>("open_book", { id }));
export const getStartupBooks = () => invoke<string[]>("startup_books");
export const getStartupNotice = () => invoke<string | null>("startup_notice");
export const getSystemFonts = async () =>
  native
    ? invoke<string[]>("system_fonts")
    : ["Microsoft YaHei", "SimSun", "SimHei", "KaiTi", "Arial", "Georgia"];
