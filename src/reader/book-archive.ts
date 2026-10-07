import {
  Reader,
  ZipReader,
  Uint8ArrayWriter,
  configure,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import type { ByteSource } from "../reader-types";

configure({ useWebWorkers: false, useCompressionStream: true });
const MAX_ENTRY = 64 * 1024 * 1024;

class SourceReader extends Reader<ByteSource> {
  constructor(readonly source: ByteSource) {
    super(source);
    this.size = Number(source.info.size);
  }
  readUint8Array(index: number, length: number) {
    return this.source.readAt(index, length);
  }
}
class BoundedWriter extends Uint8ArrayWriter {
  private count = 0;
  async writeUint8Array(bytes: Uint8Array) {
    this.count += bytes.length;
    if (this.count > MAX_ENTRY) throw new Error("档案条目解压超过 64 MiB");
    return super.writeUint8Array(bytes);
  }
}
function normalizeArchivePath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  if (
    parts.some((x) => x === "..") ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path)
  )
    throw new Error("档案包含不安全的路径");
  return parts.filter((x) => x && x !== ".").join("/");
}

export class BookArchive {
  private reader: ZipReader<ByteSource>;
  private files = new Map<string, FileEntry>();
  entries: Entry[] = [];
  constructor(source: ByteSource) {
    this.reader = new ZipReader(new SourceReader(source), {
      checkSignature: true,
    });
  }
  async init() {
    try {
      this.entries = await this.reader.getEntries();
      if (this.entries.length > 30000) throw new Error("档案包含过多条目");
      for (const entry of this.entries) {
        const name = normalizeArchivePath(entry.filename);
        if (entry.directory) continue;
        if (this.files.has(name)) throw new Error(`档案路径重复：${name}`);
        if (entry.uncompressedSize > MAX_ENTRY)
          throw new Error(`条目过大：${name}`);
        this.files.set(name, entry);
      }
      return this;
    } catch (error) {
      await this.reader.close();
      this.files.clear();
      throw error;
    }
  }
  getSize = (name: string) =>
    this.files.get(normalizeArchivePath(name))?.uncompressedSize ?? 0;
  names() {
    return Array.from(this.files.keys());
  }
  async read(name: string) {
    const entry = this.files.get(normalizeArchivePath(name));
    if (!entry) throw new Error(`缺少档案资源：${name}`);
    if (entry.encrypted) throw new Error("此开发版尚不支持加密压缩包");
    if (!entry.getData) throw new Error(`条目不可读：${name}`);
    const result = await entry.getData(new BoundedWriter(), {
      checkSignature: true,
    });
    if (result.length > MAX_ENTRY || result.length !== entry.uncompressedSize)
      throw new Error(`条目大小不匹配：${name}`);
    return result;
  }
  loadText = async (name: string) =>
    this.files.has(normalizeArchivePath(name))
      ? new TextDecoder().decode(await this.read(name))
      : null;
  loadBlob = async (name: string, type?: string) =>
    this.files.has(normalizeArchivePath(name))
      ? new Blob([new Uint8Array(await this.read(name)).buffer], { type })
      : null;
  async close() {
    await this.reader.close();
    this.files.clear();
  }
}
