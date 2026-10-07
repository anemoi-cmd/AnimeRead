import { version } from "../package.json";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BookOpen,
  Library,
  Plus,
  ArrowLeft,
  ArrowRight,
  List,
  SlidersHorizontal,
  Bookmark,
  Maximize,
  X,
  Trash2,
  Search,
  FileText,
  Check,
  Info,
  Palette,
  Download,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ByteSource,
  ReaderEngine,
  ReaderSnapshot,
  ReaderStyle,
  TocItem,
  ShelfBook,
} from "./reader-types";
import { THEME_COLORS } from "./reader-types";
import {
  FileByteSource,
  getStartupBooks,
  getStartupNotice,
  getSystemFonts,
  importNativePaths,
  loadNativeLibrary,
  native,
  openNativeBook,
  pickNativeBooks,
  removeNativeBook,
} from "./file-sources";
import { createEngine } from "./reader/create-reader";
import {
  isInteractive,
  keyAction,
  type NavigationAction,
} from "./reader/reading-input";
import type { TurnGesture } from "./reader/reading-input";
import {
  loadMemory,
  saveMemory,
  mergeBookMemory,
  type ReadingMemory,
} from "./reading-storage";
import { Preferences, type Ambience } from "./components/Preferences";
import { Rain } from "./components/Rain";
import { useRainSound } from "./ambience/reading-sounds";
import { LibraryShelf } from "./components/LibraryShelf";
import { Help } from "./components/Help";
import { SoftwareUpdate } from "./components/SoftwareUpdate";
import { ReaderProgress } from "./components/ReaderProgress";
import { BookMenu } from "./components/BookMenu";
import {
  getEnhancementRuntime,
  anime4kDevice,
  type EnhancementRuntime,
} from "./image-enhancement";
import {
  DEFAULT_APPEARANCE,
  appearanceColor,
  type Appearance,
} from "./appearance-settings";
import { AppearanceSettings } from "./components/AppearanceSettings";
import { GroupManager } from "./components/GroupManager";
import { useReadingTime } from "./reading-time";
import {
  readMedia,
  writeMedia,
  deleteMedia,
  thumbnail,
  validateVideo,
  coverKey,
} from "./cover-wallpaper-store";
import { VideoWallpaper } from "./components/VideoWallpaper";
import { autoGroupBooks } from "./book-groups";

const INITIAL_MEMORY = loadMemory();
function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "读取失败，请重新打开文件";
}
function readableName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}
function flattenToc(
  toc: TocItem[],
  depth = 0,
): (TocItem & { depth: number })[] {
  return toc.flatMap((item) => [
    { ...item, depth },
    ...flattenToc(item.subitems ?? [], depth + 1),
  ]);
}

export default function App() {
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [memory, setMemory] = useState<ReadingMemory>(INITIAL_MEMORY);
  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const [style, setStyle] = useState<ReaderStyle>(INITIAL_MEMORY.style);
  const styleRef = useRef(style);
  styleRef.current = style;
  const [active, setActive] = useState<ShelfBook>();
  const [snapshot, setSnapshot] = useState<ReaderSnapshot>();
  const [fonts, setFonts] = useState<string[]>([]);
  const [enhancement, setEnhancement] = useState<EnhancementRuntime>();
  const [animeDevice, setAnimeDevice] = useState<string>();
  const [immersive, setImmersive] = useState(false);
  const immersiveRef = useRef(false);
  immersiveRef.current = immersive;
  const fullscreenPending = useRef(false);
  const [contextBook, setContextBook] = useState<{
    book: ShelfBook;
    x: number;
    y: number;
  }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const [groupId, setGroupId] = useState<string>();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [shelfMode, setShelfMode] = useState("all");
  const [ambience, setAmbience] = useState<Ambience>({
    rain: false,
    sound: false,
    strength: 0.5,
    volume: 0.25,
  });
  const files = useRef(new Map<string, File>());
  const engine = useRef<ReaderEngine | undefined>(undefined);
  const opening = useRef(0);
  const ready = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());
  const lifecycle = useRef(Promise.resolve());
  const pendingSeek = useRef<number | undefined>(undefined);
  const seeking = useRef(false);
  const queuedCount = useRef(0);
  const appliedStyle = useRef<ReaderStyle | undefined>(undefined);
  const enabled = useRef(false);
  enabled.current =
    !!active &&
    !loading &&
    !help &&
    !appearanceOpen &&
    !groupsOpen &&
    !updatesOpen;
  const fail = useCallback((error: unknown) => {
    if ((error as Error)?.name !== "AbortError" && error !== "增强任务已取消")
      setError(messageOf(error));
  }, []);
  useRainSound(ambience.sound, ambience.volume, fail);
  const appearance = memory.appearance ?? DEFAULT_APPEARANCE;
  const sourceFor = useCallback(async (book: ShelfBook) => {
    const file = files.current.get(book.id);
    return file ? new FileByteSource(file) : openNativeBook(book.id);
  }, []);
  useReadingTime(
    active &&
      !loading &&
      !help &&
      !appearanceOpen &&
      !groupsOpen &&
      !updatesOpen
      ? active.id
      : undefined,
    (id, elapsed) => {
      const current = memoryRef.current;
      const next = {
        ...current,
        totalReadingMillis: (current.totalReadingMillis ?? 0) + elapsed,
        books: {
          ...current.books,
          [id]: {
            ...current.books[id],
            bookmarks: current.books[id]?.bookmarks ?? [],
            readingMillis: (current.books[id]?.readingMillis ?? 0) + elapsed,
            lastRead: Date.now(),
          },
        },
      };
      memoryRef.current = next;
      setMemory(next);
      try {
        saveMemory({ ...next, style: styleRef.current });
      } catch (error) {
        fail(error);
      }
    },
  );
  const changeAppearance = (patch: Partial<Appearance>) =>
    setMemory((current) => ({
      ...current,
      appearance: { ...(current.appearance ?? DEFAULT_APPEARANCE), ...patch },
    }));
  const background = async (file?: File) => {
    try {
      if (file) {
        const video =
          file.type.startsWith("video/") || /\.(mp4|webm)$/i.test(file.name);
        if (file.size > (video ? 200 : 32) * 1024 * 1024)
          throw new Error(
            video ? "背景视频请小于 200 MiB" : "背景图片请小于 32 MiB",
          );
        const blob = video ? file : await thumbnail(file, 2560, 1600);
        if (video) await validateVideo(blob);
        await writeMedia("background", blob);
        setBackgroundUrl(URL.createObjectURL(blob));
        changeAppearance({
          background: true,
          backgroundKind: video ? "video" : "image",
        });
      } else {
        await deleteMedia("background");
        setBackgroundUrl(undefined);
        changeAppearance({ background: false });
      }
    } catch (error) {
      fail(error);
    }
  };
  useEffect(() => {
    let alive = true;
    void readMedia("background")
      .then((blob) => {
        if (alive && blob) setBackgroundUrl(URL.createObjectURL(blob));
      })
      .catch(fail);
    return () => {
      alive = false;
    };
  }, [fail]);
  useEffect(
    () => () => {
      if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    },
    [backgroundUrl],
  );
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--theme-accent",
      appearanceColor(appearance),
    );
  }, [appearance]);
  useEffect(() => {
    const flush = () => {
      try {
        saveMemory({ ...memoryRef.current, style: styleRef.current });
      } catch {}
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const run = useCallback(
    (operation: (reader: ReaderEngine) => Promise<void>, priority = false) => {
      const target = engine.current;
      if (!target || !ready.current || (!priority && queuedCount.current >= 4))
        return false;
      queuedCount.current++;
      queue.current = queue.current
        .then(async () => {
          if (target === engine.current) await operation(target);
        })
        .catch(fail)
        .finally(() => {
          queuedCount.current--;
        });
      return true;
    },
    [fail],
  );
  const move = useCallback(
    (action: NavigationAction, gesture?: TurnGesture) => {
      if (
        fullscreenPending.current ||
        !run((reader) =>
          action === "next" ? reader.next(gesture) : reader.previous(gesture),
        )
      )
        gesture?.finish(false);
    },
    [run],
  );

  const addBooks = useCallback((imports: ShelfBook[]) => {
    const unique = [
      ...new Map(imports.map((book) => [book.id, book])).values(),
    ];
    setBooks((current) => [
      ...current.filter(
        (book) =>
          !unique.some(
            (item) => item.id === book.id || item.aliases?.includes(book.id),
          ),
      ),
      ...unique,
    ]);
    setMemory((current) => mergeBookMemory(current, unique));
  }, []);
  const fullscreen = useCallback(
    async (value: boolean) => {
      if (fullscreenPending.current) return;
      fullscreenPending.current = true;
      try {
        // 先结束当前翻页，再改变窗口。原生窗口与 React 布局不是同时
        // 更新的；切换期间暂停新翻页，避免把两个视口的快照混在一起。
        await queue.current;
        setSettings(false);
        setTocOpen(false);
        setBookmarksOpen(false);
        setImmersive(value);
        if (native) await getCurrentWindow().setFullscreen(value);
        else if (value) await document.documentElement.requestFullscreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        run((reader) => reader.resize(), true);
        await queue.current;
        surface.current?.focus({ preventScroll: true });
      } catch (error) {
        setImmersive(false);
        fail(error);
      } finally {
        fullscreenPending.current = false;
      }
    },
    [fail, run],
  );
  const open = useCallback(
    async (book: ShelfBook) => {
      const sequence = ++opening.current;
      ready.current = false;
      pendingSeek.current = undefined;
      seeking.current = false;
      setLoading(true);
      const task = lifecycle.current
        .catch(() => {})
        .then(async () => {
          if (sequence !== opening.current) return;
          appliedStyle.current = undefined;
          setError("");
          setNotice("");
          setSettings(false);
          setBookmarksOpen(false);
          const previous = engine.current;
          engine.current = undefined;
          try {
            await previous?.cancelPending?.();
            await queue.current;
            await previous?.dispose();
          } catch (error) {
            console.warn("reader cleanup", error);
          }
          if (sequence !== opening.current) return;
          setActive(book);
          setSnapshot(undefined);
          let source: ByteSource | undefined;
          let reader: ReaderEngine | undefined;
          let latest: ReaderSnapshot | undefined;
          try {
            const file = files.current.get(book.id);
            source = file
              ? new FileByteSource(file)
              : await openNativeBook(book.id);
            if (sequence !== opening.current) {
              await source.close();
              return;
            }
            const saved = memoryRef.current.books[book.id];
            const savedMatches =
              !saved?.revision ||
              saved.revision === source.info.revision ||
              (!saved.revision.startsWith("sha256:") &&
                source.info.revision.startsWith("sha256:"));
            if (!savedMatches) setNotice("原文件已更新，本次从开头阅读。");
            const update = (value: ReaderSnapshot) => {
              if (sequence !== opening.current) return;
              latest = value;
              setSnapshot(value);
              // Fixed non-comic pages do not have a continuous text layout.
              if (
                value.category !== "comic" &&
                !value.reflow &&
                styleRef.current.direction === "ttb"
              ) {
                const horizontal = {
                  ...styleRef.current,
                  direction: "ltr" as const,
                };
                styleRef.current = horizontal;
                setStyle(horizontal);
              }
              setBooks((current) =>
                current.find((item) => item.id === book.id)?.category ===
                value.category
                  ? current
                  : current.map((item) =>
                      item.id === book.id
                        ? { ...item, category: value.category }
                        : item,
                    ),
              );
              if (ready.current && value.location)
                setMemory((current) => ({
                  ...current,
                  books: {
                    ...current.books,
                    [book.id]: {
                      ...current.books[book.id],
                      title: value.title,
                      author: value.author,
                      revision: source!.info.revision,
                      location: value.location,
                      lastRead: Date.now(),
                      bookmarks: (current.books[book.id]?.bookmarks ?? []).map(
                        (item) =>
                          item.location.kind === "reflow" &&
                          value.category === "comic" &&
                          value.pages
                            ? {
                                ...item,
                                location: {
                                  kind: "fixed",
                                  page: Math.min(
                                    value.pages - 1,
                                    item.location.section,
                                  ),
                                  progress:
                                    Math.min(
                                      value.pages - 1,
                                      item.location.section,
                                    ) / Math.max(1, value.pages - 1),
                                },
                              }
                            : item,
                      ),
                    },
                  },
                }));
            };
            reader = await createEngine(
              source,
              styleRef.current,
              update,
              move,
              () => enabled.current && !fullscreenPending.current,
              fail,
            );
            if (sequence !== opening.current) {
              await reader.dispose();
              return;
            }
            engine.current = reader;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            if (!surface.current) throw new Error("阅读界面尚未准备好");
            await reader.open(
              surface.current,
              savedMatches ? saved?.location : undefined,
            );
            if (appliedStyle.current !== styleRef.current) {
              await reader.setStyle(styleRef.current);
              appliedStyle.current = styleRef.current;
            }
            if (sequence !== opening.current) {
              await reader.dispose();
              return;
            }
            ready.current = true;
            if (latest) update(latest);
            surface.current.focus({ preventScroll: true });
          } catch (error) {
            if (sequence === opening.current) {
              fail(error);
              ready.current = false;
              engine.current = undefined;
            }
            try {
              if (reader) await reader.dispose();
              else await source?.close();
            } catch {}
          } finally {
            if (sequence === opening.current) setLoading(false);
          }
        });
      lifecycle.current = task;
      await task;
    },
    [fail, move],
  );

  const importFiles = useCallback(
    async (list: File[]) => {
      const imports = list.map((file) => {
        const source = new FileByteSource(file);
        files.current.set(source.info.id, file);
        return source.info;
      });
      addBooks(imports);
      if (imports[0]) await open(imports[0]);
    },
    [addBooks, open],
  );
  const importBooks = useCallback(async () => {
    setError("");
    if (!native) {
      fileInput.current?.click();
      return;
    }
    try {
      const imports = await pickNativeBooks();
      addBooks(imports);
      if (imports[0]) await open(imports[0]);
    } catch (error) {
      fail(error);
    }
  }, [addBooks, open, fail]);
  const back = useCallback(async () => {
    const sequence = ++opening.current;
    ready.current = false;
    pendingSeek.current = undefined;
    seeking.current = false;
    setLoading(true);
    const task = lifecycle.current
      .catch(() => {})
      .then(async () => {
        if (sequence !== opening.current) return;
        if (immersiveRef.current) await fullscreen(false);
        const previous = engine.current;
        engine.current = undefined;
        setSettings(false);
        setError("");
        try {
          await previous?.cancelPending?.();
          await queue.current;
          await previous?.dispose();
        } catch (error) {
          fail(error);
        } finally {
          if (sequence === opening.current) {
            setActive(undefined);
            setSnapshot(undefined);
            setLoading(false);
          }
        }
      });
    lifecycle.current = task;
    await task;
  }, [fail, fullscreen]);

  const removeBook = useCallback(
    async (book: ShelfBook) => {
      try {
        if (native && !files.current.has(book.id))
          await removeNativeBook(book.id);
        if (active?.id === book.id) await back();
        setBooks((current) => current.filter((item) => item.id !== book.id));
        files.current.delete(book.id);
        void deleteMedia(coverKey(book.id, book.revision)).catch(() => {});
        setMemory((current) => {
          const copy = { ...current.books };
          for (const id of [book.id, ...(book.aliases ?? [])]) delete copy[id];
          return {
            ...current,
            books: copy,
            groups: current.groups?.map((group) => ({
              ...group,
              bookIds: group.bookIds.filter(
                (id) => id !== book.id && !book.aliases?.includes(id),
              ),
            })),
          };
        });
        setContextBook(undefined);
      } catch (error) {
        fail(error);
      }
    },
    [active, back, fail],
  );

  useEffect(() => {
    let mounted = true;
    void getSystemFonts()
      .then((value) => {
        if (mounted) setFonts(value);
      })
      .catch(fail);
    void Promise.all([
      anime4kDevice(),
      native ? getEnhancementRuntime().catch(() => undefined) : undefined,
    ]).then(([device, runtime]) => {
      if (!mounted) return;
      setAnimeDevice(device);
      setEnhancement(runtime);
      const current = styleRef.current;
      const available =
        current.enhanceBackend === "anime4k" ? !!device : !!runtime?.available;
      if (!available) {
        const next = {
          ...current,
          enhanceEnabled:
            current.enhanceEnabled && !!(device || runtime?.available),
          enhanceBackend: device
            ? ("anime4k" as const)
            : runtime?.available
              ? ("waifu2x" as const)
              : current.enhanceBackend,
        };
        styleRef.current = next;
        setStyle(next);
      }
    });
    if (native)
      void loadNativeLibrary()
        .then(async (value) => {
          if (!mounted) return;
          setBooks(value);
          setMemory((current) => mergeBookMemory(current, value));
          const [initial, notice] = await Promise.all([
            getStartupBooks(),
            getStartupNotice(),
          ]);
          if (notice && mounted) setError(notice);
          const book = value.find((book) => book.id === initial[0]);
          if (book && mounted) await open(book);
        })
        .catch(fail);
    let unlisten: (() => void) | undefined;
    if (native)
      void getCurrentWindow()
        .onDragDropEvent(async (event) => {
          if (event.payload.type !== "drop") return;
          try {
            const imports = await importNativePaths(event.payload.paths);
            addBooks(imports);
            if (imports[0]) await open(imports[0]);
          } catch (error) {
            fail(error);
          }
        })
        .then((value) => {
          if (mounted) unlisten = value;
          else value();
        });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [open, addBooks, fail]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        saveMemory({ ...memory, style });
      } catch (error) {
        fail(error);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [memory, style, fail]);
  useEffect(() => {
    document.documentElement.dataset.theme = style.theme;
    if (!ready.current || !engine.current) return;
    if (
      snapshot?.format === "txt" &&
      snapshot.encoding &&
      style.encoding !== "auto" &&
      snapshot.encoding !== style.encoding &&
      active
    ) {
      void open(active);
      return;
    }
    const target = engine.current;
    queue.current = queue.current
      .then(async () => {
        if (
          !target ||
          target !== engine.current ||
          appliedStyle.current === styleRef.current
        )
          return;
        const desired = styleRef.current;
        await target.setStyle(desired);
        appliedStyle.current = desired;
      })
      .catch(fail);
  }, [style]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (updatesOpen) return;
      if (event.ctrlKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void importBooks();
        return;
      }
      if (event.ctrlKey && event.key === "," && active) {
        event.preventDefault();
        setSettings((current) => !current);
        return;
      }
      if (event.key === "Escape" && immersiveRef.current) {
        event.preventDefault();
        void fullscreen(false);
        return;
      }
      if (event.key === "F11" && active) {
        event.preventDefault();
        void fullscreen(!immersiveRef.current);
        return;
      }
      if (event.key === "Escape") {
        if (help) setHelp(false);
        else if (appearanceOpen) setAppearanceOpen(false);
        else if (groupsOpen) setGroupsOpen(false);
        else if (settings) setSettings(false);
        else if (active) void back();
        return;
      }
      if (!enabled.current || isInteractive(event.target)) return;
      const action = keyAction(event);
      if (action) {
        event.preventDefault();
        move(action);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [
    move,
    importBooks,
    active,
    back,
    settings,
    help,
    updatesOpen,
    appearanceOpen,
    groupsOpen,
    fullscreen,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const changeStyle = (patch: Partial<ReaderStyle>) => {
    if (
      "enhanceEnabled" in patch ||
      "filters" in patch ||
      "enhanceBackend" in patch
    ) {
      setError("");
      void engine.current?.cancelPending?.().catch(fail);
    }
    setStyle((current) => ({ ...current, ...patch }));
  };
  const bookmark = () => {
    if (!active || !snapshot?.location) return;
    const location = snapshot.location;
    setMemory((current) => ({
      ...current,
      books: {
        ...current.books,
        [active.id]: {
          ...current.books[active.id],
          bookmarks: [
            ...(current.books[active.id]?.bookmarks ?? []),
            {
              id: crypto.randomUUID(),
              label: snapshot.chapter,
              location,
              created: Date.now(),
            },
          ],
        },
      },
    }));
    setNotice("已添加书签");
  };
  const restoreBookmark = (index: number) => {
    if (!active) return;
    const location = memory.books[active.id]?.bookmarks[index]?.location;
    if (location)
      run((reader) =>
        reader.goTo(location.kind === "fixed" ? location.page : location.cfi),
      );
  };
  const removeBookmark = (id: string) => {
    if (!active) return;
    setMemory((current) => ({
      ...current,
      books: {
        ...current.books,
        [active.id]: {
          ...current.books[active.id],
          bookmarks: (current.books[active.id]?.bookmarks ?? []).filter(
            (item) => item.id !== id,
          ),
        },
      },
    }));
  };
  const seek = (progress: number) => {
    pendingSeek.current = progress;
    if (seeking.current || !ready.current) return;
    seeking.current = true;
    const queued = run(async (reader) => {
      try {
        while (pendingSeek.current !== undefined) {
          const value = pendingSeek.current;
          pendingSeek.current = undefined;
          await reader.goToProgress(value);
        }
      } finally {
        seeking.current = false;
      }
    }, true);
    if (!queued) seeking.current = false;
  };
  const colors = THEME_COLORS[style.theme];
  const ordered = books
    .slice()
    .sort(
      (a, b) =>
        (memory.books[b.id]?.lastRead ?? 0) -
        (memory.books[a.id]?.lastRead ?? 0),
    );
  const visible = ordered.filter(
    (book) =>
      (shelfMode === "all" ||
        (book.category ??
          (["txt", "epub", "pdf"].includes(book.format)
            ? "novel"
            : "comic")) === shelfMode) &&
      (memory.books[book.id]?.title ?? book.name)
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const recent = ordered.find((book) => memory.books[book.id]?.lastRead);
  const matchingTitles = books
    .map((book) => memory.books[book.id]?.title ?? "")
    .join("\0");
  useEffect(() => {
    setMemory((current) => {
      const groups = current.groups ?? [];
      const next = autoGroupBooks(groups, books, current.books);
      return next === groups ? current : { ...current, groups: next };
    });
  }, [books, memory.groups, matchingTitles]);
  const activeBookmarks = active
    ? (memory.books[active.id]?.bookmarks ?? [])
    : [];

  return (
    <div
      className={`app-shell ${active ? "is-reading" : ""} ${immersive ? "is-immersive" : ""} ${appearance.background && backgroundUrl ? "has-wallpaper" : ""}`}
      style={
        {
          "--wallpaper":
            backgroundUrl && appearance.backgroundKind !== "video"
              ? `url("${backgroundUrl}")`
              : "none",
          "--wallpaper-opacity": appearance.backgroundOpacity,
        } as CSSProperties
      }
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        if (!native) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!native) {
          event.preventDefault();
          void importFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      {!active &&
        appearance.background &&
        appearance.backgroundKind === "video" &&
        backgroundUrl && <VideoWallpaper src={backgroundUrl} />}
      <input
        type="file"
        ref={fileInput}
        className="file-input"
        aria-label="导入书籍文件"
        multiple
        accept=".txt,.epub,.pdf,.cbz,.zip,.png,.jpg,.jpeg,.webp,.avif,.gif,.bmp"
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <aside className="sidebar">
        <button className="brand" onClick={() => void back()}>
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <span>
            AnimeRead<small>让故事，慢慢发生</small>
          </span>
        </button>
        <div className="sidebar-label">阅读空间</div>
        <button
          className={`sidebar-item ${!active ? "active" : ""}`}
          onClick={() => {
            setGroupId(undefined);
            void back();
          }}
        >
          <Library size={18} /> 我的书架
          <span className="count-pill">{books.length}</span>
        </button>
        {active && (
          <button className="sidebar-item active">
            <BookOpen size={18} /> 正在阅读
          </button>
        )}
        <div className="sidebar-label shelf-label">书籍分类</div>
        <button
          className={`sidebar-item ${shelfMode === "novel" && !active ? "active" : ""}`}
          onClick={() => {
            void back();
            setShelfMode("novel");
            setGroupId(undefined);
          }}
        >
          <FileText size={18} /> 小说
        </button>
        <button
          className={`sidebar-item ${shelfMode === "comic" && !active ? "active" : ""}`}
          onClick={() => {
            void back();
            setShelfMode("comic");
            setGroupId(undefined);
          }}
        >
          <BookOpen size={18} /> 漫画
        </button>
        <div className="sidebar-bottom">
          <button onClick={() => setUpdatesOpen(true)} className="sidebar-item">
            <Download size={17} /> 软件更新
          </button>
          <button
            onClick={() => setAppearanceOpen(true)}
            className="sidebar-item"
          >
            <Palette size={17} /> 外观设置
          </button>
          <button onClick={() => setHelp(true)} className="sidebar-item">
            <Info size={17} /> 使用说明
          </button>
          <span className="version">AnimeRead {version}</span>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            {active ? (
              <>
                <button
                  className="icon-button"
                  aria-label="返回书架"
                  onClick={() => void back()}
                >
                  <ArrowLeft size={18} />
                </button>
                <span>正在阅读</span>
                <span className="breadcrumb-divider">/</span>
                <strong title={snapshot?.title ?? active.name}>
                  {snapshot?.title ?? readableName(active.name)}
                </strong>
              </>
            ) : (
              <>
                <span>我的书架</span>
                <span className="breadcrumb-divider">/</span>
                <strong>
                  {shelfMode === "novel"
                    ? "小说"
                    : shelfMode === "comic"
                      ? "漫画"
                      : "全部书籍"}
                </strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {active ? (
              <>
                <button
                  className={`icon-button ${tocOpen ? "pressed" : ""}`}
                  aria-label="目录"
                  onClick={() => {
                    setTocOpen(!tocOpen);
                    setBookmarksOpen(false);
                  }}
                >
                  <List size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="添加书签"
                  disabled={!snapshot?.location}
                  onClick={bookmark}
                >
                  <Bookmark size={18} />
                </button>
                <button
                  className={`icon-button ${settings ? "pressed" : ""}`}
                  aria-label="阅读设置"
                  onClick={() => setSettings(!settings)}
                >
                  <SlidersHorizontal size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="全屏"
                  onClick={() => void fullscreen(true)}
                >
                  <Maximize size={18} />
                </button>
              </>
            ) : (
              <>
                <label className="shelf-search">
                  <Search size={16} />
                  <input
                    aria-label="搜索书架"
                    placeholder="搜索书架"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  onClick={() => void importBooks()}
                >
                  <Plus size={17} /> 导入书籍
                </button>
              </>
            )}
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              aria-label="关闭错误提示"
              className="icon-button"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        {!active && (
          <LibraryShelf
            visible={visible}
            recent={recent}
            shelfMode={shelfMode}
            filter={filter}
            memory={memory}
            sourceFor={sourceFor}
            groupId={groupId}
            groupChange={setGroupId}
            manageGroups={() => setGroupsOpen(true)}
            open={open}
            importBooks={importBooks}
            modeChange={setShelfMode}
            contextMenu={(book, x, y) => setContextBook({ book, x, y })}
          />
        )}
        <section
          className={`reader-layout ${!active ? "hidden" : ""}`}
          style={{ background: colors.background, color: colors.foreground }}
        >
          {(tocOpen || bookmarksOpen) && (
            <aside className="toc-panel" data-no-page>
              <div className="toc-tabs">
                <button
                  className={tocOpen ? "selected" : ""}
                  onClick={() => {
                    setTocOpen(true);
                    setBookmarksOpen(false);
                  }}
                >
                  目录
                </button>
                <button
                  className={bookmarksOpen ? "selected" : ""}
                  onClick={() => {
                    setTocOpen(false);
                    setBookmarksOpen(true);
                  }}
                >
                  书签 ({activeBookmarks.length})
                </button>
              </div>
              <div className="toc-list">
                {tocOpen
                  ? flattenToc(snapshot?.toc ?? []).map((item, index) => (
                      <button
                        key={`${item.href}-${index}`}
                        style={{ paddingLeft: 14 + item.depth * 12 }}
                        onClick={() => run((reader) => reader.goTo(item.href))}
                      >
                        {item.label}
                      </button>
                    ))
                  : activeBookmarks.map((item, index) => (
                      <div className="bookmark-row" key={item.id}>
                        <button onClick={() => restoreBookmark(index)}>
                          <Bookmark size={14} />
                          {item.label}
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`删除书签 ${item.label}`}
                          onClick={() => removeBookmark(item.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                {bookmarksOpen && !activeBookmarks.length && (
                  <p className="setting-note">点击上方书签按钮，记住这一页。</p>
                )}
              </div>
            </aside>
          )}
          <div className="reader-center">
            <div className="reading-heading">
              <span>{snapshot?.chapter || "正在打开书籍"}</span>
              {snapshot?.enhancing ? (
                <span role="status">正在增强 · 可继续翻页</span>
              ) : (
                snapshot?.enhancement && (
                  <span>
                    {snapshot.enhancement.filters} ·{" "}
                    {snapshot.enhancement.scale}×
                  </span>
                )
              )}
            </div>
            <div className="reader-stage" data-testid="reader-stage">
              <div
                className={`reader-surface ${snapshot?.reflow === false ? "fixed-surface" : ""}`}
                ref={surface}
                tabIndex={-1}
                aria-label="书籍正文"
              />
              {loading && (
                <div className="loading-overlay">
                  <div className="loading-spinner" />
                  正在打开…
                </div>
              )}
              <Rain enabled={ambience.rain} strength={ambience.strength} />
            </div>
            <footer className="reading-footer">
              <button
                className="icon-button"
                aria-label="上一页"
                disabled={loading || !snapshot}
                onClick={() => move("previous")}
              >
                {style.direction !== "rtl" ? (
                  <ArrowLeft size={18} />
                ) : (
                  <ArrowRight size={18} />
                )}
              </button>
              <ReaderProgress snapshot={snapshot} seek={seek} />
              <button
                className="icon-button"
                aria-label="下一页"
                disabled={loading || !snapshot}
                onClick={() => move("next")}
              >
                {style.direction !== "rtl" ? (
                  <ArrowRight size={18} />
                ) : (
                  <ArrowLeft size={18} />
                )}
              </button>
            </footer>
          </div>
          {settings && (
            <Preferences
              style={style}
              setStyle={changeStyle}
              fonts={fonts}
              comic={snapshot?.category === "comic"}
              enhancement={enhancement}
              animeDevice={animeDevice}
              reflow={snapshot?.reflow ?? true}
              ambience={ambience}
              setAmbience={(patch) =>
                setAmbience((current) => ({ ...current, ...patch }))
              }
              close={() => setSettings(false)}
            />
          )}
        </section>
      </main>
      {active && immersive && (
        <div className="immersive-tools" data-no-page>
          <button
            className={`icon-button ${settings ? "pressed" : ""}`}
            aria-label="全屏阅读设置"
            onClick={() => setSettings(!settings)}
          >
            <SlidersHorizontal size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="退出全屏"
            onClick={() => void fullscreen(false)}
          >
            <X size={19} />
          </button>
        </div>
      )}
      {help && <Help close={() => setHelp(false)} />}
      {updatesOpen && (
        <SoftwareUpdate
          close={() => setUpdatesOpen(false)}
          prepare={async () => {
            await back();
            // 阅读样式独立于书目状态；更新退出前必须保存最新样式，
            // 避免用 memory 中较早的 style 覆盖用户刚修改的主题或速度。
            saveMemory({ ...memoryRef.current, style: styleRef.current });
          }}
        />
      )}
      {groupsOpen && (
        <GroupManager
          books={books}
          memory={memory}
          initialGroupId={groupId}
          change={(groups) => setMemory((current) => ({ ...current, groups }))}
          close={() => setGroupsOpen(false)}
        />
      )}
      {appearanceOpen && (
        <AppearanceSettings
          value={appearance}
          change={changeAppearance}
          background={background}
          close={() => setAppearanceOpen(false)}
        />
      )}
      {contextBook && (
        <BookMenu
          x={contextBook.x}
          y={contextBook.y}
          close={() => setContextBook(undefined)}
          remove={() => void removeBook(contextBook.book)}
          help={() => {
            setContextBook(undefined);
            setHelp(true);
          }}
        />
      )}
    </div>
  );
}
