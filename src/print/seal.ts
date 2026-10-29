/*
 * 落款: the owner's square 朱文 seal, the one seal printed in the folio (the bookplate on the liner) (owner 2026-10-24).
 * Four glyphs in a 2 × 2 grid read right column first (林 文 / 之 印), standing in 藍 lines inside a frame of about the same weight
 * (FRAME), with a few chips in the frame, unevenly inked (starved specks), then pressed onto the paper with multiply at α .9, turned
 * −2°. Never shown in the DOM.
 * The glyphs are cut in small seal script (小篆) when the profile carries them (profile/seal.ts, `bun run seal`): each stretched
 * to fill its cell as a seal cutter does (within STRETCH of its own proportions: further would fatten its cross strokes) and its
 * lines evened out a little; a 3-glyph seal gives the left column to its last glyph, a 2-glyph seal a column each. Otherwise they
 * are set in the serif.
 *
 * The painter must have the glyphs' face loaded before it presses a typeset seal: `ensureFonts([sealRun(chars, han)])`, then repaint.
 */
import { canvasFont as canvasFontWeb, canvasFontLocal, hanLangOf, type FontRun, type HanLang } from "../fonts";
import type { SealArt } from "../profile/schema";

export const SEAL_INK = "#2f4f73";

/** Grid cells, read right column first: top right, bottom right, top left, bottom left (fractions of the seal). */
const CELLS: [number, number][] = [
  [0.72, 0.29],
  [0.72, 0.71],
  [0.28, 0.29],
  [0.28, 0.71],
];

/** Small seal glyphs: how far a glyph may be stretched out of its own proportions to fill its cell, and the stroke thickening (of the seal) */
const STRETCH = 1.6;
const ZHUAN_WEIGHT = 0.01;
/** The frame's weight (of the seal) */
const FRAME = 0.035;

/** The cells of a small seal script seal for n glyphs (fractions of the seal: x, y, w, h), read right column first */
function zhuanCells(n: number): [number, number, number, number][] {
  const m = 0.075;
  const c = (1 - 2 * m - 0.04) / 2;
  const r = 1 - m - c;
  const h = 1 - 2 * m;
  if (n >= 4) return [[r, m, c, c], [r, r, c, c], [m, m, c, c], [m, r, c, c]];
  if (n === 3) return [[r, m, c, c], [r, r, c, c], [m, m, c, h]];
  if (n === 2) return [[r, m, c, h], [m, m, c, h]];
  return [[m, m, h, h]];
}

/**
 * The glyphs a seal carries: a 2-character name gives [c0, c1, 之, 印]; 3 give [c0, c1, c2, 印]; 4 are used as they are (longer names
 * keep their first four). A 1-character name, or no local name at all (then the Latin initials, e.g. "LW"), is one centred monogram.
 * A `nameLatin` written in Han characters (林文, with no nameLocal) counts as the local name.
 */
export function sealChars(nameLocal: string | undefined, nameLatin: string): string[] {
  const c = Array.from((sealName(nameLocal, nameLatin) ?? "").replace(/\s+/g, ""));
  if (c.length >= 4) return c.slice(0, 4);
  if (c.length === 3) return [...c, "印"];
  if (c.length === 2) return [...c, "之", "印"];
  if (c.length === 1) return c;
  const words = nameLatin.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return [(first + last).toUpperCase() || "○"];
}

/** The name a seal is cut from: the local name, or a name written in Han characters (a Chinese profile leaves nameLocal empty) */
export function sealName(nameLocal: string | undefined, nameLatin: string): string | undefined {
  return !nameLocal && /\p{Script=Han}/u.test(nameLatin) && !/[A-Za-z]/.test(nameLatin) ? nameLatin : nameLocal;
}

/** The profile's small seal glyphs when they were cut from this name (scripts/seal.ts), else null: the seal is typeset */
export function sealArtFor(art: SealArt | null | undefined, nameLocal: string | undefined, nameLatin: string): SealArt | null {
  const name = sealName(nameLocal, nameLatin)?.replace(/\s+/g, "");
  return art && name && art.name === name && art.glyphs.length ? art : null;
}

/** The font run a seal needs loaded (Mincho 600 in the glyphs' own Han face). */
export function sealRun(chars: string[], han?: HanLang): FontRun {
  const text = chars.join("");
  return { role: "serif", weight: 600, text, han: han ?? hanLangOf(text) };
}

/**
 * Presses the seal centred at (cx, cy), `sizePx` square. `han` picks the glyphs' face (default: from the glyphs themselves, so a
 * Chinese name is cut in Noto Serif SC and a kana name in Shippori Mincho).
 */
export function sealSquare(g: CanvasRenderingContext2D, cx: number, cy: number, sizePx: number, chars: string[], ink = SEAL_INK, han?: HanLang, local = false, art: SealArt | null = null): void {
  // `local`: cut with the faces already in (no download) — a first paint inside a closed folio (see canvasFontLocal)
  const canvasFont = local ? canvasFontLocal : canvasFontWeb;
  if (typeof document === "undefined" || sizePx <= 0) return;
  const n = Math.max(8, Math.ceil(sizePx));
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const h = c.getContext("2d");
  if (!h) return;
  // 朱文: the frame and the glyphs stand in ink on the bare paper
  const fw = n * FRAME;
  h.strokeStyle = ink;
  h.lineWidth = fw;
  h.beginPath();
  h.roundRect(fw / 2, fw / 2, n - fw, n - fw, n * 0.025);
  h.stroke();
  h.textAlign = "center";
  h.textBaseline = "middle";
  h.fillStyle = ink;
  const face = han ?? hanLangOf(chars.join(""));
  // Han glyphs only: no Latin alias in the stack (it would be fetched for nothing, see canvasFont)
  const latin = !chars.every((c) => /^\p{Script=Han}+$/u.test(c));
  if (art) {
    // small seal script: each glyph's outline fills its cell (see the header)
    const cells = zhuanCells(Math.min(4, art.glyphs.length));
    h.lineJoin = "miter";
    h.miterLimit = 2;
    art.glyphs.slice(0, 4).forEach((gl, i) => {
      const [x, y, w, hh] = cells[i]!.map((v) => v * n) as [number, number, number, number];
      const [bx, by, bw, bh] = gl.box;
      let sx = w / bw;
      let sy = hh / bh;
      if (sx > sy * STRETCH) sx = sy * STRETCH;
      else if (sy > sx * STRETCH) sy = sx * STRETCH;
      h.save();
      h.translate(x + (w - bw * sx) / 2, y + (hh - bh * sy) / 2);
      h.scale(sx, sy);
      h.translate(-bx, -by);
      const p = new Path2D(gl.d);
      h.lineWidth = (n * ZHUAN_WEIGHT) / Math.min(sx, sy);
      h.fill(p);
      h.stroke(p);
      h.restore();
    });
  } else if (chars.length === 1) {
    // a monogram: one glyph (or the Latin initials) filling the square's middle
    const text = chars[0]!;
    let px = n * (Array.from(text).length > 1 ? 0.44 : 0.62);
    h.font = canvasFont("serif", 600, px, face, { latin });
    const w = h.measureText(text).width;
    if (w > n * 0.74) {
      px *= (n * 0.74) / w;
      h.font = canvasFont("serif", 600, px, face, { latin });
    }
    h.fillText(text, n / 2, n / 2 + px * 0.04);
  } else {
    const cell = n * 0.37;
    h.font = canvasFont("serif", 600, cell, face, { latin });
    chars.slice(0, 4).forEach((ch, i) => {
      const [x, y] = CELLS[i]!;
      h.fillText(ch, x * n, y * n + cell * 0.04);
    });
  }
  // starved specks: the ink did not take everywhere (paper showing through the lines)
  h.globalCompositeOperation = "destination-out";
  let s = 4711;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 220; i++) {
    h.globalAlpha = 0.12 + rnd() * 0.4;
    h.beginPath();
    h.arc(rnd() * n, rnd() * n, n * (0.004 + rnd() * rnd() * 0.018), 0, 7);
    h.fill();
  }
  // the stone's edge: a few chips where it broke (崩边), shallow bites of uneven width and depth into the frame
  h.globalAlpha = 1;
  for (let i = 0; i < 14; i++) {
    const t = rnd() * 4;
    const side = Math.floor(t);
    const a = (t - side) * n;
    const w = n * (0.012 + rnd() * 0.035);
    const d = n * (0.006 + rnd() * rnd() * 0.024);
    const at = (along: number, depth: number): [number, number] => (side === 0 ? [along, depth] : side === 1 ? [n - depth, along] : side === 2 ? [along, n - depth] : [depth, along]);
    h.beginPath();
    h.moveTo(...at(a - w / 2, -1));
    h.lineTo(...at(a - w * 0.15, d * (0.6 + rnd() * 0.4)));
    h.lineTo(...at(a + w * (0.1 + rnd() * 0.2), d));
    h.lineTo(...at(a + w / 2, -1));
    h.fill();
  }
  g.save();
  g.translate(cx, cy);
  g.rotate((-2 * Math.PI) / 180);
  g.globalAlpha = 0.9;
  g.globalCompositeOperation = "multiply";
  g.drawImage(c, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
  g.restore();
}
