import { useEffect, useRef } from "react";

/** Only mounted on the shelf. Reading and hidden windows do no video decoding. */
export function VideoWallpaper({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current!;
    const sync = () => {
      if (document.hidden || !document.hasFocus()) video.pause();
      else void video.play().catch(() => {});
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      video.pause();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, [src]);
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      className="video-wallpaper"
      aria-hidden="true"
    />
  );
}
