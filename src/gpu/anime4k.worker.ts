/// <reference types="@webgpu/types" />
/** Anime4K 后台推理。整页只上传一次；分块、网点保护、拼接和缩放全部在
 * 显卡上完成，块与块之间不回读 CPU，也不做 PNG 编解码。结果以
 * ImageBitmap 直接转交主线程显示。
 */
import {
  BilateralMean,
  CNNSoftVL,
  CNNx2UL,
  CNNx2VL,
  type Anime4KPipeline,
} from "anime4k-webgpu";
import type { FilterMode } from "../reader-types";
import { createTextureGuard } from "./screentone-protection";
import { enhancedSize, type EnhanceTarget } from "./output-size";

type Job = {
  id: number;
  bitmap: ImageBitmap;
  filters: FilterMode[];
  target?: EnhanceTarget;
};
type Graph = {
  key: string;
  core: number;
  side: number;
  scale: number;
  source: GPUTexture;
  output: GPUTexture;
  uniform: GPUBuffer;
  pipelines: Anime4KPipeline[];
  guard: ReturnType<typeof createTextureGuard>;
  resources: (GPUTexture | GPUBuffer)[];
};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown, transfer?: Transferable[]) => void;
};
const queued: Job[] = [];
const cancelled = new Set<number>();
let active: number | undefined;
let gpu: GPUDevice | undefined;
let adapter: GPUAdapter | undefined;
let graph: Graph | undefined;
let shaders: ReturnType<typeof createShaders> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
// CNN 感受野约 20 像素；重叠区之外的结果不受分块边界影响。
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
  } else if (data.type === "warm") {
    clearTimeout(idle);
    void warm(data.filters);
  }
};
function valid(filters: FilterMode[]) {
  return (
    filters.length > 0 &&
    filters.length <= 4 &&
    filters.every((mode) => ["A", "B", "C"].includes(mode))
  );
}
/** 大模型首次创建管线需要数秒编译着色器。打开漫画或更换滤镜时先在
 * 后台建好，读者看原图的同时完成，首页超分不再等待。
 */
async function warm(filters: FilterMode[]) {
  try {
    const gpu = await device();
    // 正在处理的页面持有当前管线，不能被预热替换。
    if (valid(filters) && active === undefined && !queued.length) {
      createGraph(gpu, filters);
      shaders ??= createShaders(gpu);
    }
  } catch {
    // 预热失败不影响阅读；真正处理页面时再报告错误。
  }
  if (active === undefined && !queued.length) scheduleIdle();
}
function scheduleIdle() {
  clearTimeout(idle);
  // 闲置三分钟释放显存；连续换书时保留已编译的模型。
  idle = setTimeout(() => {
    disposeGraph();
    shaders = undefined;
    gpu?.destroy();
    gpu = undefined;
  }, 180_000);
}

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
      shaders = undefined;
      gpu = undefined;
    }
  });
  return gpu;
}
/** 独显使用最大模型 UL；核显等共享显存设备使用 VL，避免显存不足。 */
function largeModel() {
  const info = adapter?.info;
  return /nvidia|geforce|rtx|quadro/i.test(
    `${info?.vendor ?? ""} ${info?.description ?? ""}`,
  );
}

const FULLSCREEN = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  return vec4f(p[i], 0., 1.);
}`;
// 透明像素先叠到白纸上；漫画透明底在阅读器里本来就显示为纸色。
const PIXEL = /* wgsl */ `
fn pixel(p: vec2i) -> vec3f {
  let size = vec2i(textureDimensions(image));
  let c = textureLoad(image, clamp(p, vec2i(0), size - vec2i(1)), 0);
  return c.rgb * c.a + vec3f(1. - c.a);
}`;
function createShaders(gpu: GPUDevice) {
  const pipeline = (code: string, format: GPUTextureFormat) =>
    gpu.createRenderPipeline({
      layout: "auto",
      vertex: { module: gpu.createShaderModule({ code }), entryPoint: "vs" },
      fragment: {
        module: gpu.createShaderModule({ code }),
        entryPoint: "fs",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
  // 从整页纹理截取带重叠区的块；越界部分复制边缘像素。
  const extract = pipeline(
    `${FULLSCREEN}
    @group(0) @binding(0) var image: texture_2d<f32>;
    @group(0) @binding(1) var<uniform> tile: vec4f;
    ${PIXEL}
    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      return vec4f(pixel(vec2i(floor(p.xy + tile.xy))), 1.);
    }`,
    "rgba8unorm",
  );
  // 把块的有效区域写入整页结果。密集网点区域改用原图的 Catmull-Rom
  // 双三次插值，既不被 CNN 当成破损线条，也不像双线性那样发糊。
  const compose = pipeline(
    `${FULLSCREEN}
    @group(0) @binding(0) var restored: texture_2d<f32>;
    @group(0) @binding(1) var image: texture_2d<f32>;
    @group(0) @binding(2) var preservation: texture_2d<f32>;
    @group(0) @binding(3) var linearSampler: sampler;
    @group(0) @binding(4) var<uniform> tile: vec4f;
    ${PIXEL}
    fn weights(t: f32) -> vec4f {
      let t2 = t * t;
      let t3 = t2 * t;
      return vec4f(
        -.5 * t3 + t2 - .5 * t,
        1.5 * t3 - 2.5 * t2 + 1.,
        -1.5 * t3 + 2. * t2 + .5 * t,
        .5 * t3 - .5 * t2);
    }
    fn bicubic(x: vec2f) -> vec3f {
      let t = x - .5;
      let base = vec2i(floor(t)) - vec2i(1);
      let f = fract(t);
      let wx = weights(f.x);
      let wy = weights(f.y);
      var sum = vec3f(0.);
      for (var j = 0; j < 4; j++) {
        var row = vec3f(0.);
        for (var i = 0; i < 4; i++) {
          row += pixel(base + vec2i(i, j)) * wx[i];
        }
        sum += row * wy[j];
      }
      return sum;
    }
    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      let scale = tile.z;
      let local = p.xy - tile.xy * scale;
      let model = clamp(textureLoad(restored, vec2i(floor(local)), 0).rgb, vec3f(0.), vec3f(1.));
      let source = clamp(bicubic(p.xy / scale), vec3f(0.), vec3f(1.));
      let uv = local / scale / vec2f(textureDimensions(preservation));
      let weight = textureSampleLevel(preservation, linearSampler, uv, 0.).r;
      return vec4f(mix(model, source, weight * .9), 1.);
    }`,
    "rgba8unorm",
  );
  // 缩到目标尺寸：在每个输出像素覆盖的源区域内做 n×n 次双线性采样
  // 取平均（盒式滤波），倍率为 1 时退化为逐像素复制。
  const resample = pipeline(
    `${FULLSCREEN}
    @group(0) @binding(0) var result: texture_2d<f32>;
    @group(0) @binding(1) var linearSampler: sampler;
    @group(0) @binding(2) var<uniform> size: vec4f;
    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      let source = vec2f(textureDimensions(result));
      let ratio = source / size.xy;
      let n = clamp(ceil(ratio), vec2f(1.), vec2f(4.));
      var sum = vec3f(0.);
      for (var j = 0; j < 4; j++) {
        for (var i = 0; i < 4; i++) {
          if (f32(i) < n.x && f32(j) < n.y) {
            let offset = (vec2f(f32(i), f32(j)) + .5) / n - .5;
            sum += textureSampleLevel(result, linearSampler, (p.xy + offset) * ratio / source, 0.).rgb;
          }
        }
      }
      return vec4f(sum / (n.x * n.y), 1.);
    }`,
    navigator.gpu.getPreferredCanvasFormat(),
  );
  const sampler = gpu.createSampler({
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  return { extract, compose, resample, sampler };
}

function createGraph(gpu: GPUDevice, filters: FilterMode[]) {
  const large = largeModel();
  const key = `${filters.join("+")}:${large ? "UL" : "VL"}`;
  if (graph?.key === key) return graph;
  disposeGraph();
  const scale = 2 ** filters.filter((mode) => mode === "A").length;
  // 块越大重叠区占比越低；每次 2× 后中间纹理按面积增长，所以按倍率收缩。
  const side = Math.max(256, Math.min(1024, Math.floor(2048 / scale)));
  const core = side - HALO * 2;
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
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    let texture = source;
    const guard = createTextureGuard(proxy, source);
    const pipelines: Anime4KPipeline[] = [];
    for (const mode of filters) {
      let pipeline: Anime4KPipeline;
      if (mode === "C") {
        const denoise = new BilateralMean({
          device: proxy,
          inputTexture: texture,
        });
        denoise.updateParam("strength", 0.08);
        denoise.updateParam("strength2", 2);
        pipeline = denoise;
      } else if (mode === "A")
        pipeline = large
          ? new CNNx2UL({ device: proxy, inputTexture: texture })
          : new CNNx2VL({ device: proxy, inputTexture: texture });
      else pipeline = new CNNSoftVL({ device: proxy, inputTexture: texture });
      pipelines.push(pipeline);
      texture = pipeline.getOutputTexture();
    }
    const uniform = proxy.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    graph = {
      key,
      core,
      side,
      scale,
      source,
      output: texture,
      uniform,
      pipelines,
      guard,
      resources,
    };
    return graph;
  } catch (error) {
    for (const resource of resources) resource.destroy();
    throw error;
  }
}

async function process(job: Job) {
  const { bitmap, filters, id } = job;
  if (!valid(filters)) throw new Error("滤镜链无效");
  const gpu = await device();
  check(id);
  const scale = 2 ** filters.filter((mode) => mode === "A").length;
  const width = bitmap.width * scale,
    height = bitmap.height * scale;
  const limit = gpu.limits.maxTextureDimension2D;
  if (width * height > 80_000_000 || Math.max(width, height) > limit)
    throw new Error("滤镜输出超过显卡尺寸上限，请减少超分叠加次数");
  const final = enhancedSize(bitmap.width, bitmap.height, scale, job.target);
  const temporary: GPUTexture[] = [];
  gpu.pushErrorScope("out-of-memory");
  gpu.pushErrorScope("validation");
  try {
    const g = createGraph(gpu, filters);
    shaders ??= createShaders(gpu);
    const image = gpu.createTexture({
      size: [bitmap.width, bitmap.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    temporary.push(image);
    gpu.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: image },
      [bitmap.width, bitmap.height],
    );
    const result = gpu.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    temporary.push(result);
    const extract = gpu.createBindGroup({
      layout: shaders.extract.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: image.createView() },
        { binding: 1, resource: { buffer: g.uniform } },
      ],
    });
    const compose = gpu.createBindGroup({
      layout: shaders.compose.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: g.output.createView() },
        { binding: 1, resource: image.createView() },
        { binding: 2, resource: g.guard.texture.createView() },
        { binding: 3, resource: shaders.sampler },
        { binding: 4, resource: { buffer: g.uniform } },
      ],
    });
    const sourceView = g.source.createView(),
      resultView = result.createView();
    for (let y = 0; y < bitmap.height; y += g.core)
      for (let x = 0; x < bitmap.width; x += g.core) {
        check(id);
        // 每块单独提交：writeBuffer 与提交按队列顺序执行，块参数不会串用。
        gpu.queue.writeBuffer(
          g.uniform,
          0,
          new Float32Array([x - HALO, y - HALO, scale, 0]),
        );
        const encoder = gpu.createCommandEncoder();
        const cut = encoder.beginRenderPass({
          colorAttachments: [
            { view: sourceView, loadOp: "clear", storeOp: "store" },
          ],
        });
        cut.setPipeline(shaders.extract);
        cut.setBindGroup(0, extract);
        cut.draw(3);
        cut.end();
        g.guard.pass(encoder);
        for (const pipeline of g.pipelines) pipeline.pass(encoder);
        const merge = encoder.beginRenderPass({
          colorAttachments: [
            { view: resultView, loadOp: "load", storeOp: "store" },
          ],
        });
        merge.setPipeline(shaders.compose);
        merge.setBindGroup(0, compose);
        merge.setScissorRect(
          x * scale,
          y * scale,
          Math.min(g.core, bitmap.width - x) * scale,
          Math.min(g.core, bitmap.height - y) * scale,
        );
        merge.draw(3);
        merge.end();
        gpu.queue.submit([encoder.finish()]);
        // 让出事件循环以便及时响应取消，同时限制排队的显卡工作量。
        await gpu.queue.onSubmittedWorkDone();
      }
    check(id);
    const sizeBuffer = gpu.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    gpu.queue.writeBuffer(
      sizeBuffer,
      0,
      new Float32Array([final.width, final.height, 0, 0]),
    );
    const canvas = new OffscreenCanvas(final.width, final.height);
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("无法创建 Anime4K 输出画布");
    context.configure({
      device: gpu,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "opaque",
    });
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
        },
      ],
    });
    pass.setPipeline(shaders.resample);
    pass.setBindGroup(
      0,
      gpu.createBindGroup({
        layout: shaders.resample.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resultView },
          { binding: 1, resource: shaders.sampler },
          { binding: 2, resource: { buffer: sizeBuffer } },
        ],
      }),
    );
    pass.draw(3);
    pass.end();
    gpu.queue.submit([encoder.finish()]);
    const output = canvas.transferToImageBitmap();
    context.unconfigure();
    sizeBuffer.destroy();
    if (cancelled.has(id)) output.close();
    check(id);
    return {
      bitmap: output,
      scale: final.width / bitmap.width,
      device:
        adapter!.info.description ||
        `${adapter!.info.vendor} ${adapter!.info.architecture}`.trim(),
    };
  } finally {
    // 结果位图已由画布独立持有；整页中间纹理在每页结束后立即释放。
    for (const texture of temporary) texture.destroy();
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
      scope.postMessage({ id: job.id, output }, [output.bitmap]);
    } catch (error) {
      scope.postMessage({ id: job.id, error: (error as Error).message });
    } finally {
      job.bitmap.close();
      cancelled.delete(job.id);
      active = undefined;
    }
  }
  scheduleIdle();
}
