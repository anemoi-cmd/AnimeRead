import { invoke } from "@tauri-apps/api/core";
import type { ReaderStyle } from "./reader-types";
import { native } from "./file-sources";
import { anime4kImage } from "./gpu/anime4k-client";
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
export async function enhanceImage(
  image: HTMLImageElement,
  style: ReaderStyle,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (style.enhanceBackend === "anime4k") {
    if (await anime4kDevice()) {
      try {
        return await anime4kImage(image, style.filters, signal);
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
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法准备漫画页面");
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("页面转换失败"))),
      "image/png",
    ),
  );
  signal?.throwIfAborted();
  if (blob.size > 16 * 1024 * 1024) throw new Error("增强输入最多 16 MiB");
  const bytes = await invoke<ArrayBuffer>(
    "enhance_image",
    await blob.arrayBuffer(),
    { headers: { "x-animeread-filters": JSON.stringify(style.filters) } },
  );
  signal?.throwIfAborted();
  return {
    blob: new Blob([bytes], { type: "image/png" }),
    scale: 2 ** style.filters.filter((mode) => mode === "A").length,
    device: runtime.device,
  };
}
