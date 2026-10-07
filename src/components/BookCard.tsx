import { memo } from "react";
import { BookOpen, Clock3 } from "lucide-react";
import { formatReadingTime } from "../reading-time";
import type { ShelfBook as Book } from "../reader-types";
import type { BookMemory } from "../reading-storage";
export const BookCard = memo(function BookCard({
  book,
  saved,
  cover,
  index,
  open,
  contextMenu,
}: {
  book: Book;
  saved?: BookMemory;
  cover?: string;
  index: number;
  open: (book: Book) => Promise<void>;
  contextMenu: (book: Book, x: number, y: number) => void;
}) {
  const title = saved?.title ?? book.name.replace(/\.[^.]+$/, "");
  return (
    <button
      className="book-card"
      data-book-id={book.id}
      aria-label={`阅读 ${title}`}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        contextMenu(book, event.clientX, event.clientY);
      }}
      onClick={() => void open(book)}
    >
      <div
        className={`book-cover cover-${["sage", "sand", "slate", "rose"][index % 4]}`}
      >
        {cover ? (
          <img className="cover-image" src={cover} alt={`${title} 封面`} />
        ) : (
          <>
            <span className="cover-rule" />
            <strong>{title}</strong>
            <span className="cover-author">
              {saved?.author || "你的阅读收藏"}
            </span>
            <BookOpen className="cover-symbol" size={38} strokeWidth={0.8} />
            <span className="cover-spine" />
          </>
        )}
      </div>
      <h3 title={title}>{title}</h3>
      <p>
        {saved?.author || ""}
        <span>
          {saved?.location
            ? `已读 ${Math.round(saved.location.progress * 100)}%`
            : "未开始"}
        </span>
      </p>
      <div className="book-progress">
        <span style={{ width: `${(saved?.location?.progress ?? 0) * 100}%` }} />
      </div>
      <div className="book-reading-time">
        <Clock3 size={14} />
        <span>阅读 {formatReadingTime(saved?.readingMillis)}</span>
      </div>
    </button>
  );
});
