import { describe, expect, test } from "bun:test";
import { binderDims, boardsAt, caseFontRuns } from "./binder";
import { MM } from "./sheet";

/*
 * Golden values of binderDims(sheets, material) captured from the phase-1 engine before the case was parametrised.
 * The defaults (no board / depth / rings option) must keep reproducing them exactly.
 */
const GOLDEN: Record<string, Record<string, number>> = {
  "frost:1": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.016, xb: 0.20500000000000002, B: 2.2517037211661854, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "frost:2": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.016, xb: 0.20500000000000002, B: 2.264395568392242, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "frost:3": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.016, xb: 0.20500000000000002, B: 2.2753485940699583, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "frost:6": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.016, xb: 0.20500000000000002, B: 2.300734153879951, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "frost:9": { R: 0.13859, D: 0.16358999999999999, S: 0.32717999999999997, h: 0.05, CT: 0.016, xb: 0.21359, B: 2.332140412363601, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "frost:17": { R: 0.19067, D: 0.21567, S: 0.43134, h: 0.05, CT: 0.016, xb: 0.26567, B: 2.4505624052890242, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "frost:42": { R: 0.35342, D: 0.37842000000000003, S: 0.7568400000000001, h: 0.05, CT: 0.016, xb: 0.42842, B: 2.7840044984506878, H: 2.0640000000000005, drop: 0.022000000000000002, spineInset: 0.016 },
  "cloth:1": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.2673803753317907, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "cloth:2": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.2788660773192255, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "cloth:3": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.2888630482772383, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "cloth:6": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.312184307332592, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "cloth:9": { R: 0.13859, D: 0.16358999999999999, S: 0.32717999999999997, h: 0.05, CT: 0.03, xb: 0.21359, B: 2.3423366496341043, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "cloth:17": { R: 0.19067, D: 0.21567, S: 0.43134, h: 0.05, CT: 0.03, xb: 0.26567, B: 2.4591716189107857, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "cloth:42": { R: 0.35342, D: 0.37842000000000003, S: 0.7568400000000001, h: 0.05, CT: 0.03, xb: 0.42842, B: 2.7910064670083328, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:1": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.2673803753317907, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:2": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.2788660773192255, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:3": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.2888630482772383, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:6": { R: 0.13, D: 0.155, S: 0.31, h: 0.05, CT: 0.03, xb: 0.20500000000000002, B: 2.312184307332592, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:9": { R: 0.13859, D: 0.16358999999999999, S: 0.32717999999999997, h: 0.05, CT: 0.03, xb: 0.21359, B: 2.3423366496341043, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:17": { R: 0.19067, D: 0.21567, S: 0.43134, h: 0.05, CT: 0.03, xb: 0.26567, B: 2.4591716189107857, H: 2.0640000000000005, drop: 0, spineInset: 0 },
  "leather:42": { R: 0.35342, D: 0.37842000000000003, S: 0.7568400000000001, h: 0.05, CT: 0.03, xb: 0.42842, B: 2.7910064670083328, H: 2.0640000000000005, drop: 0, spineInset: 0 },
};

describe("binderDims", () => {
  test("defaults reproduce the phase-1 card binder exactly (golden)", () => {
    for (const [key, want] of Object.entries(GOLDEN)) {
      const [material, sheets] = key.split(":") as ["frost" | "cloth" | "leather", string];
      expect({ ...binderDims(Number(sheets), material) } as Record<string, number>).toEqual(want);
    }
  });

  test("zero sheets is a real state: a positive board, not the old negative width", () => {
    for (const m of ["frost", "cloth", "leather"] as const) {
      const d = binderDims(0, m);
      expect(d.B).toBeGreaterThan(1);
      expect(Number.isFinite(d.R) && Number.isFinite(d.D)).toBe(true);
    }
  });

  test("ring-less portrait folio: board 250 x 340 mm, 16 mm deep spine", () => {
    for (const m of ["frost", "cloth", "leather"] as const) {
      const d = binderDims(0, m, { board: { w: 250, h: 340 }, depth: 16, rings: false });
      expect(d.S).toBeCloseTo(16 * MM, 10);
      expect(d.B).toBeCloseTo((250 + 14) * MM, 10);
      expect(d.H).toBeCloseTo((340 + 14) * MM, 10);
      // portrait: taller than wide
      expect(d.H).toBeGreaterThan(d.B);
      // the closed box's middle sits inside the spine depth
      expect(d.D).toBeGreaterThan(0);
      expect(d.D).toBeLessThan(d.S);
    }
  });

  test("a board option only ever enlarges the card binder; depth only widens a ringed spine", () => {
    const base = binderDims(2, "cloth");
    const big = binderDims(2, "cloth", { board: { w: 300, h: 250 } });
    expect(big.B).toBeCloseTo(314 * MM, 10);
    expect(big.H).toBeCloseTo(264 * MM, 10);
    const small = binderDims(2, "cloth", { board: { w: 10, h: 10 } });
    expect(small.B).toBe(base.B);
    expect(small.H).toBe(base.H);
    expect(binderDims(2, "cloth", { depth: 5 }).S).toBe(base.S);
    expect(binderDims(2, "cloth", { depth: 60 }).S).toBeCloseTo(60 * MM, 10);
  });
});

/*
 * sasshi: boardsAt is what the camera frames by (and Binder.pose places the meshes by): shut, the front board lies on top of the
 * back one; open, it lies flat on the left, the back board's mirror image; the boards keep their size throughout.
 */
describe("boardsAt", () => {
  for (const m of ["frost", "cloth", "leather"] as const)
    test(`${m}: shut on top, open mirrored on the desk, sizes kept`, () => {
      const d = binderDims(2, m);
      const [front0, , back0] = boardsAt(d, 0);
      const [front1, spine1, back1] = boardsAt(d, 1);
      // shut: the front board over the back board, a box's depth above it, both flat
      expect(front0!.o[0]).toBeCloseTo(back0!.o[0], 6);
      expect(front0!.o[2]).toBeGreaterThan(back0!.o[2] + d.CT);
      expect(front0!.n[2]).toBeCloseTo(back0!.n[2], 6);
      // open: flat on the desk to the left, the back board's mirror image; the spine between them (sunk on a frosted case)
      expect(front1!.o[0]).toBeCloseTo(-back1!.o[0], 6);
      expect(front1!.o[2]).toBeCloseTo(back1!.o[2], 6);
      expect(front1!.n[2]).toBeCloseTo(-back1!.n[2], 6);
      expect(spine1!.o[0]).toBeCloseTo(0, 6);
      for (const c of [0, 0.3, 0.5, 0.8, 1]) {
        const [f, s, b] = boardsAt(d, c);
        expect(f!.hw).toBeCloseTo(back1!.hw, 10);
        expect(b!.hh).toBeCloseTo(d.H / 2, 10);
        expect(s!.hw).toBeCloseTo(spine1!.hw, 10);
      }
    });
});

/*
 * sasshi: the strings a case prints and the faces it sets them in (src/fonts), which the scene loads before painting. A
 * Chinese profile's print must come out in the Chinese faces, a Japanese one's in the Japanese faces, never a mix in one string.
 */
describe("caseFontRuns", () => {
  const en = { title: "Lin Wen", subtitle: "林文", role: "Design engineer", place: "Shanghai", lang: "en" };
  test("an English folio: Mincho stamp and name, the 林文 / seal in SC, Gothic role and place", () => {
    const runs = caseFontRuns("Lin Wen — Folio", { liner: en });
    expect(runs).toContainEqual({ role: "serif", weight: 500, text: "Lin Wen — Folio", han: "zh-Hans" });
    expect(runs).toContainEqual({ role: "serif", weight: 500, text: "林文", han: "zh-Hans" });
    expect(runs).toContainEqual({ role: "sans", weight: 400, text: "Design engineer", han: "zh-Hans" });
    expect(runs).toContainEqual({ role: "serif", weight: 600, text: "林文之印", han: "zh-Hans" });
  });
  test("a Chinese folio (the name in Han, no nameLocal): every string in the SC faces, the seal cut from the name", () => {
    const runs = caseFontRuns("林文 · 作品集", { liner: { title: "林文", role: "设计工程师", place: "上海", lang: "zh-CN" } });
    expect(runs.every((r) => r.han === "zh-Hans")).toBe(true);
    expect(runs).toContainEqual({ role: "serif", weight: 600, text: "林文之印", han: "zh-Hans" });
    expect(runs).toContainEqual({ role: "sans", weight: 400, text: "设计工程师", han: "zh-Hans" });
  });
  test("a Japanese profile sets its Han in the Japanese faces", () => {
    const runs = caseFontRuns("履歴書", { liner: { ...en, lang: "ja" } });
    expect(runs.filter((r) => /\p{Script=Han}/u.test(r.text)).every((r) => r.han === "ja")).toBe(true);
  });
  test("an album: the slip's title in its own faces, and the stamp follows the slip's language", () => {
    const runs = caseFontRuns("卡册", { slip: { title: "卡册", han: "zh-Hans" } });
    expect(runs).toEqual([
      { role: "serif", weight: 500, text: "卡册", han: "zh-Hans" },
      { role: "serif", weight: 500, text: "卡册", han: "zh-Hans" },
    ]);
    expect(caseFontRuns("Cards", { slip: { title: "カード帖", han: "ja" } })[0]).toEqual({ role: "serif", weight: 500, text: "Cards", han: "ja" });
  });
  test("nothing to print, nothing to load", () => {
    expect(caseFontRuns("  ")).toEqual([]);
  });
});
