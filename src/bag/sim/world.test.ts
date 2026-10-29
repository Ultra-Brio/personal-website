import { describe, expect, test } from "bun:test";
import { G, POUCH_H, POUCH_W, SIM_HZ } from "../constants";
import type { Frame } from "./frame";
import { createFrameTracker } from "./frame";
import { halfExtents } from "./layout";
import type { BodySpec } from "./types";
import { createBagSim } from "./world";
import { BODIES, FLAT, OPTS, SUBSTEP, chaosSchedule, find, gap, overlaps, place, run, sane, snapshot, tilted } from "./testkit";

const MM = 1000;
const deg = (d: number) => (d * Math.PI) / 180;
const maxMove = (a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]) => Math.max(...a.map((s, i) => Math.hypot(s.x - b[i]!.x, s.y - b[i]!.y)));
const rect = (id: string, w: number, h: number, layer: 0 | 1 | 2, mass = 0.005): BodySpec => ({ id, w, h, layer, shape: "rect", mass });

describe("determinism", () => {
  function script(seed: number) {
    const sim = createBagSim({ ...OPTS, seed });
    const chaos = chaosSchedule(5);
    run(sim, 3, chaos, 60);
    const p = find(sim, "polaroid");
    sim.grab("polaroid", p.x + 0.01, p.y);
    for (let i = 0; i < 90; i++) {
      sim.drag(0.05 * Math.sin(i / 10), 0.1 * Math.cos(i / 17));
      sim.step(1 / 60, chaos(3 + i / 60));
    }
    sim.release(0.8, -0.3);
    sim.shake(1.5);
    run(sim, 2, chaos, 60);
    sim.resetLayout();
    run(sim, 1, tilted(deg(20)), 120);
    return JSON.stringify([snapshot(sim), sim.stats()]);
  }
  test("equal seeds give bit-identical runs (grab, drag, release, shake, re-deal included)", () => {
    expect(script(7)).toBe(script(7));
  });
  test("different seeds give different layouts", () => {
    expect(script(7)).not.toBe(script(8));
  });
});

describe("initial layout", () => {
  test("30 seeds x 4 deals: no same-layer overlap, everything inside the walls, slightly rotated, at rest", () => {
    let worstGap = Infinity, anyRotated = 0, deals = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const sim = createBagSim({ ...OPTS, seed });
      for (let d = 0; d < 4; d++) {
        if (d) sim.resetLayout();
        const st = snapshot(sim);
        deals++;
        expect(overlaps(BODIES, st, 0.001)).toEqual([]); // the solver's own slop is 0.5 mm
        for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) if (st[i]!.layer === st[j]!.layer) worstGap = Math.min(worstGap, gap(BODIES, st[i]!, st[j]!));
        for (const s of st) {
          const spec = BODIES.find((b) => b.id === s.id)!;
          const { hx, hy } = halfExtents(spec, s.angle);
          expect(Math.abs(s.x) + hx).toBeLessThanOrEqual(POUCH_W / 2 + 0.001);
          expect(Math.abs(s.y) + hy).toBeLessThanOrEqual(POUCH_H / 2 + 0.001);
          expect(Math.abs(s.angle)).toBeLessThan(1.1);
          expect(Math.hypot(s.vx, s.vy) + Math.abs(s.w)).toBe(0);
          expect(s.held).toBe(false);
          expect(s.layer).toBe(spec.layer);
        }
        if (st.some((s) => Math.abs(s.angle) > 0.05)) anyRotated++;
      }
    }
    expect(anyRotated).toBe(deals);
    console.log(`layout: ${deals} deals, worst same-layer clearance ${(worstGap * MM).toFixed(2)} mm`);
  });
  test("resetLayout re-deals deterministically (equal seeds, equal counters) and differs from the first deal", () => {
    const a = createBagSim(OPTS), b = createBagSim(OPTS);
    const first = JSON.stringify(snapshot(a));
    a.resetLayout();
    b.resetLayout();
    expect(JSON.stringify(snapshot(a))).toBe(JSON.stringify(snapshot(b)));
    expect(JSON.stringify(snapshot(a))).not.toBe(first);
  });
  test("a crowded pouch still ends up without overlap (relaxation)", () => {
    const many: BodySpec[] = Array.from({ length: 7 }, (_, i) => rect(`r${i}`, 0.09, 0.06, 1));
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: many, seed: 3 });
    expect(overlaps(many, snapshot(sim), 0.001)).toEqual([]);
    expect(sane(sim.state())).toBe(true);
  });
});

describe("robustness", () => {
  test("20 s of hard gravity flips and +-3 g shakes with 7 mixed bodies: finite, nobody escapes, guards never fire", () => {
    const sim = createBagSim(OPTS);
    const chaos = chaosSchedule(11);
    let worstStep = 0, prev = snapshot(sim), maxSpeed = 0;
    run(sim, 20, chaos, 120, () => {
      const st = sim.state();
      expect(sane(st)).toBe(true);
      worstStep = Math.max(worstStep, maxMove(st, prev));
      for (const s of st) maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vy));
      prev = snapshot(sim);
    });
    expect(sim.stats().nanResets).toBe(0);
    expect(sim.stats().wallClamps).toBe(0);
    expect(overlaps(BODIES, snapshot(sim))).toEqual([]);
    console.log(`chaos 20 s: ${sim.stats().substeps} substeps, max speed ${maxSpeed.toFixed(2)} m/s, max travel per substep ${(worstStep * MM).toFixed(1)} mm`);
  });
  test("the same at 60 Hz cadence, with shake() thrown in", () => {
    const sim = createBagSim(OPTS);
    const chaos = chaosSchedule(23);
    run(sim, 20, chaos, 60, (t) => {
      if (Math.abs(t % 3) < 1e-9) sim.shake(2);
      expect(sane(sim.state())).toBe(true);
    });
    expect(sim.stats().nanResets + sim.stats().wallClamps).toBe(0);
  });
  test("garbage in, sane out: NaN / Infinity frames and dt, absurd magnitudes", () => {
    const sim = createBagSim(OPTS);
    sim.step(NaN, FLAT);
    sim.step(Infinity, FLAT);
    sim.step(-1, FLAT);
    sim.step(1 / 60, { ax: NaN, ay: Infinity, gn: NaN, omega: -Infinity, alpha: NaN });
    sim.step(1 / 60, { ax: 1e9, ay: -1e9, gn: 1e9, omega: 1e9, alpha: 1e9 });
    sim.step(1 / 60, FLAT);
    sim.step(5, FLAT); // clamped to SIM_MAX_DT
    sim.grab("nobody", 0, 0);
    sim.grab("card", NaN, 0);
    sim.drag(NaN, 0);
    sim.release(NaN, Infinity);
    sim.shake(NaN);
    sim.shake(-3);
    run(sim, 3, FLAT);
    expect(sane(sim.state())).toBe(true);
    expect(sim.stats().nanResets).toBe(0);
  });
  test("dt is clamped to SIM_MAX_DT: a 5 s frame costs 12 substeps", () => {
    const sim = createBagSim(OPTS);
    sim.step(1 / 60, FLAT);
    const before = sim.stats().substeps;
    sim.step(5, tilted(deg(40)));
    expect(sim.stats().substeps - before).toBe(Math.round(0.1 * SIM_HZ));
  });
});

describe("rest and idle()", () => {
  test("after chaos then a flat pouch, idle() turns true within a few seconds and nothing moves any more", () => {
    const sim = createBagSim(OPTS);
    run(sim, 6, chaosSchedule(31), 60);
    let idleAt = -1;
    run(sim, 8, FLAT, 60, (t) => {
      if (idleAt < 0 && sim.idle()) idleAt = t;
    });
    expect(idleAt).toBeGreaterThanOrEqual(0);
    expect(idleAt).toBeLessThan(4);
    const a = snapshot(sim);
    const steps = sim.stats().substeps;
    run(sim, 5, FLAT, 60);
    expect(maxMove(a, snapshot(sim))).toBe(0);
    expect(sim.idle()).toBe(true);
    expect(sim.stats().substeps).toBe(steps); // a resting pouch costs no substeps at all
    console.log(`idle() after ${idleAt.toFixed(2)} s of flat pouch following 6 s of chaos`);
  });
  test("a changed frame wakes it up, a change below 0.5 % g does not", () => {
    const sim = createBagSim(OPTS);
    run(sim, 3, FLAT);
    expect(sim.idle()).toBe(true);
    run(sim, 1, { ...FLAT, ax: 0.004 * G });
    expect(sim.idle()).toBe(true);
    sim.step(1 / 60, { ...FLAT, ax: 0.006 * G });
    expect(sim.idle()).toBe(false);
  });
  test("never idle while holding a body", () => {
    const sim = createBagSim(OPTS);
    run(sim, 2, FLAT);
    expect(sim.idle()).toBe(true);
    const c = find(sim, "card");
    sim.grab("card", c.x, c.y);
    expect(sim.idle()).toBe(false);
    for (let i = 0; i < 120; i++) {
      sim.drag(c.x, c.y);
      sim.step(SUBSTEP, FLAT);
    }
    expect(sim.idle()).toBe(false);
    sim.release(0, 0);
    run(sim, 2, FLAT);
    expect(sim.idle()).toBe(true);
  });
});

describe("surface friction in the world", () => {
  test("at a 10 and 20 degree tilt bodies stay put (no creep at all); at 26 and 30 degrees they slide", () => {
    const rows: string[] = [];
    for (const [d, slides] of [[10, false], [20, false], [26, true], [30, true]] as const) {
      const sim = createBagSim(OPTS);
      run(sim, 1, FLAT);
      const a = snapshot(sim);
      run(sim, 5, tilted(deg(d)), 60);
      const moved = maxMove(a, snapshot(sim));
      rows.push(`${d} deg: max displacement ${(moved * MM).toFixed(3)} mm`);
      if (slides) expect(moved).toBeGreaterThan(0.1);
      else expect(moved).toBeLessThan(0.0001);
    }
    console.log(rows.join(" | "));
  });
  test("upright (gn = 0) only the preload holds: everything slides down to the bottom and rests there", () => {
    const sim = createBagSim(OPTS);
    run(sim, 6, { ax: 0, ay: -G, gn: 0, omega: 0, alpha: 0 }, 60);
    expect(sim.idle()).toBe(true);
    const st = snapshot(sim);
    expect(Math.max(...st.map((s) => s.y))).toBeLessThan(0.05);
    for (const s of st) {
      const spec = BODIES.find((b) => b.id === s.id)!;
      expect(s.y - halfExtents(spec, s.angle).hy).toBeLessThan(-POUCH_H / 2 + 0.12); // sits in the lower part
    }
    expect(overlaps(BODIES, st)).toEqual([]);
  });
  test("a sliding body decelerates like MU * (gn + PRELOAD g) (flat pouch, kicked at 1.2 m/s)", () => {
    const bodies = [rect("a", 0.04, 0.04, 1)];
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies, seed: 4 });
    place(sim, "a", -0.09, 0);
    const s0 = find(sim, "a");
    sim.grab("a", s0.x, s0.y);
    sim.release(0.9, 0);
    const x0 = find(sim, "a").x;
    run(sim, 0.6, FLAT, 120);
    const s1 = find(sim, "a");
    const expected = 0.9 ** 2 / (2 * 3.9485) - 0.9 / (2 * SIM_HZ); // v^2 / 2a, less half a substep of travel from the discrete stop
    console.log(`slide: ${((s1.x - x0) * MM).toFixed(1)} mm travelled, Coulomb prediction ${(expected * MM).toFixed(1)} mm`);
    expect(Math.abs(s1.x - x0 - expected)).toBeLessThan(0.004);
    expect(Math.hypot(s1.vx, s1.vy)).toBe(0);
  });
});

describe("frame terms in the world", () => {
  test("centrifugal pushes outward and Coriolis bends the path; Euler acts across the radius", () => {
    const mk = () => {
      const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: [rect("a", 0.03, 0.03, 1)], seed: 2 });
      place(sim, "a", 0.05, 0);
      return sim;
    };
    const spin: Frame = { ax: 0, ay: 0, gn: 0, omega: 10, alpha: 0 };
    const c = mk();
    for (let i = 0; i < 6; i++) c.step(SUBSTEP, spin);
    const s = find(c, "a");
    expect(s.vx).toBeGreaterThan(0.15); // 100 * 0.05 m = 5 m/s^2 minus preload friction, for 50 ms
    expect(s.vy).toBeLessThan(-0.03);
    const e = mk();
    for (let i = 0; i < 6; i++) e.step(SUBSTEP, { ax: 0, ay: 0, gn: 0, omega: 0, alpha: 100 });
    expect(find(e, "a").vy).toBeLessThan(-0.15); // -alpha x r with r = (0.05, 0): 5 m/s^2 towards -y
    expect(Math.abs(find(e, "a").vx)).toBeLessThan(0.02);
  });
});

describe("collision layers", () => {
  const two = (layerB: 0 | 1 | 2): BodySpec[] => [rect("a", 0.05, 0.05, 0), rect("b", 0.05, 0.05, layerB)];
  function crossing(layerB: 0 | 1 | 2) {
    const specs = two(layerB);
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: specs, seed: 9, maxTravel: 0.05 });
    place(sim, "b", 0.03, 0);
    place(sim, "a", -0.07, 0);
    const b0 = find(sim, "b");
    const bx = b0.x, by = b0.y;
    const a = find(sim, "a");
    sim.grab("a", a.x, a.y);
    sim.release(3, (b0.y - a.y) * 3 / (b0.x - a.x)); // aimed at the centre of b
    let minX = Infinity, maxA = -Infinity, deepest = 0;
    run(sim, 0.5, FLAT, 120, () => {
      const sa = find(sim, "a"), sb = find(sim, "b");
      maxA = Math.max(maxA, sa.x - sb.x);
      minX = Math.min(minX, sa.x);
      deepest = Math.min(deepest, gap(specs, sa, sb));
    });
    return { bMoved: Math.hypot(find(sim, "b").x - bx, find(sim, "b").y - by), crossed: maxA, deepest };
  }
  test("different layers pass through each other; the other body is not even disturbed", () => {
    const r = crossing(1);
    expect(r.crossed).toBeGreaterThan(0.01); // a ended up on the far side of b
    expect(r.deepest).toBeLessThanOrEqual(-0.0019); // the cores really intersected (penetration beyond the two 1 mm skins)
    expect(r.bMoved).toBeLessThan(0.0001);
  });
  test("the same layer collides: a never gets through and b is shoved", () => {
    const r = crossing(0);
    expect(r.crossed).toBeLessThan(0.001);
    expect(r.deepest).toBeGreaterThan(-0.0019); // cores never intersected
    expect(r.bMoved).toBeGreaterThan(0.005);
  });
  test("setLayer switches at runtime, but only joins a layer once it is free of overlap", () => {
    const specs = two(1);
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: specs, seed: 9 });
    place(sim, "a", -0.02, 0);
    place(sim, "b", 0.02, 0); // overlaps a in x (they are 5 cm wide, centres 4 cm apart) but sits on another layer
    expect(gap(specs, find(sim, "a"), find(sim, "b"))).toBeLessThanOrEqual(-0.0019);
    const before = snapshot(sim);
    sim.setLayer("b", 0); // would overlap a in layer 0
    run(sim, 1, FLAT, 120);
    expect(find(sim, "b").layer).toBe(2); // still waiting as a ghost on the top layer
    expect(maxMove(before, snapshot(sim))).toBe(0); // and nobody was pushed
    sim.setLayer("b", 2); // an empty layer: joins at once
    expect(find(sim, "b").layer).toBe(2);
    sim.setLayer("b", 1);
    expect(find(sim, "b").layer).toBe(1);
    expect(maxMove(before, snapshot(sim))).toBe(0);
  });
});

describe("fling: continuous collision at 0.5..8 m/s", () => {
  const speeds = [0.5, 1, 2, 3, 4, 6, 8];
  const projSpec = rect("proj", 0.02, 0.06, 1, 0.009);
  function fling(v: number, hz: number, thinMass: number) {
    const thin = rect("thin", 0.012, 0.056, 1, thinMass);
    const specs = [projSpec, thin];
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: specs, seed: 5, maxTravel: 0.08 });
    place(sim, "thin", 0.025, 0);
    const t = find(sim, "thin");
    const n = [Math.cos(t.angle), Math.sin(t.angle)] as const;
    place(sim, "proj", t.x - 0.04 * n[0], t.y - 0.04 * n[1]); // 24 mm of clear run-up: even 0.5 m/s arrives, 8 m/s covers it in the first substep
    const p = find(sim, "proj");
    sim.grab("proj", p.x, p.y);
    sim.release(v * n[0], v * n[1]);
    expect(Math.hypot(find(sim, "proj").vx, find(sim, "proj").vy)).toBeCloseTo(v, 6); // released at full speed (maxTravel raised on purpose)
    let sMax = -Infinity, deepest = 0;
    run(sim, 0.5, FLAT, hz, () => {
      const sp = find(sim, "proj"), st = find(sim, "thin");
      expect(sane(sim.state())).toBe(true);
      sMax = Math.max(sMax, (sp.x - st.x) * n[0] + (sp.y - st.y) * n[1]);
      deepest = Math.min(deepest, gap(specs, sp, st));
    });
    return { sMax, deepest, clamps: sim.stats().wallClamps };
  }
  for (const hz of [60, 120]) {
    test(`a flung projectile never tunnels through a thin heavy body or a thin light one (render cadence ${hz} Hz)`, () => {
      const rows: string[] = [];
      for (const v of speeds)
        for (const m of [50, 0.0015]) {
          const r = fling(v, hz, m);
          rows.push(`${v} m/s ${m} kg: side ${(r.sMax * MM).toFixed(1)} mm, deepest ${(r.deepest * MM).toFixed(1)} mm`);
          expect(r.sMax).toBeLessThan(0.002); // the projectile never gets past the plate's centre line
          expect(r.deepest).toBeGreaterThan(-0.004);
          expect(r.clamps).toBe(0);
        }
      console.log(`fling @${hz} Hz:\n  ${rows.join("\n  ")}`);
    });
    test(`a flung body never leaves the pouch, whatever wall or corner it is aimed at (render cadence ${hz} Hz)`, () => {
      for (const v of speeds)
        for (const a of [0, 0.7, Math.PI / 2, 2.3, Math.PI, -2.4, -Math.PI / 2, -0.6]) {
          const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: [rect("proj", 0.02, 0.06, 1, 0.009)], seed: 6, maxTravel: 0.08 });
          const p = find(sim, "proj");
          sim.grab("proj", p.x, p.y);
          sim.release(v * Math.cos(a), v * Math.sin(a));
          run(sim, 0.5, FLAT, hz, () => expect(sane(sim.state())).toBe(true));
          expect(sim.stats().wallClamps).toBe(0);
        }
    });
  }
  test("at an uneven render cadence (30 / 7 / 16 ms frames) the result is just as safe", () => {
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: [projSpec, rect("thin", 0.012, 0.056, 1, 50)], seed: 5, maxTravel: 0.08 });
    place(sim, "thin", 0.025, 0);
    place(sim, "proj", -0.07, 0);
    const t = find(sim, "thin"), p = find(sim, "proj");
    sim.grab("proj", p.x, p.y);
    sim.release(8 * Math.cos(Math.atan2(t.y - p.y, t.x - p.x)), 8 * Math.sin(Math.atan2(t.y - p.y, t.x - p.x)));
    const frames = [1 / 33, 0.007, 0.016, 0.03];
    for (let i = 0; i < 60; i++) {
      sim.step(frames[i % frames.length]!, FLAT);
      expect(sane(sim.state())).toBe(true);
    }
    expect(sim.stats().wallClamps).toBe(0);
  });
});

describe("grab, drag, release", () => {
  test("the grabbed body is a ghost on the top layer, follows the pointer, and keeps its grab point under it", () => {
    const sim = createBagSim(OPTS);
    run(sim, 1, FLAT);
    const k = find(sim, "polaroid");
    sim.grab("polaroid", k.x, k.y);
    const h = find(sim, "polaroid");
    expect(h.held).toBe(true);
    expect(h.layer).toBe(2);
    expect(sim.state().filter((s) => s.held).length).toBe(1);
    for (let i = 0; i < 120; i++) {
      sim.drag(0.04, -0.03);
      sim.step(SUBSTEP, FLAT);
    }
    const f = find(sim, "polaroid");
    expect(Math.hypot(f.x - 0.04, f.y + 0.03)).toBeLessThan(0.002);
    // it passes through bodies of every layer while held, and is not pushed by walls it does not touch
    expect(sane(sim.state())).toBe(true);
  });
  test("a second grab lets go of the first body", () => {
    const sim = createBagSim(OPTS);
    const a = find(sim, "ticket"), b = find(sim, "card");
    sim.grab("ticket", a.x, a.y);
    sim.grab("card", b.x, b.y);
    expect(sim.state().filter((s) => s.held).map((s) => s.id)).toEqual(["card"]);
  });
  test("release speed is clamped to 20 mm per substep (2.4 m/s); no input can exceed it", () => {
    for (const v of [[1, 0], [5, 0], [0, -50], [300, 400], [NaN, 2], [Infinity, 0]] as const) {
      const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: [rect("a", 0.04, 0.04, 1)], seed: 4 });
      const s = find(sim, "a");
      sim.grab("a", s.x, s.y);
      sim.release(v[0], v[1]);
      const sp = Math.hypot(find(sim, "a").vx, find(sim, "a").vy);
      expect(sp).toBeLessThanOrEqual(2.4 + 1e-9);
      if (Number.isFinite(v[0] + v[1])) expect(sp).toBeCloseTo(Math.min(2.4, Math.hypot(v[0], v[1])), 9);
      else expect(sp).toBe(0);
      let worst = 0, prev = snapshot(sim);
      run(sim, 0.25, FLAT, 120, () => {
        worst = Math.max(worst, maxMove(sim.state(), prev));
        prev = snapshot(sim);
      });
      expect(worst).toBeLessThan(0.0201);
    }
  });
  test("10 s of wild pointer jumps over a crowded pouch: the held body never travels more than 20 mm per substep", () => {
    const sim = createBagSim(OPTS);
    const rnd = (() => { let a = 12345; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    let worstHeld = 0, worstAll = 0;
    let prev = snapshot(sim);
    let id = "";
    for (let i = 0; i < 1200; i++) {
      if (i % 120 === 0) {
        if (id) sim.release((rnd() - 0.5) * 20, (rnd() - 0.5) * 20);
        id = BODIES[Math.floor(rnd() * BODIES.length)]!.id;
        const s = find(sim, id);
        sim.grab(id, s.x + (rnd() - 0.5) * 0.02, s.y + (rnd() - 0.5) * 0.02);
      }
      if (i % 15 === 0) sim.drag((rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.5); // jumps, partly outside the pouch
      sim.step(SUBSTEP, chaosSchedule(2)(i / 120));
      const st = sim.state();
      for (let j = 0; j < st.length; j++) {
        const d = Math.hypot(st[j]!.x - prev[j]!.x, st[j]!.y - prev[j]!.y);
        if (st[j]!.held) worstHeld = Math.max(worstHeld, d);
        worstAll = Math.max(worstAll, d);
      }
      expect(sane(st)).toBe(true);
      prev = snapshot(sim);
    }
    console.log(`wild drag: held body max ${(worstHeld * MM).toFixed(1)} mm/substep, any body max ${(worstAll * MM).toFixed(1)} mm/substep`);
    expect(worstHeld).toBeLessThan(0.0205);
    expect(sim.stats().wallClamps + sim.stats().nanResets).toBe(0);
  });
  test("released into free space it re-joins its layer at once", () => {
    const specs = [rect("a", 0.09, 0.054, 1), rect("b", 0.09, 0.054, 1)];
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: specs, seed: 1 });
    place(sim, "a", 0, 0.08);
    place(sim, "b", 0, -0.08);
    const b = find(sim, "b");
    sim.grab("b", b.x, b.y);
    expect(find(sim, "b").layer).toBe(2);
    sim.release(0, 0);
    expect(find(sim, "b").layer).toBe(1);
    expect(find(sim, "b").held).toBe(false);
  });
  test("released on top of a same-layer body it stays a ghost, pushes nothing, and joins the layer pop-free once the spot is free", () => {
    const specs = [rect("a", 0.09, 0.054, 1), rect("b", 0.13, 0.055, 1), rect("c", 0.04, 0.04, 0)];
    const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies: specs, seed: 1 });
    place(sim, "a", 0, 0.1);
    place(sim, "b", 0, -0.1);
    const restA = find(sim, "a");
    const bb = find(sim, "b");
    sim.grab("b", bb.x, bb.y);
    for (let i = 0; i < 200; i++) {
      sim.drag(restA.x + 0.02, restA.y - 0.01); // deep on top of a
      sim.step(SUBSTEP, FLAT);
    }
    expect(Math.hypot(find(sim, "a").x - find(sim, "b").x, find(sim, "a").y - find(sim, "b").y)).toBeLessThan(0.03); // b sits deep on top of a
    sim.release(0, 0);
    const a0 = snapshot(sim);
    run(sim, 2, FLAT, 120);
    expect(find(sim, "b").layer).toBe(2); // still a ghost on top
    expect(find(sim, "b").held).toBe(false);
    expect(maxMove(a0.filter((s) => s.id !== "c"), snapshot(sim).filter((s) => s.id !== "c"))).toBe(0); // a was never pushed, nothing popped
    // pick a up and carry it away: b's spot is free, b joins its layer, nothing around it moves a hair
    const a = find(sim, "a");
    sim.grab("a", a.x, a.y);
    let joinedAt = -1;
    let worstOther = 0;
    let prev = snapshot(sim);
    for (let i = 0; i < 240; i++) {
      sim.drag(-0.02, -0.12);
      sim.step(SUBSTEP, FLAT);
      const st = sim.state();
      if (joinedAt < 0 && st[1]!.layer === 1) joinedAt = i;
      for (let j = 0; j < st.length; j++) if (st[j]!.id !== "a") worstOther = Math.max(worstOther, Math.hypot(st[j]!.x - prev[j]!.x, st[j]!.y - prev[j]!.y));
      prev = snapshot(sim);
    }
    expect(joinedAt).toBeGreaterThanOrEqual(0);
    expect(joinedAt).toBeLessThan(5); // the very next substeps: the spot is free as soon as a is a ghost
    expect(worstOther).toBeLessThan(0.0002); // the join moves nobody
    sim.release(0, 0);
    run(sim, 2, FLAT);
    expect(overlaps(specs, snapshot(sim))).toEqual([]);
    expect(find(sim, "a").layer).toBe(1);
  });
});

describe("shake", () => {
  test("kicks every free body, deterministically, and stays inside the pouch", () => {
    const run1 = () => {
      const sim = createBagSim(OPTS);
      sim.shake(1);
      const v = sim.state().map((s) => Math.hypot(s.vx, s.vy));
      run(sim, 3, FLAT, 60, () => expect(sane(sim.state())).toBe(true));
      return { v, end: JSON.stringify(snapshot(sim)) };
    };
    const a = run1(), b = run1();
    expect(a.end).toBe(b.end);
    for (const v of a.v) expect(v).toBeGreaterThan(0.5);
    for (const v of a.v) expect(v).toBeLessThan(3.2);
  });
  test("strength 0 does nothing; a held body is not shaken", () => {
    const sim = createBagSim(OPTS);
    sim.shake(0);
    expect(sim.state().every((s) => s.vx === 0 && s.vy === 0)).toBe(true);
    const k = find(sim, "card");
    sim.grab("card", k.x, k.y);
    sim.shake(2);
    expect(Math.hypot(find(sim, "card").vx, find(sim, "card").vy)).toBe(0);
  });
});

describe("the whole chain: pouch world matrices -> frame tracker -> sim", () => {
  test("a pouch lifted from lying flat to standing upright (hinged at its bottom edge) lets everything slide to the bottom, then rests", () => {
    const sim = createBagSim(OPTS);
    const tracker = createFrameTracker();
    const hinge = [0, 0, 0.16];
    const matrix = (b: number) => {
      // rotation about x: b = -90 deg lies flat on the desk (normal up), 0 stands upright facing the viewer
      const ey = [0, Math.cos(b), Math.sin(b)], ez = [0, -Math.sin(b), Math.cos(b)];
      return [1, 0, 0, 0, ey[0]!, ey[1]!, ey[2]!, 0, ez[0]!, ez[1]!, ez[2]!, 0, hinge[0]! + 0.16 * ey[0]!, hinge[1]! + 0.16 * ey[1]!, hinge[2]! + 0.16 * ey[2]!, 1];
    };
    const dt = 1 / 60;
    let maxA = 0, firstMove = -1;
    const before = snapshot(sim);
    for (let i = 0; i < 60 * 8; i++) {
      const t = i * dt;
      const b = -Math.PI / 2 + (Math.PI / 2) * Math.min(1, Math.max(0, (t - 1) / 1.5)); // starts lifting at 1 s, upright at 2.5 s
      const f = tracker.push(matrix(b), dt);
      maxA = Math.max(maxA, Math.hypot(f.ax, f.ay));
      sim.step(dt, f);
      if (firstMove < 0 && maxMove(before, snapshot(sim)) > 0.001) firstMove = t;
      expect(sane(sim.state())).toBe(true);
    }
    expect(firstMove).toBeGreaterThan(1); // nothing moves while the pouch lies flat
    expect(firstMove).toBeLessThan(2.2); // and things start to slide once it is steep enough for gravity to beat friction
    expect(sim.idle()).toBe(true);
    const st = snapshot(sim);
    expect(Math.max(...st.map((s) => s.y))).toBeLessThan(0.05);
    expect(overlaps(BODIES, st)).toEqual([]);
    console.log(`lift: first body moves at ${firstMove.toFixed(2)} s (lift starts at 1.00 s), peak in-plane acceleration ${maxA.toFixed(1)} m/s^2`);
  });
});
