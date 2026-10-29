import { describe, expect, test } from "bun:test";
import { PHYSICS, createPage, grabPage, grabPoint, pageKnotsInto, pageShape, pullPage, restPage, stepPage, type PageBody, type PageEnv } from "./physics";
import { MM, PITCH, SEG, panelRoot, restPhi, sheetPathAt } from "./sheet";

/*
 * sasshi (round 4, E6): the drawn shape of a sheet (sheet.ts sheetPath, fed by pageKnotsInto) never dips into the stack it lies
 * on. The owner's strip: the last postcard sheet (one card in its inner column, the outer column empty and soft) lying turned on the
 * left, its free edge lifted by a finger — round 3 drew each column as one even arc from its end links' tangents, which started the
 * curling outer column pointing down into the stack (≈ 3 mm below its resting plane at the seam); the sheet under it lies only
 * PITCH − SLAB = 0.15 mm lower, so a strip of that sheet's postcards showed through.
 */

const R = 0.13;
const cx = 0;
const cz = 0.155;
const SHEETS = 2;
function envFor(i: number): PageEnv {
  const zR = (SHEETS - i - 0.5) * PITCH;
  const zL = (i + 0.5) * PITCH;
  return { root: (phi, th) => panelRoot(cx + R * Math.cos(phi), cz + R * Math.sin(phi), phi, th), phR: restPhi(cx, cz, R, zR), phL: Math.PI - restPhi(cx, cz, R, zL), zR, zL, axisX: cx };
}
const GEOM = { inner: (SEG.a2 + SEG.b2) / 2 - SEG.b1, outer: SEG.w - (SEG.a2 + SEG.b2) / 2, height: SEG.h };
const H = 1 / PHYSICS.hz;

/** The lowest point of the drawn panel (u from the strip's end to the free edge) relative to the stack under it, mm (< 0: inside it) */
function clearance(b: PageBody, env: PageEnv, k: ArrayLike<number>) {
  const hx = cx + R * Math.cos(k[0]!);
  const hz = cz + R * Math.sin(k[0]!);
  let worst = Infinity;
  for (let i = 0; i <= 400; i++) {
    const u = SEG.b1 + ((SEG.w - SEG.b1) * i) / 400;
    const [x, z] = sheetPathAt(u, hx, hz, k[0]!, (k as number[]).slice(1), SEG);
    worst = Math.min(worst, (z - (x > env.axisX ? env.zR : env.zL)) / MM);
  }
  return worst;
}
const knotsNow = (b: PageBody) => pageKnotsInto(b, new Array<number>(9).fill(0));
/** Round 3's shape (one even arc a column, pageShape) in the same knot form */
function oldKnots(b: PageBody) {
  const [phi, s0, b0, seam, b1] = pageShape(b);
  const s1 = s0 + b0 + seam;
  return [phi, s0, s0 + b0 / 3, s0 + (2 * b0) / 3, s0 + b0, s1, s1 + b1 / 3, s1 + (2 * b1) / 3, s1 + b1];
}

describe("the drawn sheet stays out of its stack", () => {
  test("the owner's pose: an empty outer column lying on the left stack, curling up toward its lifted edge", () => {
    const env = envFor(1);
    const b = createPage(GEOM, 1, 0);
    restPage(b, 1, env);
    b.a.set([Math.PI, Math.PI - 0.0026, 2.6373, 2.119]);
    expect(clearance(b, env, oldKnots(b))).toBeLessThan(-1);
    expect(clearance(b, env, knotsNow(b))).toBeGreaterThan(-0.05);
  });

  for (const [name, cin, cout, side] of [
    ["the outer column empty, on the left", 1, 0, 1],
    ["the outer column empty, on the right", 1, 0, 0],
    ["the inner column empty, on the left", 0, 1, 1],
    ["both columns empty, on the right", 0, 0, 0],
  ] as const) {
    test(`a finger lifts the free edge and holds it: ${name}`, () => {
      const env = envFor(1);
      const b = createPage(GEOM, cin, cout);
      restPage(b, side, env);
      grabPage(b, GEOM.inner + GEOM.outer - 0.04, side * Math.PI);
      let worst = Infinity;
      let worstOld = Infinity;
      let off = 0;
      let t = 0;
      // up to ~70° over 0.6 s, held, then back down to a hair above the stack
      for (let i = 0; i < 1.6 * PHYSICS.hz; i++) {
        t += H;
        const lift = t < 0.6 ? (t / 0.6) * 1.2 : t < 1 ? 1.2 : Math.max(0.03, 1.2 - (t - 1) * 3);
        pullPage(b, side ? Math.PI - lift : lift);
        stepPage(b, env, H, t);
        if (i % 4) continue;
        worst = Math.min(worst, clearance(b, env, knotsNow(b)));
        worstOld = Math.min(worstOld, clearance(b, env, oldKnots(b)));
        // the drawn free edge stays near the physics' edge
        const k = knotsNow(b);
        const [, , ex, ez] = grabPoint({ ...b, hand: null } as PageBody, env);
        const [x, z] = sheetPathAt(SEG.w, cx + R * Math.cos(k[0]!), cz + R * Math.sin(k[0]!), k[0]!, k.slice(1), SEG);
        off = Math.max(off, Math.hypot(x - ex, z - ez) / MM);
      }
      expect(worst).toBeGreaterThan(-0.05);
      expect(off).toBeLessThan(12);
      // (round 3's arcs went into the stack in the same motion)
      if (cin + cout < 2) expect(worstOld).toBeLessThan(worst);
    });
  }
});
