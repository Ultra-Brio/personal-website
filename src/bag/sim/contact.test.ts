import { describe, expect, test } from "bun:test";
import { G, POUCH_H, POUCH_W, SIM_HZ } from "../constants";
import type { Frame } from "./frame";
import type { BodySpec } from "./types";
import { CONTACT_MIN_SPEED, createBagSim } from "./world";
import { BODIES, FLAT, OPTS, SUBSTEP, chaosSchedule, find, place, run, snapshot, tilted } from "./testkit";

/*
 * Contact reports (BagSimOptions.onContact): the speed is the normal approach speed of the hit, same-layer bodies and walls only,
 * a resting pile never chatters, each pair at most once per 50 ms, dealing reports nothing, and listening changes nothing.
 */

type Hit = { a: string; b: string; v: number; x: number; y: number; t: number };
const rect = (id: string, w: number, h: number, layer: 0 | 1 | 2, mass = 0.005): BodySpec => ({ id, w, h, layer, shape: "rect", mass });
const UPRIGHT: Frame = { ax: 0, ay: -G, gn: 0, omega: 0, alpha: 0 };
const NO_FRICTION = { kinetic: 0, static: 0 };

/** A sim whose reports land in `hits`, time-stamped in seconds of sim time (one SUBSTEP per step call in these tests). */
function listen(opts: Parameters<typeof createBagSim>[0]) {
  const hits: Hit[] = [];
  let t = 0;
  const sim = createBagSim({ ...opts, onContact: (a, b, v, x, y) => hits.push({ a, b, v, x, y, t }) });
  const step = (dt: number, f: Frame) => {
    sim.step(dt, f);
    t += dt;
  };
  return { sim, hits, step, now: () => t };
}

describe("contact reports", () => {
  test("a body falling onto the bottom wall reports its approach speed there (upright pouch, no friction)", () => {
    const { sim, hits, step } = listen({ width: POUCH_W, height: POUCH_H, bodies: [rect("a", 0.05, 0.05, 0)], seed: 3, friction: NO_FRICTION });
    place(sim, "a", 0, 0.05);
    hits.length = 0;
    let vPrev = 0;
    for (let i = 0; i < 2 * SIM_HZ && hits.length === 0; i++) {
      vPrev = find(sim, "a").vy;
      step(SUBSTEP, UPRIGHT);
    }
    expect(hits.length).toBe(1);
    const h = hits[0]!;
    expect(h.a).toBe("a");
    expect(h.b).toBe("wall");
    // the solver sees the velocity of this substep: last state + one substep of gravity
    const expected = Math.abs(vPrev) + G * SUBSTEP;
    expect(Math.abs(h.v - expected) / expected).toBeLessThan(0.03);
    // free fall from 185 mm (bottom edge at y = 25 mm, wall at -160 mm): sqrt(2 g d) = 1.9 m/s, give or take the substep
    const d = 0.05 - 0.025 + POUCH_H / 2;
    expect(Math.abs(h.v - Math.sqrt(2 * G * d)) / Math.sqrt(2 * G * d)).toBeLessThan(0.06);
    expect(Math.abs(h.y + POUCH_H / 2)).toBeLessThan(0.003); // on the bottom wall
    expect(Math.abs(h.x)).toBeLessThan(0.026); // under the body
    // it landed a hair tilted: the second corner may slap down once (much softer, after the 50 ms debounce), then it lies still
    for (let i = 0; i < 2 * SIM_HZ; i++) step(SUBSTEP, UPRIGHT);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const later of hits.slice(1)) {
      expect(later.v).toBeLessThan(0.2 * h.v);
      expect(later.t - h.t).toBeGreaterThanOrEqual(0.05 - 1e-9);
    }
    const n = hits.length;
    for (let i = 0; i < 2 * SIM_HZ; i++) step(SUBSTEP, UPRIGHT);
    expect(hits.length).toBe(n);
  });

  test("two bodies on the same layer: the hit reports the moving body first, at about the closing speed", () => {
    const { sim, hits, step } = listen({ width: POUCH_W, height: POUCH_H, bodies: [rect("a", 0.05, 0.05, 0), rect("b", 0.05, 0.05, 0, 0.01)], seed: 9, maxTravel: 0.05 });
    place(sim, "b", 0.03, 0);
    place(sim, "a", -0.07, 0);
    hits.length = 0;
    const a = find(sim, "a");
    sim.grab("a", a.x, a.y);
    sim.release(3, 0);
    for (let i = 0; i < 0.3 * SIM_HZ; i++) step(SUBSTEP, FLAT);
    const ab = hits.filter((h) => h.b !== "wall");
    expect(ab[0]!.a).toBe("a");
    expect(ab[0]!.b).toBe("b");
    // 3 m/s at release, film friction (MU g = 3.4 m/s^2) over the 50 mm gap: about 2.9 m/s
    expect(ab[0]!.v).toBeGreaterThan(2.5);
    expect(ab[0]!.v).toBeLessThan(3.05);
    // b is knocked into the right wall, bounces back and meets a again: real, and softer
    expect(hits.some((h) => h.a === "b" && h.b === "wall")).toBe(true);
    for (const later of ab.slice(1)) expect(later.v).toBeLessThan(0.5 * ab[0]!.v);
  });

  test("bodies on different layers pass through each other without a report (and so do ghosts)", () => {
    const { sim, hits, step } = listen({ width: POUCH_W, height: POUCH_H, bodies: [rect("a", 0.05, 0.05, 0), rect("b", 0.05, 0.05, 1)], seed: 9, maxTravel: 0.05 });
    place(sim, "b", 0.03, 0);
    place(sim, "a", -0.07, 0);
    hits.length = 0;
    const a = find(sim, "a");
    sim.grab("a", a.x, a.y);
    sim.release(3, 0);
    for (let i = 0; i < 0.5 * SIM_HZ; i++) step(SUBSTEP, FLAT);
    expect(hits.filter((h) => h.b !== "wall").length).toBe(0);
    expect(find(sim, "a").x).toBeGreaterThan(find(sim, "b").x); // it really went through
    // a held body (a ghost) dragged right across b: nothing either
    hits.length = 0;
    const b = find(sim, "b");
    sim.grab("b", b.x, b.y);
    for (let i = 0; i < 0.6 * SIM_HZ; i++) {
      sim.drag(-0.08 + (0.16 * i) / (0.6 * SIM_HZ), 0);
      step(SUBSTEP, FLAT);
    }
    sim.release(0, 0);
    expect(hits.filter((h) => h.b !== "wall").length).toBe(0);
  });

  test("a mixed pile sliding over each other on a 35 degree tilt: reports only for same-layer pairs and walls", () => {
    const layerOf = new Map(BODIES.map((b) => [b.id, b.layer]));
    const { hits, step } = listen(OPTS);
    for (let i = 0; i < 4 * SIM_HZ; i++) step(SUBSTEP, tilted((35 * Math.PI) / 180));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) if (h.b !== "wall") expect(layerOf.get(h.a)).toBe(layerOf.get(h.b));
  });

  test("a resting pile does not chatter: upright, awake (the frame keeps changing a hair), not one report in 3 s", () => {
    const { sim, hits, step } = listen(OPTS);
    for (let i = 0; i < 6 * SIM_HZ; i++) step(SUBSTEP, UPRIGHT);
    const settling = hits.length;
    expect(settling).toBeLessThan(150);
    expect(sim.idle()).toBe(true);
    // idle: stepping is free and silent
    hits.length = 0;
    for (let i = 0; i < 2 * SIM_HZ; i++) step(SUBSTEP, UPRIGHT);
    expect(hits.length).toBe(0);
    // awake but resting: the frame wobbles by 1 % g every step (above the 0.5 % g wake threshold), so every substep runs and the
    // resting contacts are pressed at about g / 120 = 0.08 m/s each step, without a single report
    const before = snapshot(sim);
    const substeps = sim.stats().substeps;
    for (let i = 0; i < 3 * SIM_HZ; i++) step(SUBSTEP, { ...UPRIGHT, ay: -G * (i % 2 ? 1 : 1.01) });
    expect(sim.stats().substeps - substeps).toBe(3 * SIM_HZ);
    expect(hits.length).toBe(0);
    const moved = Math.max(...snapshot(sim).map((s, i) => Math.hypot(s.x - before[i]!.x, s.y - before[i]!.y)));
    expect(moved).toBeLessThan(0.002);
  });

  test("a resting contact that is struck again reports (a jolt into the wall it lies on); a slow tilt change does not", () => {
    const { sim, hits, step } = listen({ width: POUCH_W, height: POUCH_H, bodies: [rect("a", 0.05, 0.05, 0)], seed: 3 });
    place(sim, "a", 0, -POUCH_H / 2 + 0.03, UPRIGHT);
    for (let i = 0; i < SIM_HZ; i++) step(SUBSTEP, UPRIGHT);
    hits.length = 0;
    // tilting from upright to 1.05 g and back over a second: nothing
    for (let i = 0; i < SIM_HZ; i++) step(SUBSTEP, { ...UPRIGHT, ay: -G * (1 + 0.05 * Math.sin((Math.PI * i) / SIM_HZ)) });
    expect(hits.length).toBe(0);
    // a 12 g jolt downward for one substep: the body is thrown into the wall it rests on
    step(SUBSTEP, { ...UPRIGHT, ay: -12 * G });
    for (let i = 0; i < 10; i++) step(SUBSTEP, UPRIGHT);
    expect(hits.length).toBe(1);
    expect(hits[0]!.b).toBe("wall");
    expect(hits[0]!.v).toBeGreaterThan(0.8);
  });

  test("each pair reports at most once per 50 ms (a body rattled between the walls by a 3 g, 12 Hz square shake)", () => {
    const { hits, step } = listen({ width: 0.08, height: 0.08, bodies: [rect("a", 0.03, 0.03, 0)], seed: 3 });
    for (let i = 0; i < 2 * SIM_HZ; i++) step(SUBSTEP, { ax: Math.floor(i / 5) % 2 ? 3 * G : -3 * G, ay: 0, gn: G, omega: 0, alpha: 0 });
    expect(hits.length).toBeGreaterThan(5);
    const last = new Map<string, number>();
    let closest = Infinity;
    for (const h of hits) {
      const key = `${h.a}|${h.b}|${Math.sign(h.x)}|${Math.sign(h.y)}`;
      const t0 = last.get(key);
      if (t0 !== undefined) closest = Math.min(closest, h.t - t0);
      last.set(key, h.t);
      expect(h.v).toBeGreaterThanOrEqual(CONTACT_MIN_SPEED);
    }
    expect(closest).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  test("dealing reports nothing (creation and resetLayout), and a flat resting pouch stays silent", () => {
    const { sim, hits, step } = listen(OPTS);
    expect(hits.length).toBe(0);
    for (let i = 0; i < SIM_HZ; i++) step(SUBSTEP, FLAT);
    sim.resetLayout();
    for (let i = 0; i < SIM_HZ; i++) step(SUBSTEP, FLAT);
    expect(hits.length).toBe(0);
  });

  test("listening changes nothing: chaos, grab, fling and shake give bit-identical states with and without onContact", () => {
    const script = (listenTo: boolean) => {
      let n = 0;
      const sim = createBagSim({ ...OPTS, ...(listenTo && { onContact: () => void n++ }) });
      const chaos = chaosSchedule(5);
      run(sim, 3, chaos, 60);
      const p = find(sim, "polaroid");
      sim.grab("polaroid", p.x + 0.01, p.y);
      for (let i = 0; i < 60; i++) {
        sim.drag(0.05 * Math.sin(i / 10), 0.1 * Math.cos(i / 17));
        sim.step(1 / 60, chaos(3 + i / 60));
      }
      sim.release(0.8, -0.3);
      sim.shake(1.5);
      run(sim, 2, chaos, 60);
      return { json: JSON.stringify(snapshot(sim)), n };
    };
    const quiet = script(false);
    const heard = script(true);
    expect(heard.json).toBe(quiet.json);
    expect(heard.n).toBeGreaterThan(10);
  });
});
