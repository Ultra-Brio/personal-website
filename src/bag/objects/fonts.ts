/*
 * The pouch's print is set through src/fonts (Shippori Mincho, Zen Kaku Gothic New, Klee One; Noto SC / LXGW WenKai for Chinese).
 * Canvas text never triggers a web-font fetch, so every object lists the strings it prints (BuiltObject.fonts) and the addon loads
 * exactly those glyphs: objects are painted at once with whatever is loaded and painted again when the rest arrives.
 */
import { ensureFonts, fontsLoadedFor, type FontRun } from "../../fonts";
import type { FontStacks } from "./types";

/** @deprecated The stacks are src/fonts' now; kept so hosts that still pass `font` keep compiling. */
export const PRINT_FONT: FontStacks = { serif: "", sans: "", mono: "" };

/**
 * Null when every face the runs need is loaded already; otherwise a promise that settles once they have loaded (or failed).
 * Requests the faces either way.
 */
export function printFontsPending(runs: FontRun[]): Promise<void> | null {
  if (typeof document === "undefined" || !document.fonts) return null;
  const ready = fontsLoadedFor(runs);
  const p = ensureFonts(runs);
  return ready ? null : p;
}
