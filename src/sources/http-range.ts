import type { ByteSource, SourceInfo } from "../reader-types";

const CHUNK = 1024 * 1024;
const CACHE_LIMIT = 8 * 1024 * 1024;
function rangeHeader(value: string | null) {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match)
    throw new Error("INVALID_CONTENT_RANGE：服务器没有返回有效字节范围");
  const [start, end, size] = match.slice(1).map(Number);
  if (
    ![start, end, size].every(Number.isSafeInteger) ||
    start < 0 ||
    end < start ||
    size <= end
  )
    throw new Error("INVALID_CONTENT_RANGE：服务器范围超出文件大小");
  return { start, end, size };
}
async function boundedBody(response: Response, expected: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("服务器没有返回书籍数据");
  const result = new Uint8Array(expected);
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (count + value.length > expected)
        throw new Error("RANGE_LENGTH_MISMATCH：服务器返回了范围之外的数据");
      result.set(value, count);
      count += value.length;
    }
    if (count !== expected)
      throw new Error("RANGE_LENGTH_MISMATCH：字节范围传输未完成");
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Strict random access: no whole-file fallback, no disk writes, bounded cache.
 * Account authentication belongs to the future native SourceProvider adapter.
 */
export class HttpRangeSource implements ByteSource {
  private closed = false;
  private controller = new AbortController();
  private cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  private constructor(
    private url: string,
    readonly info: SourceInfo,
    private etag: string | null,
    private modified: string | null,
  ) {}
  static async open(url: string, name: string, signal?: AbortSignal) {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("请输入 HTTP/HTTPS 地址，认证交由来源提供器处理");
    const response = await fetch(parsed.href, {
      headers: { Range: "bytes=0-0" },
      credentials: "omit",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    try {
      if (response.status !== 206)
        throw new Error(
          `RANGE_NOT_SUPPORTED：服务器返回 ${response.status}，未启动全文件下载`,
        );
      const range = rangeHeader(response.headers.get("content-range"));
      if (range.start !== 0 || range.end !== 0)
        throw new Error("INVALID_CONTENT_RANGE：探测区间不匹配");
      if (
        response.headers.get("content-encoding") &&
        response.headers.get("content-encoding") !== "identity"
      )
        throw new Error("范围响应被压缩，无法保证字节位置");
      const etag = response.headers.get("etag");
      const modified = response.headers.get("last-modified");
      if ((!etag || etag.startsWith("W/")) && !modified)
        throw new Error("SOURCE_UNVALIDATED：服务器未提供可靠的源版本标识");
      const bytes = await boundedBody(response, 1);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(parsed.href),
      );
      const id =
        "http-" +
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      const source = new HttpRangeSource(
        parsed.href,
        {
          id,
          sourceId: id,
          name,
          size: String(range.size),
          revision: `${range.size}:${etag ?? modified}`,
          format: name.split(".").pop()?.toLowerCase() ?? "",
        },
        etag && !etag.startsWith("W/") ? etag : null,
        modified,
      );
      source.remember("0:1", bytes);
      return source;
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
  }
  private remember(key: string, bytes: Uint8Array) {
    if (this.closed) return;
    const previous = this.cache.get(key);
    if (previous) {
      this.cacheBytes -= previous.length;
      this.cache.delete(key);
    }
    while (this.cacheBytes + bytes.length > CACHE_LIMIT && this.cache.size) {
      const oldest = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(oldest)!.length;
      this.cache.delete(oldest);
    }
    this.cache.set(key, bytes);
    this.cacheBytes += bytes.length;
  }
  private async chunk(offset: number, length: number, signal?: AbortSignal) {
    const key = `${offset}:${length}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const headers: Record<string, string> = {
      Range: `bytes=${offset}-${offset + length - 1}`,
    };
    if (this.etag || this.modified)
      headers["If-Range"] = this.etag ?? this.modified!;
    const response = await fetch(this.url, {
      headers,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.any([
        this.controller.signal,
        ...(signal ? [signal] : []),
        AbortSignal.timeout(20000),
      ]),
    });
    try {
      if (response.status !== 206)
        throw new Error(
          `RANGE_NOT_SUPPORTED_OR_CHANGED：服务器返回 ${response.status}，本次范围读取已停止`,
        );
      const range = rangeHeader(response.headers.get("content-range"));
      if (
        range.start !== offset ||
        range.end !== offset + length - 1 ||
        String(range.size) !== this.info.size
      )
        throw new Error("INVALID_CONTENT_RANGE：响应区间不匹配");
      if (
        (this.etag && response.headers.get("etag") !== this.etag) ||
        (!this.etag &&
          this.modified &&
          response.headers.get("last-modified") !== this.modified)
      )
        throw new Error("SOURCE_CHANGED：云端文件已更新，请重新打开");
      if (
        response.headers.get("content-encoding") &&
        response.headers.get("content-encoding") !== "identity"
      )
        throw new Error("范围响应被压缩");
      const bytes = await boundedBody(response, length);
      this.remember(key, bytes);
      return bytes;
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
  }
  async readAt(offset: number, length: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("书籍已关闭");
    const size = Number(this.info.size);
    if (
      ![offset, length].every(Number.isSafeInteger) ||
      offset < 0 ||
      length < 0 ||
      offset > size ||
      length > 64 * 1024 * 1024
    )
      throw new Error("读取范围无效");
    const available = Math.min(length, size - offset);
    const result = new Uint8Array(available);
    for (let cursor = 0; cursor < available; cursor += CHUNK) {
      signal?.throwIfAborted();
      const count = Math.min(CHUNK, available - cursor);
      result.set(await this.chunk(offset + cursor, count, signal), cursor);
    }
    signal?.throwIfAborted();
    return result;
  }
  async close() {
    this.closed = true;
    this.controller.abort();
    this.cache.clear();
    this.cacheBytes = 0;
  }
}
