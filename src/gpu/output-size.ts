/** 页面在本屏幕上最多占用的设备像素框；上下阅读不限制高度。 */
export interface EnhanceTarget {
  width: number;
  height: number;
}

/** 超分输出尺寸：屏幕需要多大就输出多大，上限为模型倍率，下限为原图。
 * 原图已经高于屏幕时仍输出原尺寸：模型按倍率推理后在显卡上高质量缩回，
 * 只清理线条锯齿和压缩噪点，不生成浏览器随后又要缩小的超大图。
 */
export function enhancedSize(
  width: number,
  height: number,
  scale: number,
  target?: EnhanceTarget,
) {
  const fit =
    target && target.width > 0 && target.height > 0
      ? Math.min(target.width / width, target.height / height)
      : scale;
  const factor = Math.max(1, Math.min(scale, fit));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}
