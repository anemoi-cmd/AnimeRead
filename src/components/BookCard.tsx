import { memo, type PointerEvent } from "react";
import { BookOpen, Clock3 } from "lucide-react";
import { formatReadingTime } from "../reading-time";
import type { ShelfBook as Book } from "../reader-types";
import type { BookMemory } from "../reading-storage";
/** 鼠标在书上移动时书本略微转向指针；离开后回到书架共同视角下的姿态。 */
export const followPointer = {
  onPointerMove(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty("--turn-y", `${x * 24}deg`);
    event.currentTarget.style.setProperty("--turn-x", `${-y * 12}deg`);
  },
  onPointerLeave(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.removeProperty("--turn-y");
    event.currentTarget.style.removeProperty("--turn-x");
  },
};
const COLORS = ["sage", "sand", "slate", "rose"];
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
      {...followPointer}
    >
      <div className="book-3d">
        <span className="book-pages" aria-hidden="true" />
        <BookSpine cover={cover} color={COLORS[index % 4]} />
        <div className={`book-cover cover-${COLORS[index % 4]}`}>
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
/** 书脊：用封面图贴在左侧窄面上，颜色与这本书一致；没有封面时用占位色。 */
export function BookSpine({ cover, color }: { cover?: string; color: string }) {
  return (
    <span
      className={`book-spine cover-${color}`}
      style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
      aria-hidden="true"
    />
  );
}
