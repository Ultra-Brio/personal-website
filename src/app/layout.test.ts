import { describe, expect, test } from "bun:test";
import { zhNum } from "./i18n";
import { classOf, frameOf, held, heldRect, lightFade, lightOf, scaleOf, SIDE_COL, sideBox } from "./layout";

describe("layout classes (spec §1.5)", () => {
  test("by width, with sideways phones first", () => {
    expect(classOf(1440, 900)).toBe("d");
    expect(classOf(1360, 800)).toBe("d");
    expect(classOf(1359, 800)).toBe("s");
    expect(classOf(1280, 720)).toBe("s");
    expect(classOf(961, 700)).toBe("s");
    expect(classOf(960, 1000)).toBe("t");
    expect(classOf(834, 1112)).toBe("t");
    expect(classOf(600, 900)).toBe("p");
    expect(classOf(390, 844)).toBe("p");
    expect(classOf(844, 390)).toBe("l");
    expect(classOf(1000, 480)).toBe("l");
  });
});

describe("the book box and the camera insets", () => {
  test("1440 × 900: words 48–252, box 390–1392 × 48–788, the reference plate's insets", () => {
    const f = frameOf(1440, 900);
    expect(f.c).toBe(90);
    expect(f.words).toEqual({ left: 48, top: 48, right: 252, bottom: 852 });
    expect(f.box).toEqual({ left: 390, top: 48, right: 1392, bottom: 788 });
    // every booklet reaches into the 間 column, a margin clear of the words (r3 D3; the résumé too since the owner's 2026-10-20 note:
    // the book as central as it can be), and leans toward the middle of the screen (anchor); the albums keep a margin clear of the
    // right edge (the hashira); the card album's case keeps 12 px more air inside its insets
    expect(f.insets).toEqual({ left: 300, right: 36, top: 24, bottom: 88, anchor: 720 });
    expect(f.wide).toEqual({ left: 300, right: 48, top: 24, bottom: 88, anchor: 720 });
    expect(f.wide.left - f.words.right).toBe(f.m);
    expect(f.wideCards).toEqual({ left: 288, right: 48, top: 24, bottom: 88, anchor: 720 });
  });
  test("1280 × 720: box 370–1240", () => {
    const f = frameOf(1280, 720);
    expect(f.m).toBe(40);
    expect(f.c).toBe(78);
    expect(f.box.left).toBe(370);
    expect(f.box.right).toBe(1240);
    expect(f.box.bottom).toBe(720 - 40 - 40 - 24);
    expect(f.wide).toEqual({ left: 284, right: 40, top: 16, bottom: 80, anchor: 640 });
    expect(f.wideCards.left).toBe(272);
  });
  test("the desk's scale: 1 everywhere (K_MAX: on a large desk only the book grows, the words keep their 1440 size)", () => {
    for (const [W, H] of [[1440, 900], [1280, 720], [390, 844], [834, 1112], [1920, 1080], [2512, 1233], [2560, 1440], [3440, 1440]] as const) {
      expect(scaleOf(W, H)).toBe(1);
      expect(frameOf(W, H).k).toBe(1);
    }
  });
  test("a large desk: the words and rows at their 1440 size, the box reaching the right margin (no empty band), the book leaning to the middle", () => {
    for (const [W, H] of [[1920, 1080], [1680, 1050], [2560, 1257], [2512, 1233], [2560, 1440]] as const) {
      const f = frameOf(W, H);
      expect(f.x0).toBe(0);
      expect(f.m).toBeCloseTo(48 * f.k, 1);
      expect(f.g).toBeCloseTo(24 * f.k, 1);
      expect(f.words.right - f.words.left).toBeCloseTo(204 * f.k, 1);
      // the box from one column of 間 after the words to the right margin, where the hashira stands
      expect(f.box.right).toBeCloseTo(W - f.m, 1);
      expect(f.box.left - f.words.right).toBeCloseTo(2 * f.g + f.c, 0);
      expect(f.box.bottom).toBeCloseTo(H - f.m - 40 * f.k - f.g, 1);
      // the albums: a margin clear of the words, a margin short of the right edge
      expect(f.wide.left - f.words.right).toBeCloseTo(f.m, 1);
      expect(f.wide.right).toBeCloseTo(f.m, 1);
      expect(f.insets.anchor).toBe(W / 2);
    }
  });
  test("a very wide desk (21:9): the composition stops at 2.1 H and stands centred", () => {
    const f = frameOf(3440, 1440);
    expect(f.k).toBe(1);
    expect(f.x0).toBe((3440 - 3024) / 2);
    expect(f.words.left).toBeCloseTo(f.x0 + f.m, 1);
    expect(f.box.right).toBeCloseTo(3440 - f.x0 - f.m, 1);
    expect(f.wide.right).toBeCloseTo(f.x0 + f.m, 1);
    // 16:9 and the owner's 2560 × 1257 (2.04 : 1) are not capped
    expect(frameOf(2560, 1257).x0).toBe(0);
    expect(frameOf(2560, 1440).x0).toBe(0);
  });
  test("phones: full width from 150 to H − 104, plus the safe areas", () => {
    const f = frameOf(390, 844, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(f.box).toEqual({ left: 0, top: 197, right: 390, bottom: 844 - 104 - 34 });
    expect(f.insets).toEqual({ left: 0, right: 0, top: 197, bottom: 138 });
  });
  test("tablet: the phone structure, box from 220 to H − 112", () => {
    const f = frameOf(834, 1112);
    expect(f.m).toBe(32);
    expect(f.box).toEqual({ left: 0, top: 220, right: 834, bottom: 1000 });
  });
  test("landscape: a 172 px column, the box beside it", () => {
    const f = frameOf(844, 390);
    expect(f.words.right - f.words.left).toBe(172);
    expect(f.box).toEqual({ left: 212, top: 8, right: 836, bottom: 382 });
  });
});

describe("the held object (brief O2)", () => {
  test("1440 × 900: the sizes in the brief, leaning toward the middle of the screen as far as the box allows", () => {
    const f = frameOf(1440, 900);
    const w = (k: Parameters<typeof heldRect>[1]) => {
      const r = heldRect(f, k);
      return Math.round(r.right - r.left);
    };
    expect(w("ticket")).toBe(780);
    expect(w("polaroid")).toBe(420);
    expect(w("note")).toBe(300);
    expect(w("cards")).toBe(680);
    expect(w("postcards")).toBe(860);
    const t = heldRect(f, "ticket");
    expect(t.left).toBe(f.box.left + f.m + f.g);
    // a large desk: in the middle of the screen; the résumé's host only as narrow as keeps its spread at full size
    const g = frameOf(2512, 1233);
    const u = heldRect(g, "ticket");
    expect((u.left + u.right) / 2).toBe(1256);
    const p = heldRect(g, "resume");
    expect(p.right - p.left).toBeGreaterThanOrEqual((p.bottom - p.top) * 1.5 - 0.01);
    expect(Math.abs((p.left + p.right) / 2 - 1256)).toBeLessThan(40);
  });
  test("a large desk holds them larger, with its box (at most 1.3×)", () => {
    const f = frameOf(2560, 1257);
    const r = heldRect(f, "ticket");
    expect(r.right - r.left).toBeCloseTo(780 * Math.min(1.3, (f.box.right - f.box.left) / 1002, (f.box.bottom - f.box.top) / 740), 0);
    const p = heldRect(f, "resume");
    expect(p.bottom).toBeCloseTo(1257 - f.m - 40 * f.k, 1);
  });
  test("never past the box", () => {
    for (const [W, H] of [[1280, 720], [1100, 640], [1440, 760], [2560, 1257], [3440, 1440]] as const) {
      const f = frameOf(W, H);
      for (const k of ["ticket", "polaroid", "note", "cards", "postcards"] as const) {
        const r = heldRect(f, k);
        expect(r.left).toBeGreaterThanOrEqual(f.box.left);
        expect(r.right).toBeLessThanOrEqual(f.box.right);
        expect(r.top).toBeGreaterThanOrEqual(f.box.top);
        expect(r.bottom).toBeLessThanOrEqual(f.box.bottom);
      }
    }
  });
  test("phones: the résumé's page as wide as the screen less its margins, under the identity (r4 E4)", () => {
    for (const [W, H] of [[390, 844], [360, 800], [412, 915]] as const) {
      const f = frameOf(W, H);
      const { host, obj } = held(f, "resume");
      expect(obj.top).toBe(f.m + 64);
      // the page as the paper viewer draws it (PAPER_REST.size of its rect, until it says where it rests) is the screen less its
      // margins; its rect is that much larger
      expect(obj.right - obj.left).toBeCloseTo(W - 2 * f.m, 5);
      expect(host.right - host.left).toBeGreaterThan((W - 2 * f.m) / 0.96 + 31);
    }
    // a short phone keeps the caption's count, title and kind's name: the page is height-bound there, still most of the width
    for (const [W, H] of [[375, 667], [396, 690]] as const) {
      const f = frameOf(W, H);
      const { obj } = held(f, "resume");
      expect((obj.right - obj.left) / (W - 2 * f.m)).toBeGreaterThan(0.86);
      expect(obj.bottom + 14 + 78).toBeLessThanOrEqual(H - 72 + 0.5);
    }
  });
  test("phones: the object 24 px under the book box's top, in its own shape, inside the screen, the caption's room kept", () => {
    const SHAPE = { resume: 210 / 297, card: 91 / 55, ticket: 150 / 58, polaroid: 88 / 107, note: 82 / 182, cards: 85.6 / 54, postcards: 148 / 105 };
    for (const [W, H] of [[390, 844], [360, 800], [834, 1112]] as const) {
      const f = frameOf(W, H);
      for (const k of ["resume", "card", "ticket", "polaroid", "note", "cards", "postcards"] as const) {
        const { host, obj } = held(f, k);
        expect(obj.top).toBe(k === "resume" ? f.m + 64 : f.box.top + 24);
        // the polaroid is held at −2°: its drawn rect has its shape, the object's extent is that rect turned
        const r = k === "polaroid" ? host : obj;
        expect((r.right - r.left) / (r.bottom - r.top)).toBeCloseTo(SHAPE[k], 2);
        expect(obj.left).toBeGreaterThanOrEqual(16);
        expect(obj.right).toBeLessThanOrEqual(W - 16);
        // the caption keeps its minimum above the bottom row (the résumé's: its count, title and kind's name)
        expect(obj.bottom + 14 + (k === "resume" ? 78 : 150)).toBeLessThanOrEqual(H - 72);
        // the paper viewer's host: the paper plus its gutters; everything else is drawn in its own rect
        if (k === "resume" || k === "card") {
          // the paper's host: wider and taller than the paper by the viewer's gutters (and the card's 3 mm framing margin)
          expect(host.right - host.left).toBeGreaterThan(obj.right - obj.left + 32);
          expect(obj.top - host.top).toBeGreaterThan(12);
          expect(host.bottom).toBeGreaterThan(obj.bottom);
        } else if (k === "polaroid") {
          const w = host.right - host.left, h = host.bottom - host.top, a = (2 * Math.PI) / 180;
          expect(obj.bottom - obj.top).toBeCloseTo(w * Math.sin(a) + h * Math.cos(a), 5);
          expect((host.top + host.bottom) / 2).toBeCloseTo((obj.top + obj.bottom) / 2, 5);
        } else expect(host).toEqual(obj);
      }
      // the card unfolds downwards at the same width: same top, twice the height
      const shut = held(f, "card");
      const open = held(f, "card", { open: true });
      expect(open.obj.top).toBe(shut.obj.top);
      expect(open.host.right - open.host.left).toBe(shut.host.right - shut.host.left);
      expect((open.obj.bottom - open.obj.top) / (shut.obj.bottom - shut.obj.top)).toBeGreaterThan(1.9);
      expect(open.obj.bottom).toBeLessThanOrEqual(H - 72 - 14);
    }
  });
});

describe("a landscape tablet window's detail view (side by side)", () => {
  test("900 × 600: the object beside the caption column, inside the screen, over the bottom row; portrait keeps the stack", () => {
    const f = frameOf(900, 600);
    expect(f.cls).toBe("t");
    const side = sideBox(f)!;
    expect(side.left).toBe(f.m + SIDE_COL + 2 * f.g);
    for (const k of ["resume", "card", "ticket", "polaroid", "note", "cards", "postcards"] as const) {
      const { host, obj } = held(f, k);
      expect(obj).toEqual(host);
      expect(host.left).toBeGreaterThanOrEqual(side.left - 24);
      expect(host.right).toBeLessThanOrEqual(900);
      expect(host.top).toBeGreaterThanOrEqual(side.top);
      expect(host.bottom).toBeLessThanOrEqual(side.bottom);
      if (k === "ticket") expect(host.right - host.left).toBeGreaterThan(400);
    }
    expect(sideBox(frameOf(834, 1112))).toBeNull();
    expect(sideBox(frameOf(1440, 900))).toBeNull();
    expect(sideBox(frameOf(844, 390))).toBeNull();
  });
});

describe("the window light", () => {
  test("C's geometry at the reference sizes", () => {
    const g = lightOf(frameOf(1440, 900));
    expect(g.patch[0]).toEqual([560, -60]);
    expect(g.bars[0]).toEqual([910, -60, 730, 960, 16]);
    expect(g.twig).toBe("translate(560.0 -14.0) scale(1.000)");
    expect(lightOf(frameOf(390, 844)).bars).toHaveLength(2);
  });
  test("keeps off the words (r3 D2): the words column and the hands row on a desk, the header and the foot on a phone", () => {
    const d = lightFade(frameOf(1440, 900));
    expect(d.left).toEqual({ from: 276, to: 324 });
    expect(d.right).toEqual({ from: 48, to: 96 });
    expect(d.bottom).toEqual({ from: 92, to: 116 });
    expect(d.top).toEqual({ from: 0, to: 0 });
    const p = lightFade(frameOf(390, 844, { top: 47, right: 0, bottom: 34, left: 0 }));
    expect(p.top).toEqual({ from: 175, to: 243 });
    expect(p.bottom).toEqual({ from: 134, to: 166 });
    expect(p.left).toEqual({ from: 0, to: 0 });
    expect(lightFade(frameOf(844, 390)).left).toEqual({ from: 200, to: 260 });
    // every fade starts where the words end and is whole before the book box; at the right it starts at the hashira's margin
    for (const [W, H] of [[1440, 900], [1280, 720], [1920, 1080], [2560, 1257], [3440, 1440]] as const) {
      const f = frameOf(W, H);
      const l = lightFade(f);
      expect(l.left.from).toBeGreaterThan(f.words.right);
      expect(l.left.to).toBeLessThanOrEqual(f.box.left);
      expect(H - l.bottom.from).toBeLessThanOrEqual(H - f.m - 40 * f.k);
      expect(H - l.bottom.to).toBeGreaterThanOrEqual(f.box.bottom - f.g);
      expect(l.right.from).toBeCloseTo(W - f.box.right, 1);
    }
  });
});

test("Chinese numerals for the postcard line", () => {
  expect(zhNum(7)).toBe("七");
  expect(zhNum(10)).toBe("十");
  expect(zhNum(12)).toBe("十二");
  expect(zhNum(21)).toBe("二十一");
  expect(zhNum(120)).toBe("120");
});
