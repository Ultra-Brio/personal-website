import { useEffect } from "react";
import { cssWeight, ensureFonts, hanLangOf, htmlLang, profileHan, registerFaces, stack, type FontRun, type HanLang, type Role } from "../fonts";
import type { Profile } from "../profile/schema";
import type { Dict } from "./i18n";
import shipporiLatin500 from "@fontsource/shippori-mincho/files/shippori-mincho-latin-500-normal.woff2?url";
import zenKakuLatin400 from "@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-400-normal.woff2?url";

/*
 * The page's faces in the DOM (spec §1.3, brief O4). src/fonts decides every stack; this file only puts them on the page:
 *   --mincho  Shippori Mincho (serif)      --gothic  Zen Kaku Gothic New (sans)      --hand  Klee One (handwriting)
 * Latin always comes from the Japanese faces (src/fonts registers their Latin slices as alias families, first in every stack), so
 * English reads the same in every language. Han glyphs follow the text: kana → Japanese faces, Chinese → Noto Serif / Sans SC and
 * LXGW WenKai. The root stacks follow the profile (`profileHan`); an element holding a string in another Han language carries
 * `data-han` and switches its own stack (app.css), plus a `lang` attribute.
 *
 * Nothing CJK is fetched until a string needs it: components call `useFontRuns` with the exact strings they show, which imports
 * the CSS for that face (fontsource's unicode-range slices) and loads only the slices those characters live in.
 */

export type { HanLang, Role } from "../fonts";
const HANS: HanLang[] = ["ja", "zh-Hans", "zh-Hant"];
const ROLES: [Role, string][] = [
  ["serif", "mincho"],
  ["sans", "gothic"],
  ["hand", "hand"],
];

/** Puts every stack on <html>: the profile's own (--mincho, --gothic, --hand) and one set per Han language (--mincho-ja …). */
export function applyFontVars(han: HanLang): void {
  const s = document.documentElement.style;
  for (const h of HANS) for (const [role, name] of ROLES) s.setProperty(`--${name}-${h}`, stack(role, h));
  for (const [role, name] of ROLES) s.setProperty(`--${name}`, stack(role, han));
  s.setProperty("--gw4", String(cssWeight("sans", 400, han)));
  s.setProperty("--gw5", String(cssWeight("sans", 500, han)));
}

/** The two Latin files every first paint needs (§1.3), preloaded from the entry script so they race the CSS. */
export function preloadLatin(): void {
  for (const href of [shipporiLatin500, zenKakuLatin400]) {
    if (document.querySelector(`link[rel="preload"][href="${href}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "preload";
    l.as = "font";
    l.type = "font/woff2";
    l.crossOrigin = "anonymous";
    l.href = href;
    document.head.appendChild(l);
  }
}

const HAN = /[⺀-⿟々-〇〡-〩぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/;
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}
/**
 * Registers every face the DOM sets Han text in (§1.3), through src/fonts (@font-face rules only, nothing downloads yet): the
 * browser fetches a unicode-range slice only when text on screen needs it, at the weight it is set in. useFontRuns loads a
 * component's exact strings early; this is what keeps a string nobody listed (a label, a date, a link) from falling to a system
 * face or a neighbouring weight. The Japanese faces always (the chrome's local titles, 郵便はがき, 一筆箋); the SC faces only when
 * the page sets Han text in them (Chinese chrome, or the profile's own Han words outside Japanese); handwriting stays with
 * useFontRuns.
 */
export function loadDomFaces(profile: { lang?: string }, zhChrome: boolean): void {
  void registerFaces("ja");
  const sc = new Set<HanLang>(zhChrome ? ["zh-Hans"] : []);
  for (const s of strings(profile)) if (hasHan(s)) sc.add(hanLangOf(s, profile.lang));
  sc.delete("ja");
  for (const h of sc) void registerFaces(h);
}

/** Does a string hold any CJK character at all (anything the Latin alias faces cannot set)? */
export const hasHan = (s: string) => HAN.test(s);

/**
 * Props for an element that sets the person's own words (or a Japanese / Chinese chrome string): its `lang`, and `data-han`
 * when its Han face differs from the root's. Put them on the element that declares the font.
 */
export function textProps(text: string, lang: string | undefined, rootHan: HanLang): { lang: string; "data-han"?: HanLang } {
  if (!hasHan(text)) return { lang: lang && !/^(zh|ja)(-|$)/i.test(lang) ? lang : "en" };
  const h = hanLangOf(text, lang);
  return h === rootHan ? { lang: htmlLang(h, lang) } : { lang: htmlLang(h, lang), "data-han": h };
}

/** A run for ensureFonts, or nothing when the strings hold no Han (the Latin aliases load by themselves). */
export function run(role: Role, weight: number, han: HanLang, ...texts: (string | undefined | null | false)[]): FontRun[] {
  const text = texts.filter((t): t is string => !!t).join(" ");
  return hasHan(text) ? [{ role, weight, text, han }] : [];
}

/**
 * Every string the desk's words set for a profile and its chrome (the identity, the bio, the booklets, the handling lines, the
 * printed controls, the colophon, the hashira), as the components ask for them: a language switch (App) loads these before the new
 * words are shown, so none of them paints in a fallback face first.
 */
export function pageRuns(p: Profile, t: Dict): FontRun[] {
  const han = profileHan(p);
  const ch: HanLang = t.lang === "zh" ? "zh-Hans" : "ja";
  const c = t.controls;
  const booklets = Object.values(t.booklet);
  return [
    ...run("serif", 500, han, p.nameLocal, p.name),
    ...run("sans", 400, han, p.role, p.location),
    ...run("serif", 400, han, p.bio),
    ...run("sans", 500, han, t.colophon.email, ...p.links.map((l) => l.label)),
    ...run("serif", 400, ch, ...booklets.map((b) => b.name)),
    ...run("serif", 500, ch, ...booklets.map((b) => b.local)),
    ...run("sans", 400, ch, t.handling.resume, t.handling.cards, t.handling.postcards(p.albums.postcards.length), t.handling.closed, t.hint.resume, t.hint.cards, t.hint.postcards, t.hint.closed),
    ...run("sans", 500, ch, c.open, c.close, c.closeFolio, c.closeFolioShort, c.shake, c.tilt, t.profile.open, t.case.label, ...Object.values(t.case.material), t.colophon.sound, t.colophon.on, t.colophon.off, t.colophon.textVersion, t.colophon.source),
  ];
}

/** Load exactly these strings' faces (once per distinct set). The DOM paints at once with whatever is there (font-display swap). */
export function useFontRuns(runs: FontRun[]): void {
  const key = runs.map((r) => `${r.role}${r.weight}${r.han}:${r.text}`).join("|");
  useEffect(() => {
    if (runs.length) void ensureFonts(runs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the strings themselves
  }, [key]);
}
