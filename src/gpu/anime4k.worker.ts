/// <reference types="@webgpu/types" />
import {
  CNNSoftM,
  CNNx2M,
  BilateralMean,
  type Anime4KPipeline,
} from "anime4k-webgpu";
import type { FilterMode } from "../reader-types";
import { createTextureGuard } from "./screentone-protection";

type Job = { id: number; bitmap: ImageBitmap; filters: FilterMode[] };
type Graph = {
  key: string;
  core: number;
  side: number;
  scale: number;
  source: GPUTexture;
  target: GPUTexture;
  buffer: GPUBuffer;
  row: number;
  output: number;
  pipelines: Anime4KPipeline[];
  guard: ReturnType<typeof createTextureGuard>;
  blit: GPURenderPipeline;
  bind: GPUBindGroup;
  resources: (GPUTexture | GPUBuffer)[];
};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown) => void;
};
const queued: Job[] = [];
const cancelled = new Set<number>();
let active: number | undefined;
let gpu: GPUDevice | undefined;
let adapter: GPUAdapter | undefined;
let graph: Graph | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
const HALO = 32;

scope.onmessage = ({ data }) => {
  if (data.type === "cancel") {
    const index = queued.findIndex((job) => job.id === data.id);
    if (index !== -1) queued.splice(index, 1)[0].bitmap.close();
    else if (active === data.id) cancelled.add(data.id);
  } else if (data.type === "image") {
    clearTimeout(idle);
    queued.push(data);
    void drain();
  }
};

function check(id: number) {
  if (cancelled.has(id)) throw new DOMException("增强已取消", "AbortError");
}
function disposeGraph() {
  for (const resource of graph?.resources ?? []) resource.destroy();
  graph = undefined;
}
async function device() {
  if (gpu) return gpu;
  if (!navigator.gpu) throw new Error("无法启动 Anime4K，请选择 Waifu2x");
  adapter =
    (await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    })) ?? undefined;
  if (!adapter || adapter.info?.isFallbackAdapter)
    throw new Error("未发现可用显卡");
  gpu = await adapter.requestDevice({
    requiredLimits: {
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  const current = gpu;
  void current.lost.then(() => {
    if (gpu === current) {
      disposeGraph();
      gpu = undefined;
    }
  });
  return gpu;
}

function createGraph(gpu: GPUDevice, filters: FilterMode[]) {
  const key = filters.join("+");
  if (graph?.key === key) return graph;
  disposeGraph();
  const scale = 2 ** filters.filter((mode) => mode === "A").length;
  const core = Math.max(64, Math.floor(1024 / scale) - HALO * 2);
  const side = core + HALO * 2;
  const output = side * scale;
  const row = Math.ceil((output * 4) / 256) * 256;
  const resources: (GPUTexture | GPUBuffer)[] = [];
  const proxy = new Proxy(gpu, {
    get(target, key) {
      if (key === "createTexture")
        return (descriptor: GPUTextureDescriptor) => {
          const value = target.createTexture(descriptor);
          resources.push(value);
          return value;
        };
      if (key === "createBuffer")
        return (descriptor: GPUBufferDescriptor) => {
          const value = target.createBuffer(descriptor);
          resources.push(value);
          return value;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const source = proxy.createTexture({
      size: [side, side],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    let texture = source;
    const guard = createTextureGuard(proxy, source);
    const pipelines: Anime4KPipeline[] = [];
    for (const mode of filters) {
      if (mode === "C") {
        const denoise = new BilateralMean({
          device: proxy,
          inputTexture: texture,
        });
        denoise.updateParam("strength", 0.08);
        denoise.updateParam("strength2", 2);
        pipelines.push(denoise);
        texture = denoise.getOutputTexture();
      } else {
        const pipeline =
          mode === "A"
            ? new CNNx2M({ device: proxy, inputTexture: texture })
            : new CNNSoftM({ device: proxy, inputTexture: texture });
        pipelines.push(pipeline);
        texture = pipeline.getOutputTexture();
      }
    }
    const target = proxy.createTexture({
      size: [output, output],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const shader = proxy.createShaderModule({
      code: `
      @group(0) @binding(0) var image: texture_2d<f32>;
      @group(0) @binding(1) var original: texture_2d<f32>;
      @group(0) @binding(2) var preservation: texture_2d<f32>;
      @group(0) @binding(3) var sampling: sampler;
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        let p = array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.)); return vec4f(p[i],0.,1.);
      }
      @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
        let uv = p.xy / vec2f(textureDimensions(image));
        let restored = clamp(textureLoad(image, vec2i(p.xy), 0).rgb, vec3f(0.), vec3f(1.));
        let source = textureSampleLevel(original, sampling, uv, 0.).rgb;
        let weight = textureSampleLevel(preservation, sampling, uv, 0.).r;
        return vec4f(mix(restored, source, weight * .98), 1.);
      }`,
    });
    const blit = proxy.createRenderPipeline({
      layout: "auto",
      vertex: { module: shader, entryPoint: "vs" },
      fragment: {
        module: shader,
        entryPoint: "fs",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const bind = proxy.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: source.createView() },
        { binding: 2, resource: guard.texture.createView() },
        {
          binding: 3,
          resource: proxy.createSampler({
            minFilter: "linear",
            magFilter: "linear",
          }),
        },
      ],
    });
    const buffer = proxy.createBuffer({
      size: row * output,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    graph = {
      key,
      core,
      side,
      scale,
      source,
      target,
      buffer,
      row,
      output,
      pipelines,
      guard,
      blit,
      bind,
      resources,
    };
    return graph;
  } catch (error) {
    for (const resource of resources) resource.destroy();
    throw error;
  }
}

/** Replicate outside edges; discard the overlap so CNN receptive fields cross
 * internal tile boundaries without introducing seams. */
function drawTile(
  context: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  side: number,
) {
  const left = x - HALO,
    top = y - HALO;
  context.clearRect(0, 0, side, side);
  context.drawImage(bitmap, -left, -top);
  const sy = Math.max(0, top),
    sh = Math.min(bitmap.height, top + side) - sy,
    dy = sy - top;
  if (left < 0) context.drawImage(bitmap, 0, sy, 1, sh, 0, dy, -left, sh);
  if (left + side > bitmap.width) {
    const start = Math.max(0, bitmap.width - left);
    context.drawImage(
      bitmap,
      bitmap.width - 1,
      sy,
      1,
      sh,
      start,
      dy,
      side - start,
      sh,
    );
  }
  if (top < 0)
    context.drawImage(context.canvas, 0, -top, side, 1, 0, 0, side, -top);
  if (top + side > bitmap.height) {
    const start = Math.max(0, bitmap.height - top);
    context.drawImage(
      context.canvas,
      0,
      start - 1,
      side,
      1,
      0,
      start,
      side,
      side - start,
    );
  }
}

async function process(job: Job) {
  const { bitmap, filters, id } = job;
  if (
    !filters.length ||
    filters.length > 4 ||
    filters.some((mode) => !["A", "B", "C"].includes(mode))
  )
    throw new Error("滤镜链无效");
  const gpu = await device();
  check(id);
  const scale = 2 ** filters.filter((mode) => mode === "A").length;
  const width = bitmap.width * scale,
    height = bitmap.height * scale;
  if (
    width * height > 80_000_000 ||
    Math.max(width, height) > gpu.limits.maxTextureDimension2D
  )
    throw new Error("滤镜输出超过显卡尺寸上限，请减少超分叠加次数");
  gpu.pushErrorScope("out-of-memory");
  gpu.pushErrorScope("validation");
  try {
    const g = createGraph(gpu, filters);
    const tile = new OffscreenCanvas(g.side, g.side),
      input = tile.getContext("2d")!;
    const result = new OffscreenCanvas(width, height),
      output = result.getContext("2d")!;
    const data = new Uint8ClampedArray(g.output * g.output * 4);
    const tilePixels = new ImageData(data, g.output, g.output);
    const decoded = new OffscreenCanvas(g.output, g.output),
      decodedContext = decoded.getContext("2d")!;
    for (let y = 0; y < bitmap.height; y += g.core)
      for (let x = 0; x < bitmap.width; x += g.core) {
        check(id);
        drawTile(input, bitmap, x, y, g.side);
        gpu.queue.copyExternalImageToTexture(
          { source: tile },
          { texture: g.source },
          [g.side, g.side],
        );
        const encoder = gpu.createCommandEncoder();
        g.guard.pass(encoder);
        for (const pipeline of g.pipelines) pipeline.pass(encoder);
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: g.target.createView(),
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 1, g: 1, b: 1, a: 1 },
            },
          ],
        });
        pass.setPipeline(g.blit);
        pass.setBindGroup(0, g.bind);
        pass.draw(3);
        pass.end();
        encoder.copyTextureToBuffer(
          { texture: g.target },
          { buffer: g.buffer, bytesPerRow: g.row },
          [g.output, g.output],
        );
        gpu.queue.submit([encoder.finish()]);
        await g.buffer.mapAsync(GPUMapMode.READ);
        try {
          check(id);
          const mapped = new Uint8Array(g.buffer.getMappedRange());
          for (let row = 0; row < g.output; row++)
            data.set(
              mapped.subarray(row * g.row, row * g.row + g.output * 4),
              row * g.output * 4,
            );
        } finally {
          g.buffer.unmap();
        }
        decodedContext.putImageData(tilePixels, 0, 0);
        const w = Math.min(g.core, bitmap.width - x) * scale,
          h = Math.min(g.core, bitmap.height - y) * scale;
        output.drawImage(
          decoded,
          HALO * scale,
          HALO * scale,
          w,
          h,
          x * scale,
          y * scale,
          w,
          h,
        );
      }
    check(id);
    const blob = await result.convertToBlob({ type: "image/png" });
    check(id);
    return {
      blob,
      scale,
      device:
        adapter!.info.description ||
        `${adapter!.info.vendor} ${adapter!.info.architecture}`.trim(),
    };
  } finally {
    const validation = await gpu.popErrorScope(),
      memory = await gpu.popErrorScope();
    if (validation || memory) {
      disposeGraph();
      throw new Error(`Anime4K：${validation?.message ?? memory?.message}`);
    }
  }
}

async function drain() {
  if (active !== undefined) return;
  while (queued.length) {
    const job = queued.shift()!;
    active = job.id;
    try {
      const output = await process(job);
      scope.postMessage({ id: job.id, output });
    } catch (error) {
      scope.postMessage({ id: job.id, error: (error as Error).message });
    } finally {
      job.bitmap.close();
      cancelled.delete(job.id);
      active = undefined;
    }
  }
  idle = setTimeout(() => {
    disposeGraph();
    gpu?.destroy();
    gpu = undefined;
  }, 60_000);
}
