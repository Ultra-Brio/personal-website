/*
 * The print faces of the paper viewer, through src/fonts: Shippori Mincho (serif) and Zen Kaku Gothic New (sans), with the SC faces
 * for Chinese text. Canvas text never triggers a web-font load, so the painters call loadPrintFonts() with the strings they will print
 * first: it loads exactly the glyphs (unicode-range slices) those strings need and resolves when they are in (or after a timeout, so a
 * slow network never blocks the viewer; `late` then resolves when they do arrive and the viewer repaints once).
 *
 * Imported by viewer.ts only: typeset.ts stays free of DOM loading so its layout is unit-tested with bun.
 */
import { ensureFonts, hanLangOf, type FontRun, type Role } from "../fonts";

/** The faces the résumé and the card are painted with (role, weight) */
const FACES: [Role, number][] = [
  ["serif", 400],
  ["serif", 500],
  ["serif", 600],
  ["sans", 400],
  ["sans", 500],
];

export type PrintFonts = {
  /** resolves true when every face is in, false after the timeout (the painters then use the fallbacks) */
  ready: Promise<boolean>;
  /** resolves when every face is in, however long that takes (never rejects) */
  late: Promise<boolean>;
};

/** The runs for a set of strings: grouped by the Han faces each string needs, in every face the print uses. */
export function printRuns(texts: readonly (string | undefined)[], lang?: string): FontRun[] {
  const groups = new Map<string, string>();
  for (const t of texts) {
    if (!t || !t.trim()) continue;
    const han = hanLangOf(t, lang);
    // capitals are printed too (running heads, labels)
    groups.set(han, `${groups.get(han) ?? ""}${t}${t.toUpperCase()}`);
  }
  const runs: FontRun[] = [];
  for (const [han, text] of groups) for (const [role, weight] of FACES) runs.push({ role, weight, text, han: han as FontRun["han"] });
  return runs;
}

export function loadPrintFonts(texts: readonly (string | undefined)[], lang?: string, timeout = 2500): PrintFonts {
  if (typeof document === "undefined" || !document.fonts) {
    const no = Promise.resolve(false);
    return { ready: no, late: no };
  }
  const late = ensureFonts(printRuns(texts, lang)).then(
    () => true,
    () => false,
  );
  const ready = Promise.race([late, new Promise<boolean>((r) => window.setTimeout(() => r(false), timeout))]);
  return { ready, late };
}
