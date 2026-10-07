import { useMemo, useState } from "react";
import {
  BookOpen,
  Plus,
  Clock3,
  Folders,
  ArrowLeft,
  FolderOpen,
} from "lucide-react";
import { formatReadingTime } from "../reading-time";
import type { ByteSource, ShelfBook as Book } from "../reader-types";
import type { ReadingMemory } from "../reading-storage";
import type { BookGroup } from "../book-groups";
import { useBookCovers } from "../book-covers";
import { BookCard } from "./BookCard";
import { DEFAULT_APPEARANCE } from "../appearance-settings";
const PAGE_SIZE = 60;
const lastGroupCover = new Map<string, string>();
export function LibraryShelf({
  visible,
  recent,
  shelfMode,
  filter,
  memory,
  open,
  importBooks,
  modeChange,
  contextMenu,
  sourceFor,
  groupId,
  groupChange,
  manageGroups,
}: {
  visible: Book[];
  recent?: Book;
  shelfMode: string;
  filter: string;
  memory: ReadingMemory;
  open: (book: Book) => Promise<void>;
  importBooks: () => Promise<void>;
  modeChange: (mode: string) => void;
  contextMenu: (book: Book, x: number, y: number) => void;
  sourceFor: (book: Book) => Promise<ByteSource>;
  groupId?: string;
  groupChange: (id?: string) => void;
  manageGroups: () => void;
}) {
  const [pagination, setPagination] = useState({ key: "", page: 0 });
  const key = `${groupId ?? ""}:${shelfMode}:${filter}`;
  const group = memory.groups?.find((group) => group.id === groupId);
  const visibleIds = new Set(visible.map((book) => book.id));
  const byId = new Map(visible.map((book) => [book.id, book]));
  const groupedIds = new Set(memory.groups?.flatMap((group) => group.bookIds));
  const groups = group
    ? []
    : (memory.groups ?? []).filter(
        (group) =>
          group.bookIds.some((id) => visibleIds.has(id)) ||
          (!filter && shelfMode === "all" && !group.bookIds.length),
      );
  const books = group
    ? group.bookIds.flatMap((id) => {
        const book = byId.get(id);
        return book ? [book] : [];
      })
    : visible.filter((book) => !groupedIds.has(book.id));
  const entries: ({ book: Book } | { group: BookGroup })[] = [
    ...groups.map((group) => ({ group })),
    ...books.map((book) => ({ book })),
  ];
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const page = Math.min(
    pages - 1,
    pagination.key === key ? pagination.page : 0,
  );
  const shown = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const groupCoverSignature = groups
    .map(
      (group) =>
        `${group.id}:${group.bookIds.filter((id) => visibleIds.has(id)).join(",")}`,
    )
    .join(";");
  const groupCovers = useMemo(
    () =>
      Object.fromEntries(
        groups.map((group) => {
          const ids = group.bookIds.filter((id) => visibleIds.has(id));
          const choices = ids.filter(
            (id) => id !== lastGroupCover.get(group.id),
          );
          const id =
            choices[Math.floor(Math.random() * choices.length)] ?? ids[0];
          if (id) lastGroupCover.set(group.id, id);
          if (lastGroupCover.size > 200)
            lastGroupCover.delete(lastGroupCover.keys().next().value!);
          return [group.id, id];
        }),
      ),
    [groupCoverSignature],
  );
  const coverBooks = shown.flatMap((entry) =>
    "book" in entry
      ? [entry.book]
      : [byId.get(groupCovers[entry.group.id])].filter(
          (book): book is Book => !!book,
        ),
  );
  const covers = useBookCovers(
    [
      ...new Map(
        [...coverBooks, ...(recent ? [recent] : [])].map((book) => [
          book.id,
          book,
        ]),
      ).values(),
    ],
    sourceFor,
  );
  const appearance = memory.appearance ?? DEFAULT_APPEARANCE;
  const recentTitle = recent
    ? (memory.books[recent.id]?.title ?? recent.name.replace(/\.[^.]+$/, ""))
    : "";
  const lastRead = recent && memory.books[recent.id]?.lastRead;
  return (
    <div className="library-content">
      <section className="welcome">
        <div>
          <h1>{appearance.welcomeTitle || DEFAULT_APPEARANCE.welcomeTitle}</h1>
          <p>
            {appearance.welcomeSubtitle || DEFAULT_APPEARANCE.welcomeSubtitle}
          </p>
          <div className="reading-time-total">
            <Clock3 size={20} />
            <div>
              <span>总阅读时间</span>
              <strong data-testid="total-reading-time">
                {formatReadingTime(memory.totalReadingMillis)}
              </strong>
            </div>
          </div>
          <div className="welcome-actions">
            <button
              className="primary-button"
              onClick={() => void (recent ? open(recent) : importBooks())}
            >
              <BookOpen size={17} />
              {recent ? "继续阅读" : "开始阅读"}
            </button>
          </div>
        </div>
        {recent && (
          <button
            className="recent-book"
            onClick={() => void open(recent)}
            aria-label={`继续阅读 ${recentTitle}`}
          >
            {covers[recent.id] ? (
              <img
                src={covers[recent.id]}
                alt={`上次阅读 ${recentTitle} 封面`}
              />
            ) : (
              <BookOpen size={48} />
            )}
            <div>
              <span>上次阅读</span>
              <strong>{recentTitle}</strong>
              {lastRead && (
                <time dateTime={new Date(lastRead).toISOString()}>
                  {new Date(lastRead).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </time>
              )}
            </div>
          </button>
        )}
      </section>
      <div className="shelf-heading">
        <div className="group-breadcrumb">
          {group && (
            <button
              className="icon-button"
              aria-label="返回全部分组"
              onClick={() => groupChange()}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2>
            {group?.name ??
              (shelfMode === "all"
                ? "我的书籍"
                : shelfMode === "novel"
                  ? "小说"
                  : "漫画")}
            <span>{group ? books.length + " 卷" : visible.length}</span>
          </h2>
        </div>
        <div className="shelf-heading-actions">
          <button className="outline-button" onClick={manageGroups}>
            <Folders size={16} />
            管理分组
          </button>
          <div className="shelf-tabs">
            {[
              { id: "all", name: "全部" },
              { id: "novel", name: "小说" },
              { id: "comic", name: "漫画" },
            ].map((mode) => (
              <button
                key={mode.id}
                className={shelfMode === mode.id ? "selected" : ""}
                onClick={() => modeChange(mode.id)}
              >
                {mode.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      {shown.length ? (
        <div className="book-grid">
          {shown.map((entry, index) =>
            "book" in entry ? (
              <BookCard
                key={entry.book.id}
                book={entry.book}
                saved={memory.books[entry.book.id]}
                cover={covers[entry.book.id]}
                index={index}
                open={open}
                contextMenu={contextMenu}
              />
            ) : (
              <button
                className="book-card group-card"
                key={entry.group.id}
                aria-label={`打开分组 ${entry.group.name}`}
                onClick={() => groupChange(entry.group.id)}
              >
                <div className="book-cover cover-sage">
                  {covers[groupCovers[entry.group.id]] ? (
                    <img
                      className="cover-image"
                      data-cover-book={groupCovers[entry.group.id]}
                      src={covers[groupCovers[entry.group.id]]}
                      alt={`${entry.group.name} 分组封面`}
                    />
                  ) : (
                    <FolderOpen size={44} />
                  )}
                  <span className="group-volume-count">
                    {entry.group.bookIds.length} 卷
                  </span>
                </div>
                <h3>{entry.group.name}</h3>
                <div className="book-reading-time">
                  <Clock3 size={14} />
                  {formatReadingTime(
                    entry.group.bookIds.reduce(
                      (sum, id) => sum + (memory.books[id]?.readingMillis ?? 0),
                      0,
                    ),
                  )}
                </div>
              </button>
            ),
          )}
        </div>
      ) : (
        <div className="empty-shelf">
          <span className="empty-icon">
            <BookOpen size={31} strokeWidth={1.3} />
          </span>
          <h3>
            {filter
              ? "没有找到这本书"
              : group
                ? "这个分组还没有书籍"
                : "第一本书，从这里开始"}
          </h3>
          <p>
            {filter
              ? "换一个书名试试。"
              : group
                ? "打开分组管理，添加已经导入的卷。"
                : "导入书籍，或把文件拖到窗口中。"}
          </p>
          {!filter && (
            <button
              className="outline-button"
              onClick={() => void (group ? manageGroups() : importBooks())}
            >
              <Plus size={16} />
              {group ? "添加卷" : "导入书籍"}
            </button>
          )}
        </div>
      )}
      {pages > 1 && (
        <nav className="shelf-pagination" aria-label="书架分页">
          <button
            className="outline-button"
            disabled={page === 0}
            onClick={() => setPagination({ key, page: page - 1 })}
          >
            上一组书籍
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            className="outline-button"
            disabled={page === pages - 1}
            onClick={() => setPagination({ key, page: page + 1 })}
          >
            下一组书籍
          </button>
        </nav>
      )}
    </div>
  );
}
