import { useMemo, useRef, useState } from "react";
import {
  X,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Sparkles,
  FolderPlus,
} from "lucide-react";
import {
  saveGroup,
  autoGroupBooks,
  seriesTitle,
  suggestSeries,
  type BookGroup,
} from "../book-groups";
import type { ShelfBook as Book } from "../reader-types";
import type { ReadingMemory } from "../reading-storage";

const emptyGroup = (): BookGroup => ({
  id: crypto.randomUUID(),
  name: "",
  bookIds: [],
});
/** 分组管理：
 * - 打开时自动列出“检测到的系列”，一键建组；
 * - 从书籍右键“加入分组”进入时，已为这本书和同系列的卷准备好新分组；
 * - 添加书籍默认只列未分组的书，已在其他分组的书标明所在分组；
 * - 切换分组或关闭窗口时，有效的修改自动保存。
 */
export function GroupManager({
  books,
  memory,
  initialGroupId,
  focusBook,
  change,
  close,
}: {
  books: Book[];
  memory: ReadingMemory;
  initialGroupId?: string;
  focusBook?: Book;
  change: (groups: BookGroup[]) => void;
  close: () => void;
}) {
  const groups = memory.groups ?? [];
  // 自动保存后紧接着新建分组时，两次写入必须基于最新列表。
  const latest = useRef(groups);
  latest.current = groups;
  const title = (book: Book) =>
    memory.books[book.id]?.title ?? book.name.replace(/\.[^.]+$/, "");
  const suggestions = useMemo(
    () => suggestSeries(groups, books, memory.books),
    [groups, books, memory.books],
  );
  const [draft, setDraft] = useState<BookGroup>(() => {
    if (focusBook) {
      const owner = groups.find((group) =>
        group.bookIds.includes(focusBook.id),
      );
      if (owner) return { ...owner, bookIds: [...owner.bookIds] };
      const series = suggestions.find((entry) =>
        entry.ids.includes(focusBook.id),
      );
      return {
        ...emptyGroup(),
        name: series?.name ?? seriesTitle(title(focusBook)),
        bookIds: series?.ids ?? [focusBook.id],
      };
    }
    const initial =
      groups.find((group) => group.id === initialGroupId) ?? groups[0];
    return initial
      ? { ...initial, bookIds: [...initial.bookIds] }
      : emptyGroup();
  });
  const [pickerPage, setPickerPage] = useState(0);
  const [volumePage, setVolumePage] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyUngrouped, setOnlyUngrouped] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [closing, setClosing] = useState(false);
  const byId = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books],
  );
  const ownerOf = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.bookIds.map((id) => [id, group] as const),
        ),
      ),
    [groups],
  );
  const selectedIds = useMemo(() => new Set(draft.bookIds), [draft.bookIds]);
  const saved = groups.find((group) => group.id === draft.id);
  const dirty = saved
    ? JSON.stringify(saved) !==
      JSON.stringify({ ...saved, ...draft, name: draft.name.trim() })
    : draft.bookIds.length > 0 || !!draft.name.trim();
  const matches = books.filter((book) => {
    const owner = ownerOf.get(book.id);
    return (
      title(book).toLowerCase().includes(search.toLowerCase()) &&
      (!onlyUngrouped ||
        !owner ||
        owner.id === draft.id ||
        selectedIds.has(book.id))
    );
  });
  const pickerPages = Math.max(1, Math.ceil(matches.length / 100));
  const shownPickerPage = Math.min(pickerPage, pickerPages - 1);
  const volumePages = Math.max(1, Math.ceil(draft.bookIds.length / 100));
  const shownVolumePage = Math.min(volumePage, volumePages - 1);
  const problem = (group: BookGroup) =>
    !group.name.trim()
      ? "请填写分组名称"
      : groups.some(
            (item) => item.id !== group.id && item.name === group.name.trim(),
          )
        ? "已有同名分组"
        : "";
  const persist = (group: BookGroup) => {
    const updated = autoGroupBooks(
      saveGroup(latest.current, { ...group, name: group.name.trim() }),
      books,
      memory.books,
    );
    latest.current = updated;
    change(updated);
    return updated.find((item) => item.id === group.id)!;
  };
  const save = () => {
    const message = problem(draft);
    if (message) {
      setError(message);
      return;
    }
    setDraft(persist(draft));
    setError("");
    setFeedback("分组已保存");
  };
  /** 离开当前分组前自动保存；名称无效时提示一次，再次操作则放弃修改。 */
  const leave = (next: () => void) => {
    if (dirty) {
      const message = problem(draft);
      if (!message) persist(draft);
      else if (!closing) {
        setError(`${message}，否则修改不会保存。再次点击将放弃修改。`);
        setClosing(true);
        return;
      }
    }
    setClosing(false);
    setError("");
    setFeedback("");
    next();
  };
  const select = (group: BookGroup) =>
    leave(() => {
      setDraft({ ...group, bookIds: [...group.bookIds] });
      setVolumePage(0);
    });
  const reorder = (index: number, delta: number) => {
    const bookIds = [...draft.bookIds];
    [bookIds[index], bookIds[index + delta]] = [
      bookIds[index + delta],
      bookIds[index],
    ];
    edit({ ...draft, bookIds });
  };
  const edit = (next: BookGroup) => {
    setDraft(next);
    setFeedback("");
    setClosing(false);
  };
  return (
    <div className="modal-backdrop">
      <section
        className="group-manager"
        role="dialog"
        aria-label="管理分组"
        aria-modal="true"
      >
        <div className="panel-heading">
          <h2>管理分组</h2>
          <button
            className="icon-button"
            aria-label="关闭分组管理"
            onClick={() => leave(close)}
          >
            <X size={18} />
          </button>
        </div>
        <p className="setting-note group-intro">
          把同一系列的多卷书放进一个分组，书架上只显示一张卡片，打开后按卷序阅读。分组名称与书名一致时，以后导入的同名卷会自动加入。
        </p>
        {suggestions.length > 0 && (
          <div className="group-suggestions" aria-label="检测到的系列">
            <span>
              <Sparkles size={15} />
              检测到的系列
            </span>
            {suggestions.slice(0, 8).map((entry) => (
              <button
                key={entry.name}
                className="suggestion-chip"
                onClick={() =>
                  leave(() => {
                    const created = persist({
                      ...emptyGroup(),
                      name: entry.name,
                      bookIds: entry.ids,
                    });
                    setDraft(created);
                    setFeedback(`已创建分组“${created.name}”`);
                  })
                }
              >
                <FolderPlus size={14} />
                {entry.name}
                <small>{entry.ids.length} 卷</small>
              </button>
            ))}
          </div>
        )}
        <div className="group-manager-body">
          <nav className="group-list" aria-label="分组列表">
            <button
              className="outline-button"
              onClick={() => leave(() => setDraft(emptyGroup()))}
            >
              <Plus size={16} />
              新建分组
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                className={draft.id === group.id ? "selected" : ""}
                onClick={() => select(group)}
              >
                {group.name}
                <span>
                  {group.bookIds.length} 卷
                  {group.autoMatch !== false && " · 自动收录"}
                </span>
              </button>
            ))}
            {!groups.length && <p className="setting-note">还没有分组。</p>}
          </nav>
          <div className="group-editor">
            <label className="field-label" htmlFor="group-name">
              分组名称
            </label>
            <input
              id="group-name"
              maxLength={80}
              value={draft.name}
              onChange={(event) => edit({ ...draft, name: event.target.value })}
              placeholder="通常就是系列名，例如：星之旅人"
            />
            <label className="switch-row">
              <span>
                自动收录同名系列
                <small>以后导入名称相同的卷会自动加入</small>
              </span>
              <input
                type="checkbox"
                checked={draft.autoMatch !== false}
                onChange={(event) =>
                  edit({ ...draft, autoMatch: event.target.checked })
                }
              />
            </label>
            <div className="group-volumes">
              <h3>卷序 · {draft.bookIds.length} 本</h3>
              {!draft.bookIds.length && (
                <p className="setting-note">在下方勾选要放进这个分组的书。</p>
              )}
              {draft.bookIds
                .slice(shownVolumePage * 100, (shownVolumePage + 1) * 100)
                .map((id, offset) => {
                  const index = shownVolumePage * 100 + offset;
                  const book = byId.get(id);
                  return (
                    <div className="volume-row" key={id}>
                      <span>
                        {index + 1}. {book ? title(book) : "暂未找到的书籍"}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`上移卷 ${index + 1}`}
                        disabled={index === 0}
                        onClick={() => reorder(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`下移卷 ${index + 1}`}
                        disabled={index === draft.bookIds.length - 1}
                        onClick={() => reorder(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`从分组移除卷 ${index + 1}`}
                        onClick={() =>
                          edit({
                            ...draft,
                            excludedIds: [...(draft.excludedIds ?? []), id],
                            bookIds: draft.bookIds.filter(
                              (value) => value !== id,
                            ),
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
            </div>
            {volumePages > 1 && (
              <nav className="shelf-pagination" aria-label="卷序分页">
                <button
                  className="text-button"
                  disabled={shownVolumePage === 0}
                  onClick={() => setVolumePage(shownVolumePage - 1)}
                >
                  上一组卷
                </button>
                <span>
                  {shownVolumePage + 1} / {volumePages}
                </span>
                <button
                  className="text-button"
                  disabled={shownVolumePage === volumePages - 1}
                  onClick={() => setVolumePage(shownVolumePage + 1)}
                >
                  下一组卷
                </button>
              </nav>
            )}
            <div className="picker-heading">
              <label className="field-label" htmlFor="group-search">
                添加书籍
              </label>
              <label className="picker-filter">
                <input
                  type="checkbox"
                  checked={onlyUngrouped}
                  onChange={(event) => {
                    setOnlyUngrouped(event.target.checked);
                    setPickerPage(0);
                  }}
                />
                只看未分组
              </label>
            </div>
            <input
              id="group-search"
              placeholder="搜索书名"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPickerPage(0);
              }}
            />
            <div className="group-book-picker">
              {matches
                .slice(shownPickerPage * 100, (shownPickerPage + 1) * 100)
                .map((book) => {
                  const owner = ownerOf.get(book.id);
                  return (
                    <label key={book.id}>
                      <input
                        type="checkbox"
                        aria-label={`分组收录 ${title(book)}`}
                        checked={selectedIds.has(book.id)}
                        onChange={(event) =>
                          edit({
                            ...draft,
                            excludedIds: event.target.checked
                              ? draft.excludedIds?.filter(
                                  (id) => id !== book.id,
                                )
                              : [...(draft.excludedIds ?? []), book.id],
                            bookIds: event.target.checked
                              ? [...draft.bookIds, book.id]
                              : draft.bookIds.filter((id) => id !== book.id),
                          })
                        }
                      />
                      <span>{title(book)}</span>
                      {owner && owner.id !== draft.id && (
                        <em title="勾选后会移到当前分组">在“{owner.name}”中</em>
                      )}
                    </label>
                  );
                })}
              {!matches.length && (
                <p className="setting-note">
                  {onlyUngrouped
                    ? "没有未分组的书。取消“只看未分组”可调整其他分组的书。"
                    : "没有找到这本书。"}
                </p>
              )}
            </div>
            {pickerPages > 1 && (
              <nav className="shelf-pagination" aria-label="分组书籍分页">
                <button
                  className="text-button"
                  disabled={shownPickerPage === 0}
                  onClick={() => setPickerPage(shownPickerPage - 1)}
                >
                  上一组书籍
                </button>
                <span>
                  {shownPickerPage + 1} / {pickerPages}
                </span>
                <button
                  className="text-button"
                  disabled={shownPickerPage === pickerPages - 1}
                  onClick={() => setPickerPage(shownPickerPage + 1)}
                >
                  下一组书籍
                </button>
              </nav>
            )}
            {error && <p role="alert">{error}</p>}
            {feedback && <p role="status">{feedback}</p>}
            <div className="group-actions">
              {saved && (
                <button
                  className="text-button"
                  onClick={() => {
                    change(groups.filter((group) => group.id !== draft.id));
                    setDraft(emptyGroup());
                    setVolumePage(0);
                    setError("");
                    setFeedback("已删除分组，书籍仍在书架中");
                  }}
                >
                  <Trash2 size={15} />
                  删除分组
                </button>
              )}
              <button className="primary-button" onClick={save}>
                保存分组
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
