import { describe, expect, test } from "bun:test";
import { PHYSICS, carryPage, createPage, freePage, grabPage, grabPoint, pageShape, pullPage, restPage, seamFold, stepPage, turnPage, type PageBody, type PageEnv } from "./physics";
import { resolveLayout } from "./layout";
import { physicsFor } from "./physics-profile";
import { PITCH, SEG, panelRoot, restPhi, segOf } from "./sheet";

/* An open binder lying flat: ring centre and radius as in binder.ts (a 1-inch ring for 4 sheets) */
const R = 0.13;
const cx = 0;
const cz = 0.155;
const SHEETS = 4;
function envFor(i: number): PageEnv {
  const zR = (SHEETS - i - 0.5) * PITCH;
  const zL = (i + 0.5) * PITCH;
  return {
    root: (phi, th) => panelRoot(cx + R * Math.cos(phi), cz + R * Math.sin(phi), phi, th),
    phR: restPhi(cx, cz, R, zR),
    phL: Math.PI - restPhi(cx, cz, R, zL),
    zR,
    zL,
    axisX: cx,
  };
}
const GEOM = { inner: (SEG.a2 + SEG.b2) / 2 - SEG.b1, outer: SEG.w - (SEG.a2 + SEG.b2) / 2, height: SEG.h };
const H = 1 / PHYSICS.hz;
const DEG = Math.PI / 180;

/** Run until asleep (or out of time); returns the time taken and what was recorded on the way */
function run(b: PageBody, env: PageEnv, seconds: number, each?: (t: number) => void) {
  let t = 0;
  let restarts = 0;
  let hadFinger = !!b.finger;
  while (t < seconds) {
    t += H;
    each?.(t);
    const awake = stepPage(b, env, H, t);
    if (b.finger && !hadFinger) restarts++;
    hadFinger = !!b.finger;
    if (!awake && !b.hand) break;
  }
  return { t, restarts };
}

/**
 * A tap turn of one sheet: time taken, the smallest seam fold (outer column trailing) and the largest (outer column ahead), how far
 * the inner column had turned when the outer column passed vertical, the deepest seam fold once the inner column is past 170° (whether
 * the outer column lands late), the moment the inner column reaches 90°
 */
function clickTurn(cin: number, cout: number) {
  const env = envFor(1);
  const b = createPage(GEOM, cin, cout);
  restPage(b, 0, env);
  turnPage(b, 1, 0);
  let lo = 0;
  let hi = 0;
  let land = 0;
  let innerAtOuterUp = -1;
  let t90 = Infinity;
  const r = run(b, env, 3, (t) => {
    const th = b.a[0]!;
    const fold = seamFold(b);
    lo = Math.min(lo, fold);
    hi = Math.max(hi, fold);
    if (th > 170 * DEG) land = Math.min(land, fold);
    if (innerAtOuterUp < 0 && b.a[b.n - 1]! > Math.PI / 2) innerAtOuterUp = th;
    if (th >= Math.PI / 2 && t < t90) t90 = t;
  });
  return { b, ...r, lo, hi, land, innerAtOuterUp, t90 };
}

/** Grab the inner column's outer end, lift the inner column to deg degrees and hold it there; returns the settled pose */
function holdInner(cin: number, cout: number, deg: number) {
  const env = envFor(1);
  const b = createPage(GEOM, cin, cout);
  restPage(b, 0, env);
  grabPage(b, GEOM.inner - 0.03, 0);
  run(b, env, 2.5, (t) => pullPage(b, deg * DEG * Math.min(1, t / 0.6)));
  return b;
}

describe("album page physics", () => {
  test("a click turn lifts the page over the top, lands on the left and goes to sleep", () => {
    const { b, t, restarts, lo, hi, land, innerAtOuterUp } = clickTurn(6, 6);
    expect(b.asleep).toBe(true);
    expect(b.a[0]).toBeCloseTo(Math.PI, 6);
    expect(b.a[1]).toBeCloseTo(Math.PI, 6);
    // a turn takes 0.6–1.3 s; after landing it is not taken for "flung back" and lifted again
    expect(t).toBeGreaterThan(0.6);
    expect(t).toBeLessThan(1.3);
    expect(restarts).toBe(0);
    // the seam is soft: at the start the outer column trails (a tent, folded 20°–40°); once the sheet is up the hand lifts further
    // out along it, the outer column passes vertical first (the inner column not yet at 90°) and goes over ahead (folded
    // +15° … +35°); on landing the outer column is a little late instead
    expect(lo).toBeLessThan(-20 * DEG);
    expect(lo).toBeGreaterThan(-40 * DEG);
    expect(hi).toBeGreaterThan(15 * DEG);
    expect(hi).toBeLessThan(35 * DEG);
    expect(innerAtOuterUp).toBeGreaterThan(0);
    expect(innerAtOuterUp).toBeLessThan(90 * DEG);
    expect(land).toBeLessThan(-2 * DEG);
  });

  test("a click turn keeps the inner column moving while the hand slides out under the outer column", () => {
    for (const [cin, cout] of [
      [6, 6],
      [3, 3],
      [0, 6],
      [6, 0],
    ] as const) {
      const env = envFor(1);
      const b = createPage(GEOM, cin, cout);
      restPage(b, 0, env);
      turnPage(b, 1, 0);
      const sub = Math.round(PHYSICS.hz / 60);
      let t = 0;
      let prev = 0;
      let minStep = Infinity;
      for (let f = 0; f < 120 && !b.asleep; f++) {
        for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
        const a = b.a[0]!;
        if (a > 10 * DEG && a < 80 * DEG) minStep = Math.min(minStep, a - prev);
        prev = a;
      }
      // the inner column still moves at least 1.5° a frame (it does not stop in mid-air waiting for the outer column to go over)
      expect(minStep).toBeGreaterThan(1.5 * DEG);
      expect(b.a[0]).toBeCloseTo(Math.PI, 6);
    }
  });

  test("grabbing a page and pulling hard does not whip the outer column up: the hand eases in and the seam folds at a capped rate", () => {
    // grab the sheet edge: the hand's target jumps to 120° at once (no flick is faster than that); over the first 10 frames the outer
    // column turns no more than 8° a frame and the inner column does not move back
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
    pullPage(b, 120 * DEG);
    const sub = Math.round(PHYSICS.hz / 60);
    let t = 0;
    let prevO = 0;
    let prevI = 0;
    for (let f = 0; f < 10; f++) {
      for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
      const o = b.a[b.n - 1]!;
      expect(o - prevO).toBeLessThan(8 * DEG);
      expect(b.a[0]!).toBeGreaterThan(prevI - 1e-4);
      prevO = o;
      prevI = b.a[0]!;
    }
  });

  test("the finger's torque is capped: a full page lifts slower than an empty one", () => {
    const full = clickTurn(6, 6);
    const empty = clickTurn(0, 0);
    expect(empty.b.asleep).toBe(true);
    expect(full.t90).toBeGreaterThan(empty.t90 * 1.15);
  });

  test("the seam gives under the outer column's own weight; an empty outer column droops more than a full one", () => {
    // inner column lifted to 45°: a full outer column droops at the seam, an empty one bends down along its own length too
    const full = holdInner(6, 6, 45);
    expect(seamFold(full)).toBeLessThan(-20 * DEG);
    const empty = holdInner(6, 0, 45);
    const droop = empty.a[empty.n - 1]! - empty.a[empty.nIn - 1]!;
    expect(droop).toBeLessThan(-20 * DEG);
    const [, , , , bendOut] = pageShape(empty);
    expect(bendOut).toBeLessThan(-10 * DEG);
    // inner column upright: the seam's small-angle stiffness is softer than the critical stiffness of a full outer column as an
    // inverted pendulum, so the outer column is pushed to one side by its own weight
    const up = holdInner(6, 6, 90);
    expect(Math.abs(seamFold(up))).toBeGreaterThan(8 * DEG);
    // just lifted: the seam holds the outer column out level, it does not keep folding to forty or fifty degrees
    const low = holdInner(6, 6, 30);
    expect(seamFold(low)).toBeGreaterThan(-40 * DEG);
  });

  test("turning back from the left lands on the right", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 1, env);
    turnPage(b, 0, 0);
    run(b, env, 3);
    expect(b.asleep).toBe(true);
    expect(b.a[0]).toBeCloseTo(0, 6);
  });

  test("is deterministic", () => {
    const env = envFor(2);
    const once = () => {
      const b = createPage(GEOM, 4, 0);
      restPage(b, 0, env);
      turnPage(b, 1, 0.05);
      const trace: number[] = [];
      run(b, env, 0.5, () => trace.push(...pageShape(b)));
      return trace;
    };
    expect(once()).toEqual(once());
  });

  test("grabbing the outer edge lifts the outer column first; grabbing near the rings lifts the inner column first", () => {
    const env = envFor(1);
    const seams = (u: number) => {
      const b = createPage(GEOM, 6, 6);
      restPage(b, 0, env);
      grabPage(b, u, 0);
      let sum = 0;
      run(b, env, 0.6, (t) => {
        pullPage(b, Math.min(1, t / 0.5) * 1.2);
        sum += seamFold(b);
      });
      return sum;
    };
    // outer column leading: seam fold positive; inner column leading with the outer one hanging: negative
    expect(seams(GEOM.inner + GEOM.outer - 0.03)).toBeGreaterThan(0);
    expect(seams(0.2)).toBeLessThan(0);
  });

  test("the hand only sets the direction to the grabbed point: a page held by its edge sags at the seam", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
    run(b, env, 2, (t) => pullPage(b, 60 * DEG * Math.min(1, t / 0.8)));
    expect(seamFold(b)).toBeGreaterThan(15 * DEG);
  });

  test("letting go of a page that was not lifted past the top lets it fall back without being pushed up", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
    run(b, env, 0.6, (t) => pullPage(b, Math.min(1, t / 0.5) * 0.7));
    const before = b.a[0]!;
    turnPage(b, 0, 0.6);
    let max = before;
    run(b, env, 2, () => (max = Math.max(max, b.a[0]!)));
    expect(max).toBeLessThan(before + 0.05);
    expect(b.asleep).toBe(true);
    expect(b.a[0]).toBeCloseTo(0, 6);
  });

  test("the finger cannot yank a page that is falling the other way within a couple of frames", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    b.a.fill(60 * DEG);
    b.w.fill(-3);
    b.asleep = false;
    turnPage(b, 1, 0);
    run(b, env, 2 / 60);
    expect(b.w[0]!).toBeLessThan(0);
  });

  test("an empty sleeve page (both columns empty) stays stable and lands", () => {
    const env = envFor(3);
    const b = createPage(GEOM, 0, 0);
    expect(b.n).toBe(6);
    restPage(b, 0, env);
    turnPage(b, 1, 0);
    run(b, env, 3, () => {
      for (const a of b.a) expect(Number.isFinite(a)).toBe(true);
    });
    expect(b.asleep).toBe(true);
    expect(b.a[0]).toBeCloseTo(Math.PI, 6);
  });

  test("a flick is speed-capped: the hand saturates, the page turns smoothly and takes at least 0.4 s", () => {
    // flick from the sheet edge: the hand's target direction jumps 20° a frame (about 150 px / frame), let go after 6 frames and
    // treated as a turn (the hand carries on). The inner column's angle is checked frame by frame (1/60 s)
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
    const sub = Math.round(PHYSICS.hz / 60);
    let t = 0;
    let goal = 0;
    let prev = 0;
    let maxStep = 0;
    let maxAngle = 0;
    let reached = -1;
    let monotone = true;
    for (let f = 1; f <= 120; f++) {
      if (f <= 6) pullPage(b, (goal = Math.min(Math.PI, goal + 20 * DEG)));
      if (f === 7) carryPage(b, env, 1, t);
      for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
      const a = b.a[0]!;
      maxStep = Math.max(maxStep, Math.abs(a - prev));
      if (a < prev - 1e-4 && a < Math.PI - 0.03) monotone = false;
      maxAngle = Math.max(maxAngle, a);
      if (reached < 0 && a >= Math.PI - 0.01) reached = t;
      prev = a;
    }
    expect(reached).toBeGreaterThan(0.4);
    expect(monotone).toBe(true);
    // at most about the cap per frame (no frame jumps a long way), and the landing does not overshoot much
    expect(maxStep).toBeLessThan(11 * DEG);
    expect(maxAngle).toBeLessThan(Math.PI + 4 * DEG);
    expect(b.asleep).toBe(true);
  });

  test("letting go after a flick hands the page over smoothly: the seam does not whip to the other side", () => {
    // after release the hand still holds the sheet edge and carries it on over the top: the outer column was leading (seam fold
    // positive) and eases flat over the 0.3 s after release, not collapsing back first and then being whipped up
    for (const frames of [2, 6]) {
      const env = envFor(1);
      const b = createPage(GEOM, 6, 6);
      restPage(b, 0, env);
      grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
      const sub = Math.round(PHYSICS.hz / 60);
      let t = 0;
      let goal = 0;
      for (let f = 0; f < frames; f++) {
        pullPage(b, (goal += 20 * DEG));
        for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
      }
      // outer column leading (seam fold positive; after a two-frame drag the hand is still starting up, so it leads less)
      const at = seamFold(b);
      expect(at).toBeGreaterThan(3 * DEG);
      carryPage(b, env, 1, t);
      let lo = at;
      let hi = at;
      for (let f = 0; f < 18; f++) {
        for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
        lo = Math.min(lo, seamFold(b));
        hi = Math.max(hi, seamFold(b));
      }
      expect(lo).toBeGreaterThan(-3 * DEG);
      // while carried on, the outer column leads a little more (the hand still holds the sheet edge and carries it forward), but never
      // whips past thirty-five degrees
      expect(hi).toBeLessThan(35 * DEG);
      run(b, env, 3);
      expect(b.asleep).toBe(true);
      expect(b.a[0]).toBeCloseTo(Math.PI, 6);
    }
  });

  test("a page dragged past the top and let go keeps falling the way it was going", () => {
    // drag the sheet edge slowly past vertical and let go: the outer column is already past vertical and is not pushed from the spine
    // and turned back
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
    run(b, env, 1.4, (t) => pullPage(b, 110 * DEG * Math.min(1, t / 1.3)));
    const outer0 = b.a[b.n - 1]!;
    carryPage(b, env, 1, 1.4);
    let min = outer0;
    run(b, env, 2, () => (min = Math.min(min, b.a[b.n - 1]!)));
    expect(min).toBeGreaterThan(outer0 - 2 * DEG);
    expect(b.a[0]).toBeCloseTo(Math.PI, 6);
  });

  test("landing is cushioned: a full page slows down over the last few degrees instead of stopping in one frame", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    turnPage(b, 1, 0);
    const sub = Math.round(PHYSICS.hz / 60);
    let t = 0;
    const per: number[] = [];
    let prev = 0;
    for (let f = 0; f < 120 && !b.asleep; f++) {
      for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
      per.push(b.a[0]! - prev);
      prev = b.a[0]!;
    }
    // before the landing frame the speed has already come down: the last 10° take at least 3 frames
    const land = per.findIndex((_, i) => per.slice(0, i + 1).reduce((s, x) => s + x, 0) > Math.PI - 0.01);
    let deg = 0;
    let frames = 0;
    for (let i = land; i >= 0 && deg < 10 * DEG; i--) {
      deg += per[i]!;
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(3);
  });

  test("a slow drag keeps the hand's target exactly on the pointer direction", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    grabPage(b, GEOM.inner + GEOM.outer - 0.03, 0);
    // 1° a frame: the hand's target direction catches up within the frame (no saturation), the grabbed point follows the target, the
    // error stays small
    let goal = 0;
    let t = 0;
    let worst = 0;
    const sub = Math.round(PHYSICS.hz / 60);
    for (let f = 1; f <= 60; f++) {
      pullPage(b, (goal += DEG));
      for (let k = 0; k < sub; k++) stepPage(b, env, H, (t += H));
      expect(b.hand!.th).toBeCloseTo(goal, 9);
      if (f > 20) {
        const [rx, rz, gx, gz] = grabPoint(b, env);
        worst = Math.max(worst, Math.abs(Math.atan2(gz - rz, gx - rx) - goal));
      }
    }
    expect(worst).toBeLessThan(1.5 * DEG);
  });

  /**
   * sasshi (round 4, E6): the owner-size repro of QA r4 — a postcard sheet holding one card (its outer column empty film), held
   * at the free edge, lifted three quarters over, then pulled flat past the spine and let go. The free edge used to whip round under the
   * page (the last two links folded ≈ 170°), land so and never rest (the film's spring against the stack). Now no two links of the
   * empty column fold much past flex.max (the hand pulls a little into the stop while it holds), and the page lies flat on the left
   * and sleeps. (With flex.max = 99 this sequence ends at [3.14, 2.97, 3.31, 6.28], awake for ever.)
   */
  function heldPull(P: ReturnType<typeof physicsFor>) {
    const L = resolveLayout("postcard2x3");
    const seg = segOf(L);
    const geom = { inner: (seg.a2 + seg.b2) / 2 - seg.b1, outer: seg.w - (seg.a2 + seg.b2) / 2, height: seg.h };
    const zR = 0.5 * PITCH;
    const zL = 1.5 * PITCH;
    const env: PageEnv = {
      root: (phi, th) => panelRoot(cx + R * Math.cos(phi), cz + R * Math.sin(phi), phi, th, seg),
      phR: restPhi(cx, cz, R, zR, seg),
      phL: Math.PI - restPhi(cx, cz, R, zL, seg),
      zR,
      zL,
      axisX: cx,
    };
    const b = createPage(geom, 1, 0, P);
    restPage(b, 0, env);
    grabPage(b, (geom.inner + geom.outer) * 0.93, 0);
    const sub = Math.round(P.hz / 60);
    let t = 0;
    let fold = 0;
    const frame = (goal: number | null) => {
      if (goal !== null && b.hand) pullPage(b, goal);
      for (let k = 0; k < sub; k++) stepPage(b, env, 1 / P.hz, (t += 1 / P.hz), P);
      for (let j = 1; j < b.n; j++) if (j !== b.seam) fold = Math.max(fold, Math.abs(b.a[j]! - b.a[j - 1]!));
    };
    // three quarters over in steps (12 frames each, then a 30-frame hold), then flat past the spine in 8 frames, held 0.8 s
    let g = 0;
    for (const to of [0.25, 0.5, 0.75])
      for (let f = 0; f < 42; f++) frame(f < 12 ? (g += ((to - (g / Math.PI)) * Math.PI) / (12 - f)) : g);
    for (let f = 0; f < 8; f++) frame(0.75 * Math.PI + ((0.25 * Math.PI + 0.06) * (f + 1)) / 8);
    for (let f = 0; f < 48; f++) frame(Math.PI + 0.06);
    carryPage(b, env, 1, t, P);
    let settled = -1;
    for (let f = 0; f < 6 * 60 && settled < 0; f++) {
      frame(null);
      if (b.asleep && !b.hand) settled = f / 60;
    }
    return { b, fold, settled };
  }
  test("an empty column held at its edge and pulled flat past the spine never folds back under the page, and comes to rest", () => {
    const P = physicsFor(resolveLayout("postcard2x3"));
    const { b, fold, settled } = heldPull(P);
    // (the hand pulls against the stop while it holds: a little past it, never the ≈ 2.97 rad fold of round 4's first build)
    expect(fold).toBeLessThan(P.flex.max + 0.3);
    expect(settled).toBeGreaterThanOrEqual(0);
    expect(settled).toBeLessThan(2.5);
    for (let i = 0; i < b.n; i++) expect(b.a[i]).toBeCloseTo(Math.PI, 6);
  });

  test("a page nobody holds that cannot come to rest is laid down after sleep.stuck (never drawn for ever)", () => {
    // held in a pose the model cannot leave: the last link folded back under the page, the page lying on the left
    const P = physicsFor(resolveLayout("postcard2x3"));
    P.flex.max = 99;
    const env = envFor(1);
    const b = createPage(GEOM, 1, 0, P);
    restPage(b, 1, env);
    b.a.set([Math.PI, 2.97, 3.31, 2 * Math.PI]);
    freePage(b);
    const { t } = run(b, env, 10);
    expect(t).toBeLessThan(P.sleep.stuck + 0.5);
    expect(b.asleep).toBe(true);
    for (let i = 0; i < b.n; i++) expect(b.a[i]).toBeCloseTo(Math.PI, 6);
  });

  test("a freed page lying flat stays asleep", () => {
    const env = envFor(0);
    const b = createPage(GEOM, 6, 6);
    restPage(b, 0, env);
    freePage(b);
    const { t } = run(b, env, 1);
    expect(t).toBeLessThan(0.3);
    expect(b.a[0]).toBeCloseTo(0, 6);
  });
});
