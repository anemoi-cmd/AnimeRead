import { test, expect } from "vitest";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { HttpRangeSource } from "../../src/sources/http-range";
import { BookArchive } from "../../src/reader/book-archive";
import { verificationDirectory } from "../../scripts/tool-paths.mjs";

test("S4 actual CBZ HTTP random access and protocol failures", async () => {
  // A one-pixel protocol probe; no bundled example work or user page is copied.
  const image = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/Z0AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("page-1.png", new Uint8ArrayReader(image));
  await writer.add(
    "padding.bin",
    new Uint8ArrayReader(new Uint8Array(16 * 1024 * 1024)),
    { level: 0 },
  );
  await writer.add("page-20.png", new Uint8ArrayReader(image));
  const bytes = new Uint8Array(await writer.close());
  const requests: {
    path: string;
    range: string;
    status: number;
    bytes: number;
  }[] = [];
  let revision = '"v1"';
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const range = request.headers.range ?? "";
    response.setHeader("etag", revision);
    if (path === "/ignore") {
      requests.push({ path, range, status: 200, bytes: bytes.length });
      response.writeHead(200, { "content-length": bytes.length });
      response.end(bytes);
      return;
    }
    const match = range.match(/^bytes=(\d+)-(\d+)$/);
    if (!match) {
      response.writeHead(400);
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const content = bytes.slice(start, end + 1);
    const wrong = path === "/wrong";
    response.writeHead(206, {
      "content-range": `bytes ${wrong ? start + 1 : start}-${end}/${bytes.length}`,
      "content-length": content.length,
    });
    requests.push({ path, range, status: 206, bytes: content.length });
    response.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const source = await HttpRangeSource.open(`${base}/book`, "range.cbz");
  const archive = await new BookArchive(source).init();
  try {
    expect(
      archive.names().filter((name) => name.endsWith(".png")),
    ).toHaveLength(2);
    expect(await archive.read("page-1.png")).toEqual(image);
    const before = requests.length;
    expect(await archive.read("page-20.png")).toEqual(image);
    const transferred = requests
      .filter((request) => request.path === "/book")
      .reduce((sum, request) => sum + request.bytes, 0);
    expect(transferred).toBeLessThan(bytes.length / 20);
    expect(
      requests
        .slice(before)
        .some(
          (request) =>
            Number(request.range.match(/\d+/)![0]) > bytes.length * 0.9,
        ),
    ).toBe(true);
    const cached = requests.length;
    await archive.read("page-20.png");
    expect(requests.length).toBe(cached);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        source.readAt(4 * 1024 * 1024, 1024 * 1024),
      ),
    );
    for (const megabyte of [5, 6, 7])
      await source.readAt(megabyte * 1024 * 1024, 1024 * 1024);
    const beforeReuse = requests.length;
    await source.readAt(4 * 1024 * 1024, 1024 * 1024);
    expect(requests.length).toBe(beforeReuse);
    await expect(
      HttpRangeSource.open(`${base}/ignore`, "range.cbz"),
    ).rejects.toThrow("RANGE_NOT_SUPPORTED");
    await expect(
      HttpRangeSource.open(`${base}/wrong`, "range.cbz"),
    ).rejects.toThrow("INVALID_CONTENT_RANGE");
    revision = '"v2"';
    await expect(source.readAt(1000000, 64)).rejects.toThrow("SOURCE_CHANGED");
    const controller = new AbortController();
    controller.abort();
    await expect(source.readAt(0, 1, controller.signal)).rejects.toThrow();
    await source.close();
    await expect(source.readAt(0, 1)).rejects.toThrow("已关闭");
    await mkdir(verificationDirectory, { recursive: true });
    await writeFile(
      resolve(verificationDirectory, "range-results.json"),
      JSON.stringify(
        {
          passed: true,
          size: bytes.length,
          transferredBeforeFailures: transferred,
          ratio: transferred / bytes.length,
          requests,
          verified: [
            "CBZ central directory",
            "first and distant image",
            "cache hit",
            "12 concurrent identical reads do not inflate the 8 MiB cache accounting",
            "HTTP 200 refusal",
            "bad Content-Range refusal",
            "source revision refusal",
            "cancellation",
            "close",
          ],
          scope:
            "Controlled loopback HTTP; account providers and real cloud disks not yet tested",
        },
        null,
        2,
      ),
    );
  } finally {
    await archive.close();
    await source.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30000);
