import { describe, expect, test } from "bun:test";
import { breakUnits, NO_END, NO_START, wrapUnits } from "./kinsoku";

/** one unit per character / letter: every character 1 wide */
const w = (s: string) => Array.from(s).length;

describe("breakUnits", () => {
  test("joining the units gives the text back", () => {
    for (const s of ["设计工程师，从第一张草图到最后一帧动效。", "Lin Wen  — Design engineer", "Rust（业余） and「会动的纸」", "140 ms → 38 ms。"]) expect(breakUnits(s).join("")).toBe(s);
  });
  test("Latin words stay whole, CJK characters are units", () => {
    expect(breakUnits("在 Paperplane Labs 工作")).toEqual(["在", " ", "Paperplane", " ", "Labs", " ", "工", "作"]);
  });
  test("closing punctuation hangs on the character before it", () => {
    expect(breakUnits("草图，动效。")).toEqual(["草", "图，", "动", "效。"]);
    expect(breakUnits("38 ms。")).toEqual(["38", " ", "ms。"]);
  });
  test("opening punctuation goes with the character after it", () => {
    expect(breakUnits("讲「会动的纸」")).toEqual(["讲", "「会", "动", "的", "纸」"]);
    expect(breakUnits("Rust（业余）")).toEqual(["Rust", "（业", "余）"]);
  });
  test("runs of closing punctuation all stay on the line", () => {
    expect(breakUnits("纸」。")).toEqual(["纸」。"]);
  });
});

describe("wrapUnits (kinsoku)", () => {
  const text = "设计工程师，从第一张草图到最后一帧动效，整件事自己做完。讲题是「会动的纸」：有分量，有摩擦。";
  for (const max of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    test(`no line starts or ends with a forbidden character at width ${max}`, () => {
      const lines = wrapUnits(text, max, w);
      expect(lines.join("")).toBe(text);
      for (const l of lines) {
        expect(NO_START.has(Array.from(l)[0]!)).toBe(false);
        expect(NO_END.has(Array.from(l).pop()!)).toBe(false);
        // a glued unit may run one or two over the measure, never more
        expect(w(l)).toBeLessThanOrEqual(max + 2);
      }
    });
  }
  test("Latin words are never split when they fit a line", () => {
    const lines = wrapUnits("主导触感界面系统 Paperplane Labs 的设计", 12, w);
    expect(lines.some((l) => l.includes("Paperplane"))).toBe(true);
    for (const l of lines) expect(l === l.trim()).toBe(true);
  });
  test("a word wider than the line is cut by characters", () => {
    expect(wrapUnits("abcdefghij", 4, w)).toEqual(["abcd", "efgh", "ij"]);
  });
  test("English wraps at spaces", () => {
    expect(wrapUnits("one two three four", 9, w)).toEqual(["one two", "three", "four"]);
  });
});

describe("orphans and balance (QA 2026-10-19)", () => {
  // proportional enough: CJK 1, Latin letters and digits .55, a space .3
  const m = (s: string) => Array.from(s).reduce((a, c) => a + (/[⺀-鿿＀-￯]/u.test(c) ? 1 : /\s/.test(c) ? 0.3 : 0.55), 0);
  const last = (ls: string[]) => Array.from(ls[ls.length - 1]!.replace(/\s/g, "")).length;
  test("the ticket terms never end on 「日。」 alone", () => {
    const terms = "凭本票入场一人，仅限当日有效。请保留至离场，入口处验票，打孔后不再用于他日。";
    for (const max of [9, 10, 11, 12, 13, 14, 16, 18]) {
      const plain = wrapUnits(terms, max, w);
      const ls = wrapUnits(terms, max, m);
      expect(ls.join("")).toBe(terms);
      expect(ls.length).toBe(wrapUnits(terms, max, m).length);
      if (plain.length > 1) expect(last(plain)).toBeGreaterThan(2);
      if (ls.length > 1) expect(last(ls)).toBeGreaterThan(2);
    }
  });
  test("the polaroid back keeps 「背面。」 together", () => {
    const back = "旅行的第一个早上。自动售货机的咖啡，作品集画在一张收据的背面。";
    for (const max of [8, 10, 12, 14, 17]) {
      const ls = wrapUnits(back, max, w);
      expect(ls.join("")).toBe(back);
      if (ls.length > 1) expect(last(ls)).toBeGreaterThanOrEqual(3);
    }
  });
  test("orphan control never adds a line", () => {
    const s = "打孔后不再用于他日。";
    expect(wrapUnits(s, 9, w).length).toBe(2);
  });
  test("a number keeps its counter: 120 张, 2027 年", () => {
    expect(breakUnits("印了 120 张。")).toEqual(["印", "了", " ", "120 张。"]);
    expect(breakUnits("2027 年春天")).toEqual(["2027 年", "春", "天"]);
    expect(breakUnits("38 ms。")).toEqual(["38", " ", "ms。"]);
    const ls = wrapUnits("这批卡片一共印了 120 张", 9, m);
    expect(ls.some((l) => l.includes("120 张"))).toBe(true);
  });
  test("balanced centred note breaks after the pause", () => {
    const note = "2027 年春天起，接一些小而用心的项目。";
    expect(wrapUnits(note, 14, m, { balance: true })).toEqual(["2027 年春天起，", "接一些小而用心的项目。"]);
    // without the option: greedy, with the orphan rule
    const g = wrapUnits(note, 14, m);
    expect(g.length).toBe(2);
    expect(last(g)).toBeGreaterThanOrEqual(4);
  });
  test("balance without a pause evens the lines", () => {
    const ls = wrapUnits("one two three four five six seven", 24, (s) => s.length, { balance: true });
    expect(ls.length).toBe(2);
    expect(Math.abs(ls[0]!.length - ls[1]!.length)).toBeLessThanOrEqual(6);
  });
});
