/*
 * The two physics.ts fixes the paper viewer needs, plus the paper / card presets driven end to end:
 *  (a) a zero-length outer column (single-panel paper) must not produce NaN,
 *  (b) the hand can be given a reach, so a pointer controls direction AND distance (a folded card can be unfolded by a drag).
 */
import { describe, expect, test } from "bun:test";
import { createPage, grabPage, pageShape, posePage, pullPage, restPage, seamFold, stepPage, turnPage, carryPage, type PageBody } from "../book/physics";
import { CARD_CLOSED, CARD_GEOM, CARD_L, FLAT_ENV, PAGE_GEOM, PAGE_W, cardPhysics, keepOrder, knotPoint, paperKnots, createKnots, paperPhysics, turnProgress } from "./presets";

const finite = (a: ArrayLike<number>) => Array.from(a).every(Number.isFinite);

describe("createPage with a zero-length outer column", () => {
  test("builds a single flexible column with finite matrices", () => {
    const P = paperPhysics();
    const b = createPage({ inner: PAGE_W, outer: 0, height: PAGE_GEOM.height }, 0, 0, P);
    expect(b.n).toBe(3);
    expect(b.nIn).toBe(3);
    for (const arr of [b.L, b.m, b.mu, b.I, b.gm, b.Iout]) expect(finite(arr)).toBe(true);
    expect(Array.from(b.L).every((l) => l > 0)).toBe(true);
    restPage(b, 0, FLAT_ENV);
    expect(seamFold(b)).toBe(0);
    const [, , , seam, bendOut] = pageShape(b);
    expect(seam).toBe(0);
    expect(bendOut).toBe(0);
  });

  test("turns over and lands without NaN", () => {
    const P = paperPhysics();
    const b = createPage({ inner: PAGE_W, outer: 0, height: PAGE_GEOM.height }, 0, 0, P);
    restPage(b, 0, FLAT_ENV);
    turnPage(b, 1, 0);
    const H = 1 / P.hz;
    let t = 0;
    for (let i = 0; i < 3 * P.hz; i++) {
      t += H;
      stepPage(b, FLAT_ENV, H, t, P);
      expect(finite(b.a)).toBe(true);
    }
    expect(b.asleep).toBe(true);
    for (const a of b.a) expect(Math.abs(a - Math.PI)).toBeLessThan(0.03);
  });

});

/** Unfold the closed card by pulling the cover's free edge around the crease, as a pointer would (direction + optional distance). */
function unfold(withReach: boolean, secs = 2) {
  const P = cardPhysics();
  const b = createPage(CARD_GEOM, 1, 1, P);
  posePage(b, 0, FLAT_ENV, CARD_CLOSED);
  const tip = 2 * CARD_L - 0.01;
  grabPage(b, tip, Math.PI / 2);
  const H = 1 / P.hz;
  let t = 0;
  let fold = seamFold(b);
  const start = fold;
  for (let i = 0; i < secs * P.hz; i++) {
    t += H;
    // the pointer sweeps the tip round the crease, from closed to flat open, in 1.2 s
    const s = Math.min(1, t / 1.2);
    const beta = CARD_CLOSED * (1 - s * s * (3 - 2 * s));
    const tx = CARD_L + (tip - CARD_L) * Math.cos(beta);
    const tz = (tip - CARD_L) * Math.sin(beta);
    if (withReach) pullPage(b, Math.atan2(tz, tx), Math.hypot(tx, tz));
    else pullPage(b, Math.atan2(tz, tx));
    stepPage(b, FLAT_ENV, H, t, P);
    // the inner panel lies on the desk, pinned by the viewer
    b.a[0] = 0;
    b.w[0] = 0;
    fold = seamFold(b);
    expect(Number.isFinite(fold)).toBe(true);
  }
  return { start, fold, b };
}

describe("hand reach", () => {
  test("direction only (the original hand) cannot open a folded card", () => {
    const { start, fold } = unfold(false);
    expect(start).toBeGreaterThan(3);
    expect(fold).toBeGreaterThan(2.5);
  });

  test("direction + distance unfolds it", () => {
    const { start, fold } = unfold(true);
    expect(start).toBeGreaterThan(3);
    expect(Math.abs(fold)).toBeLessThan(0.2);
  });

  test("reach: undefined keeps the setting, null clears it, carryPage clears it", () => {
    const P = paperPhysics();
    const b = createPage(PAGE_GEOM, 0, 0, P);
    restPage(b, 0, FLAT_ENV);
    grabPage(b, PAGE_W * 0.9, 0);
    pullPage(b, 0.5, 1.2);
    expect(b.hand!.reach).toBeCloseTo(1.2, 9);
    pullPage(b, 0.6);
    expect(b.hand!.reach).toBeCloseTo(1.2, 9);
    pullPage(b, 0.6, null);
    expect(b.hand!.reach).toBeUndefined();
    pullPage(b, 0.6, 0.8);
    carryPage(b, FLAT_ENV, 1, 0, P);
    expect(b.hand!.reach).toBeUndefined();
  });

  test("a reach change alone wakes a sleeping held page", () => {
    const P = paperPhysics();
    const b = createPage(PAGE_GEOM, 0, 0, P);
    restPage(b, 0, FLAT_ENV);
    grabPage(b, PAGE_W * 0.9, 0.3);
    b.asleep = true;
    pullPage(b, 0.3, 1.0);
    expect(b.asleep).toBe(false);
  });
});

describe("paper preset", () => {
  /** max change of any link angle between 60 Hz frames while a page turns from a click */
  function clickTurn(): { b: PageBody; maxFrame: number; landed: number } {
    const P = paperPhysics();
    const b = createPage(PAGE_GEOM, 0, 0, P);
    restPage(b, 0, FLAT_ENV);
    turnPage(b, 1, 0);
    const H = 1 / P.hz;
    let t = 0;
    let maxFrame = 0;
    let landed = -1;
    let prev = Float64Array.from(b.a);
    for (let f = 0; f < 180; f++) {
      for (let s = 0; s < 8; s++) {
        t += H;
        stepPage(b, FLAT_ENV, H, t, P);
      }
      for (let i = 0; i < b.n; i++) maxFrame = Math.max(maxFrame, Math.abs(b.a[i]! - prev[i]!));
      prev = Float64Array.from(b.a);
      if (landed < 0 && b.asleep) landed = t;
    }
    return { b, maxFrame, landed };
  }

  test("an A4 sheet has six flexible links and turns over within two seconds", () => {
    const { b, maxFrame, landed } = clickTurn();
    expect(b.n).toBe(6);
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(2);
    expect(turnProgress(b)).toBeCloseTo(1, 2);
    // no single-frame jumps: under 12° per 60 Hz frame
    expect(maxFrame).toBeLessThan((12 * Math.PI) / 180);
  });

  test("the knot path has the sheet's length and follows the links", () => {
    const P = paperPhysics();
    const b = createPage(PAGE_GEOM, 0, 0, P);
    const k = createKnots();
    for (let i = 0; i < b.n; i++) b.a[i] = 0.2 * i;
    paperKnots(b, k);
    expect(k.count).toBe(b.n + 2);
    expect(k.s[k.count - 1]!).toBeCloseTo(PAGE_W, 6);
    // the free edge of the smoothed path stays within a few mm of the chain's own end
    let x = 0;
    let z = 0;
    for (let i = 0; i < b.n; i++) {
      x += b.L[i]! * Math.cos(b.a[i]!);
      z += b.L[i]! * Math.sin(b.a[i]!);
    }
    const [ex, ez] = knotPoint(k, PAGE_W);
    expect(Math.hypot(ex - x, ez - z)).toBeLessThan(0.06);
  });

  test("a sheet lifting from its free edge never dips below the stack at the binding (nor a curled edge into it)", () => {
    const P = paperPhysics();
    const b = createPage(PAGE_GEOM, 0, 0, P);
    const k = createKnots();
    // flat at the binding, bending up toward the free edge (a drag from the right edge), and the mirror on the left stack
    for (const pose of [[0, 0.3, 0.7, 1.1, 1.5, 1.9], [0.02, 0.12, 0.4, 0.8, 1.2, 1.6], [Math.PI, Math.PI, Math.PI, Math.PI, Math.PI - 0.2, Math.PI - 0.5]]) {
      for (let i = 0; i < b.n; i++) b.a[i] = pose[i]!;
      paperKnots(b, k);
      for (let s = 0; s <= PAGE_W; s += PAGE_W / 200) expect(knotPoint(k, s)[1]).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

describe("keepOrder", () => {
  const pair = () => {
    const P = paperPhysics();
    const a = createPage(PAGE_GEOM, 0, 0, P);
    const b = createPage(PAGE_GEOM, 0, 0, P);
    restPage(a, 1, FLAT_ENV);
    restPage(b, 0, FLAT_ENV);
    return { a, b };
  };
  test("a held sheet dipping below the left stack never drags the sheet lying there through the desk", () => {
    const { a, b } = pair();
    // the held sheet (b, on top on the left) comes down a hair past flat
    grabPage(b, PAGE_W * 0.9, Math.PI);
    for (let k = 0; k < b.n; k++) {
      b.a[k] = Math.PI + 0.05;
      b.w[k] = 2;
    }
    b.asleep = false;
    keepOrder([a, b]);
    for (let k = 0; k < a.n; k++) {
      expect(a.a[k]!).toBeLessThanOrEqual(Math.PI);
      expect(a.w[k]!).toBeLessThanOrEqual(0);
    }
  });
  test("two sheets in flight still never pass through each other", () => {
    const { a, b } = pair();
    for (let k = 0; k < a.n; k++) {
      a.a[k] = 1.2;
      b.a[k] = 1.5;
      b.w[k] = 1;
    }
    a.asleep = b.asleep = false;
    grabPage(b, PAGE_W * 0.9, 1.5);
    keepOrder([a, b]);
    for (let k = 0; k < a.n; k++) expect(a.a[k]!).toBeGreaterThanOrEqual(b.a[k]!);
  });
});
