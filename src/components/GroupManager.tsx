import { useMemo, useState } from "react";
import { X, Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { saveGroup, autoGroupBooks, type BookGroup } from "../book-groups";
import type { ShelfBook as Book } from "../reader-types";
import type { ReadingMemory } from "../reading-storage";
export function GroupManager({
  books,
  memory,
  initialGroupId,
  change,
  close,
}: {
  books: Book[];
  memory: ReadingMemory;
  initialGroupId?: string;
  change: (groups: BookGroup[]) => void;
  close: () => void;
}) {
  const groups = memory.groups ?? [];
  const [draft, setDraft] = useState<BookGroup>(
    () =>
      groups.find((group) => group.id === initialGroupId) ??
      groups[0] ?? { id: crypto.randomUUID(), name: "", bookIds: [] },
  );
  const [pickerPage, setPickerPage] = useState(0);
  const [volumePage, setVolumePage] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const title = (book: Book) =>
    memory.books[book.id]?.title ?? book.name.replace(/\.[^.]+$/, "");
  const byId = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books],
  );
  const selectedIds = useMemo(() => new Set(draft.bookIds), [draft.bookIds]);
  const matches = books.filter((book) =>
    title(book).toLowerCase().includes(search.toLowerCase()),
  );
  const pickerPages = Math.max(1, Math.ceil(matches.length / 100));
  const shownPickerPage = Math.min(pickerPage, pickerPages - 1);
  const volumePages = Math.max(1, Math.ceil(draft.bookIds.length / 100));
  const shownVolumePage = Math.min(volumePage, volumePages - 1);
  const save = () => {
    if (!draft.name.trim()) {
      setError("请填写分组名称");
      return;
    }
    if (
      groups.some(
        (group) => group.id !== draft.id && group.name === draft.name.trim(),
      )
    ) {
      setError("已有同名分组");
      return;
    }
    const updated = autoGroupBooks(
      saveGroup(groups, draft),
      books,
      memory.books,
    );
    change(updated);
    setDraft(updated.find((group) => group.id === draft.id)!);
    setError("");
    setFeedback("分组已保存");
  };
  const reorder = (index: number, delta: number) => {
    const bookIds = [...draft.bookIds];
    [bookIds[index], bookIds[index + delta]] = [
      bookIds[index + delta],
      bookIds[index],
    ];
    setDraft({ ...draft, bookIds });
    setFeedback("");
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
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div className="group-manager-body">
          <nav className="group-list">
            <button
              className="outline-button"
              onClick={() => {
                setDraft({ id: crypto.randomUUID(), name: "", bookIds: [] });
                setError("");
                setFeedback("");
                setVolumePage(0);
              }}
            >
              <Plus size={16} />
              新建分组
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                className={draft.id === group.id ? "selected" : ""}
                onClick={() => {
                  setDraft({ ...group, bookIds: [...group.bookIds] });
                  setError("");
                  setFeedback("");
                  setVolumePage(0);
                }}
              >
                {group.name}
                <span>{group.bookIds.length} 卷</span>
              </button>
            ))}
          </nav>
          <div className="group-editor">
            <label className="field-label" htmlFor="group-name">
              分组名称
            </label>
            <input
              id="group-name"
              maxLength={80}
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                setFeedback("");
              }}
              placeholder="例如：與妳相戀到生命盡頭"
            />
            <div className="group-volumes">
              <h3>卷序 · {draft.bookIds.length} 本</h3>
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
                        onClick={() => {
                          setDraft({
                            ...draft,
                            excludedIds: [...(draft.excludedIds ?? []), id],
                            bookIds: draft.bookIds.filter(
                              (value) => value !== id,
                            ),
                          });
                          setFeedback("");
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
            </div>
            <label className="switch-row">
              自动收录同名系列
              <input
                type="checkbox"
                checked={draft.autoMatch !== false}
                onChange={(event) =>
                  setDraft({ ...draft, autoMatch: event.target.checked })
                }
              />
            </label>
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
            <label className="field-label" htmlFor="group-search">
              添加书籍
            </label>
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
                .map((book) => (
                  <label key={book.id}>
                    <input
                      type="checkbox"
                      aria-label={`分组收录 ${title(book)}`}
                      checked={selectedIds.has(book.id)}
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          excludedIds: event.target.checked
                            ? draft.excludedIds?.filter((id) => id !== book.id)
                            : [...(draft.excludedIds ?? []), book.id],
                          bookIds: event.target.checked
                            ? [...draft.bookIds, book.id]
                            : draft.bookIds.filter((id) => id !== book.id),
                        });
                        setFeedback("");
                      }}
                    />
                    <span>{title(book)}</span>
                  </label>
                ))}
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
              {groups.some((group) => group.id === draft.id) && (
                <button
                  className="text-button"
                  onClick={() => {
                    change(groups.filter((group) => group.id !== draft.id));
                    setDraft({
                      id: crypto.randomUUID(),
                      name: "",
                      bookIds: [],
                    });
                    setVolumePage(0);
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
