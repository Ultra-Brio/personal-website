/*
 * The polaroid's picture when the profile has no image: "desk, 2 a.m." — the desk the folio was drawn on, shot from above at night
 * on instant film. It is computed like a photograph, not drawn like an illustration:
 *   - one light: a desk lamp just out of frame (top right), a point source in a shade, so the desk gets a real pool of light
 *     (inverse square, cosine, the shade's cone) and every object casts a soft shadow whose penumbra grows with height;
 *   - a camera: a pinhole 42 cm above the frame's centre, so the mug shows its wall on the side facing the centre and its rim,
 *     inner wall and coffee surface at their own heights;
 *   - materials: oiled walnut (warped growth rings, pores along the grain, a satin sheen where the lamp reflects), speckled
 *     stoneware glaze, black coffee with its tide line, a lacquered hexagonal pencil, a sheet with a pencil sketch on it and the
 *     ring the first coffee left;
 *   - the film: soft lens, halation round the highlights, a soft shoulder, lifted cool blacks, creamy highlights, a little
 *     chromatic fringe, a heavy vignette, uneven development and grain.
 * Every edge is an analytic signed distance with a one-pixel ramp, so nothing is outlined and nothing is sharper than an instant
 * print. Pure 2D canvas + typed arrays, deterministic per seed; the finished picture is cached per seed, tint and size.
 */
import { clamp, makeCanvas, mixHex, parseColor, rng, smoothstep } from "./shared";

/** Separable box blur, three passes (close to a Gaussian of sigma ~ r * 0.58 * sqrt(3)), in place on one plane. */
function blurPlane(a: Float32Array, w: number, h: number, r: number, tmp: Float32Array) {
  const R = Math.max(0, Math.round(r));
  if (R === 0) return;
  const norm = 1 / (2 * R + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -R; x <= R; x++) acc += a[row + clamp(x, 0, w - 1)]!;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc * norm;
        acc += a[row + Math.min(x + R + 1, w - 1)]! - a[row + Math.max(x - R, 0)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -R; y <= R; y++) acc += tmp[clamp(y, 0, h - 1) * w + x]!;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm;
        acc += tmp[Math.min(y + R + 1, h - 1) * w + x]! - tmp[Math.max(y - R, 0) * w + x]!;
      }
    }
  }
}

/* ---------- value noise on the fly (no lattice arrays: the wood needs anisotropic, unbounded coordinates) ---------- */

function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, s: number, oct: number): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    v += vnoise(x * f, y * f, s + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/* ---------- small vector helpers (scene units: the frame is 1 x 1, x right, y DOWN, z up; 1 unit ~ 34 cm of desk) ---------- */

type V3 = [number, number, number];
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Distance from p to segment ab, and the parameter of the closest point. */
function seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const ex = bx - ax, ey = by - ay;
  const t = clamp(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
  return [Math.hypot(px - ax - t * ex, py - ay - t * ey), t];
}

/** Pencil marks on the sheet, in its own frame (0..1 across, 0..1 down): a sketch of the folio and notes beside it. */
function sketchSheet(w: number, h: number, seed: number): Float32Array {
  const { c, g } = makeCanvas(w, h);
  const r = rng(seed ^ 0x5e7c);
  const X = (u: number) => u * w, Y = (v: number) => v * h;
  g.lineCap = "round";
  g.lineJoin = "round";
  /** a pencil line: drawn twice, a hair apart, wobbling, pressure varying along it */
  const line = (pts: [number, number][], width = 2.2, alpha = 0.75) => {
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      const ox = (r() - 0.5) * 2.2, oy = (r() - 0.5) * 2.2;
      pts.forEach(([u, v], i) => {
        const x = X(u) + ox + (r() - 0.5) * 1.4, y = Y(v) + oy + (r() - 0.5) * 1.4;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.strokeStyle = `rgba(0,0,0,${alpha * (pass ? 0.45 : 1) * (0.75 + r() * 0.25)})`;
      g.lineWidth = width * (pass ? 0.7 : 1);
      g.stroke();
    }
  };
  /** a straight-ish stroke, split so it can wobble */
  const stroke = (u0: number, v0: number, u1: number, v1: number, width?: number, alpha?: number) => {
    const n = 6;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n]);
    line(pts, width, alpha);
  };
  const rect = (u0: number, v0: number, u1: number, v1: number, width?: number) => {
    stroke(u0 - 0.008, v0, u1 + 0.006, v0 + 0.002, width);
    stroke(u1, v0 - 0.006, u1 - 0.002, v1 + 0.008, width);
    stroke(u1 + 0.008, v1, u0 - 0.004, v1 - 0.002, width);
    stroke(u0, v1 + 0.006, u0 + 0.002, v0 - 0.008, width);
  };
  /** handwriting: a wavy run of loops on a baseline, broken into words */
  const words = (u0: number, v: number, u1: number, size: number) => {
    let u = u0;
    while (u < u1 - 0.04) {
      const len = Math.min(u1 - u, 0.05 + r() * 0.12);
      const pts: [number, number][] = [];
      const steps = Math.max(6, Math.round(len * 90));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ph = t * len * 140;
        pts.push([u + t * len, v - Math.abs(Math.sin(ph)) * size * (0.55 + 0.45 * Math.sin(ph * 0.37 + r())) + Math.sin(ph * 0.5) * size * 0.12]);
      }
      line(pts, 1.6, 0.6);
      u += len + 0.025 + r() * 0.02;
    }
  };
  // the open folio: two boards, the spine, a hatch of shade on its right
  rect(0.14, 0.12, 0.47, 0.5);
  rect(0.49, 0.12, 0.82, 0.5);
  for (let i = 0; i < 9; i++) stroke(0.83 + i * 0.008, 0.14 + i * 0.002, 0.83 + i * 0.008 + 0.02, 0.5, 1.2, 0.45);
  // the pouch in the right board, its zip, and four things in it
  rect(0.53, 0.16, 0.78, 0.46, 1.8);
  stroke(0.54, 0.185, 0.77, 0.185, 1.2, 0.6);
  rect(0.56, 0.24, 0.66, 0.39, 1.4);
  rect(0.65, 0.22, 0.75, 0.31, 1.4);
  rect(0.6, 0.36, 0.76, 0.42, 1.4);
  rect(0.57, 0.39, 0.64, 0.44, 1.2);
  // the liner: lines on the left board
  for (let i = 0; i < 4; i++) stroke(0.19, 0.24 + i * 0.05, 0.4 - i * 0.03, 0.24 + i * 0.05, 1.3, 0.55);
  // an arrow from a note to the pouch
  line([[0.86, 0.6], [0.82, 0.56], [0.77, 0.47]], 1.6);
  line([[0.76, 0.5], [0.77, 0.47], [0.8, 0.49]], 1.6);
  words(0.62, 0.64, 0.95, 0.018);
  // notes under it
  for (let i = 0; i < 6; i++) words(0.14, 0.62 + i * 0.055, 0.14 + 0.42 + r() * 0.25, 0.016);
  // a crossed-out line
  stroke(0.14, 0.952, 0.48, 0.948, 1.4, 0.7);
  words(0.14, 0.96, 0.5, 0.016);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3]! / 255;
  return out;
}

/** Bilinear lookup into a w x h plane at (u, v) in 0..1 (0 outside). */
function sample(a: Float32Array, w: number, h: number, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const x = u * (w - 1), y = v * (h - 1);
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const i = iy * w + ix;
  const a00 = a[i]!, a10 = a[Math.min(i + 1, a.length - 1)]!, a01 = a[Math.min(i + w, a.length - 1)]!, a11 = a[Math.min(i + w + 1, a.length - 1)]!;
  return a00 + (a10 - a00) * fx + (a01 - a00) * fy + (a00 - a10 - a01 + a11) * fx * fy;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Paint the photograph into `g` at (x0, y0), `size` px square. `tint` warms or cools the print (the profile's tint), `seed`
 * varies the grain, the speckle and the hand in the sketch.
 */
export function paintDeskAtNight(g: CanvasRenderingContext2D, x0: number, y0: number, size: number, tint: string, seed: number) {
  const S = Math.max(8, Math.round(size));
  const key = `${seed}:${tint}:${S}`;
  let pic = cache.get(key);
  if (!pic) {
    pic = renderPhoto(S, tint, seed);
    cache.set(key, pic);
    // a polaroid and its lightbox copy share one; nobody needs more than a handful
    if (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  g.drawImage(pic, x0, y0, size, size);
}

function renderPhoto(S: number, tint: string, seed: number): HTMLCanvasElement {
  const N = 520; // the scene's own resolution: instant film is soft, the grain is added at print size
  const PX = 1 / N;
  const r = rng(seed);
  const n = N * N;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);

  // ---- the set (scene units, y down) ----
  const CAM = { x: 0.5, y: 0.5, h: 1.25 };
  const LAMP = { x: 0.98, y: -0.1, h: 0.62, size: 0.05 };
  const LI = 1.6; // lamp intensity (linear)
  const warm: V3 = [1.0, 0.66, 0.38]; // ~2700 K
  const cool: V3 = [0.42, 0.58, 1.0]; // a screen, off frame bottom left
  const spotAxis = norm3([0.64 - LAMP.x, 0.5 - LAMP.y, -LAMP.h]);
  const proj = (x: number, y: number, h: number): [number, number] => {
    const k = CAM.h / (CAM.h - h);
    return [CAM.x + (x - CAM.x) * k, CAM.y + (y - CAM.y) * k];
  };
  /** irradiance from the lamp at a point with surface normal n (lambert x inverse square x the shade's cone) */
  const lampAt = (x: number, y: number, h: number, nx: number, ny: number, nz: number): number => {
    const lx = LAMP.x - x, ly = LAMP.y - y, lz = LAMP.h - h;
    const d2 = lx * lx + ly * ly + lz * lz;
    const d = Math.sqrt(d2);
    const cos = Math.max(0, (lx * nx + ly * ny + lz * nz) / d);
    const cone = smoothstep(Math.cos(0.9), Math.cos(0.36), -(lx * spotAxis[0] + ly * spotAxis[1] + lz * spotAxis[2]) / d);
    return (LI * cos * cone) / d2;
  };
  const glowAt = (x: number, y: number) => 0.05 * Math.exp(-Math.hypot(x + 0.12, y - 1.12) / 0.42);

  // mug: a speckled stoneware mug, 8 cm across, 9.5 cm tall, black coffee 1.5 cm under the rim
  const MUG = { x: 0.255, y: 0.275, r: 0.118, h: 0.28, wall: 0.011, fill: 0.045 };
  const mugTop = proj(MUG.x, MUG.y, MUG.h);
  const kTop = CAM.h / (CAM.h - MUG.h);
  const rTop = MUG.r * kTop, rTopIn = (MUG.r - MUG.wall) * kTop;
  const hCof = MUG.h - MUG.fill;
  const cof = proj(MUG.x, MUG.y, hCof);
  const rCof = (MUG.r - MUG.wall) * (CAM.h / (CAM.h - hCof));
  // the mug's shadow on the desk: the base circle swept to the rim's shadow (a tapered capsule)
  const shK = MUG.h / (LAMP.h - MUG.h);
  const mugSh = { x: MUG.x + (MUG.x - LAMP.x) * shK, y: MUG.y + (MUG.y - LAMP.y) * shK, r: MUG.r * (LAMP.h / (LAMP.h - MUG.h)) };
  // the handle points down-right (toward the sheet), at mid height
  const ha = 1.75 + (r() - 0.5) * 0.1;
  const hdx = Math.cos(ha), hdy = Math.sin(ha);
  // the handle: a D-shaped strap in the vertical plane through the axis, sampled as a polyline (loop angle -pi/2 bottom .. pi/2 top)
  const HANDLE_R = 0.0105;
  const loop: { x: number; y: number; h: number; th: number }[] = [];
  for (let k = 0; k <= 16; k++) {
    const th = -Math.PI / 2 + (Math.PI * k) / 16;
    const c = Math.cos(th);
    const out = MUG.r - 0.006 + 0.058 * Math.sign(c) * Math.pow(Math.abs(c), 0.7);
    loop.push({ x: MUG.x + hdx * out, y: MUG.y + hdy * out, h: 0.15 + 0.078 * Math.sin(th), th });
  }
  const loopImg = loop.map((p) => proj(p.x, p.y, p.h));
  /** 1 where the lamp sees (x, y, h) past the mug's body, 0 where the body is in the way (soft over a few millimetres) */
  const bodyLets = (x: number, y: number, h: number) => {
    const dx = LAMP.x - x, dy = LAMP.y - y;
    const t = ((MUG.x - x) * dx + (MUG.y - y) * dy) / (dx * dx + dy * dy || 1);
    if (t <= 0) return 1;
    const miss = Math.hypot(x + dx * t - MUG.x, y + dy * t - MUG.y) - MUG.r;
    const over = h + (LAMP.h - h) * t - MUG.h;
    return 1 - smoothstep(0.006, -0.006, miss) * smoothstep(0.006, -0.006, over);
  };
  const loopSh = loop.map((p) => {
    const k = p.h / (LAMP.h - p.h);
    return [p.x + (p.x - LAMP.x) * k, p.y + (p.y - LAMP.y) * k, LAMP.h / (LAMP.h - p.h), LAMP.size * k] as const;
  });
  /** distance from (x, y) to a polyline, with the index and parameter of the closest segment */
  const polyDist = (x: number, y: number, pts: readonly (readonly [number, number, ...number[]])[]): [number, number, number] => {
    let best = Infinity, bi = 0, bt = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]!, b = pts[k + 1]!;
      const [dd, tt] = seg(x, y, a[0], a[1], b[0], b[1]);
      if (dd < best) {
        best = dd;
        bi = k;
        bt = tt;
      }
    }
    return [best, bi, bt];
  };
  // bounding box of the handle's image and shadow, so the polyline tests run only near them
  const bbox = (pts: readonly (readonly [number, number, ...number[]])[], pad: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const loopBox = bbox(loopImg, 0.03);
  const shBox = bbox(loopSh, 0.06);

  // the sheet: A5, turned a little, running off the bottom right; its top left corner lifts a few millimetres
  const SHEET = { x: 0.665, y: 0.67, hx: 0.218, hy: 0.309, a: -0.13 };
  const sca = Math.cos(SHEET.a), ssa = Math.sin(SHEET.a);
  const SKW = 360, SKH = Math.round((SKW * SHEET.hy) / SHEET.hx);
  const sketch = sketchSheet(SKW, SKH, seed);
  // the first coffee's ring, on the sheet's upper left, partly off it
  const RING = { x: SHEET.x - 0.2, y: SHEET.y - 0.215, r: 0.104 };
  const ringPh = r() * 6.28;

  // the pencil, lying across the sheet, its point toward the top right
  const P0 = { x: 0.3, y: 1.06 }, P1 = { x: 0.84, y: 0.705 };
  const PR = 0.0105;
  const plen = Math.hypot(P1.x - P0.x, P1.y - P0.y);
  const pdx = (P1.x - P0.x) / plen, pdy = (P1.y - P0.y) / plen;
  const CONE = 0.05; // sharpened length
  const pShK = 0.021 / (LAMP.h - 0.021);
  const pMidX = (P0.x + P1.x) / 2, pMidY = (P0.y + P1.y) / 2;
  const pShX = (pMidX - LAMP.x) * pShK, pShY = (pMidY - LAMP.y) * pShK;

  // the desk's satin sheen: where the lamp mirrors toward the camera
  const sheenX = (CAM.x * LAMP.h + LAMP.x * CAM.h) / (LAMP.h + CAM.h);
  const sheenY = (CAM.y * LAMP.h + LAMP.y * CAM.h) / (LAMP.h + CAM.h);

  const woodS = seed & 0xffff;
  const ga = -0.2; // grain direction
  const gca = Math.cos(ga), gsa = Math.sin(ga);
  const speckS = (seed >>> 3) & 0xffff;

  /** Blinn-Phong-ish glint for a glossy surface at (x, y, h) with normal n. */
  const glint = (x: number, y: number, h: number, nx: number, ny: number, nz: number, p: number) => {
    const l = norm3([LAMP.x - x, LAMP.y - y, LAMP.h - h]);
    const v = norm3([CAM.x - x, CAM.y - y, CAM.h - h]);
    const hv = norm3([l[0] + v[0], l[1] + v[1], l[2] + v[2]]);
    return Math.pow(Math.max(0, hv[0] * nx + hv[1] * ny + hv[2] * nz), p);
  };

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * PX, y = (j + 0.5) * PX;
      const idx = j * N + i;

      // ---------- the desk: oiled walnut ----------
      const gs = x * gca + y * gsa, gt = -x * gsa + y * gca; // along / across the grain
      // growth rings: spacing that wanders, a slow cathedral sweep and a finer wobble
      const warp = fbm(gs * 0.7, gt * 1.4, woodS, 4) * 16 + fbm(gs * 4, gt * 11, woodS + 5, 3) * 1.6;
      const ring = gt * (52 + 22 * fbm(gs * 0.5, gt * 0.8, woodS + 11, 2)) + warp;
      const fr = ring - Math.floor(ring);
      const late = Math.pow(Math.exp(-(((fr - 0.72) / 0.13) ** 2)), 0.8); // the dark latewood band of each ring
      // pores: short dark dashes along the grain
      const pores = smoothstep(0.6, 0.86, vnoise(gs * 70, gt * 1500, woodS + 9)) * (0.55 + 0.45 * late);
      // streaks of colour running with the grain (heartwood varies), and a fine silky figure
      const streak = fbm(gs * 0.9, gt * 22, woodS + 3, 3);
      const silk = vnoise(gs * 10, gt * 240, woodS + 13);
      const dark = clamp(0.18 + late * 0.42 + pores * 0.55 + (streak - 0.5) * 1.1 + (silk - 0.5) * 0.12, 0, 1);
      let ar = 0.15 - dark * 0.118, ag = 0.082 - dark * 0.066, ab = 0.046 - dark * 0.038;
      // a seam between two boards of the top, far left
      const seamD = Math.abs(gt - 0.08 + fbm(gs * 3, 1, woodS + 21, 2) * 0.004);
      const seam = 1 - 0.55 * smoothstep(0.0028, 0.0006, seamD);
      ar *= seam;
      ag *= seam;
      ab *= seam;

      // shadows on the desk
      // mug: tapered capsule from the base circle to the rim's shadow, penumbra growing with height; contact darkening at the foot
      const [dm, tm] = seg(x, y, MUG.x, MUG.y, mugSh.x, mugSh.y);
      const mr = MUG.r + (mugSh.r - MUG.r) * tm;
      const pen = 0.003 + LAMP.size * shK * tm;
      let sh = 1 - 0.86 * smoothstep(pen, -pen, dm - mr);
      const foot = Math.hypot(x - MUG.x, y - MUG.y) - MUG.r;
      sh *= 1 - 0.45 * Math.exp(-Math.max(0, foot) / 0.01);
      if (x > shBox.x0 && x < shBox.x1 && y > shBox.y0 && y < shBox.y1) {
        const [dh, k, tt] = polyDist(x, y, loopSh);
        const a = loopSh[k]!, b = loopSh[k + 1]!;
        const grow = a[2] + (b[2] - a[2]) * tt;
        const pp = 0.003 + a[3] + (b[3] - a[3]) * tt;
        sh *= 1 - 0.8 * smoothstep(pp, -pp, dh - HANDLE_R * grow);
      }
      // the sheet: covered here? (local frame)
      const lx = (x - SHEET.x) * sca + (y - SHEET.y) * ssa;
      const ly = -(x - SHEET.x) * ssa + (y - SHEET.y) * sca;
      const qx = Math.abs(lx) - SHEET.hx, qy = Math.abs(ly) - SHEET.hy;
      const sdS = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
      const onSheet = smoothstep(PX * 0.8, -PX * 0.8, sdS);
      // the sheet's lift (top left corner curls up a little) and its thin shadow on the desk, away from the lamp
      const su = clamp((lx / SHEET.hx) * 0.5 + 0.5, 0, 1), sv = clamp((ly / SHEET.hy) * 0.5 + 0.5, 0, 1);
      const lift = 0.0016 + 0.009 * (1 - su) * (1 - su) * (1 - sv) * (1 - sv);
      {
        const ox = (SHEET.x - LAMP.x) * (lift / LAMP.h), oy = (SHEET.y - LAMP.y) * (lift / LAMP.h);
        const lx2 = (x - ox - SHEET.x) * sca + (y - oy - SHEET.y) * ssa;
        const ly2 = -(x - ox - SHEET.x) * ssa + (y - oy - SHEET.y) * sca;
        const q2x = Math.abs(lx2) - SHEET.hx, q2y = Math.abs(ly2) - SHEET.hy;
        const sd2 = Math.hypot(Math.max(q2x, 0), Math.max(q2y, 0)) + Math.min(Math.max(q2x, q2y), 0);
        const pp = 0.002 + lift * 0.6;
        sh *= 1 - 0.5 * smoothstep(pp, -pp, sd2) * (1 - onSheet);
      }
      // pencil shadow (on desk and sheet alike)
      const [dps] = seg(x, y, P0.x + pShX, P0.y + pShY, P1.x - pdx * CONE * 0.6 + pShX, P1.y - pdy * CONE * 0.6 + pShY);
      const pSh = 1 - 0.62 * smoothstep(0.006, -0.006, dps - PR * 0.95);
      const [dpc] = seg(x, y, P0.x, P0.y, P1.x, P1.y);
      const pAo = 1 - 0.3 * Math.exp(-Math.max(0, dpc - PR) / 0.005);

      const Ed = lampAt(x, y, 0, 0, 0, 1) * sh * pSh * pAo;
      const gl = glowAt(x, y);
      // the satin finish: a broad soft reflection of the lamp, broken up by the grain (oil sits differently in the pores)
      const sheen = Math.exp(-((x - sheenX) ** 2 + (y - sheenY) ** 2) / 0.05) * 0.16 * (0.55 + 0.45 * (1 - dark)) * sh;
      let cr = ar * (Ed * warm[0] + gl * cool[0] + 0.012) + sheen * warm[0];
      let cg = ag * (Ed * warm[1] + gl * cool[1] + 0.01) + sheen * warm[1];
      let cb = ab * (Ed * warm[2] + gl * cool[2] + 0.009) + sheen * warm[2];

      // ---------- the sheet ----------
      if (onSheet > 0) {
        // 90 gsm cartridge, a cool white; the curl tilts its top left corner toward the lamp's side a little
        const fib = vnoise(x * 900, y * 900, 77) * 0.04 + fbm(x * 40, y * 40, 78, 2) * 0.04;
        let pr = 0.74 + fib, pg = 0.72 + fib, pb = 0.66 + fib;
        const graphite = sample(sketch, SKW, SKH, su, sv);
        pr *= 1 - 0.62 * graphite;
        pg *= 1 - 0.62 * graphite;
        pb *= 1 - 0.6 * graphite;
        // the coffee ring: a darker tide line with a faint stain inside, its radius wavering
        const ra = Math.atan2(y - RING.y, x - RING.x);
        const rr = RING.r * (1 + 0.018 * Math.sin(ra * 3 + ringPh) + 0.01 * Math.sin(ra * 7 + ringPh * 2));
        const rd = Math.hypot(x - RING.x, y - RING.y);
        const edge = Math.exp(-(((rd - rr) / 0.0022) ** 2)) * (0.5 + 0.5 * fbm(ra * 3, 2, 31, 2));
        const fill = smoothstep(rr, rr - 0.012, rd) * 0.14 * (0.6 + 0.4 * fbm(x * 30, y * 30, 33, 3));
        const st = clamp(edge * 0.85 + fill * 1.3, 0, 0.8);
        pr *= 1 - st * 0.3;
        pg *= 1 - st * 0.48;
        pb *= 1 - st * 0.66;
        // curl normal: the lifted corner slopes down toward the sheet's middle
        const tilt = 0.09 * (1 - su) * (1 - sv);
        const nx = (sca * 1 - ssa * 1) * tilt * 0.7, ny = (ssa * 1 + sca * 1) * tilt * 0.7;
        const Es = lampAt(x, y, lift, nx, ny, 1) * pSh * pAo;
        const sr = pr * (Es * warm[0] + gl * cool[0] * 1.2 + 0.014);
        const sg = pg * (Es * warm[1] + gl * cool[1] * 1.2 + 0.012);
        const sb = pb * (Es * warm[2] + gl * cool[2] * 1.2 + 0.011);
        cr = cr * (1 - onSheet) + sr * onSheet;
        cg = cg * (1 - onSheet) + sg * onSheet;
        cb = cb * (1 - onSheet) + sb * onSheet;
      }

      // ---------- the pencil ----------
      {
        const ax = x - P0.x, ay = y - P0.y;
        const along = ax * pdx + ay * pdy;
        const across = -ax * pdy + ay * pdx;
        const toTip = plen - along;
        const coneR = toTip < CONE ? PR * Math.max(0, toTip) / CONE : PR;
        const cov = smoothstep(PX * 0.8, -PX * 0.8, Math.abs(across) - coneR) * smoothstep(-PX, PX, toTip);
        if (cov > 0) {
          const t = clamp(across / Math.max(coneR, 1e-5), -1, 1);
          // hexagonal section: three faces show from above
          const face = t < -0.5 ? -1 : t > 0.5 ? 1 : 0;
          const fnx = face * 0.866, fnz = face === 0 ? 1 : 0.5;
          // across direction in the scene
          const cxv = -pdy, cyv = pdx;
          const nX = cxv * fnx, nY = cyv * fnx, nZ = fnz;
          const h = PR * (1 + fnz * 0.5);
          // the sharpened end: lacquer gives way to bare cedar along a scalloped line, then the graphite point
          const scallop = CONE - 0.004 * (1 + Math.cos(t * Math.PI * 1.5));
          const wood = smoothstep(scallop + 0.0012, scallop - 0.0012, toTip);
          const lead = smoothstep(0.0125, 0.0105, toTip);
          let alb: V3 = [0.012, 0.045, 0.03]; // deep green lacquer
          if (wood > 0) alb = [alb[0] + (0.42 - alb[0]) * wood, alb[1] + (0.27 - alb[1]) * wood, alb[2] + (0.15 - alb[2]) * wood];
          if (lead > 0) alb = [alb[0] + (0.035 - alb[0]) * lead, alb[1] + (0.035 - alb[1]) * lead, alb[2] + (0.038 - alb[2]) * lead];
          // a gold-stamped band near the back end
          const band = smoothstep(0.0015, 0, Math.abs(along - 0.16) - 0.012) * (1 - wood);
          if (band > 0) alb = [alb[0] + (0.5 - alb[0]) * band * 0.6, alb[1] + (0.36 - alb[1]) * band * 0.6, alb[2] + (0.12 - alb[2]) * band * 0.6];
          const E = lampAt(x, y, h, nX, nY, nZ);
          const gloss = (1 - wood) * (0.55 + 0.45 * lead);
          const spec = glint(x, y, h, nX, nY, nZ, 70) * gloss * LI * 0.9;
          // the arris between two faces catches a thin line of light
          const arris = Math.exp(-(((Math.abs(t) - 0.5) / 0.08) ** 2)) * 0.08 * E * (1 - wood);
          const pr = alb[0] * (E * warm[0] + gl * cool[0] + 0.01) + (spec + arris) * warm[0];
          const pg = alb[1] * (E * warm[1] + gl * cool[1] + 0.01) + (spec + arris) * warm[1];
          const pb = alb[2] * (E * warm[2] + gl * cool[2] + 0.01) + (spec + arris) * warm[2];
          cr = cr * (1 - cov) + pr * cov;
          cg = cg * (1 - cov) + pg * cov;
          cb = cb * (1 - cov) + pb * cov;
        }
      }

      // ---------- the mug ----------
      {
        // stoneware: warm white glaze with iron speckle
        const sp = hash2(Math.floor(x * 700), Math.floor(y * 700), speckS);
        const speck = sp > 0.985 ? 0.55 : sp > 0.97 ? 0.25 : 0;
        const glaze: V3 = [0.64 * (1 - speck), 0.6 * (1 - speck * 1.05), 0.53 * (1 - speck * 1.1)];
        // handle (drawn first: the body overlaps where it joins): a round strap; its normal rolls across the strap and turns with the loop
        if (x > loopBox.x0 && x < loopBox.x1 && y > loopBox.y0 && y < loopBox.y1) {
          const [dhd, k, tt] = polyDist(x, y, loopImg);
          const a = loop[k]!, b = loop[k + 1]!;
          const ph = a.h + (b.h - a.h) * tt;
          const hcov = smoothstep(PX, -PX, dhd - HANDLE_R * (CAM.h / (CAM.h - ph)));
          if (hcov > 0) {
            const th = a.th + (b.th - a.th) * tt;
            // across the strap: which side of its centre line, and how far (0 on the line, 1 at its silhouette)
            const ia = loopImg[k]!, ib = loopImg[k + 1]!;
            const ex = ib[0] - ia[0], ey = ib[1] - ia[1];
            const sgn = Math.sign((x - ia[0]) * -ey + (y - ia[1]) * ex) || 1;
            // the image of the across-strap direction (-hdy, hdx) points the same way as the polyline's left normal or not
            const flip = Math.sign(-hdy * -ey + hdx * ex) || 1;
            const side = clamp(dhd / (HANDLE_R * 1.15), 0, 1) * sgn * flip;
            const ring = Math.sqrt(Math.max(0, 1 - side * side));
            const lr = Math.cos(th) * ring, lz = Math.sin(th) * ring;
            const nx = hdx * lr - hdy * side, ny = hdy * lr + hdx * side, nz = Math.max(0.05, lz + 0.15);
            const hx = a.x + (b.x - a.x) * tt, hy = a.y + (b.y - a.y) * tt;
            const lit = bodyLets(hx, hy, ph);
            const E = lampAt(hx, hy, ph, nx, ny, nz) * lit;
            const spec = glint(hx, hy, ph, nx, ny, nz, 80) * 0.14 * LI * lit;
            cr = cr * (1 - hcov) + (glaze[0] * (E * warm[0] + gl * cool[0] * 0.6 + 0.07) + spec * warm[0]) * hcov;
            cg = cg * (1 - hcov) + (glaze[1] * (E * warm[1] + gl * cool[1] * 0.6 + 0.045) + spec * warm[1]) * hcov;
            cb = cb * (1 - hcov) + (glaze[2] * (E * warm[2] + gl * cool[2] * 0.6 + 0.028) + spec * warm[2]) * hcov;
          }
        }
        // outer wall: the hull between the base circle and the (bigger, further out) rim circle
        const [dw, tw] = seg(x, y, MUG.x, MUG.y, mugTop[0], mugTop[1]);
        const wr = MUG.r + (rTop - MUG.r) * tw;
        const wallCov = smoothstep(PX, -PX, dw - wr);
        const dTop = Math.hypot(x - mugTop[0], y - mugTop[1]);
        const topCov = smoothstep(PX, -PX, dTop - rTop);
        const wcov = wallCov * (1 - topCov);
        if (wcov > 0) {
          const axX = MUG.x + (mugTop[0] - MUG.x) * tw, axY = MUG.y + (mugTop[1] - MUG.y) * tw;
          const rx = x - axX, ry = y - axY;
          const rl = Math.hypot(rx, ry) || 1;
          const nx = rx / rl, ny = ry / rl;
          const hgt = MUG.h * tw;
          const E = lampAt(axX + nx * MUG.r, axY + ny * MUG.r, hgt, nx, ny, 0);
          const spec = glint(axX + nx * MUG.r, axY + ny * MUG.r, hgt, nx, ny, 0, 30) * 0.5 * LI;
          const foot = 1 - 0.25 * Math.exp(-tw / 0.08); // darker toward the foot (the desk's bounce is all that reaches it)
          cr = cr * (1 - wcov) + (glaze[0] * (E * warm[0] + gl * cool[0] * 0.6 + 0.06) * foot + spec * warm[0]) * wcov;
          cg = cg * (1 - wcov) + (glaze[1] * (E * warm[1] + gl * cool[1] * 0.6 + 0.04) * foot + spec * warm[1]) * wcov;
          cb = cb * (1 - wcov) + (glaze[2] * (E * warm[2] + gl * cool[2] * 0.6 + 0.025) * foot + spec * warm[2]) * wcov;
        }
        if (topCov > 0) {
          const rx = (x - mugTop[0]) / (dTop || 1), ry = (y - mugTop[1]) / (dTop || 1);
          // light direction across the desk, for the inside
          const lx0 = LAMP.x - MUG.x, ly0 = LAMP.y - MUG.y;
          const ll = Math.hypot(lx0, ly0);
          const towardLamp = (rx * lx0 + ry * ly0) / ll;
          let tr: number, tg: number, tb: number;
          const inRim = smoothstep(PX, -PX, dTop - rTopIn);
          // rim: the rounded lip
          {
            const k = clamp((dTop - rTopIn) / (rTop - rTopIn), 0, 1);
            const roll = (k - 0.5) * 2;
            const nx = rx * roll * 0.85, ny = ry * roll * 0.85, nz = Math.sqrt(Math.max(0.05, 1 - 0.72 * roll * roll));
            const E = lampAt(x, y, MUG.h, nx, ny, nz);
            const spec = glint(x, y, MUG.h, nx, ny, nz, 60) * 0.9 * LI;
            tr = glaze[0] * (E * warm[0] + gl * cool[0] + 0.02) + spec * warm[0];
            tg = glaze[1] * (E * warm[1] + gl * cool[1] + 0.018) + spec * warm[1];
            tb = glaze[2] * (E * warm[2] + gl * cool[2] + 0.016) + spec * warm[2];
          }
          if (inRim > 0) {
            const dC = Math.hypot(x - cof[0], y - cof[1]);
            const cCov = smoothstep(PX, -PX, dC - rCof);
            // inner wall: lit on the side away from the lamp (the light comes in over the near lip), with the tide line above the coffee
            const lit = smoothstep(0.25, -0.45, towardLamp);
            const tide = Math.exp(-(((dC - rCof) / 0.0035) ** 2)) * 0.5;
            const Ei = lampAt(MUG.x, MUG.y, MUG.h - 0.02, -rx, -ry, 0.3) * lit;
            let ir = glaze[0] * (1 - tide * 0.45) * (Ei * warm[0] + 0.02) * 0.9;
            let ig = glaze[1] * (1 - tide * 0.62) * (Ei * warm[1] + 0.018) * 0.9;
            let ib = glaze[2] * (1 - tide * 0.8) * (Ei * warm[2] + 0.016) * 0.9;
            if (cCov > 0) {
              // black coffee: almost no diffuse, a glossy surface that mirrors the lit inner wall as a soft crescent; the near lip shades it
              const crx = (x - cof[0]) / (dC || 1), cry = (y - cof[1]) / (dC || 1);
              const away = smoothstep(0.1, -0.7, (crx * lx0 + cry * ly0) / ll);
              const refl = Math.exp(-(((dC - rCof * 0.86) / (rCof * 0.09)) ** 2)) * away * 0.035;
              const shade = 0.35 + 0.65 * away;
              const crema = smoothstep(rCof - 0.007, rCof - 0.001, dC) * 0.6;
              const kr = (0.011 + crema * 0.05) * shade + refl * warm[0];
              const kg = (0.0055 + crema * 0.026) * shade + refl * warm[1] * 0.95;
              const kb = (0.0025 + crema * 0.012) * shade + refl * warm[2] * 0.9;
              ir = ir * (1 - cCov) + kr * cCov;
              ig = ig * (1 - cCov) + kg * cCov;
              ib = ib * (1 - cCov) + kb * cCov;
            }
            tr = tr * (1 - inRim) + ir * inRim;
            tg = tg * (1 - inRim) + ig * inRim;
            tb = tb * (1 - inRim) + ib * inRim;
          }
          cr = cr * (1 - topCov) + tr * topCov;
          cg = cg * (1 - topCov) + tg * topCov;
          cb = cb * (1 - topCov) + tb * topCov;
        }
      }

      R[idx] = cr;
      G[idx] = cg;
      B[idx] = cb;
    }
  }

  // ---------- the lens: a soft instant lens, then halation round the highlights ----------
  const tmp = new Float32Array(n);
  blurPlane(R, N, N, 1, tmp);
  blurPlane(G, N, N, 1, tmp);
  blurPlane(B, N, N, 1, tmp);
  const hr = new Float32Array(n), hg = new Float32Array(n), hb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const L = Math.max(R[i]!, G[i]!, B[i]!);
    const k = Math.max(0, L - 0.85) / (L || 1);
    hr[i] = R[i]! * k;
    hg[i] = G[i]! * k;
    hb[i] = B[i]! * k;
  }
  blurPlane(hr, N, N, N * 0.022, tmp);
  blurPlane(hg, N, N, N * 0.022, tmp);
  blurPlane(hb, N, N, N * 0.022, tmp);

  // ---------- the film ----------
  const tintC = parseColor(mixHex("#ffffff", tint, 0.3));
  const exposure = 1.75;
  const img = new ImageData(N, N);
  const d = img.data;
  const dev = (u: number, v: number) => (fbm(u * 2.2, v * 2.2, seed & 0xfff, 3) - 0.5) * 0.07; // uneven development
  const tone = (c: number) => {
    const t = (c * (1 + c / 6)) / (1 + c);
    return Math.pow(clamp(t, 0, 1), 1 / 2.2);
  };
  const at = (P: Float32Array, u: number, v: number) => sample(P, N, N, u, v);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      // a little lateral colour toward the corners
      const du = u - 0.5, dv = v - 0.5;
      const ca = 0.0035;
      const rU = clamp(0.5 + du * (1 + ca), 0, 1), rV = clamp(0.5 + dv * (1 + ca), 0, 1);
      const bU = clamp(0.5 + du * (1 - ca), 0, 1), bV = clamp(0.5 + dv * (1 - ca), 0, 1);
      const idx = j * N + i;
      let cr = (at(R, rU, rV) + at(hr, rU, rV) * 0.8) * exposure * tintC.r;
      let cg = (G[idx]! + hg[idx]! * 0.45) * exposure * tintC.g;
      let cb = (at(B, bU, bV) + at(hb, bU, bV) * 0.3) * exposure * tintC.b;
      cr = tone(cr);
      cg = tone(cg);
      cb = tone(cb);
      const Y = cr * 0.3 + cg * 0.55 + cb * 0.15;
      const sat = 1.02;
      cr = Y + (cr - Y) * sat;
      cg = Y + (cg - Y) * sat;
      cb = Y + (cb - Y) * sat;
      // instant film: blacks lift toward a cool slate, highlights go creamy, contrast is gentle
      const lo = 1 - Y;
      cr = 0.034 + cr * 0.93 - 0.012 * lo + 0.03 * Y * Y;
      cg = 0.038 + cg * 0.93 + 0.002 * lo + 0.008 * Y * Y;
      cb = 0.048 + cb * 0.9 + 0.014 * lo - 0.04 * Y * Y;
      const vig = (1 - 0.55 * Math.pow(Math.min(1, (du * du + dv * dv) * 2.05), 1.35)) * (1 + dev(u, v));
      d[idx * 4] = clamp(cr * vig * 255, 0, 255);
      d[idx * 4 + 1] = clamp(cg * vig * 255, 0, 255);
      d[idx * 4 + 2] = clamp(cb * vig * 255, 0, 255);
      d[idx * 4 + 3] = 255;
    }
  }

  // into the print (bilinear: soft, as instant film is), then grain at print resolution
  const small = makeCanvas(N, N);
  small.g.putImageData(img, 0, 0);
  const out = makeCanvas(S, S);
  out.g.imageSmoothingEnabled = true;
  out.g.imageSmoothingQuality = "high";
  out.g.drawImage(small.c, 0, 0, S, S);
  const px = out.g.getImageData(0, 0, S, S);
  const pd = px.data;
  const gr = rng(seed ^ 0x6a1);
  const noise = new Float32Array(S * S);
  for (let i = 0; i < noise.length; i++) noise[i] = gr() - 0.5;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const clump = noise[i]! * 0.6 + (noise[Math.min(i + 1, S * S - 1)]! + noise[Math.min(i + S, S * S - 1)]!) * 0.2;
      const L = (pd[i * 4]! + pd[i * 4 + 1]! + pd[i * 4 + 2]!) / 765;
      const amp = 26 * (0.4 + L * (1 - L) * 2.4);
      const k = clump * amp;
      pd[i * 4] = clamp(pd[i * 4]! + k, 0, 255);
      pd[i * 4 + 1] = clamp(pd[i * 4 + 1]! + k * 0.96, 0, 255);
      pd[i * 4 + 2] = clamp(pd[i * 4 + 2]! + k * 1.06, 0, 255);
    }
  out.g.putImageData(px, 0, 0);
  return out.c;
}
