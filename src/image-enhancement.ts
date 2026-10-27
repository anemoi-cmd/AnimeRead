import { invoke } from "@tauri-apps/api/core";
import type { FilterMode, ReaderStyle } from "./reader-types";
import { native } from "./file-sources";
import { anime4kImage } from "./gpu/anime4k-client";
import {
  enhancedSize,
  fitRatio,
  neededFilters,
  type EnhanceTarget,
} from "./gpu/output-size";
/// <reference types="@webgpu/types" />
export interface EnhancementRuntime {
  available: boolean;
  device: string;
  gpuId?: number;
  backend: string;
  temporaryFiles: boolean;
}
export const getEnhancementRuntime = () =>
  invoke<EnhancementRuntime>("enhancement_runtime");
let animeDevice: Promise<string | undefined> | undefined;
export async function anime4kDevice() {
  animeDevice ??= (async () => {
    if (!navigator.gpu) return undefined;
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (
      !adapter ||
      adapter.info?.isFallbackAdapter ||
      (adapter as GPUAdapter & { isFallbackAdapter?: boolean })
        .isFallbackAdapter ||
      /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(
        adapter.info?.description ?? "",
      )
    )
      return undefined;
    return (
      adapter.info?.description ||
      `${adapter.info?.vendor ?? ""} ${adapter.info?.architecture ?? ""}`.trim() ||
      "GPU"
    );
  })().catch(() => undefined);
  return animeDevice;
}
// Waifu2x 命令行可直接读取的格式；其他格式先转成 PNG。
const WAIFU2X_INPUT = new Set(["image/png", "image/jpeg", "image/webp"]);
export type EnhanceResult =
  | { skipped: true }
  | {
      skipped?: false;
      bitmap: ImageBitmap;
      scale: number;
      device: string;
      /** 实际执行的步骤，可能少于用户选择的（例如不需要放大时去掉 A）。 */
      filters: FilterMode[];
    };
/** 先按屏幕需要规划步骤，再决定是否动用显卡：
 * - 原图已经不小于显示尺寸：不跑放大模型；若用户没有选降噪／柔和，直接用原图。
 * - 只剩降噪／柔和时，先把大图高质量缩到显示尺寸再处理，算量按屏幕而不是按扫描分辨率。
 * - 需要放大时只跑够用的次数，输出不超过屏幕所需尺寸。
 */
export async function enhanceImage(
  original: Blob,
  style: ReaderStyle,
  target: EnhanceTarget | undefined,
  signal?: AbortSignal,
): Promise<EnhanceResult> {
  signal?.throwIfAborted();
  let bitmap = await createImageBitmap(original);
  // 交给 Worker 后位图由对方关闭，这里不能再关一次。
  let transferred = false;
  const sourceWidth = bitmap.width;
  try {
    signal?.throwIfAborted();
    const fit = fitRatio(bitmap.width, bitmap.height, target);
    const filters = neededFilters(style.filters, fit);
    if (!filters.length) return { skipped: true };
    let resized = false;
    if (fit < 1) {
      const smaller = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * fit)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * fit)),
        resizeQuality: "high",
      });
      bitmap.close();
      bitmap = smaller;
      resized = true;
    }
    if (style.enhanceBackend === "anime4k" && (await anime4kDevice())) {
      try {
        transferred = true;
        const result = await anime4kImage(bitmap, filters, target, signal);
        return {
          ...result,
          scale: result.bitmap.width / sourceWidth,
          filters,
        };
      } catch (error) {
        signal?.throwIfAborted();
        if ((error as Error)?.name === "AbortError" || !native) throw error;
        // Adapter loss and old WebView2 drivers must not break page navigation.
        // Only a detected hardware Vulkan device can supply the fallback.
        animeDevice = Promise.resolve(undefined);
        bitmap = await createImageBitmap(original);
        transferred = false;
        resized = false;
      }
    } else if (style.enhanceBackend === "anime4k" && !native)
      throw new Error("当前设备不支持 Anime4K，已保留原图");
    if (!native) throw new Error("Waifu2x 需要 Windows 桌面版");
    const result = await waifu2xImage(
      original,
      bitmap,
      resized,
      filters,
      target,
      signal,
    );
    return result.skipped
      ? result
      : { ...result, scale: result.bitmap.width / sourceWidth };
  } finally {
    if (!transferred) bitmap.close();
  }
}
async function waifu2xImage(
  original: Blob,
  bitmap: ImageBitmap,
  resized: boolean,
  filters: FilterMode[],
  target: EnhanceTarget | undefined,
  signal?: AbortSignal,
): Promise<EnhanceResult> {
  const runtime = await getEnhancementRuntime();
  if (
    !runtime.available ||
    typeof runtime.gpuId !== "number" ||
    runtime.gpuId < 0
  )
    throw new Error("未检测到可用显卡，超分已停止，保留原图");
  let input = original;
  if (resized || !WAIFU2X_INPUT.has(original.type)) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    input = await canvas.convertToBlob({ type: "image/png" });
  }
  signal?.throwIfAborted();
  if (input.size > 16 * 1024 * 1024) throw new Error("增强输入最多 16 MiB");
  const bytes = await invoke<ArrayBuffer>(
    "enhance_image",
    await input.arrayBuffer(),
    { headers: { "x-animeread-filters": JSON.stringify(filters) } },
  );
  signal?.throwIfAborted();
  const scale = 2 ** filters.filter((mode) => mode === "A").length;
  const full = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const size = enhancedSize(bitmap.width, bitmap.height, scale, target);
  if (size.width === full.width && size.height === full.height)
    return {
      bitmap: full,
      scale: full.width / bitmap.width,
      device: runtime.device,
      filters,
    };
  try {
    return {
      bitmap: await createImageBitmap(full, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: "high",
      }),
      scale: size.width / bitmap.width,
      device: runtime.device,
      filters,
    };
  } finally {
    full.close();
  }
}
