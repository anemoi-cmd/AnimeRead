import type { TurnGesture } from "./reader/reading-input";
export type Format = "txt" | "epub" | "pdf" | "cbz" | "zip" | "image";
export type Theme = "light" | "dark" | "paper" | "ink" | "wood";
export type ReadingDirection = "ltr" | "rtl" | "ttb";
export type BookCategory = "novel" | "comic";
export type FilterMode = "A" | "B" | "C";
export type PageMotion = "instant" | "slide" | "curl";
export type TextEncoding =
  "auto" | "utf-8" | "gb18030" | "utf-16le" | "utf-16be";

export interface SourceInfo {
  id: string;
  sourceId: string;
  name: string;
  size: string;
  revision: string;
  format: string;
  category?: BookCategory;
  aliases?: string[];
}
export interface ShelfBook extends Omit<SourceInfo, "sourceId"> {
  available?: boolean;
}
export interface LocalBook extends ShelfBook {
  path: string;
}
export interface ByteSource {
  readonly info: SourceInfo;
  readAt(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface ReaderStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  margin: number;
  bold: boolean;
  italic: boolean;
  theme: Theme;
  direction: ReadingDirection;
  motion: PageMotion;
  turnDuration: number;
  pageTurnSound: boolean;
  compare: boolean;
  encoding: TextEncoding;
  zoom: number;
  comicLayout: "single" | "double";
  enhanceEnabled: boolean;
  enhanceBackend: "anime4k" | "waifu2x";
  filters: FilterMode[];
}
export type ReaderLocation =
  | {
      kind: "reflow";
      cfi: string;
      section: number;
      quote: string;
      progress: number;
    }
  | { kind: "fixed"; page: number; progress: number };
export interface TocItem {
  label: string;
  href: string | number;
  subitems?: TocItem[];
}
export interface ReaderSnapshot {
  title: string;
  author: string;
  format: Format;
  category: BookCategory;
  toc: TocItem[];
  location?: ReaderLocation;
  page?: number;
  pages?: number;
  chapter: string;
  reflow: boolean;
  encoding?: string;
  enhancing?: boolean;
  enhancement?: {
    scale: number;
    milliseconds: number;
    filters: string;
    device?: string;
  };
}
export interface ReaderEngine {
  readonly source: ByteSource;
  open(host: HTMLElement, saved?: ReaderLocation): Promise<void>;
  next(gesture?: TurnGesture): Promise<void>;
  previous(gesture?: TurnGesture): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToProgress(progress: number): Promise<void>;
  setStyle(style: ReaderStyle): Promise<void>;
  cancelPending?(): Promise<void>;
  dispose(): Promise<void>;
}
export const DEFAULT_STYLE: ReaderStyle = {
  fontFamily: "Microsoft YaHei",
  fontSize: 22,
  lineHeight: 1.85,
  margin: 48,
  bold: false,
  italic: false,
  theme: "paper",
  direction: "ltr",
  motion: "slide",
  turnDuration: 400,
  pageTurnSound: true,
  compare: false,
  encoding: "auto",
  zoom:
    typeof window === "undefined"
      ? 1
      : Math.max(0.5, Math.min(3, window.devicePixelRatio || 1)),
  enhanceEnabled: false,
  comicLayout: "single",
  enhanceBackend: "anime4k",
  filters: ["A"],
};
export const THEME_COLORS: Record<
  Theme,
  { background: string; foreground: string; muted: string }
> = {
  light: { background: "#fafafa", foreground: "#252824", muted: "#70776d" },
  dark: { background: "#171b1c", foreground: "#ced6cd", muted: "#8f9a8b" },
  paper: { background: "#eee4cf", foreground: "#493f31", muted: "#85745d" },
  ink: { background: "#dfdfd9", foreground: "#272a26", muted: "#6b6f65" },
  wood: { background: "#dfc6a1", foreground: "#49392c", muted: "#806a52" },
};

/** 旧版本没有动画时长；损坏或越界设置恢复到可用范围。 */
export function pageTurnDuration(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration)
    ? Math.max(150, Math.min(1500, duration))
    : DEFAULT_STYLE.turnDuration;
}
