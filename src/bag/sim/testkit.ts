/* Shared helpers of the sim tests (not imported by production code). */
import { G, POUCH_H, POUCH_W, SIM_HZ } from "../constants";
import type { Frame } from "./frame";
import { mulberry32 } from "./layout";
import { S, gapBetween, makeShapes } from "./shapes";
import type { BagSim, BodySpec, BodyState } from "./types";
import { Transform, Vec2 } from "planck";

/**
 * Seven mixed bodies: the pouch's four paper things at their real sizes and layers (src/bag/objects: the folded A4 résumé at the
 * back, the ticket over it, the polaroid and the business card on top), plus three shape fixtures — a capsule and two discs on
 * every layer — so circles and capsules, which the sim supports though the pouch carries none today, stay covered.
 */
export const BODIES: BodySpec[] = [
  { id: "resume", w: 0.1485, h: 0.21, layer: 0, shape: "rect", mass: 0.005 },
  { id: "ticket", w: 0.138, h: 0.054, layer: 1, shape: "rect", mass: 0.0022 },
  { id: "polaroid", w: 0.088, h: 0.107, layer: 2, shape: "rect", mass: 0.006 },
  { id: "card", w: 0.085, h: 0.055, layer: 2, shape: "rect", mass: 0.003 },
  { id: "capsule", w: 0.075, h: 0.026, layer: 1, shape: "capsule", mass: 0.012 },
  { id: "disc", w: 0.036, h: 0.036, layer: 2, shape: "circle", mass: 0.001 },
  { id: "coin", w: 0.044, h: 0.044, layer: 0, shape: "circle", mass: 0.01 },
];

export const OPTS = { width: POUCH_W, height: POUCH_H, bodies: BODIES, seed: 7 };

/** Frame of a pouch tilted by `beta` (0 = lying flat, 90 deg = standing upright) with the downhill direction `phi`. */
export function tilted(beta: number, phi = -Math.PI / 2): Frame {
  return { ax: G * Math.sin(beta) * Math.cos(phi), ay: G * Math.sin(beta) * Math.sin(phi), gn: G * Math.cos(beta), omega: 0, alpha: 0 };
}
export const FLAT: Frame = { ax: 0, ay: 0, gn: G, omega: 0, alpha: 0 };

/** Run `seconds` of sim at the given render cadence (calls of step(1/hz)). */
export function run(sim: BagSim, seconds: number, frame: Frame | ((t: number) => Frame), hz = 60, each?: (t: number) => void) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    sim.step(1 / hz, typeof frame === "function" ? frame(t) : frame);
    each?.(t);
  }
}

export function find(sim: BagSim, id: string): BodyState {
  return sim.state().find((b) => b.id === id)!;
}

/** Carry a body to (x, y) with the real grab / drag / release path and let it settle there (no velocity left). */
export function place(sim: BagSim, id: string, x: number, y: number, frame: Frame = FLAT) {
  const s = find(sim, id);
  sim.grab(id, s.x, s.y);
  for (let i = 0; i < 300; i++) {
    sim.drag(x, y);
    sim.step(SUBSTEP, frame);
  }
  sim.release(0, 0);
  for (let i = 0; i < 24; i++) sim.step(SUBSTEP, frame);
}

export function snapshot(sim: BagSim): BodyState[] {
  return sim.state().map((s) => ({ ...s }));
}

/** Random hard gravity flips every second plus a +-3 g shake of 100 ms every two seconds, like the research schedule. */
export function chaosSchedule(seed = 11) {
  const rnd = mulberry32(seed);
  const segs = Array.from({ length: 24 }, () => ({ phi: rnd() * Math.PI * 2, beta: ((10 + rnd() * 80) * Math.PI) / 180, dir: rnd() * Math.PI * 2 }));
  return (t: number): Frame => {
    const s = segs[Math.min(Math.floor(t), segs.length - 1)]!;
    let ax = G * Math.sin(s.beta) * Math.cos(s.phi), ay = G * Math.sin(s.beta) * Math.sin(s.phi);
    if (t % 2 >= 1.5 && t % 2 < 1.6) {
      const a = 3 * G * Math.sin(2 * Math.PI * 5 * (t % 2 - 1.5));
      ax -= a * Math.cos(s.dir);
      ay -= a * Math.sin(s.dir);
    }
    return { ax, ay, gn: G * Math.cos(s.beta), omega: 0, alpha: 0 };
  };
}

const shapeCache = new Map<string, ReturnType<typeof makeShapes>>();
function shapesOf(spec: BodySpec) {
  let s = shapeCache.get(spec.id);
  if (!s) shapeCache.set(spec.id, (s = makeShapes(spec)));
  return s;
}

/** Signed clear distance in metres between the rounded hulls of two bodies (negative = penetration). Independent of the sim's own bookkeeping. */
export function gap(specs: readonly BodySpec[], a: BodyState, b: BodyState): number {
  const sa = specs.find((s) => s.id === a.id)!, sb = specs.find((s) => s.id === b.id)!;
  return gapBetween(shapesOf(sa), new Transform(new Vec2(a.x * S, a.y * S), a.angle), shapesOf(sb), new Transform(new Vec2(b.x * S, b.y * S), b.angle)) / S;
}

/** Same-layer pairs of non-ghost bodies that penetrate each other by more than `tol` metres (resting contact sits within about half a millimetre). */
export function overlaps(specs: readonly BodySpec[], states: readonly BodyState[], tol = 0.001): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i]!, b = states[j]!;
      if (a.layer !== b.layer || a.held) continue;
      if (gap(specs, a, b) < -tol) out.push([a.id, b.id]);
    }
  return out;
}

/** True when every body centre is inside the pouch and all numbers are finite. */
export function sane(states: readonly BodyState[], w = POUCH_W, h = POUCH_H): boolean {
  return states.every((s) => [s.x, s.y, s.angle, s.vx, s.vy, s.w].every(Number.isFinite) && Math.abs(s.x) <= w / 2 && Math.abs(s.y) <= h / 2);
}

export const SUBSTEP = 1 / SIM_HZ;
