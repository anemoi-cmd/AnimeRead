/** 阅读入口：先用文件签名确认 PDF／ZIP，再检查 EPUB 正文结构。
 * 小说与漫画共用 ByteSource、样式、输入和状态回调；只在可重排正文
 * 与固定图片／PDF 的排版机制不同处选择对应引擎。失败时释放已开的档案。
 */
import type {
  ByteSource,
  ReaderEngine,
  ReaderSnapshot,
  ReaderStyle,
} from "../reader-types";
import { BookArchive } from "./book-archive";
import { NovelReader } from "./novel-reader";
import { ComicPdfReader, IMAGE_EXTENSION } from "./comic-pdf-reader";
import type { ReadingMove } from "./reading-input";
import { inspectEpub } from "./epub-inspection";

export async function createEngine(
  source: ByteSource,
  style: ReaderStyle,
  update: (snapshot: ReaderSnapshot) => void,
  move: ReadingMove,
  enabled: () => boolean,
  fail: (error: unknown) => void,
): Promise<ReaderEngine> {
  const extension = source.info.format.toLowerCase();
  const signature = await source.readAt(
    0,
    Math.min(1024, Number(source.info.size)),
  );
  if (new TextDecoder("latin1").decode(signature).includes("%PDF-"))
    return new ComicPdfReader(
      source,
      style,
      update,
      move,
      enabled,
      "pdf",
      fail,
    );
  if (extension === "txt")
    return new NovelReader(source, style, update, move, enabled, "txt");
  if (signature[0] === 0x50 && signature[1] === 0x4b) {
    const archive = await new BookArchive(source).init();
    const epub = archive.names().includes("META-INF/container.xml");
    try {
      if (epub) {
        const inspection = await inspectEpub(archive);
        if (inspection.comic)
          return new ComicPdfReader(
            source,
            style,
            update,
            move,
            enabled,
            "epub",
            fail,
            { archive, comic: inspection.comic },
          );
        await archive.close();
        return new NovelReader(
          source,
          style,
          update,
          move,
          enabled,
          "epub",
          inspection.category,
        );
      }
      return new ComicPdfReader(
        source,
        style,
        update,
        move,
        enabled,
        extension === "cbz" ? "cbz" : "zip",
        fail,
        { archive },
      );
    } catch (error) {
      await archive.close();
      throw error;
    }
  }
  if (IMAGE_EXTENSION.test(source.info.name))
    return new ComicPdfReader(
      source,
      style,
      update,
      move,
      enabled,
      "image",
      fail,
    );
  throw new Error(`文件内容与格式不匹配，或格式暂未支持：${source.info.name}`);
}
