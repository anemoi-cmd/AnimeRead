import { useEffect, useRef, useState } from "react";
import type { ByteSource, ShelfBook as CoverBook } from "./reader-types";
import { readWhole } from "./file-sources";
import { BookArchive } from "./reader/book-archive";
import { epubCover } from "./reader/epub-inspection";
import { IMAGE_EXTENSION, openSourcePdf } from "./reader/comic-pdf-reader";
import {
  coverKey,
  readMedia,
  writeMedia,
  thumbnail,
} from "./cover-wallpaper-store";

const inFlight = new Map<string, Promise<Blob | undefined>>();
async function extractCover(source: ByteSource) {
  const header = await source.readAt(0, 4);
  if (header[0] === 0x25 && header[1] === 0x50) {
    const task = await openSourcePdf(source, () => void task.destroy());
    task.onPassword = () => void task.destroy();
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(360 / base.width, 520 / base.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext("2d")!;
      await page.render({ canvas, canvasContext, viewport }).promise;
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.86),
      );
    } finally {
      await task.destroy();
    }
  }
  if (header[0] === 0x50 && header[1] === 0x4b) {
    const archive = await new BookArchive(source).init();
    try {
      if (archive.names().includes("META-INF/container.xml"))
        return await epubCover(archive);
      const first = archive
        .names()
        .filter(
          (name) => IMAGE_EXTENSION.test(name) && !name.startsWith("__MACOSX/"),
        )
        .sort(new Intl.Collator("zh-CN", { numeric: true }).compare)[0];
      return first ? await archive.loadBlob(first) : undefined;
    } finally {
      await archive.close();
    }
  }
  if (IMAGE_EXTENSION.test(source.info.name))
    return new Blob([
      new Uint8Array(await readWhole(source, 64 * 1024 * 1024)).buffer,
    ]);
}
async function cover(
  book: CoverBook,
  open: (book: CoverBook) => Promise<ByteSource>,
) {
  const key = coverKey(book.id, book.revision);
  const cached = await readMedia(key);
  if (cached) return cached;
  if (book.available === false || book.format === "txt") return;
  let request = inFlight.get(key);
  if (!request) {
    request = (async () => {
      const source = await open(book);
      try {
        const original = await extractCover(source);
        if (!original) return;
        const blob = await thumbnail(original, 360, 520);
        await writeMedia(key, blob);
        return blob;
      } finally {
        await source.close();
      }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, request);
  }
  return request;
}
export function useBookCovers(
  books: CoverBook[],
  open: (book: CoverBook) => Promise<ByteSource>,
) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const owned = useRef(new Map<string, { key: string; url: string }>());
  const signature = books
    .map((book) => `${book.id}:${book.revision}`)
    .join("\0");
  useEffect(() => {
    let alive = true;
    for (const [id, value] of owned.current)
      if (
        !books.some(
          (book) => book.id === id && coverKey(id, book.revision) === value.key,
        )
      ) {
        URL.revokeObjectURL(value.url);
        owned.current.delete(id);
      }
    setUrls(
      Object.fromEntries(
        [...owned.current].map(([id, value]) => [id, value.url]),
      ),
    );
    // A single source at a time bounds PDF worker and archive memory on a large shelf.
    void (async () => {
      for (const book of books) {
        if (!alive) return;
        if (owned.current.has(book.id)) continue;
        try {
          const blob = await cover(book, open);
          if (!alive) return;
          if (blob) {
            const url = URL.createObjectURL(blob);
            owned.current.set(book.id, {
              key: coverKey(book.id, book.revision),
              url,
            });
            setUrls((current) => ({ ...current, [book.id]: url }));
          }
        } catch (error) {
          console.warn("cover", book.name, error);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [signature, open]);
  useEffect(
    () => () => {
      for (const value of owned.current.values())
        URL.revokeObjectURL(value.url);
      owned.current.clear();
    },
    [],
  );
  return urls;
}
