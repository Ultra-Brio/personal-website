/*
 * The one place that decides which face a string is set in, for the DOM (`stack`) and for every canvas painter (`canvasFont`,
 * `ensureFonts`). Three roles, three Japanese OFL families: Shippori Mincho (serif), Zen Kaku Gothic New (sans), Klee One (hand).
 *
 * The rule (owner 2026-10-19: a profile written in Simplified Chinese must look as refined as an English one, with no mixed glyph
 * shapes inside a sentence):
 *   - Latin always comes from the Japanese faces, so English looks the same in every language. Their latin + latin-ext woff2 are
 *     registered here under alias families ("Folio Serif Latin" …) that sit first in every stack, so the CJK face after them never
 *     sets a Latin letter.
 *   - Han: kana in the string, or `lang` ja → the Japanese faces; zh-Hant / zh-TW / zh-HK → Noto SC, then the system TC faces;
 *     anything else with Han text (Chinese, or an English profile's 林文) → Noto Serif SC / Noto Sans SC / LXGW WenKai.
 *
 * Nothing CJK is fetched until a string needs it: the SC and WenKai faces are registered lazily by `ensureFonts` (and the Japanese
 * CSS imported), and the unicode-range slices mean only the slices holding the requested characters download. Canvas text never
 * triggers a web-font load by itself, so painters paint, `await ensureFonts(runs)` with the exact strings they print, then repaint.
 *
 * Bytes (spec §1.3: an English first paint fetches ≤ 250 KB of woff2): each Chinese face is registered from as few file weights as
 * keep its colour beside the Latin (SC_FILES: the serif's three beside Shippori's 400 / 500 / 600, a light and a medium one for the
 * sans, one for the hand), and without the ranges the alias faces cover (Latin, general punctuation, arrows), so a Chinese face
 * never downloads a Latin slice and an English profile's 林文 costs two slices, not ten.
 */
import serifLatin400 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-400-normal.woff2?url";
import serifLatinExt400 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-ext-400-normal.woff2?url";
import serifLatin500 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-500-normal.woff2?url";
import serifLatinExt500 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-ext-500-normal.woff2?url";
import serifLatin600 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-600-normal.woff2?url";
import serifLatinExt600 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-ext-600-normal.woff2?url";
import sansLatin400 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-400-normal.woff2?url";
import sansLatinExt400 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-ext-400-normal.woff2?url";
import sansLatin500 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-500-normal.woff2?url";
import sansLatinExt500 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-ext-500-normal.woff2?url";
import handLatin600 from "@fontsource/klee-one/files/klee-one-latin-600-normal.woff2?url";
import handLatinExt600 from "@fontsource/klee-one/files/klee-one-latin-ext-600-normal.woff2?url";
// the arrows (→ ↗ ←) live in three of the Japanese faces' numbered slices: [107] → , [58] ↔ ↕ ↖ ↗ ↘ ↙ …, [94] ←
import serifArrowR400 from "@fontsource/shippori-mincho/files/shippori-mincho-107-400-normal.woff2?url";
import serifArrowD400 from "@fontsource/shippori-mincho/files/shippori-mincho-58-400-normal.woff2?url";
import serifArrowL400 from "@fontsource/shippori-mincho/files/shippori-mincho-94-400-normal.woff2?url";
import serifArrowR500 from "@fontsource/shippori-mincho/files/shippori-mincho-107-500-normal.woff2?url";
import serifArrowD500 from "@fontsource/shippori-mincho/files/shippori-mincho-58-500-normal.woff2?url";
import serifArrowL500 from "@fontsource/shippori-mincho/files/shippori-mincho-94-500-normal.woff2?url";
import serifArrowR600 from "@fontsource/shippori-mincho/files/shippori-mincho-107-600-normal.woff2?url";
import serifArrowD600 from "@fontsource/shippori-mincho/files/shippori-mincho-58-600-normal.woff2?url";
import serifArrowL600 from "@fontsource/shippori-mincho/files/shippori-mincho-94-600-normal.woff2?url";
import sansArrowR400 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-107-400-normal.woff2?url";
import sansArrowD400 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-58-400-normal.woff2?url";
import sansArrowL400 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-94-400-normal.woff2?url";
import sansArrowR500 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-107-500-normal.woff2?url";
import sansArrowD500 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-58-500-normal.woff2?url";
import sansArrowL500 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-94-500-normal.woff2?url";

export type Role = "serif" | "sans" | "hand";
export type HanLang = "ja" | "zh-Hans" | "zh-Hant";

/** Hiragana, katakana (with ー, without the ・ that Chinese text borrows), katakana extensions and half-width katakana. */
const KANA = /[ぁ-ゖゝ-ゟァ-ヺー-ヿㇰ-ㇿｦ-ﾟ]/;

/** Which Han faces a string is set in: kana → ja; otherwise by `lang` (ja → ja, zh-Hant / TW / HK / MO → zh-Hant, else zh-Hans). */
export function hanLangOf(text: string, lang?: string): HanLang {
  if (KANA.test(text)) return "ja";
  const l = (lang ?? "").toLowerCase();
  if (l === "ja" || l.startsWith("ja-")) return "ja";
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(l)) return "zh-Hant";
  return "zh-Hans";
}

/** The Han faces of a profile's own name: the face its 名 nameplate, seal and other name-bearing print use. */
export function profileHan(p: { lang?: string; nameLocal?: string }): HanLang {
  return hanLangOf(p.nameLocal ?? "", p.lang);
}

/** Alias families: the Japanese faces' Latin slices under their own names, first in every stack. */
const LATIN: Record<Role, string> = { serif: "Folio Serif Latin", sans: "Folio Sans Latin", hand: "Folio Hand Latin" };
/** The web faces for Han, per Han language. */
const HAN_FACE: Record<"ja" | "zh", Record<Role, string>> = {
  ja: { serif: "Shippori Mincho", sans: "Zen Kaku Gothic New", hand: "Klee One" },
  zh: { serif: "Noto Serif SC", sans: "Noto Sans SC", hand: "LXGW WenKai" },
};
/** System fallbacks behind the web faces (offline, or a character the slices lack). */
const SYSTEM: Record<HanLang, Record<Role, string>> = {
  ja: { serif: '"Hiragino Mincho ProN", "Yu Mincho", serif', sans: '"Hiragino Sans", "Yu Gothic", sans-serif', hand: '"Hiragino Maru Gothic ProN", cursive' },
  "zh-Hans": { serif: '"Songti SC", "STSong", serif', sans: '"PingFang SC", "Microsoft YaHei", sans-serif', hand: '"Kaiti SC", "STKaiti", cursive' },
  "zh-Hant": { serif: '"Songti TC", "PMingLiU", serif', sans: '"PingFang TC", "Microsoft JhengHei", sans-serif', hand: '"Kaiti TC", "DFKai-SB", cursive' },
};

function hanFace(role: Role, han: HanLang): string {
  return HAN_FACE[han === "ja" ? "ja" : "zh"][role];
}

/** CSS font-family list for a role: the Latin alias, the Han web face, then the system faces. */
export function stack(role: Role, han: HanLang): string {
  return `"${LATIN[role]}", "${hanFace(role, han)}", ${SYSTEM[han][role]}`;
}

/**
 * The file weights each Chinese face is registered from, and the band of asked weights each answers (the bands cover 100–900, so
 * nothing is ever faked bold). Serif: one file per Shippori weight, 400 / 500 / 600 (owner 2026-10-23: one 500 file under every
 * weight set the 400 body a shade darker than its Latin and read a little off; LXGW Neo ZhiSong and Zhuque Fangsong were tried
 * after it and read less comfortable). Sans: Noto Sans SC is heavier than Zen Kaku at the same
 * number — measured at 200 px, stems Zen Kaku 400 / 500: 14 / 20 px (its Latin l 12 / 19), Noto Sans SC 300 / 400 / 500: 11 / 17 /
 * 21 — so text up to 450 (the 400 body) takes the 300 file and the 500 words (labels, the chrome) the 500 file: a sentence mixing
 * Chinese and Latin has one colour at either weight. Handwriting: WenKai has one weight.
 * The serif's 500 / 600 and the sans's 500 files are for a Chinese page (`<html lang="zh…">`, which the app sets before any face is
 * asked for): elsewhere the few Han characters (an English profile's 林文, 中文 in a list of languages) take the first file at every
 * weight, so an English page
 * fetches no second set of slices for them.
 * (han-serif.ts / han-sans.ts / han-hand.ts import exactly these files.)
 */
export const SC_FILES: Record<Role, readonly { file: number; weight: string }[]> = {
  serif: [
    { file: 400, weight: "100 449" },
    { file: 500, weight: "450 549" },
    { file: 600, weight: "550 900" },
  ],
  sans: [
    { file: 300, weight: "100 449" },
    { file: 500, weight: "450 900" },
  ],
  hand: [{ file: 400, weight: "100 900" }],
};

/**
 * The weight to ask for: one the Latin alias has as a file (Shippori 400/500/600, Zen Kaku 400/500; handwriting Klee One 600, or
 * 400 beside WenKai). The Japanese Han faces have the same files; the Chinese faces take any weight (SC_FILES: serif 400 / 500 / 600
 * → the same Noto Serif SC file, sans 400 → Noto Sans SC 300, 500 → 500).
 */
function weightOf(role: Role, weight: number, han: HanLang): number {
  if (role === "hand") return han === "ja" ? 600 : 400;
  const have = role === "serif" ? [400, 500, 600] : [400, 500];
  let best = have[0]!;
  for (const w of have) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  return best;
}

/** The numeric font-weight for DOM text set in `stack(role, han)`: the Latin alias's file weight (see weightOf). */
export function cssWeight(role: Role, weight: number, han: HanLang): number {
  return weightOf(role, weight, han);
}

/**
 * A canvas `ctx.font` value. The weight snaps to one that exists, so the browser never fakes a bold.
 * `o.latin: false` leaves the Latin alias out, for text with no Latin in it (a seal's 林文之印): Chrome loads a canvas font's first
 * family for its metrics whatever the characters, so a Han-only string set in the full stack would fetch an unused Latin file.
 */
export function canvasFont(role: Role, weight: number, px: number, han: HanLang, o: { latin?: boolean } = {}): string {
  const s = o.latin === false ? `"${hanFace(role, han)}", ${SYSTEM[han][role]}` : stack(role, han);
  return `${weightOf(role, weight, han)} ${Math.round(px * 100) / 100}px ${s}`;
}

/**
 * A ctx.font that never starts a download: Chrome fetches a registered web face the moment canvas text is set (or measured) in it,
 * so a painter whose print is not needed yet (inside a closed folio, on a sheet's back) paints with this first — the Latin alias only
 * when that file weight is loaded already (the page's own text loads 400 / 500), then the system faces — and with canvasFont once
 * it has asked ensureFonts for its strings.
 */
export function canvasFontLocal(role: Role, weight: number, px: number, han: HanLang, o: { latin?: boolean } = {}): string {
  const w = weightOf(role, weight, han);
  let latin = false;
  try {
    latin = o.latin !== false && typeof document !== "undefined" && !!document.fonts && registered && document.fonts.check(`${w} 16px "${LATIN[role]}"`, "a");
  } catch {
    latin = false;
  }
  return `${w} ${Math.round(px * 100) / 100}px ${latin ? `"${LATIN[role]}", ` : ""}${SYSTEM[han][role]}`;
}

/** Value for an element's `lang` attribute: the profile's own tag when it names the same Han script, else the script tag. */
export function htmlLang(han: HanLang, lang?: string): string {
  if (lang && /^(ja|zh)(-|$)/i.test(lang) && hanLangOf("", lang) === han) return lang;
  return han;
}

// ---- browser side: alias faces, lazy CSS, exact-string loads ----

export type FontRun = { role: Role; weight: number; text: string; han: HanLang };

const RANGE_LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const RANGE_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
/** The arrows of the Japanese faces' slices [107], [58] and [94] (↑ ↓ are in the Latin slice already). */
const RANGE_ARROW_R = "U+2192";
const RANGE_ARROW_D = "U+2194-2199,U+21B8-21B9,U+21C4-21C6,U+21CB-21CC,U+21D0,U+21E6-21E9,U+21F5";
const RANGE_ARROW_L = "U+2190";

/** [family, weight descriptor, file, unicode-range]. The hand alias answers 400–700 so WenKai's 400 and Klee's 600 share a weight. */
const ALIASES: [string, string, string, string][] = [
  [LATIN.serif, "400", serifLatin400, RANGE_LATIN],
  [LATIN.serif, "400", serifLatinExt400, RANGE_EXT],
  [LATIN.serif, "400", serifArrowR400, RANGE_ARROW_R],
  [LATIN.serif, "400", serifArrowD400, RANGE_ARROW_D],
  [LATIN.serif, "400", serifArrowL400, RANGE_ARROW_L],
  [LATIN.serif, "500", serifLatin500, RANGE_LATIN],
  [LATIN.serif, "500", serifLatinExt500, RANGE_EXT],
  [LATIN.serif, "500", serifArrowR500, RANGE_ARROW_R],
  [LATIN.serif, "500", serifArrowD500, RANGE_ARROW_D],
  [LATIN.serif, "500", serifArrowL500, RANGE_ARROW_L],
  [LATIN.serif, "600", serifLatin600, RANGE_LATIN],
  [LATIN.serif, "600", serifLatinExt600, RANGE_EXT],
  [LATIN.serif, "600", serifArrowR600, RANGE_ARROW_R],
  [LATIN.serif, "600", serifArrowD600, RANGE_ARROW_D],
  [LATIN.serif, "600", serifArrowL600, RANGE_ARROW_L],
  [LATIN.sans, "400", sansLatin400, RANGE_LATIN],
  [LATIN.sans, "400", sansLatinExt400, RANGE_EXT],
  [LATIN.sans, "400", sansArrowR400, RANGE_ARROW_R],
  [LATIN.sans, "400", sansArrowD400, RANGE_ARROW_D],
  [LATIN.sans, "400", sansArrowL400, RANGE_ARROW_L],
  [LATIN.sans, "500", sansLatin500, RANGE_LATIN],
  [LATIN.sans, "500", sansLatinExt500, RANGE_EXT],
  [LATIN.sans, "500", sansArrowR500, RANGE_ARROW_R],
  [LATIN.sans, "500", sansArrowD500, RANGE_ARROW_D],
  [LATIN.sans, "500", sansArrowL500, RANGE_ARROW_L],
  [LATIN.hand, "400 700", handLatin600, RANGE_LATIN],
  [LATIN.hand, "400 700", handLatinExt600, RANGE_EXT],
];

type Span = [number, number];
/** "U+0041-005A,U+00C0" → [[0x41, 0x5a], [0xc0, 0xc0]] */
export function parseRanges(r: string): Span[] {
  const out: Span[] = [];
  for (const part of r.split(",")) {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m) continue;
    if (m[1]!.includes("?")) out.push([parseInt(m[1]!.replace(/\?/g, "0"), 16), parseInt(m[1]!.replace(/\?/g, "f"), 16)]);
    else out.push([parseInt(m[1]!, 16), parseInt(m[2] ?? m[1]!, 16)]);
  }
  return out;
}
/** The ranges `r` minus the spans `cut`, as a unicode-range value ("" when nothing is left). */
export function subtractRanges(r: Span[], cut: Span[]): string {
  let cur = r.map(([a, b]) => [a, b] as Span);
  for (const [ca, cb] of cut) {
    const next: Span[] = [];
    for (const [a, b] of cur) {
      if (cb < a || ca > b) next.push([a, b]);
      else {
        if (a < ca) next.push([a, ca - 1]);
        if (b > cb) next.push([cb + 1, b]);
      }
    }
    cur = next;
  }
  const hex = (n: number) => n.toString(16);
  return cur.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(",");
}

/** Code points the alias faces cover (parsed once). */
const ALIAS_SPANS: Span[] = parseRanges([RANGE_LATIN, RANGE_EXT, RANGE_ARROW_R, RANGE_ARROW_D, RANGE_ARROW_L].join(","));
function isAliasChar(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  for (const [a, b] of ALIAS_SPANS) if (c >= a && c <= b) return true;
  return false;
}

let registered = false;
/** Adds the alias faces to document.fonts once. They are not fetched until text (DOM or a load below) needs them. */
function registerAliases(): void {
  if (registered || typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) return;
  registered = true;
  try {
    for (const [family, weight, url, range] of ALIASES) document.fonts.add(new FontFace(family, `url("${url}") format("woff2")`, { weight, style: "normal", display: "swap", unicodeRange: range }));
  } catch {
    // an engine without the FontFace API: the stacks fall through to the Han face's own Latin
  }
}
// The DOM uses the stacks before any painter asks, so the aliases exist from the first import.
registerAliases();

type HanSource = { css: string; files: Record<string, string> };

/**
 * The weight bands a Chinese face answers on a page in `pageLang` (the `<html lang>`): SC_FILES on a Chinese page; elsewhere the
 * first file alone for every weight, so the few Han characters of an English page (林文, 中文 in a list) fetch one set of slices.
 */
export function hanBands(role: Role, pageLang: string): readonly { file: number; weight: string }[] {
  return SC_FILES[role].length > 1 && !/^zh(-|$)/i.test(pageLang) ? [{ file: SC_FILES[role][0]!.file, weight: "100 900" }] : SC_FILES[role];
}

/** A registered Chinese face: its slices (file name → url, range) and the FontFace objects added per file weight. */
type HanFaces = { family: string; slices: { file: string; range: string }[]; byName: Map<string, string>; added: Map<number, FontFace[]> };
const hanFaces = new Map<Role, HanFaces>();
let langWatch: MutationObserver | null = null;

/** Adds (or re-weights) the faces of one file weight so the face answers `band`. */
function addBand(h: HanFaces, band: { file: number; weight: string }): void {
  const have = h.added.get(band.file);
  if (have) {
    // already in the set (and maybe loaded): only its weight band changes, nothing is fetched again
    for (const f of have) f.weight = band.weight;
    return;
  }
  const faces: FontFace[] = [];
  for (const { file, range } of h.slices) {
    // noto-sans-sc-88-300-normal.woff2 → the same slice of the 500 file (WenKai's subset files carry no weight)
    const url = h.byName.get(file.replace(/-\d+-normal\.woff2$/, `-${band.file}-normal.woff2`)) ?? h.byName.get(file);
    if (!url) continue;
    try {
      const f = new FontFace(h.family, `url("${url}") format("woff2")`, { weight: band.weight, style: "normal", display: "swap", unicodeRange: range });
      document.fonts.add(f);
      faces.push(f);
    } catch {
      // a face the engine refuses: the system faces in the stack set those characters
    }
  }
  h.added.set(band.file, faces);
}

/** The page's language changed (a language switch): every registered Chinese face takes the bands of the new one (hanBands). */
function retuneHan(): void {
  const lang = document.documentElement.lang;
  for (const [role, h] of hanFaces) {
    const bands = hanBands(role, lang);
    // the faces of a file no band uses any more leave the set (two faces answering the same weight would be a tie the browser breaks)
    for (const [file, faces] of h.added)
      if (!bands.some((b) => b.file === file)) {
        for (const f of faces) document.fonts.delete(f);
        h.added.delete(file);
      }
    for (const b of bands) addBand(h, b);
  }
  // a weight may now be set from another file: what ensureFonts loaded before says nothing about it
  loads.clear();
}

/**
 * A Chinese face from its (lazily imported) source: every numbered slice of each of its file weights (SC_FILES; the CSS lists one
 * weight's files, the others have the same slices under their own weight in the name), under the face's family name for that
 * weight band, its unicode-range minus what the alias faces set. Latin / Cyrillic / Vietnamese slices are not registered at all.
 * The bands follow the page's language (hanBands), also when it changes later: a language switch sets `<html lang>`, and the faces
 * registered for the other language are re-weighted in place (brief r4 E1).
 */
async function registerHan(role: Role, load: () => Promise<{ default: HanSource }>): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) return;
  const { css, files } = (await load()).default;
  const h: HanFaces = { family: HAN_FACE.zh[role], slices: [], byName: new Map(), added: new Map() };
  for (const [path, url] of Object.entries(files)) h.byName.set(path.slice(path.lastIndexOf("/") + 1), url);
  for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = m[1]!;
    const file = /url\(\s*['"]?\.\/files\/([^'")]+\.woff2)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;}]+)/.exec(body)?.[1];
    if (!file || !range) continue;
    const r = subtractRanges(parseRanges(range), ALIAS_SPANS);
    if (r) h.slices.push({ file, range: r });
  }
  hanFaces.set(role, h);
  for (const band of hanBands(role, document.documentElement.lang)) addBand(h, band);
  if (!langWatch && typeof MutationObserver !== "undefined" && SC_FILES[role].length > 1) {
    langWatch = new MutationObserver(retuneHan);
    langWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
}

/** The faces per (role, Han[, weight]). Static specifiers so Vite emits each as its own lazy chunk. */
const CSS: Record<string, () => Promise<unknown>> = {
  "serif-zh": () => registerHan("serif", () => import("./han-serif")),
  "sans-zh": () => registerHan("sans", () => import("./han-sans")),
  "hand-zh": () => registerHan("hand", () => import("./han-hand")),
  "serif-ja-400": () => import("@fontsource/shippori-mincho/400.css"),
  "serif-ja-500": () => import("@fontsource/shippori-mincho/500.css"),
  "serif-ja-600": () => import("@fontsource/shippori-mincho/600.css"),
  "sans-ja-400": () => import("@fontsource/zen-kaku-gothic-new/400.css"),
  "sans-ja-500": () => import("@fontsource/zen-kaku-gothic-new/500.css"),
  "hand-ja-600": () => import("@fontsource/klee-one/600.css"),
};
const cssLoads = new Map<string, Promise<void>>();
/** CSS that has been applied (its @font-face rules exist), so document.fonts.check() can be trusted for its family. */
const cssDone = new Set<string>();
function importCss(key: string): Promise<void> {
  let p = cssLoads.get(key);
  if (!p) {
    const load = CSS[key];
    p = (load ? load().then(() => undefined, () => undefined) : Promise.resolve()).then(() => {
      cssDone.add(key);
    });
    cssLoads.set(key, p);
  }
  return p;
}

/**
 * Registers the faces a page may set Han text in for this Han language, without downloading anything: the browser fetches a
 * unicode-range slice only when text on screen needs it (for DOM strings no component lists in a run: a label, a date, a link).
 * ja: the Shippori Mincho / Zen Kaku Gothic New weight CSS (and Klee One 600 with "hand"); zh-Hans / zh-Hant: Noto Serif SC, Noto
 * Sans SC and LXGW WenKai, at their file weights (SC_FILES: a slice of the sans's 500 file downloads only for text set at 500). Use this instead of importing a CJK face's CSS directly: the
 * fontsource CSS of the Chinese faces registers every slice (Latin ones too) at its own weight, which multiplies the bytes.
 */
export function registerFaces(han: HanLang, roles: readonly Role[] = ["serif", "sans"]): Promise<void> {
  registerAliases();
  const keys: string[] = [];
  for (const role of roles) {
    if (han !== "ja") keys.push(`${role}-zh`);
    else if (role === "serif") keys.push("serif-ja-400", "serif-ja-500", "serif-ja-600");
    else if (role === "sans") keys.push("sans-ja-400", "sans-ja-500");
    else keys.push("hand-ja-600");
  }
  return Promise.all(keys.map(importCss)).then(() => undefined);
}

/** One run split into what the alias face sets and what the Han face sets: [font spec, chars, css key | null]. */
function parts(r: FontRun): [string, string, string | null][] {
  const w = weightOf(r.role, r.weight, r.han);
  let latin = "";
  let rest = "";
  for (const ch of new Set(Array.from(r.text))) {
    if (/\s/.test(ch)) continue;
    if (isAliasChar(ch)) latin += ch;
    else rest += ch;
  }
  const out: [string, string, string | null][] = [];
  if (latin) out.push([`${w} 16px "${LATIN[r.role]}"`, latin, null]);
  // the Chinese faces are one registration per role (all its file weights), whatever the weight
  if (rest) out.push([`${w} 16px "${hanFace(r.role, r.han)}"`, rest, r.han === "ja" ? `${r.role}-ja-${w}` : `${r.role}-zh`]);
  return out;
}

/**
 * True when every face the runs need is loaded now, so a painter that painted already can skip its second paint. (A family whose
 * CSS has not been applied yet is unknown to document.fonts.check(), which would call it ready: such runs count as not loaded.)
 */
export function fontsLoadedFor(runs: FontRun[]): boolean {
  if (typeof document === "undefined" || !document.fonts) return true;
  registerAliases();
  try {
    for (const r of runs) for (const [spec, text, css] of parts(r)) {
      if (css && !cssDone.has(css)) return false;
      if (!document.fonts.check(spec, text)) return false;
    }
  } catch {
    return true;
  }
  return true;
}

const loads = new Map<string, Promise<void>>();
/**
 * Loads exactly the faces (and unicode-range slices) the runs' strings need: imports the CSS a Han run needs first, then
 * `document.fonts.load(spec, text)`. Never rejects; resolves when every requested face has loaded or failed.
 */
export function ensureFonts(runs: FontRun[]): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  registerAliases();
  const jobs: Promise<void>[] = [];
  for (const r of runs)
    for (const [spec, text, css] of parts(r)) {
      const key = `${spec}|${text}`;
      let p = loads.get(key);
      if (!p) {
        p = (css ? importCss(css) : Promise.resolve()).then(() => document.fonts.load(spec, text)).then(
          () => undefined,
          () => undefined,
        );
        loads.set(key, p);
      }
      jobs.push(p);
    }
  return Promise.all(jobs).then(() => undefined);
}
