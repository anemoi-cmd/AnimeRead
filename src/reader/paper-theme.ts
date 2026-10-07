/** 纸张仅参与显示合成。固定小纹理首次生成后复用，不逐页遍历像素，
 * 不进入超分管线、不改写原漫画。静态页和卷页共享纹理与正片叠底，
 * 白色显示纸张，黑色线条保持不变。
 */
import { THEME_COLORS, type Theme } from "../reader-types";

let wood: { canvas: HTMLCanvasElement; url: string } | undefined;
function woodTexture() {
  if (wood) return wood;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(256, 256);
  let seed = 731;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const phase = (Math.PI * 2 * x) / 256;
      const grain =
        Math.sin((Math.PI * 2 * y) / 16 + Math.sin(phase) * 0.7) * 3 +
        Math.sin((Math.PI * 2 * y) / 64 + Math.sin(phase * 2)) * 2 +
        ((seed & 255) / 255 - 0.5) * 2;
      const index = (y * 256 + x) * 4;
      pixels.data[index] = 223 + grain;
      pixels.data[index + 1] = 198 + grain;
      pixels.data[index + 2] = 161 + grain;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  wood = { canvas, url: canvas.toDataURL("image/png") };
  return wood;
}
export function paperBlendsInk(theme: Theme) {
  return theme === "paper" || theme === "ink" || theme === "wood";
}
export function applyPaperTheme(element: HTMLElement, theme: Theme) {
  element.dataset.paper = theme;
  element.style.setProperty("--paper-color", THEME_COLORS[theme].background);
  element.style.setProperty(
    "--paper-texture",
    theme === "wood" ? `url("${woodTexture().url}")` : "none",
  );
  element.style.setProperty(
    "--paper-blend",
    paperBlendsInk(theme) ? "multiply" : "normal",
  );
}
export function paintPaper(
  context: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  width: number,
  height: number,
  scale = 1,
) {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = THEME_COLORS[theme].background;
  context.fillRect(0, 0, width / scale, height / scale);
  if (theme === "wood") {
    context.fillStyle = context.createPattern(woodTexture().canvas, "repeat")!;
    context.fillRect(0, 0, width / scale, height / scale);
  }
  context.restore();
}
