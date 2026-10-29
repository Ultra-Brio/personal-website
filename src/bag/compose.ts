/*
 * The pouch's first impression: a composed deal instead of a random scatter. The stapled résumé lies big at the back, left of centre,
 * its head (name, summary, first job) clear; the 一筆箋 stands tall at the right, over the résumé's margin; the business card lies on
 * the résumé's lower left; the ticket runs along the foot, its 藍 stub tucked under the polaroid, which lies at the lower right.
 * Every object keeps a good part of itself in view and can be picked up where it lies.
 * Every deal is the same composition with its own small variation (position and angle, from the seed); every second re-deal is
 * mirrored left to right, so "deal again" changes the picture without losing it.
 * Pure functions (no three, no DOM). Things the composition has no place for (a second ticket, …) are scattered around it.
 */
import type { ItemKind } from "../profile/schema";
import { mulberry32 } from "./sim/layout";
import type { BodySpec, Placement } from "./sim/types";

/** Slot of the first item of each kind: centre (mm) and angle (degrees) in pouch-plane axes (y up, toward the zip). */
export const SLOTS: Partial<Record<ItemKind, { x: number; y: number; a: number }>> = {
  resume: { x: -28, y: 42, a: -2 },
  note: { x: 67, y: 50, a: 3 },
  card: { x: -59, y: -46, a: -7 },
  ticket: { x: -35, y: -124, a: -3 },
  polaroid: { x: 66, y: -100, a: 4 },
};
/** Variation per deal: +- mm, +- degrees (the first deal is quieter than a re-deal). */
const JITTER = [
  { d: 1.5, a: 1 },
  { d: 4, a: 2.5 },
] as const;

/**
 * A `deal` for createBagSim: placements in spec order for items whose kind has a slot (the first of each kind), null for the
 * rest. `kinds` runs parallel to `specs`.
 */
export function composeDeal(kinds: readonly ItemKind[], specs: readonly BodySpec[], seed: number): (n: number) => (Placement | null)[] {
  return (n) => {
    const r = mulberry32((seed * 2654435761) ^ (n * 40503 + 17));
    const j = JITTER[n === 0 ? 0 : 1];
    const mirror = n % 2 === 1 ? -1 : 1;
    const used = new Set<ItemKind>();
    return specs.map((_, i) => {
      const kind = kinds[i];
      const slot = kind ? SLOTS[kind] : undefined;
      if (!kind || !slot || used.has(kind)) return null;
      used.add(kind);
      const dx = (r() * 2 - 1) * j.d, dy = (r() * 2 - 1) * j.d, da = (r() * 2 - 1) * j.a;
      return { x: (mirror * slot.x + dx) / 1000, y: (slot.y + dy) / 1000, angle: ((mirror * slot.a + da) * Math.PI) / 180 };
    });
  };
}

/*
 * After a shake: who lies on top. The sim keeps three layers (same layer collides, different layers pass over each other), so where
 * things come to rest after a shake is physics, but which of two overlapping things lies on top is a choice. When something ends up
 * mostly buried (less than RESCUE of it showing), the layers are dealt again for the places things now lie: the assignment with
 * nothing overlapping on one layer that leaves the most-covered object the most of itself, so every object can be seen and picked up.
 */

/** Where a body lies (pouch metres, radians) and its footprint. */
export type Footprint = { x: number; y: number; angle: number; w: number; h: number };
export type LayerNo = 0 | 1 | 2;

/** Below this visible fraction an object counts as buried. */
export const RESCUE = 0.4;

function inside(f: Footprint, px: number, py: number): boolean {
  const c = Math.cos(f.angle), n = Math.sin(f.angle);
  const dx = px - f.x, dy = py - f.y;
  return Math.abs(dx * c + dy * n) <= f.w / 2 && Math.abs(-dx * n + dy * c) <= f.h / 2;
}

/** Fraction of each footprint not covered by one on a higher layer, sampled on a grid of about `step` m. */
export function visibleFractions(fp: readonly Footprint[], layers: readonly number[], step = 0.004): number[] {
  return fp.map((f, i) => {
    const c = Math.cos(f.angle), n = Math.sin(f.angle);
    const nu = Math.max(4, Math.round(f.w / step)), nv = Math.max(4, Math.round(f.h / step));
    let seen = 0;
    for (let a = 0; a < nu; a++)
      for (let b = 0; b < nv; b++) {
        const u = ((a + 0.5) / nu - 0.5) * f.w, v = ((b + 0.5) / nv - 0.5) * f.h;
        const px = f.x + u * c - v * n, py = f.y + u * n + v * c;
        if (!fp.some((o, j) => j !== i && layers[j]! > layers[i]! && inside(o, px, py))) seen++;
      }
    return seen / (nu * nv);
  });
}

/** Do two footprints come closer than `gap` m (separating axes on the two rectangles)? */
export function footprintsTouch(a: Footprint, b: Footprint, gap = 0.001): boolean {
  for (const ang of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const ax = Math.cos(ang), ay = Math.sin(ang);
    const proj = (f: Footprint) => {
      const c = Math.cos(f.angle), n = Math.sin(f.angle);
      const r = (Math.abs(c * ax + n * ay) * f.w) / 2 + (Math.abs(-n * ax + c * ay) * f.h) / 2;
      const m = f.x * ax + f.y * ay;
      return [m - r, m + r] as const;
    };
    const [a0, a1] = proj(a);
    const [b0, b1] = proj(b);
    if (a1 + gap <= b0 || b1 + gap <= a0) return false;
  }
  return true;
}

/**
 * New layers for bodies at rest when one of them is buried (null when none is, or nothing better exists). Tries every assignment of
 * the three layers (up to 7 bodies) with no two touching bodies on one layer; best = the largest smallest visible fraction (in 5 %
 * steps), then the fewest bodies moved, then the fewest off their own layer (`home`).
 */
export function rescueLayers(fp: readonly Footprint[], current: readonly LayerNo[], home: readonly LayerNo[] = current): LayerNo[] | null {
  const n = fp.length;
  if (n === 0 || n > 7) return null;
  const now = Math.min(...visibleFractions(fp, current));
  if (now >= RESCUE) return null;
  const touch: boolean[][] = fp.map((a, i) => fp.map((b, j) => i !== j && footprintsTouch(a, b)));
  let best: LayerNo[] | null = null;
  let bestKey: [number, number, number] = [Math.floor(now * 20), 0, 0];
  const pick: LayerNo[] = new Array<LayerNo>(n).fill(0);
  const total = 3 ** n;
  for (let code = 0; code < total; code++) {
    let k = code;
    for (let i = 0; i < n; i++) {
      pick[i] = (k % 3) as LayerNo;
      k = Math.floor(k / 3);
    }
    let ok = true;
    for (let i = 0; i < n && ok; i++) for (let j = i + 1; j < n; j++) if (pick[i] === pick[j] && touch[i]![j]) ok = false;
    if (!ok) continue;
    const min = Math.floor(Math.min(...visibleFractions(fp, pick, 0.006)) * 20);
    let moved = 0;
    let off = 0;
    for (let i = 0; i < n; i++) {
      if (pick[i] !== current[i]) moved++;
      if (pick[i] !== home[i]) off++;
    }
    if (min > bestKey[0] || (min === bestKey[0] && best && (moved < bestKey[1] || (moved === bestKey[1] && off < bestKey[2])))) {
      best = pick.slice();
      bestKey = [min, moved, off];
    }
  }
  return best;
}

/**
 * A shake deals again: the kicks throw everything about, then, as it settles, each object is steered to its place in the nearer of the
 * two next composed deals (as dealt, or mirrored) — a soft pull capped at a slow slide, so it reads as things coming to rest, and
 * same-layer bodies still collide on the way. Without it a shake often left the big sheet or the ticket under everything else.
 */
export const GUIDE = {
  /** after the first kick (s), for (s) */
  after: 0.45,
  dur: 1.6,
  /** pull: 1/s towards the place, capped (m/s), plus a floor near the place that beats the film's friction; spin likewise (1/s) */
  k: 6,
  cap: 0.4,
  floor: 0.12,
  /** within this of its place (m) the floor fades out */
  near: 0.004,
  /** how fast the velocity follows the pull (1/s) */
  rate: 21,
} as const;

/**
 * Of several composed deals, the one the bodies can reach most easily from where they are now: the sum of the distances, plus a
 * heavy penalty for two bodies of one layer whose straight paths cross or pass close (they collide, so they would jam on the way).
 */
export function easiestDeal(now: readonly { x: number; y: number }[], layers: readonly number[], deals: readonly (readonly (Placement | null)[])[]): readonly (Placement | null)[] {
  let best = deals[0]!;
  let bestCost = Infinity;
  for (const pl of deals) {
    let cost = 0;
    for (let i = 0; i < pl.length; i++) if (pl[i] && now[i]) cost += Math.hypot(pl[i]!.x - now[i]!.x, pl[i]!.y - now[i]!.y);
    for (let i = 0; i < pl.length; i++)
      for (let j = i + 1; j < pl.length; j++) {
        const a = pl[i], b = pl[j];
        if (!a || !b || !now[i] || !now[j] || layers[i] !== layers[j]) continue;
        if (segmentGap(now[i]!, a, now[j]!, b) < 0.03) cost += 1;
      }
    if (cost < bestCost) {
      bestCost = cost;
      best = pl;
    }
  }
  return best;
}

/** Closest distance between two points moving at once along straight paths p0→p1 and q0→q1 (same start and end times). */
function segmentGap(p0: { x: number; y: number }, p1: { x: number; y: number }, q0: { x: number; y: number }, q1: { x: number; y: number }): number {
  const dx = p0.x - q0.x, dy = p0.y - q0.y;
  const vx = p1.x - p0.x - (q1.x - q0.x), vy = p1.y - p0.y - (q1.y - q0.y);
  const vv = vx * vx + vy * vy;
  const t = vv > 1e-12 ? Math.max(0, Math.min(1, -(dx * vx + dy * vy) / vv)) : 0;
  return Math.hypot(dx + vx * t, dy + vy * t);
}

/** One step of the pull: the velocity (m/s) and spin (rad/s) to add to each body this frame (null: leave it alone). */
export function guidePushes(states: readonly { x: number; y: number; angle: number; vx: number; vy: number; w: number; held: boolean }[], target: readonly (Placement | null)[], dt: number): ([number, number, number] | null)[] {
  const a = 1 - Math.exp(-Math.max(0, dt) * GUIDE.rate);
  return states.map((s, i) => {
    const p = target[i];
    if (!p || s.held) return null;
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
    const f = Math.min(1, d / GUIDE.near);
    const v = d > 1e-6 ? Math.min(GUIDE.cap, d * GUIDE.k + GUIDE.floor * f * f) : 0;
    const vx = d > 1e-6 ? (dx / d) * v : 0, vy = d > 1e-6 ? (dy / d) * v : 0;
    let da = p.angle - s.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const fa = Math.min(1, Math.abs(da) / 0.02);
    const w = Math.sign(da) * (Math.abs(da) * GUIDE.k + 1.2 * fa * fa);
    return [(vx - s.vx) * a, (vy - s.vy) * a, (w - s.w) * a];
  });
}
