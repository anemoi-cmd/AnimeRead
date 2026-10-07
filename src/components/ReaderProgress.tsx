import { useEffect, useRef, useState } from "react";
import type { ReaderSnapshot } from "../reader-types";

export function ReaderProgress({
  snapshot,
  seek,
}: {
  snapshot?: ReaderSnapshot;
  seek: (progress: number) => void;
}) {
  const progress = snapshot?.location?.progress ?? 0;
  const [draft, setDraft] = useState<number>();
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!dragging.current) setDraft(undefined);
  }, [progress]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (value: number) => {
    clearTimeout(timer.current);
    seek(value / 1000);
  };
  return (
    <div className="progress-control">
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
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          commit(Number(event.currentTarget.value));
        }}
        onPointerCancel={() => {
          dragging.current = false;
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
