import { mat4 } from './util.js';

// The renderer skeleton from proceed-to-the-chopper: instanced primitives, ground decals,
// 4x MSAA, bloom and adaptive resolution. Lighting is point lights only (torches, fires,
// daylight), each binned to the tiles it reaches and shadowed by the walls (PLAN.md 7.4).
export const MAX_LIGHTS = 64;
const SHADOW_STEPS = 16; // tiles a shadow ray may cross: enough for the widest light
const SAMPLES = 4;
const BLOOM_LEVELS = 5;   // half resolution down to 1/32
const BLOOM_THRESHOLD = 0.62, BLOOM_KNEE = 0.3, BLOOM_STRENGTH = 0.5;

// Bloom: threshold the resolved frame into a half-res target, blur it down a mip chain and back
// up (dual filtering), then add it over the frame on the way to the screen.
const POST_WGSL = /* wgsl */ `
struct U { px: vec2f, a: f32, b: f32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
@group(0) @binding(3) var scene: texture_2d<f32>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv, 0.0).rgb; }
fn down(uv: vec2f) -> vec3f {
  let d = u.px;
  return (tap(uv) * 4.0 + tap(uv - d) + tap(uv + d) + tap(uv + vec2f(d.x, -d.y)) + tap(uv - vec2f(d.x, -d.y))) / 8.0;
}
@fragment fn fsPrefilter(v: VO) -> @location(0) vec4f {
  let c = pow(down(v.uv), vec3f(2.2));            // the frame is display-encoded; work in linear
  let l = max(c.r, max(c.g, c.b));
  return vec4f(c * smoothstep(u.a, u.a + u.b, l), 1.0);
}
@fragment fn fsDown(v: VO) -> @location(0) vec4f { return vec4f(down(v.uv), 1.0); }
@fragment fn fsUp(v: VO) -> @location(0) vec4f {
  let d = u.px;
  var c = tap(v.uv + vec2f(-2.0 * d.x, 0.0)) + tap(v.uv + vec2f(2.0 * d.x, 0.0)) + tap(v.uv + vec2f(0.0, -2.0 * d.y)) + tap(v.uv + vec2f(0.0, 2.0 * d.y));
  c += (tap(v.uv + d) + tap(v.uv - d) + tap(v.uv + vec2f(d.x, -d.y)) + tap(v.uv - vec2f(d.x, -d.y))) * 2.0;
  return vec4f(c / 12.0, 1.0);
}
@fragment fn fsComposite(v: VO) -> @location(0) vec4f {
  let c = pow(textureSampleLevel(scene, smp, v.uv, 0.0).rgb, vec3f(2.2)) + tap(v.uv) * u.a;
  return vec4f(pow(min(c, vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}
`;

const WGSL = /* wgsl */ `
struct Light { pos: vec4f, col: vec4f };
struct Scene {
  viewProj: mat4x4f,
  camPos: vec4f,
  camRight: vec4f,
  camUp: vec4f,
  info: vec4f,      // mapW, mapH, time, nLights
  keyDir: vec4f,
  keyCol: vec4f,
  sky: vec4f,       // ambient from above
  ground: vec4f,    // ambient from below
  lights: array<Light, ${MAX_LIGHTS}>,
};
@group(0) @binding(0) var<uniform> S: Scene;
// one texel per tile: bit k of (r, g) is set if light k (or 32 + k) reaches the tile
@group(0) @binding(1) var lightMask: texture_2d<u32>;
// one texel per tile: 1 where light can't pass (rock, closed doors)
@group(0) @binding(2) var wallTex: texture_2d<f32>;

fn h2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn h3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn noise2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2f(1.0, 0.0)), u.x), mix(h2(i + vec2f(0.0, 1.0)), h2(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn tonemap(c: vec3f) -> vec3f {
  let t = vec3f(1.0) - exp(-c * 1.5);
  return pow(t, vec3f(1.0 / 2.2));
}
fn rotm(yaw: f32, pitch: f32, roll: f32) -> mat3x3f {
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  let cr = cos(roll); let sr = sin(roll);
  let ry = mat3x3f(vec3f(cy, 0.0, sy), vec3f(0.0, 1.0, 0.0), vec3f(-sy, 0.0, cy));
  let rz = mat3x3f(vec3f(cp, sp, 0.0), vec3f(-sp, cp, 0.0), vec3f(0.0, 0.0, 1.0));
  let rx = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, cr, sr), vec3f(0.0, -sr, cr));
  return ry * rz * rx;
}

// Instance: a = base position + yaw, b = size + pitch, c = linear colour + roll,
// d = (emissive, material, unused, seed). The mesh's local origin is its base centre.
struct VIn {
  @location(0) pos: vec3f, @location(1) nrm: vec3f,
  @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f, @location(5) d: vec4f,
};
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) @interpolate(flat) m: vec4f,
};

@vertex fn vsMesh(v: VIn) -> VOut {
  let R = rotm(v.a.w, v.b.w, v.c.w);
  let wp = R * (v.pos * v.b.xyz) + v.a.xyz;
  var o: VOut;
  o.clip = S.viewProj * vec4f(wp, 1.0);
  o.wpos = wp; o.nrm = normalize(R * (v.nrm / v.b.xyz)); o.col = v.c.xyz; o.m = v.d;
  return o;
}

// Grid-raymarched shadow: step through the tiles between the point p and the light (both on
// the ground plane) and stop at the first wall. Walls are full height and lights sit below
// the ceiling, so a wall tile in between always blocks. Start and end tiles never block:
// the start is the surface's own tile and the light may stand in a doorway.
fn lit(p: vec2f, l: vec2f) -> bool {
  let d = l - p;
  var cell = vec2i(floor(p));
  let end = vec2i(floor(l));
  let stepv = vec2i(sign(d));
  let inv = 1.0 / max(abs(d), vec2f(1e-6));
  let fp = fract(p);
  var tMax = select(1.0 - fp, fp, d < vec2f(0.0)) * inv;
  for (var k = 0; k < ${SHADOW_STEPS}; k++) {
    if (all(cell == end)) { return true; }
    if (tMax.x < tMax.y) { cell.x += stepv.x; tMax.x += inv.x; } else { cell.y += stepv.y; tMax.y += inv.y; }
    if (all(cell == end)) { return true; }
    if (textureLoad(wallTex, cell, 0).r > 0.5) { return false; }
  }
  return true;
}

fn shade(wp: vec3f, N: vec3f, base: vec3f, spec: f32, gloss: f32) -> vec3f {
  let V = normalize(S.camPos.xyz - wp);
  let Ld = normalize(S.keyDir.xyz);
  var diff = mix(S.ground.rgb, S.sky.rgb, N.y * 0.5 + 0.5);
  diff += S.keyCol.rgb * max(dot(N, Ld), 0.0);
  var sp = S.keyCol.rgb * pow(max(dot(N, normalize(Ld + V)), 0.0), gloss) * spec;
  let cell = clamp(vec2i(floor(wp.xz)), vec2i(0), vec2i(S.info.xy) - 1);
  // the top of a wall tile is solid rock under the ceiling: no lamp or torch reaches it
  // (only matters with low walls, when the tops face the lights)
  let rockTop = N.y > 0.5 && wp.y > 0.1 && textureLoad(wallTex, cell, 0).r > 0.5;
  let masks = select(textureLoad(lightMask, cell, 0).rg, vec2u(0u), rockTop);
  // nudge off the surface so wall faces test from the open tile in front of them
  let p0 = wp.xz + N.xz * 0.04;
  for (var word = 0u; word < 2u; word++) {
    var mask = select(masks.x, masks.y, word == 1u);
    loop {
      if (mask == 0u) { break; }
      let L = S.lights[firstTrailingBit(mask) + word * 32u];
      mask &= mask - 1u;
      let d = L.pos.xyz - wp;
      let dist = length(d);
      let q = clamp(1.0 - (dist * dist) / (L.pos.w * L.pos.w), 0.0, 1.0);
      if (q <= 0.0) { continue; }
      let l = d / max(dist, 0.001);
      let nl = dot(N, l);
      if (nl <= 0.0 || !lit(p0, L.pos.xz)) { continue; }
      let c = L.col.rgb * (L.col.w * q * q);
      diff += c * nl;
      sp += c * pow(max(dot(N, normalize(l + V)), 0.0), gloss) * spec;
    }
  }
  return base * diff + sp;
}

// Materials (d.y): 0 matte, 1 hewn rock, 2 flagstones, 3 water, 4 unlit (emissive only)
@fragment fn fsMesh(i: VOut) -> @location(0) vec4f {
  let mat = i32(i.m.y + 0.5);
  let N = normalize(i.nrm);
  let wp = i.wpos;
  var base = i.col;
  var spec = 0.05;
  var gloss = 12.0;
  if (mat == 1) {
    // rough blocks: jitter per half-metre block, darker in the joints
    let q = select(select(vec2f(wp.x, wp.y), vec2f(wp.z, wp.y), abs(N.x) > 0.5), wp.xz, N.y > 0.5);
    let b = floor(q * vec2f(2.0, 2.6));
    base = base * (0.82 + 0.3 * h2(b + vec2f(i.m.w * 7.0, 0.0)));
    let f = fract(q * vec2f(2.0, 2.6));
    let joint = step(f.x, 0.06) + step(f.y, 0.08);
    base = base * (1.0 - 0.35 * min(joint, 1.0));
  } else if (mat == 2) {
    let f = fract(wp.xz);
    let seam = step(f.x, 0.04) + step(f.y, 0.04);
    base = base * (0.9 + 0.2 * h2(floor(wp.xz))) * (1.0 - 0.3 * min(seam, 1.0));
  } else if (mat == 3) {
    let rip = noise2(wp.xz * 3.0 + vec2f(S.info.z * 0.4, S.info.z * 0.3));
    base = base * (0.85 + 0.3 * rip);
    // a tight glint: lights hang close over the water, so a broad highlight floods it
    spec = 0.4; gloss = 220.0;
  }
  var col = shade(wp, N, base, spec, gloss) + i.col * i.m.x;
  if (mat == 4) { col = i.col * max(i.m.x, 1.0); }
  return vec4f(tonemap(col), 1.0);
}

// ---------- ground decals (overlays: hover, path, room tint, the green circle) ----------
// Instance: a = centre + rotation, b = (size x, size z, shape, unused), c = display rgba,
// d = (shape parameter, seed, lit, unused). Lit decals are floor markings, shaded like the
// floor; the rest are interface overlays and glow at full strength.
struct DOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
  @location(2) @interpolate(flat) p: vec4f,
  @location(3) @interpolate(flat) sz: vec4f,
  @location(4) wp: vec3f,
};
@vertex fn vsDecal(@location(0) corner: vec2f, @location(1) a: vec4f, @location(2) b: vec4f, @location(3) c: vec4f, @location(4) d: vec4f) -> DOut {
  let cr = cos(a.w); let sr = sin(a.w);
  let lx = corner.x * b.x; let lz = corner.y * b.y;
  let wp = vec3f(a.x + lx * cr - lz * sr, a.y, a.z + lx * sr + lz * cr);
  var o: DOut;
  o.clip = S.viewProj * vec4f(wp, 1.0);
  o.uv = corner * 2.0; o.col = c; o.p = d; o.sz = b; o.wp = wp;
  return o;
}
// Shapes: 0 soft square, 1 ring, 2 disc, 3 square frame, 6 chevron (+x), 8 pulsing disc, 9 dashed ring
@fragment fn fsDecal(v: DOut) -> @location(0) vec4f {
  let shape = i32(v.sz.z + 0.5);
  let uv = v.uv;
  let r = length(uv);
  let e = max(abs(uv.x), abs(uv.y));
  let t = S.info.z;
  var a = 0.0;
  if (shape == 0) { a = 1.0 - smoothstep(1.0 - v.p.x, 1.0, e); }
  else if (shape == 1) { let w = v.p.x; a = 1.0 - smoothstep(0.0, w, abs(r - (1.0 - w))); }
  else if (shape == 2) { a = 1.0 - smoothstep(1.0 - v.p.x, 1.0, r); }
  else if (shape == 3) { let w = v.p.x; a = smoothstep(1.0 - w - 0.06, 1.0 - w, e) * (1.0 - smoothstep(0.96, 1.0, e)); }
  else if (shape == 6) { let x = uv.x; let y = abs(uv.y); a = step(abs(x + y * 0.9 - 0.2), 0.28) * step(y, 0.85) * step(-0.9, x); }
  else if (shape == 8) { a = (1.0 - smoothstep(0.6, 1.0, r)) * (0.6 + 0.4 * sin(t * 4.0 + v.p.y)); }
  else if (shape == 9) {
    let ang = atan2(uv.y, uv.x) + t * 0.6;
    a = (1.0 - smoothstep(0.0, v.p.x, abs(r - (1.0 - v.p.x)))) * step(0.0, sin(ang * 12.0));
  }
  if (a <= 0.004) { discard; }
  var col = v.col.rgb;
  if (v.p.z > 0.5) { col = tonemap(shade(v.wp, vec3f(0.0, 1.0, 0.0), pow(col, vec3f(2.2)), 0.05, 12.0)); }
  return vec4f(col, v.col.a * a);
}
`;

function boxMesh() {
  const v = [];
  const face = (n, u, w) => {
    // n normal, u & w tangents; emit two triangles
    const c = (su, sw) => [0.5 * n[0] + 0.5 * su * u[0] + 0.5 * sw * w[0], 0.5 * n[1] + 0.5 * su * u[1] + 0.5 * sw * w[1], 0.5 * n[2] + 0.5 * su * u[2] + 0.5 * sw * w[2]];
    const p = [c(-1, -1), c(1, -1), c(1, 1), c(-1, -1), c(1, 1), c(-1, 1)];
    for (const q of p) v.push(q[0], q[1] + 0.5, q[2], ...n);
  };
  face([1, 0, 0], [0, 1, 0], [0, 0, 1]); face([-1, 0, 0], [0, 0, 1], [0, 1, 0]);
  face([0, 1, 0], [0, 0, 1], [1, 0, 0]); face([0, -1, 0], [1, 0, 0], [0, 0, 1]);
  face([0, 0, 1], [1, 0, 0], [0, 1, 0]); face([0, 0, -1], [0, 1, 0], [1, 0, 0]);
  return new Float32Array(v);
}
function cylMesh(seg = 14) {
  const v = [];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0) * 0.5, z0 = Math.sin(a0) * 0.5, x1 = Math.cos(a1) * 0.5, z1 = Math.sin(a1) * 0.5;
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    v.push(x0, 0, z0, ...n0, x1, 0, z1, ...n1, x1, 1, z1, ...n1);
    v.push(x0, 0, z0, ...n0, x1, 1, z1, ...n1, x0, 1, z0, ...n0);
    v.push(0, 1, 0, 0, 1, 0, x1, 1, z1, 0, 1, 0, x0, 1, z0, 0, 1, 0);
    v.push(0, 0, 0, 0, -1, 0, x0, 0, z0, 0, -1, 0, x1, 0, z1, 0, -1, 0);
  }
  return new Float32Array(v);
}
function sphereMesh(seg = 12, rings = 8) {
  const v = [];
  const pt = (r, s) => {
    const th = (r / rings) * Math.PI, ph = (s / seg) * Math.PI * 2;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    return [n[0] * 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5, ...n];
  };
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = pt(r, s), b = pt(r + 1, s), c = pt(r + 1, s + 1), d = pt(r, s + 1);
    v.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return new Float32Array(v);
}

// CPU-side growable instance list: 16 floats per mesh instance.
export class Instances {
  constructor(cap = 1024) { this.f = new Float32Array(cap * 16); this.n = 0; }
  clear() { this.n = 0; }
  grow() { const f = new Float32Array(this.f.length * 2); f.set(this.f); this.f = f; }
  // x,y,z = base position; sx,sy,sz = size; col = linear rgb
  add(x, y, z, sx, sy, sz, yaw, col, mat = 0, emis = 0, pitch = 0, roll = 0, seed = 0) {
    if ((this.n + 1) * 16 > this.f.length) this.grow();
    const f = this.f, o = this.n++ * 16;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = yaw;
    f[o + 4] = sx; f[o + 5] = sy; f[o + 6] = sz; f[o + 7] = pitch;
    f[o + 8] = col[0]; f[o + 9] = col[1]; f[o + 10] = col[2]; f[o + 11] = roll;
    f[o + 12] = emis; f[o + 13] = mat; f[o + 14] = 0; f[o + 15] = seed;
  }
}
export class FlatList {
  constructor(stride, cap = 512) { this.s = stride; this.f = new Float32Array(cap * stride); this.n = 0; }
  clear() { this.n = 0; }
  // reads `arguments` rather than a rest array, so the hundreds of pushes per frame allocate nothing
  push() {
    const s = this.s;
    if ((this.n + 1) * s > this.f.length) { const f = new Float32Array(this.f.length * 2); f.set(this.f); this.f = f; }
    const f = this.f, o = this.n++ * s;
    for (let k = 0; k < s; k++) f[o + k] = arguments[k];
  }
}
export const MESHES = ['box', 'cyl', 'sph'];

export class Renderer {
  async init(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found.');
    const device = (this.device = await adapter.requestDevice());
    device.lost.then((info) => { console.error('WebGPU device lost', info.message); this.onLost?.(info); });
    this.canvas = canvas;
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    const mod = device.createShaderModule({ code: WGSL });
    mod.getCompilationInfo?.().then((info) => { for (const m of info.messages) if (m.type === 'error') console.error('WGSL', m.lineNum, m.message); });

    this.meshes = {};
    for (const [name, data] of [['box', boxMesh()], ['cyl', cylMesh()], ['sph', sphereMesh()]]) {
      const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, data);
      this.meshes[name] = { buf, count: data.length / 6 };
    }
    const quad = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
    this.quadBuf = device.createBuffer({ size: quad.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.quadBuf, 0, quad);

    this.uniformSize = 64 + 16 * 8 + MAX_LIGHTS * 32;
    this.uniformData = new Float32Array(this.uniformSize / 4);
    this.ubuf = device.createBuffer({ size: this.uniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.linSamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    const mainBGL = (this.mainBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ] }));
    const mainLayout = device.createPipelineLayout({ bindGroupLayouts: [mainBGL] });

    const meshBuffers = [
      { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
      { arrayStride: 64, stepMode: 'instance', attributes: [0, 1, 2, 3].map((k) => ({ shaderLocation: 2 + k, offset: k * 16, format: 'float32x4' })) },
    ];
    const ds = (write) => ({ format: 'depth24plus', depthWriteEnabled: write, depthCompare: 'less-equal' });
    const ms = { count: SAMPLES };
    const alphaBlend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const oneBlend = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };

    this.meshPipe = device.createRenderPipeline({
      layout: mainLayout,
      vertex: { module: mod, entryPoint: 'vsMesh', buffers: meshBuffers },
      fragment: { module: mod, entryPoint: 'fsMesh', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: ds(true), multisample: ms,
    });
    const decalDesc = (depth) => ({
      layout: mainLayout,
      vertex: { module: mod, entryPoint: 'vsDecal', buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        { arrayStride: 64, stepMode: 'instance', attributes: [0, 1, 2, 3].map((k) => ({ shaderLocation: 1 + k, offset: k * 16, format: 'float32x4' })) },
      ] },
      fragment: { module: mod, entryPoint: 'fsDecal', targets: [{ format: this.format, blend: alphaBlend }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: depth ? 'less-equal' : 'always' }, multisample: ms,
    });
    this.decalPipe = device.createRenderPipeline(decalDesc(true));
    // overlays that must read through walls (the path preview), drawn faintly on top
    this.xrayPipe = device.createRenderPipeline(decalDesc(false));

    const post = device.createShaderModule({ code: POST_WGSL });
    post.getCompilationInfo?.().then((info) => { for (const m of info.messages) if (m.type === 'error') console.error('WGSL post', m.lineNum, m.message); });
    this.postBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const postLayout = device.createPipelineLayout({ bindGroupLayouts: [this.postBGL] });
    const postPipe = (entry, format, blend) => device.createRenderPipeline({
      layout: postLayout, vertex: { module: post, entryPoint: 'vsFull' },
      fragment: { module: post, entryPoint: entry, targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' },
    });
    this.bloomPipes = {
      prefilter: postPipe('fsPrefilter', 'rgba16float'),
      down: postPipe('fsDown', 'rgba16float'),
      up: postPipe('fsUp', 'rgba16float', oneBlend),
      composite: postPipe('fsComposite', this.format),
    };

    this.gpuBufs = {};
    this.resize();
  }

  // Grow-on-demand GPU buffer keyed by name.
  upload(name, data, bytes) {
    let b = this.gpuBufs[name];
    if (!b || b.size < bytes) {
      b?.destroy();
      b = this.gpuBufs[name] = this.device.createBuffer({ size: Math.max(bytes, 1024) * 1.5 & ~3, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (bytes) this.device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, bytes);
    return b;
  }

  // The tile grid the lighting works on. walls: Uint8Array, 255 where light can't pass.
  setMap(w, h, walls) {
    if (this.mapW !== w || this.mapH !== h) {
      this.mapW = w; this.mapH = h;
      this.maskTex?.destroy(); this.wallTex?.destroy();
      this.maskTex = this.device.createTexture({ size: [w, h], format: 'rg32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.wallTex = this.device.createTexture({ size: [w, h], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.mask = new Uint32Array(w * h * 2);
      this.mainBG = this.device.createBindGroup({ layout: this.mainBGL, entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: this.maskTex.createView() },
        { binding: 2, resource: this.wallTex.createView() },
      ] });
    }
    // rows of an r8 texture upload in steps of 256 bytes
    const row = Math.ceil(w / 256) * 256, data = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) data.set(walls.subarray(y * w, y * w + w), y * row);
    this.device.queue.writeTexture({ texture: this.wallTex }, data, { bytesPerRow: row }, [w, h]);
  }

  // Light culling: mark every tile each light's radius reaches, so a pixel only loops over the
  // handful of lights near it instead of all of them. Tested on the ground plane (xz), which is
  // conservative: the shader's attenuation still handles height.
  binLights(lights, nl) {
    const w = this.mapW, h = this.mapH, mask = this.mask;
    mask.fill(0);
    for (let k = 0; k < nl; k++) {
      const [lx, , lz, r] = lights[k], r2 = r * r, word = k >> 5, bit = 1 << (k & 31);
      const x0 = Math.max(0, Math.floor(lx - r)), x1 = Math.min(w - 1, Math.floor(lx + r));
      const z0 = Math.max(0, Math.floor(lz - r)), z1 = Math.min(h - 1, Math.floor(lz + r));
      for (let z = z0; z <= z1; z++) {
        const dz = lz < z ? z - lz : lz > z + 1 ? lz - z - 1 : 0;
        for (let x = x0; x <= x1; x++) {
          const dx = lx < x ? x - lx : lx > x + 1 ? lx - x - 1 : 0;
          if (dx * dx + dz * dz <= r2) mask[(z * w + x) * 2 + word] |= bit;
        }
      }
    }
    this.device.queue.writeTexture({ texture: this.maskTex }, mask, { bytesPerRow: w * 8 }, [w, h]);
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    const maxPx = 3.6e6 * (this.scale ?? 1) ** 2;
    if (w * h > maxPx) { const k = Math.sqrt(maxPx / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
    if (c.width === w && c.height === h && this.msaa) return;
    c.width = w; c.height = h;
    this.msaa?.destroy(); this.depth?.destroy();
    this.msaa = this.device.createTexture({ size: [w, h], sampleCount: SAMPLES, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depth = this.device.createTexture({ size: [w, h], sampleCount: SAMPLES, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.msaaView = this.msaa.createView();
    this.depthView = this.depth.createView();
    this.buildBloom(w, h);
  }

  // The frame resolves into sceneTex instead of the screen, so bloom can read it.
  buildBloom(w, h) {
    const d = this.device;
    for (const t of this.bloomTex || []) t.destroy();
    this.sceneTex?.destroy();
    for (const b of this.bloomBufs || []) b.destroy();
    this.sceneTex = d.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.sceneView = this.sceneTex.createView();
    this.bloomTex = []; this.bloomViews = []; this.bloomSize = [];
    for (let k = 0; k < BLOOM_LEVELS; k++) {
      const s = [Math.max(1, Math.ceil(w / 2 ** (k + 1))), Math.max(1, Math.ceil(h / 2 ** (k + 1)))];
      const t = d.createTexture({ size: s, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.bloomTex.push(t); this.bloomViews.push(t.createView()); this.bloomSize.push(s);
    }
    // one bind group per pass: [source view, source size, uniform a, uniform b, target view, pipe, load]
    const V = this.bloomViews, Z = this.bloomSize;
    const steps = [['prefilter', this.sceneView, [w, h], BLOOM_THRESHOLD, BLOOM_KNEE, V[0]]];
    for (let k = 1; k < BLOOM_LEVELS; k++) steps.push(['down', V[k - 1], Z[k - 1], 0, 0, V[k]]);
    for (let k = BLOOM_LEVELS - 1; k > 0; k--) steps.push(['up', V[k], Z[k], 0, 0, V[k - 1]]);
    steps.push(['composite', V[0], Z[0], BLOOM_STRENGTH, 0, null]);
    this.bloomBufs = [];
    this.bloomSteps = steps.map(([pipe, src, [sw, sh], a, b, dst]) => {
      const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(buf, 0, new Float32Array([1 / sw, 1 / sh, a, b]));
      this.bloomBufs.push(buf);
      const bg = d.createBindGroup({ layout: this.postBGL, entries: [
        { binding: 0, resource: src }, { binding: 1, resource: this.linSamp },
        { binding: 2, resource: { buffer: buf } }, { binding: 3, resource: this.sceneView },
      ] });
      return { pipe: this.bloomPipes[pipe], bg, dst, load: pipe === 'up' };
    });
  }

  bloom(enc) {
    for (const st of this.bloomSteps) {
      const view = st.dst || this.ctx.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: st.load ? 'load' : 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }] });
      pass.setPipeline(st.pipe); pass.setBindGroup(0, st.bg); pass.draw(3);
      pass.end();
    }
  }

  drawSet(pass, mesh, bufName, n) {
    if (!n) return;
    pass.setVertexBuffer(0, this.meshes[mesh].buf);
    pass.setVertexBuffer(1, this.gpuBufs[bufName]);
    pass.draw(this.meshes[mesh].count, n);
  }

  // frame: { viewProj, camPos, camRight, camUp, mapW, mapH, time, keyDir, keyCol, sky, ground,
  //          lights: [[x,y,z,r, cr,cg,cb,intensity]], staticSets: {box,cyl,sph}, staticVersion,
  //          staticDecals, staticDecalsVersion, dynSets: {box,cyl,sph}, decals, xray,
  //          walls (Uint8Array per tile, 255 = blocks light), wallsVersion }
  render(fr) {
    const d = this.device;
    const u = this.uniformData;
    u.set(fr.viewProj, 0);
    u.set([...fr.camPos, 1], 16); u.set([...fr.camRight, 0], 20); u.set([...fr.camUp, 0], 24);
    const nl = Math.min(fr.lights.length, MAX_LIGHTS);
    u.set([fr.mapW, fr.mapH, fr.time, nl], 28);
    u.set([...fr.keyDir, 0], 32); u.set([...fr.keyCol, 0], 36); u.set([...fr.sky, 0], 40); u.set([...fr.ground, 0], 44);
    for (let k = 0; k < nl; k++) u.set(fr.lights[k], 48 + k * 8);
    d.queue.writeBuffer(this.ubuf, 0, u);
    if (fr.wallsVersion !== this.wallsVersion) { this.wallsVersion = fr.wallsVersion; this.setMap(fr.mapW, fr.mapH, fr.walls); }
    this.binLights(fr.lights, nl);

    // the dungeon itself only changes when the map does
    if (fr.staticVersion !== this.staticVersion) {
      this.staticVersion = fr.staticVersion;
      for (const m of MESHES) this.upload('s_' + m, fr.staticSets[m].f, fr.staticSets[m].n * 64);
    }
    for (const m of MESHES) { const s = fr.dynSets[m]; this.upload('d_' + m, s.f, s.n * 64); }
    const sd = fr.staticDecals, dec = fr.decals, xr = fr.xray;
    if (fr.staticDecalsVersion !== this.staticDecalsVersion) {
      this.staticDecalsVersion = fr.staticDecalsVersion;
      this.upload('sdecal', sd.f, sd.n * 64);
    }
    this.upload('decal', dec.f, dec.n * 64);
    this.upload('xray', xr.f, xr.n * 64);

    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.msaaView, resolveTarget: this.sceneView, clearValue: { r: 0.012, g: 0.011, b: 0.01, a: 1 }, loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    pass.setBindGroup(0, this.mainBG);
    pass.setPipeline(this.meshPipe);
    for (const m of MESHES) {
      this.drawSet(pass, m, 's_' + m, fr.staticSets[m].n);
      this.drawSet(pass, m, 'd_' + m, fr.dynSets[m].n);
    }
    pass.setVertexBuffer(0, this.quadBuf);
    if (sd.n || dec.n) pass.setPipeline(this.decalPipe);
    if (sd.n) { pass.setVertexBuffer(1, this.gpuBufs.sdecal); pass.draw(6, sd.n); }
    if (dec.n) { pass.setVertexBuffer(1, this.gpuBufs.decal); pass.draw(6, dec.n); }
    if (xr.n) { pass.setPipeline(this.xrayPipe); pass.setVertexBuffer(1, this.gpuBufs.xray); pass.draw(6, xr.n); }
    pass.end();
    this.bloom(enc);
    d.queue.submit([enc.finish()]);
  }
}

// Camera: orbits the target at a fixed pitch. yaw 0 looks north from the south;
// increasing yaw turns the world clockwise on screen.
export class Camera {
  constructor() {
    this.tx = 26; this.tz = 17; this.dist = 30; this.pitch = 0.96; this.fov = 0.78;
    this.yaw = 0; this.yawGoal = null;
    this.goal = null; this.aspect = 1;
  }
  // Ground-plane directions of screen-right and screen-up.
  axes() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { right: [c, -s], fwd: [-s, -c] };
  }
  // Move the target so the map follows a finger drag of (dx, dy) css pixels.
  pan(dx, dy, worldPerPx) {
    const { right, fwd } = this.axes();
    const a = -dx * worldPerPx, b = (dy * worldPerPx) / Math.sin(this.pitch);
    this.tx += right[0] * a + fwd[0] * b;
    this.tz += right[1] * a + fwd[1] * b;
    this.goal = null;
  }
  // Turn by a quarter step, snapping to the nearest compass direction.
  turn(dir) {
    const q = Math.PI / 2;
    this.yawGoal = Math.round((this.yawGoal ?? this.yaw) / q) * q + dir * q;
  }
  faceNorth() { this.yawGoal = Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2; }
  matrices(w, h) {
    this.aspect = w / h;
    const c = Math.cos(this.pitch) * this.dist;
    const eye = [this.tx + Math.sin(this.yaw) * c, Math.sin(this.pitch) * this.dist, this.tz + Math.cos(this.yaw) * c];
    this._eye = eye;
    const view = mat4.lookAt(eye, [this.tx, 0, this.tz], [0, 1, 0]);
    const proj = mat4.perspective(this.fov, this.aspect, 0.5, 300);
    this.vp = mat4.mul(proj, view);
    const f = norm([this.tx - eye[0], -eye[1], this.tz - eye[2]]);
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    this.basis = { f, r, u };
    return { vp: this.vp, eye, right: r, up: u };
  }
  // screen (css px) -> ray
  ray(px, py, w, h) {
    const { f, r, u } = this.basis;
    const ny = Math.tan(this.fov / 2), nx = ny * this.aspect;
    const sx = (px / w) * 2 - 1, sy = 1 - (py / h) * 2;
    const d = norm([f[0] + r[0] * sx * nx + u[0] * sy * ny, f[1] + r[1] * sx * nx + u[1] * sy * ny, f[2] + r[2] * sx * nx + u[2] * sy * ny]);
    return { o: this._eye, d };
  }
  project(x, y, z, w, h) {
    const c = mat4.xform(this.vp, x, y, z);
    if (c[3] <= 0) return null;
    return [((c[0] / c[3]) * 0.5 + 0.5) * w, (0.5 - (c[1] / c[3]) * 0.5) * h];
  }
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
