import { useEffect, useRef } from "react";
import { RainField } from "../ambience/rain-field";

export function Rain({
  enabled,
  strength,
}: {
  enabled: boolean;
  strength: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<RainField>(null);
  const intensity = useRef(strength);
  intensity.current = strength;
  useEffect(() => {
    if (!enabled || !canvas.current) return;
    const element = canvas.current;
    const context = element.getContext("2d");
    if (!context) return;
    const rain = new RainField(element, context);
    field.current = rain;
    let request = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const resize = () => {
      rain.resize(element.clientWidth, element.clientHeight, devicePixelRatio);
      rain.setStrength(intensity.current);
      if (reduced.matches) rain.draw(performance.now(), 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let previous = 0;
    const draw = (time: number) => {
      const seconds = previous ? Math.min(0.04, (time - previous) / 1000) : 0;
      previous = time;
      rain.draw(time, seconds);
      if (!reduced.matches && !document.hidden)
        request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    const visibility = () => {
      cancelAnimationFrame(request);
      if (!document.hidden) {
        previous = 0;
        request = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", visibility);
    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", visibility);
      field.current = null;
      rain.clear();
    };
  }, [enabled]);
  useEffect(() => {
    field.current?.setStrength(strength);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      field.current?.draw(performance.now(), 0);
  }, [strength]);
  return enabled ? (
    <canvas ref={canvas} className="rain-canvas" aria-hidden="true" />
  ) : null;
}
