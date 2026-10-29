/*
 * Physics presets and pure helpers for the paper viewer (no three, no DOM, unit-tested with bun).
 *
 * Both objects reuse src/book/physics.ts: a page is a chain of rigid links in the turning plane (x along the page, z up),
 * angle 0 = lying flat to the right of the root, π = lying flat to the left. Units are scene units (1 = 100 mm), kg, s.
 *
 *  - Résumé page: an A4 sheet (210 × 297 mm) bound on its left edge. No cards, so both columns are flexible: 3 + 3 links of
 *    35 mm (the "full-flex" path, n = 6). The seam between the two columns is made to behave like every other joint
 *    (same EI / L stiffness, no stiffening, no seam rate governor), so the sheet is one homogeneous strip of paper.
 *  - Business card: two rigid 54 mm panels joined by a soft crease (the chain's seam joint). The inner panel lies on the desk
 *    and is pinned there by the viewer; only the cover swings about the crease.
 */
import { PHYSICS, type PageBody, type PageEnv, type PageGeom, type Physics } from "../book/physics";

export const MM = 0.01;

/* ── A4 résumé page ── */
export const A4 = { w: 210, h: 297 } as const;
export const PAGE_W = A4.w * MM;
export const PAGE_H = A4.h * MM;
/** Both columns empty: 3 + 3 flexible links */
export const PAGE_GEOM: PageGeom = { inner: PAGE_W / 2, outer: PAGE_W / 2, height: PAGE_H };

/**
 * Paper preset (80 gsm, from the research note): 2.5 g per sheet, EI 0.037 kg·unit³/s² (≈ 3.7e-5 N·m²), finger torque 0.5.
 * Mass and EI are both half of a physical A4 80 gsm sheet, so the static curl (∝ m·g·L² / EI) matches real A4 paper while
 * the sheet floats down a little slower through the air — which reads as paper rather than card.
 */
export function paperPhysics(): Physics {
  const P = clone(PHYSICS);
  P.pvc = 0.0025;
  P.card = 0;
  // (no fold stop between neighbouring links: that is the album's empty film, r4 E6; a sheet of paper simply bends)
  P.flex = { segs: 3, EI: 0.037, zeta: 0.3, max: Infinity };
  // the column joint behaves like every other joint: EI / link length, no stiffening, no hard stop
  P.seam = { k: P.flex.EI / (PAGE_GEOM.inner / 3), zeta: P.flex.zeta, stiffen: 50, max: 3.4 };
  P.cap.seamK = 0;
  P.finger.torque = 0.5;
  // paper on paper
  P.contact = { e: 0.15, mu: 0.3 };
  return P;
}

/* ── Folded business card ── */
export const CARD = { w: 90, h: 54, t: 0.6 } as const;
/** One panel along the chain (the card folds along its long top edge: the chain runs across the 54 mm side) */
export const CARD_L = CARD.h * MM;
/** Width of the card across the chain (the crease length) */
export const CARD_SPAN = CARD.w * MM;
export const CARD_GEOM: PageGeom = { inner: CARD_L, outer: CARD_L, height: CARD_SPAN };
/** Closed rest: the crease springs the cover a few degrees open */
export const CARD_CLOSED = Math.PI - 0.06;
/** Width of the rounded crease (scene units) */
export const CREASE = 2.2 * MM;

/** 600 gsm cotton panels (≈ 2.9 g each), a soft crease that gravity holds closed, a hard stop when the cover lies on the inner panel */
export function cardPhysics(): Physics {
  const P = clone(PHYSICS);
  P.card = 0.0029;
  P.pvc = 0;
  P.seam = { k: 0.02, zeta: 0.45, stiffen: 50, max: CARD_CLOSED };
  P.cap.seam = 6;
  P.cap.seamK = 6;
  P.contact = { e: 0.1, mu: 0.4 };
  return P;
}

/** The turning plane is the desk: the root is fixed at the binding / at the inner panel's free edge, both stacks at z = 0 */
export const FLAT_ENV: PageEnv = { root: () => [0, 0], phR: 0, phL: 0, zR: 0, zL: 0, axisX: 0 };

function clone(p: Physics): Physics {
  return JSON.parse(JSON.stringify(p)) as Physics;
}

/* ── Shape for the shader: knots of (arc length, tangent angle); the tangent varies linearly between knots, so each piece is a circular arc ── */
export const MAX_KNOTS = 8;
export type Knots = { s: Float32Array; a: Float32Array; count: number };

export function createKnots(): Knots {
  return { s: new Float32Array(MAX_KNOTS), a: new Float32Array(MAX_KNOTS), count: 0 };
}

/**
 * Paper: one knot at each link's midpoint (its angle is that link's tangent), plus the two ends extrapolated by half a link.
 * The tangent is continuous along the sheet: no seam, a smooth curl. The extrapolated ends never head below the stacks (an angle
 * under 0 or over π) unless their link already does: a sheet lifting from its free edge bends up from the binding, and extrapolating
 * that bend back past the binding pointed the root down into the sheet under it, which then showed through a band of the turning
 * page along the binding (the phone's résumé, 2026-10-20).
 */
export function paperKnots(b: PageBody, out: Knots): Knots {
  const n = b.n;
  let s = 0;
  out.s[0] = 0;
  out.a[0] = n > 1 ? floorAngle(b.a[0]! - (b.a[1]! - b.a[0]!) / 2, b.a[0]!) : b.a[0]!;
  for (let i = 0; i < n; i++) {
    out.s[i + 1] = s + b.L[i]! / 2;
    out.a[i + 1] = b.a[i]!;
    s += b.L[i]!;
  }
  out.s[n + 1] = s;
  out.a[n + 1] = n > 1 ? floorAngle(b.a[n - 1]! + (b.a[n - 1]! - b.a[n - 2]!) / 2, b.a[n - 1]!) : b.a[n - 1]!;
  out.count = n + 2;
  return out;
}

/** An extrapolated end tangent kept within [0, π] (level with the stacks or above), or within its own link's angle beyond that */
const floorAngle = (a: number, link: number) => Math.min(Math.max(a, Math.min(0, link)), Math.max(Math.PI, link));

/** Card: two straight panels, the tangent turns from one panel's angle to the other's across the crease width */
export function cardKnots(b: PageBody, out: Knots, crease = CREASE): Knots {
  const L0 = b.L[0]!;
  const L1 = b.L[1]!;
  out.s[0] = 0;
  out.a[0] = b.a[0]!;
  out.s[1] = L0 - crease / 2;
  out.a[1] = b.a[0]!;
  out.s[2] = L0 + crease / 2;
  out.a[2] = b.a[1]!;
  out.s[3] = L0 + L1;
  out.a[3] = b.a[1]!;
  out.count = 4;
  return out;
}

/** Point on the knot path at arc length s (same maths as the vertex shader). Beyond the ends the path continues straight. */
export function knotPoint(k: Knots, s: number): [x: number, z: number, angle: number] {
  let x = 0;
  let z = 0;
  if (s <= 0) return [s * Math.cos(k.a[0]!), s * Math.sin(k.a[0]!), k.a[0]!];
  for (let i = 0; i + 1 < k.count; i++) {
    const s0 = k.s[i]!;
    const s1 = k.s[i + 1]!;
    const a0 = k.a[i]!;
    const len = s1 - s0;
    const last = i + 2 === k.count;
    if (s <= s1 || last) {
      const d = Math.min(s - s0, len);
      const bend = len > 1e-9 ? ((k.a[i + 1]! - a0) * d) / len : 0;
      const [ax, az] = arc(a0, bend, d);
      x += ax;
      z += az;
      if (s > s1) {
        const a1 = k.a[i + 1]!;
        x += (s - s1) * Math.cos(a1);
        z += (s - s1) * Math.sin(a1);
        return [x, z, a1];
      }
      return [x, z, a0 + bend];
    }
    const [ax, az] = arc(a0, k.a[i + 1]! - a0, len);
    x += ax;
    z += az;
  }
  return [x, z, k.a[k.count - 1]!];
}

/** Displacement of an arc starting at angle a0, turning by b over length L (counter-clockwise positive) */
export function arc(a0: number, b: number, L: number): [number, number] {
  if (Math.abs(b) < 1e-5) return [L * Math.cos(a0), L * Math.sin(a0)];
  return [(L / b) * (Math.sin(a0 + b) - Math.sin(a0)), (L / b) * (Math.cos(a0) - Math.cos(a0 + b))];
}

/** Mean link angle as turn progress: 0 lying on the right, 1 lying on the left */
export function turnProgress(b: PageBody): number {
  let m = 0;
  let w = 0;
  for (let i = 0; i < b.n; i++) {
    m += b.a[i]! * b.L[i]!;
    w += b.L[i]!;
  }
  return Math.min(1, Math.max(0, m / w / Math.PI));
}

/**
 * Pages never pass through each other: page i lies on top of page i + 1 on the right and under it on the left, so every link
 * angle of page i is at least that of page i + 1. When two pages are in flight at once, the one that is not held is pushed — but
 * never past lying flat (0 on the right, π on the left): a sheet in the hand that dips a hair below the left stack must not drag
 * the sheet lying there through the desk (it rendered under the desk's shadow as a grey slab).
 */
export function keepOrder(pages: PageBody[]) {
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i]!;
    const b = pages[i + 1]!;
    if (a.asleep && b.asleep) continue;
    for (let k = 0; k < a.n; k++) {
      const d = b.a[k]! - a.a[k]!;
      if (d <= 0) continue;
      // push the one that is not in the hand; otherwise the one chasing (the faster towards the other)
      const pushB = a.hand && !b.hand ? true : b.hand && !a.hand ? false : b.w[k]! >= -a.w[k]!;
      if (pushB) {
        const to = Math.max(0, a.a[k]!);
        b.a[k] = to;
        if (b.w[k]! > a.w[k]!) b.w[k] = to <= 0 ? Math.max(0, a.w[k]!) : a.w[k]!;
        b.asleep = false;
      } else {
        const to = Math.min(Math.PI, b.a[k]!);
        a.a[k] = to;
        // pushed flat onto the desk: it stops there rather than taking the push into the desk
        if (a.w[k]! < b.w[k]!) a.w[k] = to >= Math.PI ? Math.min(0, b.w[k]!) : b.w[k]!;
        a.asleep = false;
      }
    }
  }
}

/** Smoothstep on [0, 1] */
export const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
