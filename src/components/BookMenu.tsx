import { useEffect, useState } from "react";
import { Trash2, ChevronRight, Info } from "lucide-react";

export function BookMenu({
  x,
  y,
  remove,
  help,
  close,
}: {
  x: number;
  y: number;
  remove: () => void;
  help: () => void;
  close: () => void;
}) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!(event.target as Element)?.closest(".book-menu")) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key, true);
    };
  }, [close]);
  return (
    <div
      className="book-menu"
      role="menu"
      data-no-page
      style={{
        left: Math.min(x, innerWidth - 190),
        top: Math.min(y, innerHeight - 130),
      }}
    >
      <button role="menuitem" onClick={remove}>
        <Trash2 size={16} />
        从书架删除
      </button>
      <button
        role="menuitem"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        更多工具
        <ChevronRight size={16} />
      </button>
      {more && (
        <div className="tools-menu" role="menu">
          <button role="menuitem" onClick={help}>
            <Info size={16} />
            使用说明
          </button>
        </div>
      )}
    </div>
  );
}
