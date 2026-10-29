/*
 * Initial layout: a deterministic scatter of the objects, "dropped in a bag". Pure geometry; the world finishes the job
 * by relaxing whatever overlap is left with its own contact solver.
 */
import type { BodySpec, Placement } from "./types";
import { shapeRadius } from "./friction";

export type { Placement };

/** mulberry32: tiny seeded generator, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Half extents (m) of a spec's footprint rotated by `angle`: the axis-aligned box around it. */
export function halfExtents(spec: BodySpec, angle: number): { hx: number; hy: number } {
  if (spec.shape === "circle") {
    const r = shapeRadius(spec);
    return { hx: r, hy: r };
  }
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  if (spec.shape === "capsule") {
    // stadium: core segment of half length (L/2 - r) along the long axis, plus the end radius r
    const r = shapeRadius(spec), core = Math.max(Math.max(spec.w, spec.h) / 2 - r, 0);
    const along = spec.w >= spec.h;
    return { hx: (along ? core * c : core * s) + r, hy: (along ? core * s : core * c) + r };
  }
  return { hx: (spec.w * c + spec.h * s) / 2, hy: (spec.w * s + spec.h * c) / 2 };
}

/** Radius of the smallest circle around the footprint's centre. */
export function boundRadius(spec: BodySpec): number {
  if (spec.shape === "circle") return shapeRadius(spec);
  return Math.hypot(spec.w, spec.h) / 2;
}

const SHRINK = [1, 0.85, 0.7, 0.55, 0.4, 0.25];

/**
 * Random, mostly upright placements (a triangular spread of about +-40 degrees), clear of the walls, with same-layer
 * bounding circles kept apart. Big objects are placed first; if the pouch is too crowded for the full circles the
 * circles shrink step by step and the world's relaxation resolves the rest. Result order follows `specs`.
 * `fixed` (spec order) pins some bodies where the caller wants them (nudged inside the walls); only the rest is scattered.
 */
export function scatter(specs: readonly BodySpec[], width: number, height: number, seed: number, fixed?: readonly (Placement | null | undefined)[]): Placement[] {
  const rnd = mulberry32(seed);
  const out: Placement[] = specs.map(() => ({ x: 0, y: 0, angle: 0 }));
  const order = specs.map((_, i) => i).sort((a, b) => boundRadius(specs[b]!) - boundRadius(specs[a]!) || a - b);
  const placed: number[] = [];
  const margin = 0.004;
  specs.forEach((spec, i) => {
    const f = fixed?.[i];
    if (!f || !Number.isFinite(f.x + f.y + f.angle)) return;
    const { hx, hy } = halfExtents(spec, f.angle);
    const rx = Math.max(width / 2 - hx - margin, 0), ry = Math.max(height / 2 - hy - margin, 0);
    out[i] = { x: Math.max(-rx, Math.min(rx, f.x)), y: Math.max(-ry, Math.min(ry, f.y)), angle: f.angle };
    placed.push(i);
  });
  for (const i of order) {
    if (placed.includes(i)) continue;
    const spec = specs[i]!;
    let found: Placement | null = null;
    let last: Placement = { x: 0, y: 0, angle: 0 };
    search: for (const shrink of SHRINK) {
      for (let k = 0; k < 300; k++) {
        let angle = (rnd() + rnd() - 1) * 0.7;
        let { hx, hy } = halfExtents(spec, angle);
        // a big sheet must not be dealt at an angle at which it cannot fit between the walls
        for (let t = 0; t < 8 && (hx > width / 2 - margin || hy > height / 2 - margin); t++) {
          angle *= 0.6;
          ({ hx, hy } = halfExtents(spec, angle));
        }
        const rx = Math.max(width / 2 - hx - margin, 0), ry = Math.max(height / 2 - hy - margin, 0);
        last = { x: (rnd() * 2 - 1) * rx, y: (rnd() * 2 - 1) * ry, angle };
        const clear = placed.every((j) => {
          const o = specs[j]!;
          if (o.layer !== spec.layer) return true;
          const p = out[j]!;
          return Math.hypot(p.x - last.x, p.y - last.y) >= (boundRadius(spec) + boundRadius(o)) * shrink;
        });
        if (clear) {
          found = last;
          break search;
        }
      }
    }
    out[i] = found ?? last;
    placed.push(i);
  }
  return out;
}
