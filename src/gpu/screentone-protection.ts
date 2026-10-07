/// <reference types="@webgpu/types" />

/** CNN restoration is trained for anime frames. Preserve dense manga screentones
 * instead of interpreting their alternating dots as broken line art. */
export function createTextureGuard(device: GPUDevice, source: GPUTexture) {
  const texture = device.createTexture({
    size: [source.width, source.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shader = device.createShaderModule({
    code: `
      @group(0) @binding(0) var source: texture_2d<f32>;
      @group(0) @binding(1) var maskOutput: texture_storage_2d<rgba8unorm, write>;
      fn luma(p: vec2i) -> f32 {
        let point = clamp(p, vec2i(0), vec2i(textureDimensions(source)) - vec2i(1));
        return dot(textureLoad(source, point, 0).rgb, vec3f(.2126, .7152, .0722));
      }
      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3u) {
        if (any(id.xy >= textureDimensions(source))) { return; }
        let p = vec2i(id.xy);
        var energy = 0.;
        var xx = 0.;
        var yy = 0.;
        var xy = 0.;
        for (var y = -2; y <= 2; y += 2) {
          for (var x = -2; x <= 2; x += 2) {
            let q = p + vec2i(x, y);
            let center = 2. * luma(q);
            let left = luma(q - vec2i(1, 0));
            let right = luma(q + vec2i(1, 0));
            let up = luma(q - vec2i(0, 1));
            let down = luma(q + vec2i(0, 1));
            let horizontal = abs(left + right - center);
            let vertical = abs(up + down - center);
            // A straight stroke varies across its normal; dots vary in both axes.
            energy += min(horizontal, vertical);
            let dx = right - left;
            let dy = down - up;
            xx += dx * dx;
            yy += dy * dy;
            xy += dx * dy;
          }
        }
        // Preserve isotropic texture while allowing coherent diagonal strokes to sharpen.
        let coherence = sqrt((xx - yy) * (xx - yy) + 4. * xy * xy) / (xx + yy + .0001);
        let weight = smoothstep(.015, .055, energy / 9.) * (1. - smoothstep(.35, .8, coherence));
        textureStore(maskOutput, p, vec4f(weight, weight, weight, 1.));
      }`,
  });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: shader, entryPoint: "main" },
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: texture.createView() },
    ],
  });
  return {
    texture,
    pass(encoder: GPUCommandEncoder) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(
        Math.ceil(source.width / 8),
        Math.ceil(source.height / 8),
      );
      pass.end();
    },
  };
}
