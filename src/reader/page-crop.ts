/** 漫画页面的“显示区域”：裁掉扫描白边、把横向跨页拆成两半。
 * 只决定显示原图的哪一块，不改源文件；页码、书签和进度仍按原图计算。
 */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** 宽高比超过这个值视为横向跨页。 */
const WIDE = 1.1;
const SAMPLE = 400;

/** 在灰度采样里找内容边界。边缘接近纯白或纯黑才视为页边；彩色边框、
 * 满版插画等不裁。去掉的面积太小（不值得）或剩余太少（多半误判）时返回 null。
 */
export function findContentBox(
  gray: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ViewRect | null {
  if (width < 8 || height < 8) return null;
  const edge: number[] = [];
  for (let x = 0; x < width; x++)
    edge.push(gray[x], gray[(height - 1) * width + x]);
  for (let y = 0; y < height; y++)
    edge.push(gray[y * width], gray[y * width + width - 1]);
  edge.sort((a, b) => a - b);
  const background = edge[edge.length >> 1];
  if (background > 55 && background < 200) return null;
  const ink = (value: number) => Math.abs(value - background) > 40;
  // 一行／一列里有足够多的“墨迹”才算内容，避免 JPEG 噪点和细小污点。
  const rowNeed = Math.max(2, width * 0.006);
  const columnNeed = Math.max(2, height * 0.006);
  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (ink(gray[y * width + x])) {
        rows[y]++;
        columns[x]++;
      }
  let top = 0,
    bottom = height - 1,
    left = 0,
    right = width - 1;
  while (top < height && rows[top] < rowNeed) top++;
  while (bottom > top && rows[bottom] < rowNeed) bottom--;
  while (left < width && columns[left] < columnNeed) left++;
  while (right > left && columns[right] < columnNeed) right--;
  if (top >= bottom || left >= right) return null;
  // 留一点边距，线条不贴边。
  const padX = Math.round(width * 0.012),
    padY = Math.round(height * 0.012);
  left = Math.max(0, left - padX);
  right = Math.min(width - 1, right + padX);
  top = Math.max(0, top - padY);
  bottom = Math.min(height - 1, bottom + padY);
  const box = {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  const kept = (box.width * box.height) / (width * height);
  if (kept > 0.97 || box.width < width * 0.5 || box.height < height * 0.5)
    return null;
  return box;
}

/** 一张原图在当前设置下依次显示的区域（一项或拆分后的两项）。 */
export async function pageViews(
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  options: { crop: boolean; split: boolean; rightToLeft: boolean },
): Promise<ViewRect[]> {
  const width = image.naturalWidth,
    height = image.naturalHeight;
  const full = { x: 0, y: 0, width, height };
  const halves =
    options.split && width > height * WIDE
      ? [
          { x: 0, y: 0, width: Math.floor(width / 2), height },
          {
            x: Math.floor(width / 2),
            y: 0,
            width: width - Math.floor(width / 2),
            height,
          },
        ]
      : [full];
  if (options.split && options.rightToLeft) halves.reverse();
  if (!options.crop) return halves;
  return Promise.all(halves.map((rect) => cropRect(image, rect)));
}

async function cropRect(image: CanvasImageSource, rect: ViewRect) {
  const scale = Math.min(1, SAMPLE / Math.max(rect.width, rect.height));
  const width = Math.max(1, Math.round(rect.width * scale)),
    height = Math.max(1, Math.round(rect.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return rect;
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    width,
    height,
  );
  const rgba = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++)
    gray[i] =
      (rgba[i * 4] * 54 + rgba[i * 4 + 1] * 183 + rgba[i * 4 + 2] * 19) >> 8;
  const box = findContentBox(gray, width, height);
  if (!box) return rect;
  // 采样坐标换回原图，向外取整，宁可多留一像素也不切到线条。
  const x = Math.floor(box.x / scale),
    y = Math.floor(box.y / scale);
  return {
    x: rect.x + x,
    y: rect.y + y,
    width: Math.min(rect.width - x, Math.ceil(box.width / scale)),
    height: Math.min(rect.height - y, Math.ceil(box.height / scale)),
  };
}
