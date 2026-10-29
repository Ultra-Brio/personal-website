import { describe, expect, test } from "bun:test";
import { CARD_H, CARD_R, CARD_W, HINGE, HOLE_R, HOLE_X, PAGE_H, PAGE_W, PER_SHEET, PER_SIDE, RINGS, RING_R, RING_WIRE, cardIndex, cardRect, pageCount, pocketRect, resolveLayout, sheetCount, slotAt } from "./layout";
import { PHYSICS, createPage, pageProgress, seamFold, stepPage, turnPage, type PageEnv } from "./physics";
import { physicsFor } from "./physics-profile";
import { PITCH, SEG, panelRoot, restPhi, segOf } from "./sheet";

const card = resolveLayout("idCard2x3");
const pc = resolveLayout("postcard2x2");

describe("idCard2x3 is the card binder, value for value (golden)", () => {
  test("constants", () => {
    expect(card.pageW).toBe(PAGE_W);
    expect(card.pageH).toBe(PAGE_H);
    expect(card.perSide).toBe(PER_SIDE);
    expect(card.perSheet).toBe(PER_SHEET);
    expect(card.hinge).toBe(HINGE);
    expect([...card.rings]).toEqual([...RINGS]);
    expect(card.hole).toEqual({ x: HOLE_X, r: HOLE_R });
    expect(card.ring).toEqual({ r: RING_R, wire: RING_WIRE });
    expect(card.item).toEqual({ w: CARD_W, h: CARD_H, r: CARD_R });
    expect(card.doubleSided).toBe(false);
    expect(segOf(card)).toEqual(SEG);
  });
  test("pockets, placement, hit test, counts and indices", () => {
    for (const m of [false, true])
      for (let s = 0; s < PER_SIDE; s++) {
        expect(card.pocketRect(s, m)).toEqual(pocketRect(s, m));
        for (const seed of [1, 7, 33]) expect(card.itemRect(s, m, seed)).toEqual(cardRect(s, m, seed));
      }
    for (const m of [false, true]) for (let x = -2; x < PAGE_W + 2; x += 3.7) for (let y = -2; y < PAGE_H + 2; y += 4.1) expect(card.slotAt(x, y, m)).toBe(slotAt(x, y, m));
    for (let n = 0; n <= 60; n++) {
      expect(card.sheetCount(n)).toBe(sheetCount(n));
      expect(card.pageCount(n)).toBe(pageCount(n));
      for (let side = -1; side < 12; side++) for (let s = -1; s < PER_SIDE; s++) expect(card.itemIndex(side, s, n)).toBe(cardIndex(side, s, n));
    }
  });
  test("column load matches the engine's old columnCards", () => {
    for (const n of [0, 1, 5, 6, 7, 12, 13, 29])
      for (let i = 0; i < 4; i++) {
        const has = (side: number, slot: number) => cardIndex(side, slot, n) >= 0;
        let inner = 0;
        let outer = 0;
        for (const row of [0, 1, 2]) {
          inner += Number(has(2 * i, row * 2)) + Number(has(2 * i + 1, row * 2 + 1));
          outer += Number(has(2 * i, row * 2 + 1)) + Number(has(2 * i + 1, row * 2));
        }
        expect(card.columnLoad(i, n)).toEqual([inner, outer]);
      }
  });
  test("its physics profile is an exact copy, never PHYSICS itself", () => {
    const P = physicsFor(card);
    expect(P).toEqual(PHYSICS);
    expect(P).not.toBe(PHYSICS);
    expect(P.finger).not.toBe(PHYSICS.finger);
  });
});

describe("postcard2x2", () => {
  test("A6 landscape pockets with the card binder's clearances", () => {
    expect(pc.item.w).toBe(148);
    expect(pc.item.h).toBe(105);
    expect(pc.pocket.w).toBeCloseTo(151.8, 9);
    expect(pc.pocket.h).toBeCloseTo(108.6, 9);
    expect(pc.pageW).toBeCloseTo(334.6, 9);
    expect(pc.pageH).toBeCloseTo(233.4, 9);
    expect(pc.perSide).toBe(4);
    for (const m of [false, true])
      for (let s = 0; s < 4; s++) {
        const r = pc.pocketRect(s, m);
        expect(r.x).toBeGreaterThan(0);
        expect(r.y).toBeGreaterThan(0);
        expect(r.x + r.w).toBeLessThan(pc.pageW);
        expect(r.y + r.h).toBeLessThan(pc.pageH);
        const it = pc.itemRect(s, m, 5 + s);
        expect(it.x).toBeGreaterThanOrEqual(r.x);
        expect(it.x + it.w).toBeLessThanOrEqual(r.x + r.w);
        expect(it.y).toBeGreaterThanOrEqual(r.y);
        expect(it.y + it.h).toBeLessThanOrEqual(r.y + r.h);
      }
  });
  test("rings re-spaced for the page height: four, symmetric, 15.2 mm in from the edges", () => {
    expect(pc.rings.length).toBe(4);
    expect(pc.rings[0]).toBeCloseTo(-pc.rings[3]!, 9);
    expect(pc.pageH / 2 - pc.rings[3]!).toBeCloseTo(15.2, 1);
    expect(pc.rings[2]! - pc.rings[1]!).toBeCloseTo(pc.rings[3]! - pc.rings[2]!, 0);
  });
  test("double-sided: one postcard per pocket, 4 per sheet, both faces", () => {
    expect(pc.doubleSided).toBe(true);
    expect(pc.perSheet).toBe(4);
    expect(pc.sheetCount(0)).toBe(1);
    expect(pc.sheetCount(4)).toBe(1);
    expect(pc.sheetCount(10)).toBe(3);
    expect(pc.pageCount(10)).toBe(6);
    expect(pc.faceOf(0)).toBe("front");
    expect(pc.faceOf(1)).toBe("back");
    const n = 10;
    const fronts: number[] = [];
    const backs: number[] = [];
    for (let side = 0; side < 2 * pc.sheetCount(n); side++)
      for (let s = 0; s < 4; s++) {
        const i = pc.itemIndex(side, s, n);
        if (i >= 0) (side % 2 ? backs : fronts).push(i);
      }
    // every postcard once through a front film and once through a back film
    expect(fronts.sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    expect(backs.sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
  });
  test("the back face lies in the same physical spot, mirrored", () => {
    for (let side = 0; side < 6; side += 2)
      for (let s = 0; s < 4; s++) {
        const i = pc.itemIndex(side, s, 12);
        const b = pc.mirrorSlot(s);
        expect(pc.itemIndex(side + 1, b, 12)).toBe(i);
        const front = pc.itemRect(s, false, i + 1);
        const back = pc.itemRect(b, true, i + 1, true);
        // seen from the other side, x runs the other way
        expect(back.x).toBeCloseTo(pc.pageW - (front.x + front.w), 9);
        expect(back.y).toBeCloseTo(front.y, 9);
        expect(back.tilt).toBeCloseTo(-front.tilt, 12);
      }
  });
  test("column load counts each postcard once", () => {
    for (const n of [0, 1, 3, 4, 7, 10]) {
      let total = 0;
      for (let i = 0; i < pc.sheetCount(n); i++) {
        const [a, b] = pc.columnLoad(i, n);
        expect(a).toBeLessThanOrEqual(2);
        expect(b).toBeLessThanOrEqual(2);
        total += a + b;
      }
      expect(total).toBe(n);
    }
  });
  test("its own shader cache key", () => {
    expect(pc.hash).not.toBe(card.hash);
  });
});

describe("postcard physics profile", () => {
  const P = physicsFor(pc);
  const seg = segOf(pc);
  const GEOM = { inner: (seg.a2 + seg.b2) / 2 - seg.b1, outer: seg.w - (seg.a2 + seg.b2) / 2, height: seg.h };
  // the open binder of physics.test.ts (1-inch rings), four sheets
  const R = 0.13;
  const cz = 0.155;
  const envFor = (i: number, sheets: number): PageEnv => {
    const zR = (sheets - i - 0.5) * PITCH;
    const zL = (i + 0.5) * PITCH;
    return { root: (phi, th) => panelRoot(R * Math.cos(phi), cz + R * Math.sin(phi), phi, th, seg), phR: restPhi(0, cz, R, zR, seg), phL: Math.PI - restPhi(0, cz, R, zL, seg), zR, zL, axisX: 0 };
  };
  test("scaled by area and mass × length; PHYSICS untouched", () => {
    const before = JSON.stringify(PHYSICS);
    const again = physicsFor(pc);
    expect(JSON.stringify(PHYSICS)).toBe(before);
    expect(again).toEqual(P);
    const area = (pc.pageW * pc.pageH) / (card.pageW * card.pageH);
    expect(area).toBeCloseTo(1.935, 2);
    expect(P.pvc).toBeCloseTo(PHYSICS.pvc * area, 12);
    expect(P.card).toBe(0.00466);
    expect(P.finger.torque / PHYSICS.finger.torque).toBeCloseTo(3.09, 1);
    expect(P.hand.maxF / PHYSICS.hand.maxF).toBeCloseTo(3.09, 1);
  });
  for (const [cin, cout] of [
    [2, 2],
    [1, 0],
    [0, 0],
    // twice the load a postcard column can hold (the audit's case: unscaled, the finger stalls near 10° and never lands)
    [4, 4],
  ] as const) {
    test(`a click turn lands and sleeps (${cin} + ${cout} postcards)`, () => {
      const env = envFor(0, 4);
      const b = createPage(GEOM, cin, cout, P);
      turnPage(b, 1, 0);
      const H = 1 / P.hz;
      let t = 0;
      let seamMin = 0;
      let seamMax = 0;
      while (t < 4) {
        t += H;
        const awake = stepPage(b, env, H, t, P);
        for (const x of b.a) expect(Number.isFinite(x)).toBe(true);
        seamMin = Math.min(seamMin, seamFold(b));
        seamMax = Math.max(seamMax, seamFold(b));
        if (!awake && !b.hand && !b.finger) break;
      }
      expect(t).toBeLessThan(1.6);
      expect(pageProgress(b)).toBeGreaterThan(0.99);
      // the seam folds, softly, both ways — never past ~70°
      expect(seamMin).toBeGreaterThan(-1.25);
      expect(seamMax).toBeLessThan(1.25);
    });
  }
});

/* sasshi (round 3, D3): the tall pages — the same clearances, seams and margins, one more row; the turn still feels like the card binder */
describe("tall pages: idCard2x4 and postcard2x3", () => {
  const tall = [
    { L: resolveLayout("idCard2x4"), base: card, rows: 4, pageH: 253.4, perSide: 8, perSheet: 16, full: 8 },
    { L: resolveLayout("postcard2x3"), base: pc, rows: 3, pageH: 345.4, perSide: 6, perSheet: 6, full: 3 },
  ] as const;
  for (const { L, base, rows, pageH, perSide, perSheet, full } of tall) {
    test(`${L.id}: geometry`, () => {
      expect(L.rows).toBe(rows);
      expect(L.pageW).toBeCloseTo(base.pageW, 9);
      expect(L.pageH).toBeCloseTo(pageH, 9);
      expect(L.perSide).toBe(perSide);
      expect(L.perSheet).toBe(perSheet);
      expect(L.pocket).toEqual(base.pocket);
      expect(L.seam).toBe(base.seam);
      expect(L.margin).toEqual(base.margin);
      expect(L.doubleSided).toBe(base.doubleSided);
      expect(L.hash).not.toBe(base.hash);
      // rings re-spaced: four, symmetric, the outer ones 15.2 mm in from the edges, evenly between
      expect(L.rings.length).toBe(4);
      expect(L.rings[0]).toBeCloseTo(-L.rings[3]!, 9);
      expect(L.pageH / 2 - L.rings[3]!).toBeCloseTo(15.2, 1);
      expect(L.rings[2]! - L.rings[1]!).toBeCloseTo(L.rings[3]! - L.rings[2]!, 0);
      // every pocket inside the page, the item inside its pocket, the hit test finds it
      for (const m of [false, true])
        for (let s = 0; s < perSide; s++) {
          const r = L.pocketRect(s, m);
          expect(r.x).toBeGreaterThan(0);
          expect(r.y).toBeGreaterThan(0);
          expect(r.x + r.w).toBeLessThan(L.pageW);
          expect(r.y + r.h).toBeLessThan(L.pageH);
          const it = L.itemRect(s, m, 3 + s);
          expect(it.x).toBeGreaterThanOrEqual(r.x);
          expect(it.x + it.w).toBeLessThanOrEqual(r.x + r.w);
          expect(it.y).toBeGreaterThanOrEqual(r.y);
          expect(it.y + it.h).toBeLessThanOrEqual(r.y + r.h);
          expect(L.slotAt(r.x + r.w / 2, r.y + r.h / 2, m)).toBe(s);
        }
    });
    test(`${L.id}: every item once, column loads`, () => {
      for (const n of [0, 1, 7, 24, 25]) {
        const seen: number[] = [];
        let load = 0;
        for (let side = 0; side < 2 * L.sheetCount(n); side++)
          for (let s = 0; s < perSide; s++) {
            const i = L.itemIndex(side, s, n);
            if (i >= 0 && (!L.doubleSided || side % 2 === 0)) seen.push(i);
          }
        for (let i = 0; i < L.sheetCount(n); i++) {
          const [a, b] = L.columnLoad(i, n);
          expect(a).toBeLessThanOrEqual(full);
          expect(b).toBeLessThanOrEqual(full);
          load += a + b;
        }
        expect(seen.sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
        expect(load).toBe(n);
      }
    });
    const P = physicsFor(L);
    const seg = segOf(L);
    const GEOM = { inner: (seg.a2 + seg.b2) / 2 - seg.b1, outer: seg.w - (seg.a2 + seg.b2) / 2, height: seg.h };
    const R = 0.13;
    const cz = 0.155;
    const env = (): PageEnv => {
      const zR = 3.5 * PITCH;
      const zL = 0.5 * PITCH;
      return { root: (phi, th) => panelRoot(R * Math.cos(phi), cz + R * Math.sin(phi), phi, th, seg), phR: restPhi(0, cz, R, zR, seg), phL: Math.PI - restPhi(0, cz, R, zL, seg), zR, zL, axisX: 0 };
    };
    test(`${L.id}: physics scaled by area and mass × length, PHYSICS untouched`, () => {
      const before = JSON.stringify(PHYSICS);
      expect(physicsFor(L)).toEqual(P);
      expect(JSON.stringify(PHYSICS)).toBe(before);
      const area = (L.pageW * L.pageH) / (card.pageW * card.pageH);
      expect(P.pvc).toBeCloseTo(PHYSICS.pvc * area, 12);
      expect(P.finger.torque / PHYSICS.finger.torque).toBeCloseTo(area * (L.pageW / card.pageW), 9);
    });
    // full columns, one side, nearly empty, empty; postcards also the audit's twice-full case (a card column at twice its capacity
    // never lands on the card binder either: idCard2x3 12 + 12 stalls near 3 %, so it is no case for the tall card page)
    const loads: (readonly [number, number])[] = [[full, full], [full, 0], [1, 0], [0, 0], ...(L.doubleSided ? [[2 * full, 2 * full] as const] : [])];
    for (const [cin, cout] of loads) {
      test(`${L.id}: a click turn lands and sleeps (${cin} + ${cout})`, () => {
        const e = env();
        const b = createPage(GEOM, cin, cout, P);
        turnPage(b, 1, 0);
        const H = 1 / P.hz;
        let t = 0;
        let seamMin = 0;
        let seamMax = 0;
        while (t < 4) {
          t += H;
          const awake = stepPage(b, e, H, t, P);
          for (const x of b.a) expect(Number.isFinite(x)).toBe(true);
          seamMin = Math.min(seamMin, seamFold(b));
          seamMax = Math.max(seamMax, seamFold(b));
          if (!awake && !b.hand && !b.finger) break;
        }
        expect(t).toBeLessThan(1.6);
        expect(pageProgress(b)).toBeGreaterThan(0.99);
        expect(seamMin).toBeGreaterThan(-1.25);
        expect(seamMax).toBeLessThan(1.25);
      });
    }
  }
});
