import { useEffect, useRef } from "react";

export function formatReadingTime(milliseconds = 0) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} 分钟`
    : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}
/** Monotonic elapsed time; pause on focus loss, minimize, help and leaving the book. */
export function useReadingTime(
  bookId: string | undefined,
  credit: (id: string, elapsed: number) => void,
) {
  const callback = useRef(credit);
  callback.current = credit;
  useEffect(() => {
    if (!bookId) return;
    let focused = document.hasFocus();
    let visible = document.visibilityState === "visible";
    let last = performance.now();
    const flush = () => {
      const now = performance.now();
      if (focused && visible && now > last)
        callback.current(bookId, now - last);
      last = now;
    };
    const focus = () => {
      flush();
      focused = true;
    };
    const blur = () => {
      flush();
      focused = false;
    };
    const visibility = () => {
      flush();
      visible = document.visibilityState === "visible";
    };
    const timer = setInterval(flush, 1000);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [bookId]);
}
