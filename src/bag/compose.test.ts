import { describe, expect, test } from "bun:test";
import type { ItemKind } from "../profile/schema";
import { composeDeal, footprintsTouch, easiestDeal, GUIDE, guidePushes, RESCUE, rescueLayers, SLOTS, visibleFractions, type Footprint, type LayerNo } from "./compose";
import { POUCH_H, POUCH_W } from "./constants";
import { createBagSim } from "./sim";
import { FLAT, run } from "./sim/testkit";
import type { BodySpec, BodyState } from "./sim/types";

/*
 * The five pouch objects at their real footprints and layers (src/bag/objects: the stapled résumé with its second sheet's peek, the
 * 一筆箋 and the ticket over it, the polaroid and the business card on top). Dealt by compose.ts, then left to rest: nothing on one
 * layer overlaps, nothing pokes through a wall, and every object keeps enough of itself uncovered to be seen and picked up.
 */
const KINDS: ItemKind[] = ["card", "resume", "ticket", "polaroid", "note"];
const SPECS: BodySpec[] = [
  { id: "card", w: 0.09, h: 0.054, layer: 2, shape: "rect", mass: 0.0045 },
  { id: "resume", w: 0.1495, h: 0.2124, layer: 0, shape: "rect", mass: 0.007 },
  { id: "ticket", w: 0.15, h: 0.058, layer: 1, shape: "rect", mass: 0.0026 },
  { id: "polaroid", w: 0.088, h: 0.107, layer: 2, shape: "rect", mass: 0.006 },
  { id: "note", w: 0.082, h: 0.182, layer: 1, shape: "rect", mass: 0.0018 },
];

/** Is pouch point (px, py) inside body s (its rectangle, shrunk by `inset` m)? */
function inside(s: BodyState, spec: BodySpec, px: number, py: number, inset = 0) {
  const c = Math.cos(s.angle), n = Math.sin(s.angle);
  const dx = px - s.x, dy = py - s.y;
  const u = dx * c + dy * n, v = -dx * n + dy * c;
  return Math.abs(u) <= spec.w / 2 - inset && Math.abs(v) <= spec.h / 2 - inset;
}

/** Fraction of a body's area not covered by a body on a higher layer (sampled on a 2 mm grid). */
function visible(states: readonly BodyState[], i: number): number {
  const s = states[i]!;
  const spec = SPECS[i]!;
  let seen = 0;
  let all = 0;
  const c = Math.cos(s.angle), n = Math.sin(s.angle);
  for (let u = -spec.w / 2 + 0.001; u < spec.w / 2; u += 0.002)
    for (let v = -spec.h / 2 + 0.001; v < spec.h / 2; v += 0.002) {
      const px = s.x + u * c - v * n, py = s.y + u * n + v * c;
      all++;
      if (!states.some((o, j) => j !== i && SPECS[j]!.layer > spec.layer && inside(o, SPECS[j]!, px, py))) seen++;
    }
  return seen / all;
}

/** Do two bodies (same layer) overlap by more than `slop` m? (separating axis on the two rectangles) */
function overlap(a: BodyState, sa: BodySpec, b: BodyState, sb: BodySpec, slop = 0.0005) {
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang), ay = Math.sin(ang);
    const proj = (s: BodyState, sp: BodySpec) => {
      const c = Math.cos(s.angle), n = Math.sin(s.angle);
      const r = (Math.abs(c * ax + n * ay) * sp.w) / 2 + (Math.abs(-n * ax + c * ay) * sp.h) / 2;
      const m = s.x * ax + s.y * ay;
      return [m - r, m + r] as const;
    };
    const [a0, a1] = proj(a, sa);
    const [b0, b1] = proj(b, sb);
    if (a1 - slop <= b0 || b1 - slop <= a0) return false;
  }
  return true;
}

describe("composeDeal: five objects", () => {
  test("every kind in the pouch has a slot", () => {
    for (const k of KINDS) expect(SLOTS[k]).toBeDefined();
  });

  for (const n of [0, 1, 2, 3, 4, 5]) {
    test(`deal ${n}: at rest nothing overlaps on a layer, nothing leaves the pouch, and every object shows`, () => {
      const deal = composeDeal(KINDS, SPECS, 7);
      const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: SPECS, seed: 7, deal });
      for (let k = 0; k < n; k++) sim.resetLayout();
      run(sim, 1.5, FLAT);
      const st = sim.state().map((s) => ({ ...s }));
      // the composed place, not a scatter: each object rests within a few mm of its slot
      const placed = deal(n);
      st.forEach((s, i) => {
        const p = placed[i]!;
        expect(Math.hypot(s.x - p.x, s.y - p.y)).toBeLessThan(0.01);
      });
      for (let i = 0; i < st.length; i++)
        for (let j = i + 1; j < st.length; j++) if (SPECS[i]!.layer === SPECS[j]!.layer) expect(overlap(st[i]!, SPECS[i]!, st[j]!, SPECS[j]!)).toBe(false);
      // inside the walls (corners included)
      st.forEach((s, i) => {
        const sp = SPECS[i]!;
        const c = Math.abs(Math.cos(s.angle)), m = Math.abs(Math.sin(s.angle));
        const hx = (sp.w * c + sp.h * m) / 2, hy = (sp.w * m + sp.h * c) / 2;
        expect(Math.abs(s.x) + hx).toBeLessThanOrEqual(POUCH_W / 2 + 0.0005);
        expect(Math.abs(s.y) + hy).toBeLessThanOrEqual(POUCH_H / 2 + 0.0005);
      });
      // seen: the paper at the back at least half, everything above it most of itself
      const seen = st.map((_, i) => visible(st, i));
      st.forEach((s, i) => expect(seen[i]!).toBeGreaterThan(SPECS[i]!.layer === 2 ? 0.99 : SPECS[i]!.id === "resume" ? 0.5 : 0.55));
    });
  }
});

describe("rescueLayers: nothing stays buried after a shake", () => {
  const fpOf = (st: readonly BodyState[]) => st.map((s, i) => ({ x: s.x, y: s.y, angle: s.angle, w: SPECS[i]!.w, h: SPECS[i]!.h }));
  test("a ticket buried under the card and the polaroid comes up; nothing on one layer touches", () => {
    // the ticket (layer 1) lies under both layer-2 bodies
    const fp: Footprint[] = [
      { x: -0.03, y: -0.1, angle: 0, w: 0.09, h: 0.054 },
      { x: 0, y: 0.05, angle: 0, w: 0.1495, h: 0.2124 },
      { x: 0, y: -0.1, angle: 0, w: 0.15, h: 0.058 },
      { x: 0.045, y: -0.1, angle: 0, w: 0.088, h: 0.107 },
      { x: 0.07, y: 0.08, angle: 0, w: 0.082, h: 0.182 },
    ];
    const cur: LayerNo[] = [2, 0, 1, 2, 1];
    expect(Math.min(...visibleFractions(fp, cur))).toBeLessThan(RESCUE);
    const next = rescueLayers(fp, cur)!;
    expect(next).not.toBeNull();
    expect(Math.min(...visibleFractions(fp, next))).toBeGreaterThanOrEqual(RESCUE);
    for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) if (next[i] === next[j]) expect(footprintsTouch(fp[i]!, fp[j]!)).toBe(false);
  });
  test("nothing to do when everything shows", () => {
    const fp: Footprint[] = [
      { x: -0.05, y: 0, angle: 0, w: 0.05, h: 0.05 },
      { x: 0.05, y: 0, angle: 0, w: 0.05, h: 0.05 },
    ];
    expect(rescueLayers(fp, [0, 2])).toBeNull();
  });
  for (const seed of [3, 7, 11]) {
    test(`ten shakes (seed ${seed}): the guided settle, then the layer rescue, leave every object at least ${RESCUE * 100} % in view`, () => {
      const deal = composeDeal(KINDS, SPECS, seed);
      const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: SPECS, seed, deal });
      run(sim, 1.5, FLAT);
      let layers = SPECS.map((s) => s.layer as LayerNo);
      const home = layers.slice();
      for (let k = 0; k < 10; k++) {
        // as the addon does: every body back on its own layer, then a shake stronger than the app's (two kicks of about 0.9 and
        // 0.7 m/s) and every way at once, a settle steered to the easiest of the next six deals
        for (let pass = 0; pass < 2; pass++) SPECS.forEach((sp) => sim.setLayer(sp.id, sp.layer));
        layers = home.slice();
        sim.shake(1, 2 * Math.PI);
        run(sim, GUIDE.after, FLAT);
        const target = easiestDeal(sim.state(), layers, [0, 1, 2, 3, 4, 5].map((d) => deal(6 * k + 1 + d)));
        run(sim, GUIDE.dur, FLAT, 60, () => guidePushes(sim.state(), target, 1 / 60).forEach((p, i) => p && sim.push(SPECS[i]!.id, p[0], p[1], p[2])));
        run(sim, 1, FLAT);
        const next = rescueLayers(fpOf(sim.state()), layers, home);
        if (next) {
          next.forEach((l, i) => sim.setLayer(SPECS[i]!.id, l));
          next.forEach((l, i) => sim.setLayer(SPECS[i]!.id, l));
          layers = next;
        }
        run(sim, 0.2, FLAT);
        expect(sim.ghosts()).toEqual([]);
        expect(overlapsOnALayer(sim.state())).toBe(false);
        const seen = visibleFractions(fpOf(sim.state()), sim.state().map((s) => s.layer));
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(RESCUE);
      }
    });
  }
});

/** Same-layer bodies overlapping by more than 1 mm (two bodies steered into each other may rest a hair inside, as under load). */
function overlapsOnALayer(st: readonly BodyState[]): boolean {
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) if (st[i]!.layer === st[j]!.layer && overlap(st[i]!, SPECS[i]!, st[j]!, SPECS[j]!, 0.001)) return true;
  return false;
}
