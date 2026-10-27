/** 页面在本屏幕上最多占用的设备像素框；上下阅读不限制高度。 */
export interface EnhanceTarget {
  width: number;
  height: number;
}

/** 页面需要放大多少倍才能填满目标框；没有目标时视为无限大。 */
export function fitRatio(
  width: number,
  height: number,
  target?: EnhanceTarget,
) {
  return target && target.width > 0 && target.height > 0
    ? Math.min(target.width / width, target.height / height)
    : Number.POSITIVE_INFINITY;
}
/** 只执行屏幕真正需要的步骤。A 表示“放大到适合屏幕”：每一遍 2 倍，
 * 放大不足 10% 看不出差别就不跑模型；很小的旧扫描图需要 2.2 倍以上时
 * 自动跑第二遍（最多 4 倍）。原图已经比屏幕大时去掉 A，只保留用户
 * 选的降噪／柔和。
 */
export function neededFilters<T extends string>(filters: T[], fit: number) {
  const passes = fit <= 1.1 ? 0 : fit <= 2.2 ? 1 : 2;
  const first = filters.indexOf("A" as T);
  const rest = filters.filter((mode) => mode !== "A");
  if (first === -1 || !passes) return rest;
  // 放大步骤保留在用户原来第一个 A 的位置，前后的降噪／柔和顺序不变。
  const before = filters.slice(0, first).filter((mode) => mode !== "A");
  return [
    ...before,
    ...Array<T>(passes).fill("A" as T),
    ...rest.slice(before.length),
  ];
}
/** 超分输出尺寸：屏幕需要多大就输出多大，上限为模型倍率，下限为输入。
 * 输入已经由 neededFilters 规划过，不生成浏览器随后又要缩小的超大图。
 */
export function enhancedSize(
  width: number,
  height: number,
  scale: number,
  target?: EnhanceTarget,
) {
  const factor = Math.max(1, Math.min(scale, fitRatio(width, height, target)));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}
