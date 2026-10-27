import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ReaderSnapshot } from "../reader-types";

export function ReaderProgress({
  snapshot,
  seek,
  thumbnail,
}: {
  snapshot?: ReaderSnapshot;
  seek: (progress: number) => void;
  /** 有页码的书籍在进度条上悬停／拖动时预览目标页。 */
  thumbnail?: (index: number) => Promise<string>;
}) {
  const progress = snapshot?.location?.progress ?? 0;
  const [draft, setDraft] = useState<number>();
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!dragging.current) setDraft(undefined);
  }, [progress]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [preview, setPreview] = useState<{
    x: number;
    page: number;
    url?: string;
  }>();
  const pages = snapshot?.pages ?? 0;
  const showPreview = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (!thumbnail || pages < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const page = Math.round(fraction * (pages - 1));
    const x = fraction * rect.width;
    setPreview((current) =>
      current?.page === page ? { ...current, x } : { x, page },
    );
    void thumbnail(page)
      .then((url) =>
        setPreview((current) =>
          current?.page === page ? { ...current, url } : current,
        ),
      )
      .catch(() => {});
  };
  const commit = (value: number) => {
    clearTimeout(timer.current);
    seek(value / 1000);
  };
  return (
    <div className="progress-control">
      {preview && (
        <div
          className="progress-preview"
          style={{ left: preview.x }}
          aria-hidden="true"
        >
          {preview.url ? <img src={preview.url} alt="" /> : <span />}
          <b>{preview.page + 1}</b>
        </div>
      )}
      <input
        aria-label="阅读进度"
        type="range"
        min="0"
        max="1000"
        value={draft ?? Math.round(progress * 1000)}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          setDraft(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(value), 100);
        }}
        onPointerMove={showPreview}
        onPointerLeave={() => {
          if (!dragging.current) setPreview(undefined);
        }}
        onPointerDown={(event) => {
          dragging.current = true;
          showPreview(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          setPreview(undefined);
          commit(Number(event.currentTarget.value));
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setPreview(undefined);
          setDraft(undefined);
        }}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
      />
      <span
        data-testid="reading-location"
        data-cfi={
          snapshot?.location?.kind === "reflow" ? snapshot.location.cfi : ""
        }
        data-quote={
          snapshot?.location?.kind === "reflow" ? snapshot.location.quote : ""
        }
        data-progress={progress}
      >
        {snapshot?.pages
          ? `${snapshot.page} / ${snapshot.pages}`
          : `${Math.round(progress * 100)}%`}
      </span>
    </div>
  );
}
