import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** 全书页面缩略图。只为滚动到附近的格子生成图片，点击跳到该页。 */
export function ThumbnailGrid({
  pages,
  current,
  thumbnail,
  go,
  close,
}: {
  pages: number;
  /** 当前显示的页（从 0 开始）。 */
  current: number[];
  thumbnail: (index: number) => Promise<string>;
  go: (index: number) => void;
  close: () => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    const root = grid.current;
    if (!root) return;
    let alive = true;
    const requested = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          observer.unobserve(entry.target);
          if (requested.has(index)) continue;
          requested.add(index);
          void thumbnail(index)
            .then((url) => {
              if (alive) setUrls((value) => ({ ...value, [index]: url }));
            })
            .catch(() => {});
        }
      },
      { root, rootMargin: "300px 0px" },
    );
    root
      .querySelectorAll<HTMLElement>("[data-index]")
      .forEach((item) => observer.observe(item));
    // 打开时把当前页滚到中间。
    root
      .querySelector<HTMLElement>(".is-current")
      ?.scrollIntoView({ block: "center" });
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [pages, thumbnail]);
  return (
    <section
      className="thumbnail-panel"
      role="dialog"
      aria-label="页面缩略图"
      data-no-page
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="panel-heading">
        <h2>
          页面 <small>共 {pages} 页</small>
        </h2>
        <button
          className="icon-button"
          aria-label="关闭页面缩略图"
          autoFocus
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <div className="thumbnail-grid" ref={grid}>
        {Array.from({ length: pages }, (_, index) => (
          <button
            key={index}
            data-index={index}
            className={current.includes(index) ? "is-current" : ""}
            aria-label={`跳到第 ${index + 1} 页`}
            aria-current={current.includes(index) ? "page" : undefined}
            onClick={() => go(index)}
          >
            <span className="thumbnail-image">
              {urls[index] && <img src={urls[index]} alt="" />}
            </span>
            <span className="thumbnail-number">{index + 1}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
