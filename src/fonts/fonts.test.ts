import { describe, expect, test } from "bun:test";
import { canvasFont, hanBands, hanLangOf, htmlLang, parseRanges, profileHan, SC_FILES, stack, subtractRanges } from "./index";

describe("unicode ranges", () => {
  test("parse single code points, spans and wildcards", () => {
    expect(parseRanges("U+0041-005A, U+00c0,U+4??")).toEqual([
      [0x41, 0x5a],
      [0xc0, 0xc0],
      [0x400, 0x4ff],
    ]);
  });
  test("a Chinese slice loses what the Latin alias sets (· — inside slice 119) and keeps its Han", () => {
    const slice = parseRanges("U+b7,U+2014,U+4e00,U+6587-6588");
    expect(subtractRanges(slice, parseRanges("U+0000-00FF,U+2000-206F"))).toBe("U+4e00,U+6587-6588");
    expect(subtractRanges(parseRanges("U+20-7e"), parseRanges("U+0000-00FF"))).toBe("");
    expect(subtractRanges(parseRanges("U+2180-21ff"), parseRanges("U+2190,U+2192"))).toBe("U+2180-218f,U+2191,U+2193-21ff");
  });
});

describe("hanLangOf", () => {
  test("kana anywhere picks the Japanese faces, whatever the lang", () => {
    expect(hanLangOf("雪の龍安寺", "en")).toBe("ja");
    expect(hanLangOf("ブルーアワーの稲村ヶ崎")).toBe("ja");
    expect(hanLangOf("カード帖", "zh-CN")).toBe("ja");
    expect(hanLangOf("ｶｰﾄﾞ")).toBe("ja");
  });
  test("without kana the lang decides", () => {
    expect(hanLangOf("履歴書", "ja")).toBe("ja");
    expect(hanLangOf("履歴書", "ja-JP")).toBe("ja");
    expect(hanLangOf("臺灣", "zh-Hant")).toBe("zh-Hant");
    expect(hanLangOf("臺灣", "zh-TW")).toBe("zh-Hant");
    expect(hanLangOf("香港", "zh-HK")).toBe("zh-Hant");
    expect(hanLangOf("香港", "zh-Hant-HK")).toBe("zh-Hant");
    expect(hanLangOf("简历", "zh-CN")).toBe("zh-Hans");
    expect(hanLangOf("简历", "zh")).toBe("zh-Hans");
    expect(hanLangOf("简历", "zh-Hans")).toBe("zh-Hans");
  });
  test("any other lang with Han text (an English profile's 林文) gets SC", () => {
    expect(hanLangOf("林文", "en")).toBe("zh-Hans");
    expect(hanLangOf("林文")).toBe("zh-Hans");
    expect(hanLangOf("林文", "")).toBe("zh-Hans");
  });
  test("the katakana middle dot alone is not Japanese (Chinese text borrows it)", () => {
    expect(hanLangOf("林・文", "zh-CN")).toBe("zh-Hans");
  });
  test("a lang that only starts like ja or zh is not mistaken for it", () => {
    expect(hanLangOf("林文", "jam")).toBe("zh-Hans");
    expect(hanLangOf("林文", "zh-twx")).toBe("zh-Hans");
  });
});

describe("profileHan", () => {
  test("follows the name and the profile lang", () => {
    expect(profileHan({ lang: "en", nameLocal: "林文" })).toBe("zh-Hans");
    expect(profileHan({ lang: "zh-CN", nameLocal: "林文" })).toBe("zh-Hans");
    expect(profileHan({ lang: "ja", nameLocal: "林文" })).toBe("ja");
    expect(profileHan({ nameLocal: "さくら" })).toBe("ja");
    expect(profileHan({ lang: "zh-TW" })).toBe("zh-Hant");
    expect(profileHan({})).toBe("zh-Hans");
  });
});

describe("stack", () => {
  test("the Latin alias always comes first, then the Han web face", () => {
    for (const han of ["ja", "zh-Hans", "zh-Hant"] as const) {
      expect(stack("serif", han).startsWith('"Folio Serif Latin", ')).toBe(true);
      expect(stack("sans", han).startsWith('"Folio Sans Latin", ')).toBe(true);
      expect(stack("hand", han).startsWith('"Folio Hand Latin", ')).toBe(true);
    }
    expect(stack("serif", "ja")).toContain('"Shippori Mincho"');
    expect(stack("sans", "ja")).toContain('"Zen Kaku Gothic New"');
    expect(stack("hand", "ja")).toContain('"Klee One"');
    expect(stack("serif", "zh-Hans")).toContain('"Noto Serif SC"');
    expect(stack("sans", "zh-Hans")).toContain('"Noto Sans SC"');
    expect(stack("hand", "zh-Hans")).toContain('"LXGW WenKai"');
  });
  test("Chinese stacks never name a Japanese face (it would set the shared kanji in Japanese forms)", () => {
    for (const role of ["serif", "sans", "hand"] as const) {
      const s = stack(role, "zh-Hans");
      expect(s).not.toContain("Shippori");
      expect(s).not.toContain("Zen Kaku");
      expect(s).not.toContain('"Klee One"');
      expect(s).not.toContain("Hiragino");
    }
  });
  test("Traditional Chinese puts the system TC faces after SC", () => {
    const s = stack("serif", "zh-Hant");
    expect(s.indexOf("Noto Serif SC")).toBeLessThan(s.indexOf("Songti TC"));
    expect(s.endsWith("serif")).toBe(true);
  });
  test("each stack ends in a generic family", () => {
    expect(stack("serif", "zh-Hans").endsWith(" serif")).toBe(true);
    expect(stack("sans", "ja").endsWith(" sans-serif")).toBe(true);
    expect(stack("hand", "zh-Hans").endsWith(" cursive")).toBe(true);
  });
});

describe("canvasFont", () => {
  test("weights snap to the files that exist", () => {
    expect(canvasFont("serif", 500, 22, "ja")).toBe(`500 22px ${stack("serif", "ja")}`);
    expect(canvasFont("serif", 700, 10, "zh-Hans").startsWith("600 10px ")).toBe(true);
    expect(canvasFont("sans", 600, 10, "ja").startsWith("500 10px ")).toBe(true);
    expect(canvasFont("sans", 300, 10, "ja").startsWith("400 10px ")).toBe(true);
  });
  test("Chinese text asks for the Latin alias's weights (the Chinese faces' files answer every weight between them)", () => {
    expect(canvasFont("sans", 400, 10, "zh-Hans").startsWith("400 10px ")).toBe(true);
    expect(canvasFont("sans", 500, 10, "zh-Hans").startsWith("500 10px ")).toBe(true);
    expect(canvasFont("sans", 600, 10, "zh-Hant").startsWith("500 10px ")).toBe(true);
    expect(canvasFont("serif", 600, 10, "zh-Hans").startsWith("600 10px ")).toBe(true);
    // the serif: Shippori's own three weights, so a line mixing Chinese and Latin has one colour
    expect(SC_FILES.serif.map((b) => b.file)).toEqual([400, 500, 600]);
    expect(SC_FILES.hand.map((b) => b.file)).toEqual([400]);
    // the sans: the light file for the 400 body, the 500 file for the words at 500 (Zen Kaku 500's colour)
    expect(SC_FILES.sans.map((b) => b.file)).toEqual([300, 500]);
  });
  test("each Chinese face's weight bands cover 100–900 once, and 400 / 500 land in different sans files", () => {
    for (const bands of Object.values(SC_FILES)) {
      const spans = bands.map((b) => b.weight.split(" ").map(Number) as [number, number]).sort((a, b) => a[0] - b[0]);
      expect(spans[0]![0]).toBe(100);
      expect(spans[spans.length - 1]![1]).toBe(900);
      for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThan(spans[i - 1]![1]);
    }
    const band = (w: number) => SC_FILES.sans.find((b) => { const [a, z] = b.weight.split(" ").map(Number); return w >= a! && w <= z!; })?.file;
    expect(band(400)).toBe(300);
    expect(band(450)).toBe(500);
    expect(band(500)).toBe(500);
    const serif = (w: number) => SC_FILES.serif.find((b) => { const [a, z] = b.weight.split(" ").map(Number); return w >= a! && w <= z!; })?.file;
    expect([400, 500, 600].map(serif)).toEqual([400, 500, 600]);
  });
  test("the bands follow the page's language: one sans file on an English page, both on a Chinese one (a switch re-weights them)", () => {
    expect(hanBands("sans", "en")).toEqual([{ file: 300, weight: "100 900" }]);
    expect(hanBands("sans", "")).toEqual([{ file: 300, weight: "100 900" }]);
    expect(hanBands("sans", "zh-CN")).toEqual(SC_FILES.sans);
    expect(hanBands("sans", "zh")).toEqual(SC_FILES.sans);
    expect(hanBands("serif", "en")).toEqual([{ file: 400, weight: "100 900" }]);
    expect(hanBands("serif", "zh-CN")).toEqual(SC_FILES.serif);
    expect(hanBands("hand", "en")).toEqual(SC_FILES.hand);
  });
  test("handwriting is Klee One 600 in Japanese, WenKai's own 400 otherwise (no faked bold)", () => {
    expect(canvasFont("hand", 600, 30, "ja").startsWith("600 30px ")).toBe(true);
    expect(canvasFont("hand", 600, 30, "zh-Hans").startsWith("400 30px ")).toBe(true);
  });
  test("latin: false leaves the Latin alias out (a Han-only seal never fetches a Latin file)", () => {
    const f = canvasFont("serif", 600, 20, "zh-Hans", { latin: false });
    expect(f.startsWith('600 20px "Noto Serif SC", ')).toBe(true);
    expect(f).not.toContain("Folio Serif Latin");
    expect(canvasFont("serif", 600, 20, "ja", { latin: false }).startsWith('600 20px "Shippori Mincho", ')).toBe(true);
  });
  test("sizes keep two decimals at most", () => {
    expect(canvasFont("sans", 400, 12.3456, "ja").startsWith("400 12.35px ")).toBe(true);
  });
});

describe("htmlLang", () => {
  test("keeps the profile tag when it names the same script", () => {
    expect(htmlLang("zh-Hans", "zh-CN")).toBe("zh-CN");
    expect(htmlLang("ja", "ja-JP")).toBe("ja-JP");
    expect(htmlLang("zh-Hant", "zh-TW")).toBe("zh-TW");
  });
  test("otherwise names the script itself", () => {
    expect(htmlLang("zh-Hans", "en")).toBe("zh-Hans");
    expect(htmlLang("zh-Hans")).toBe("zh-Hans");
    expect(htmlLang("ja", "zh-CN")).toBe("ja");
    expect(htmlLang("zh-Hans", "zh-TW")).toBe("zh-Hans");
  });
});
