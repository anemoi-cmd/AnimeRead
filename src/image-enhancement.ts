import { invoke } from "@tauri-apps/api/core";
import type { ReaderStyle } from "./reader-types";
import { native } from "./file-sources";
import { anime4kImage } from "./gpu/anime4k-client";
import { enhancedSize, type EnhanceTarget } from "./gpu/output-size";
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
/** 输出为 ImageBitmap：不经过 PNG 编码／再解码，尺寸由 enhancedSize 决定。 */
export async function enhanceImage(
  original: Blob,
  style: ReaderStyle,
  target: EnhanceTarget | undefined,
  signal?: AbortSignal,
): Promise<{ bitmap: ImageBitmap; scale: number; device: string }> {
  signal?.throwIfAborted();
  if (style.enhanceBackend === "anime4k") {
    if (await anime4kDevice()) {
      try {
        return await anime4kImage(original, style.filters, target, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if ((error as Error)?.name === "AbortError" || !native) throw error;
        // Adapter loss and old WebView2 drivers must not break page navigation.
        // Only a detected hardware Vulkan device can supply the fallback.
        animeDevice = Promise.resolve(undefined);
      }
    }
    if (!native) throw new Error("当前设备不支持 Anime4K，已保留原图");
  }
  if (!native) throw new Error("Waifu2x 需要 Windows 桌面版");
  const runtime = await getEnhancementRuntime();
  if (
    !runtime.available ||
    typeof runtime.gpuId !== "number" ||
    runtime.gpuId < 0
  )
    throw new Error("未检测到可用显卡，超分已停止，保留原图");
  let input = original;
  if (!WAIFU2X_INPUT.has(original.type)) {
    const decoded = await createImageBitmap(original);
    const canvas = new OffscreenCanvas(decoded.width, decoded.height);
    canvas.getContext("2d")!.drawImage(decoded, 0, 0);
    decoded.close();
    input = await canvas.convertToBlob({ type: "image/png" });
  }
  signal?.throwIfAborted();
  if (input.size > 16 * 1024 * 1024) throw new Error("增强输入最多 16 MiB");
  const bytes = await invoke<ArrayBuffer>(
    "enhance_image",
    await input.arrayBuffer(),
    { headers: { "x-animeread-filters": JSON.stringify(style.filters) } },
  );
  signal?.throwIfAborted();
  const scale = 2 ** style.filters.filter((mode) => mode === "A").length;
  const full = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const size = enhancedSize(
    full.width / scale,
    full.height / scale,
    scale,
    target,
  );
  if (size.width === full.width && size.height === full.height)
    return { bitmap: full, scale, device: runtime.device };
  try {
    const bitmap = await createImageBitmap(full, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    });
    return {
      bitmap,
      scale: (size.width * scale) / full.width,
      device: runtime.device,
    };
  } finally {
    full.close();
  }
}
