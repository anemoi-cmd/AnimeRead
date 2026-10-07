import type { TextEncoding } from "../reader-types";

export function decodeText(
  bytes: Uint8Array,
  requested: TextEncoding = "auto",
): { text: string; encoding: string } {
  let encoding: string = requested;
  if (requested === "auto") {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    else {
      try {
        return {
          text: new TextDecoder("utf-8", { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, ""),
          encoding: "utf-8",
        };
      } catch {
        encoding = "gb18030";
      }
    }
  }
  const text = new TextDecoder(encoding, { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  return { text, encoding };
}

export interface TextChapter {
  title: string;
  text: string;
  offset: number;
}
const CHAPTER =
  /^\s*(?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇].{0,80}|chapter\s+[\dIVXLC]+.{0,80}|(?:序章|序言|楔子|尾声|后记)(?:\s.{0,70})?)\s*$/i;
export function splitChapters(text: string): TextChapter[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const result: TextChapter[] = [];
  let title = "正文",
    body: string[] = [],
    offset = 0,
    start = 0,
    bodyLength = 0;
  const flush = () => {
    const content = body.join("\n").trim();
    if (content) result.push({ title, text: content, offset: start });
    body = [];
    bodyLength = 0;
  };
  for (const line of lines) {
    if (CHAPTER.test(line)) {
      flush();
      title = line.trim();
      start = offset;
    }
    body.push(line);
    bodyLength += line.length + 1;
    offset += line.length + 1;
    if (bodyLength > 60000 && line.trim() === "") {
      flush();
      title = `${title.replace(/（续）$/, "")}（续）`;
      start = offset;
    }
  }
  flush();
  return result.length ? result : [{ title: "正文", text: "", offset: 0 }];
}
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function chapterHtml(chapter: TextChapter) {
  const paragraphs = chapter.text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data: blob:; img-src data: blob:; script-src 'none'; base-uri 'none'"></head><body>${paragraphs.map((text, index) => (index === 0 && text === chapter.title ? `<h1>${escapeHtml(text)}</h1>` : `<p>${escapeHtml(text)}</p>`)).join("")}</body></html>`;
}
