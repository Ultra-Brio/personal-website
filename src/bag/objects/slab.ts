/*
 * Slab geometry: a thin flat object whose footprint is an arbitrary polygon.
 *  - front / back caps are a regular grid over the bounding box (so a vertex shader can bend them); the polygon cut is done by an
 *    alphaMap mask (see `maskCanvas`), which also gives see-through notches and perforation holes for free;
 *  - the edge wall follows the polygon exactly, with four rings whose normals roll over, so a 0.5 mm card edge still catches light like a bevel.
 * Local frame: x/y centred on the footprint, z = 0 is the rear face, z = thickness the front face.
 * Material groups: 0 = front cap, 1 = back cap, 2 = edge.
 */
import * as THREE from "three";
import { clamp, makeCanvas, type V2 } from "./shared";

export function roundedRectOutline(w: number, h: number, r: number, seg = 7): V2[] {
  const rr = Math.min(r, w / 2, h / 2);
  const pts: V2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - rr, -(h / 2 - rr), -Math.PI / 2],
    [w / 2 - rr, h / 2 - rr, 0],
    [-(w / 2 - rr), h / 2 - rr, Math.PI / 2],
    [-(w / 2 - rr), -(h / 2 - rr), Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return pts;
}

export function circleOutline(R: number, n = 96): V2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * R, Math.sin(a) * R] as V2;
  });
}

/** Insert points so no segment is longer than `maxSeg` (the wall must follow the bending caps closely). */
export function densify(pts: readonly V2[], maxSeg: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(len / maxSeg);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function bounds(pts: readonly V2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

export type SlabOpts = {
  /** CCW footprint polygon, centred on the origin. */
  outline: readonly V2[];
  /** Bounding box the cap grid covers (usually the outline's bbox). */
  w: number;
  h: number;
  thickness: number;
  /** vertical extent of the rolled-over edge (<= thickness / 2) */
  bevel?: number;
  nx: number;
  ny: number;
  /** longest wall segment (m) */
  maxSeg?: number;
  /** z offset of the whole slab */
  z0?: number;
};

export function buildSlab(o: SlabOpts): { geometry: THREE.BufferGeometry; outline: V2[] } {
  const { w, h, thickness: t, nx, ny } = o;
  const z0 = o.z0 ?? 0;
  const b = clamp(o.bevel ?? t * 0.25, 0, t / 2);
  const outline = densify(o.outline, o.maxSeg ?? 0.0035);
  const N = outline.length;

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const groups: [number, number, number][] = [];

  const capGrid = (z: number, nz: number, flip: boolean) => {
    const base = pos.length / 3;
    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const u = ix / nx;
        const v = iy / ny;
        pos.push((u - 0.5) * w, (v - 0.5) * h, z);
        nor.push(0, 0, nz);
        uv.push(u, v);
      }
    }
    const start = idx.length;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = base + iy * (nx + 1) + ix;
        const bb = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        if (!flip) idx.push(a, bb, c, bb, d, c);
        else idx.push(a, c, bb, bb, c, d);
      }
    }
    return [start, idx.length - start] as const;
  };

  const [fs, fc] = capGrid(z0 + t, 1, false);
  groups.push([fs, fc, 0]);
  const [bs, bc] = capGrid(z0, -1, true);
  groups.push([bs, bc, 1]);

  // edge wall: 4 rings per outline point (+1 duplicated seam column)
  const base = pos.length / 3;
  const ringZ = [0, b, t - b, t];
  const s = Math.SQRT1_2;
  const c20 = Math.cos(Math.PI / 9);
  const s20 = Math.sin(Math.PI / 9);
  const ringN: [number, number][] = [
    [s, -s],
    [c20, -s20],
    [c20, s20],
    [s, s],
  ];
  const perim: number[] = [0];
  for (let i = 0; i < N; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % N]!;
    perim.push(perim[i]! + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = perim[N]!;
  for (let i = 0; i <= N; i++) {
    const p = outline[i % N]!;
    const prev = outline[(i - 1 + N) % N]!;
    const next = outline[(i + 1) % N]!;
    // outward normal of a CCW polygon = tangent rotated -90deg; average of the two adjacent edges
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const tl = Math.hypot(tx, ty) || 1;
    const ox = ty / tl;
    const oy = -tx / tl;
    for (let r = 0; r < 4; r++) {
      const [nr, nz] = ringN[r]!;
      pos.push(p[0], p[1], z0 + ringZ[r]!);
      nor.push(ox * nr, oy * nr, nz);
      uv.push(perim[i]! / total, r / 3);
    }
  }
  const es = idx.length;
  for (let i = 0; i < N; i++) {
    for (let r = 0; r < 3; r++) {
      const a = base + i * 4 + r;
      const bb = base + (i + 1) * 4 + r;
      const c = bb + 1;
      const d = a + 1;
      idx.push(a, bb, c, a, c, d);
    }
  }
  groups.push([es, idx.length - es, 2]);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  for (const [s0, c0, m] of groups) g.addGroup(s0, c0, m);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return { geometry: g, outline };
}

/**
 * Greyscale coverage mask of a footprint for `alphaMap` (white inside). `cut` can punch extra holes (perforations).
 * Pixel mapping: x in [-w/2, w/2] -> [0, pw], y in [-h/2, h/2] -> [ph, 0].
 */
export function maskCanvas(outline: readonly V2[], w: number, h: number, pxPerM: number, cut?: (g: CanvasRenderingContext2D, px: (p: V2) => V2, scale: number) => void) {
  const pw = Math.min(1024, Math.ceil(w * pxPerM));
  const ph = Math.min(1024, Math.ceil(h * pxPerM));
  const { c, g } = makeCanvas(pw, ph);
  const sx = pw / w;
  const sy = ph / h;
  const px = (p: V2): V2 => [(p[0] + w / 2) * sx, (h / 2 - p[1]) * sy];
  g.fillStyle = "#000";
  g.fillRect(0, 0, pw, ph);
  g.fillStyle = "#fff";
  g.beginPath();
  outline.forEach((p, i) => {
    const [x, y] = px(p);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fill();
  if (cut) {
    g.fillStyle = "#000";
    cut(g, px, sx);
  }
  return c;
}
