import type { BookCategory } from "../reader-types";
import { BookArchive } from "./book-archive";

export interface ComicEpub {
  title: string;
  author: string;
  pages: { path: string; label: string }[];
}
function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("EPUB 元信息无法解析");
  return doc;
}
function elements(doc: Document, name: string) {
  return Array.from(doc.getElementsByTagNameNS("*", name));
}
function resolvePath(base: string, path: string) {
  if (/^(?:[a-z]+:|\/\/)/i.test(path))
    throw new Error("EPUB 页面不能引用远程图片");
  const url = new URL(path, `https://book.invalid/${base}`);
  if (url.origin !== "https://book.invalid")
    throw new Error("EPUB 资源地址无效");
  return decodeURIComponent(url.pathname.slice(1));
}

/** Read the package and spine, never infer comic page order from archive names. */
async function packageInfo(archive: BookArchive) {
  const container = xml(
    (await archive.loadText("META-INF/container.xml")) ?? "",
  );
  const packagePath = elements(container, "rootfile")[0]?.getAttribute(
    "full-path",
  );
  if (!packagePath) throw new Error("EPUB 缺少 package");
  const packageDoc = xml((await archive.loadText(packagePath)) ?? "");
  return { packageDoc, packagePath };
}
export async function epubCover(archive: BookArchive) {
  const { packageDoc, packagePath } = await packageInfo(archive);
  const items = elements(packageDoc, "item");
  const coverId = elements(packageDoc, "meta")
    .find((meta) => meta.getAttribute("name") === "cover")
    ?.getAttribute("content");
  const item =
    items.find((item) =>
      item.getAttribute("properties")?.split(/\s+/).includes("cover-image"),
    ) ?? items.find((item) => item.getAttribute("id") === coverId);
  let path = item?.getAttribute("href")
    ? resolvePath(packagePath, item.getAttribute("href")!)
    : undefined;
  if (!path) {
    const guide = elements(packageDoc, "reference")
      .find((item) => item.getAttribute("type") === "cover")
      ?.getAttribute("href");
    if (guide)
      path = await readImagePage(archive, resolvePath(packagePath, guide));
  }
  if (!path) {
    const firstId = elements(packageDoc, "itemref")[0]?.getAttribute("idref");
    const first = items
      .find((item) => item.getAttribute("id") === firstId)
      ?.getAttribute("href");
    if (first)
      path = await readImagePage(archive, resolvePath(packagePath, first));
  }
  if (path && !/\.(?:png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(path))
    path = await readImagePage(archive, path);
  return path
    ? archive.loadBlob(
        path,
        path.endsWith(".svg") ? "image/svg+xml" : undefined,
      )
    : undefined;
}

export async function inspectEpub(
  archive: BookArchive,
): Promise<{ category: BookCategory; comic?: ComicEpub }> {
  const { packageDoc, packagePath } = await packageInfo(archive);
  const metas = elements(packageDoc, "meta");
  const declaredComic = metas.some(
    (meta) =>
      meta.getAttribute("name") === "book-type" &&
      /comic|manga/i.test(meta.getAttribute("content") ?? ""),
  );
  const manifest = new Map(
    elements(packageDoc, "item").map((item) => [
      item.getAttribute("id"),
      resolvePath(packagePath, item.getAttribute("href") ?? ""),
    ]),
  );
  const spine = elements(packageDoc, "itemref")
    .filter((item) => item.getAttribute("linear") !== "no")
    .map((item) => manifest.get(item.getAttribute("idref")))
    .filter((path): path is string => !!path);
  if (!spine.length) throw new Error("EPUB 没有可读章节");
  const sample = await Promise.all(
    spine
      .slice(0, Math.min(6, spine.length))
      .map((path) => readImagePage(archive, path)),
  );
  const imageOnly = sample.every((page) => page !== undefined);
  if (!declaredComic && !imageOnly) return { category: "novel" };
  const pages: ComicEpub["pages"] = [];
  for (let index = 0; index < spine.length; index++) {
    const page =
      index < sample.length
        ? sample[index]
        : await readImagePage(archive, spine[index]);
    // Mixed-layout comics must keep their original EPUB layout.
    if (!page) return { category: "comic" };
    pages.push({ path: page, label: `第 ${index + 1} 页` });
  }
  return {
    category: "comic",
    comic: {
      title: elements(packageDoc, "title")[0]?.textContent?.trim() ?? "",
      author: elements(packageDoc, "creator")[0]?.textContent?.trim() ?? "",
      pages,
    },
  };
}
async function readImagePage(
  archive: BookArchive,
  path: string,
): Promise<string | undefined> {
  if (/\.(?:png|jpe?g|webp|avif|gif|bmp)$/i.test(path)) return path;
  const markup = await archive.loadText(path);
  if (!markup) return;
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const bodyText = doc.body.textContent?.replace(/\s/g, "") ?? "";
  const images = Array.from(doc.querySelectorAll("img, svg image"));
  if (images.length !== 1 || bodyText.length > 120) return;
  const image = images[0];
  const src =
    image.getAttribute("src") ??
    image.getAttribute("href") ??
    image.getAttribute("xlink:href");
  if (!src) return;
  const resolved = resolvePath(path, src);
  return archive.names().includes(resolved) ? resolved : undefined;
}
