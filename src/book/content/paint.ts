/* Small canvas helpers shared by the content painters (cards.ts, postcards.ts). mm units unless said otherwise. */
import { canvasFont, canvasFontLocal, type HanLang, type Role } from "../../fonts";

/**
 * The content's print uses the web faces only once a book has asked for them (grid.ts, after its first complete paint): until then
 * the faces paint with canvasFontLocal, which never starts a download (Chrome fetches a registered face as soon as canvas text is set
 * in it), so the booklet's first paint does not pay for the 和色 kanji, 郵便はがき or the handwriting. The engine repaints after.
 */
let printWeb = false;
/** Switch the content's print to the web faces (once). */
export function usePrintWeb(): void {
  printWeb = true;
}
/** True once a book has switched the content's print to the web faces (a content made after that loads its faces at once). */
export function printWebOn(): boolean {
  return printWeb;
}
/** ctx.font for the content's print: canvasFont, or canvasFontLocal before usePrintWeb(). */
export function printFont(role: Role, weight: number, px: number, han: HanLang): string {
  return (printWeb ? canvasFont : canvasFontLocal)(role, weight, px, han);
}

export type RGB = [number, number, number];

const parsed = new Map<string, RGB>();
let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour → sRGB 0–255 (via a 1×1 canvas; cached). Falls back to a mid grey. */
export function rgbOf(css: string | null | undefined, fallback = "#b4b9be"): RGB {
  const key = css || fallback;
  const hit = parsed.get(key);
  if (hit) return hit;
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true })!;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = key;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  const out: RGB = [d[0]!, d[1]!, d[2]!];
  parsed.set(key, out);
  return out;
}

export const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c.map(Math.round).join(",")})` : `rgba(${c.map(Math.round).join(",")},${a})`);
/** Linear mix in sRGB (good enough for tints) */
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const WHITE: RGB = [255, 255, 255];
export const BLACK: RGB = [0, 0, 0];
/** Relative luminance 0–1 */
export function luma(c: RGB) {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function toHsl(c: RGB): [number, number, number] {
  const [r, g, b] = c.map((v) => v / 255) as RGB;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - C / 2;
  const [r1, g1, b1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}
/** Rotate the hue (degrees), same saturation and lightness: a second, related tint */
export function hueShift(c: RGB, deg: number): RGB {
  const [h, s, l] = toHsl(c);
  return fromHsl((h + deg + 360) % 360, s, l);
}
/** Scale the saturation (and optionally set the lightness), clamped */
export function tone(c: RGB, sat: number, light?: number): RGB {
  const [h, s, l] = toHsl(c);
  return fromHsl(h, Math.min(1, s * sat), Math.min(1, Math.max(0, light ?? l)));
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/** 0–1 deterministic noise */
export function rand(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

let grainTile: HTMLCanvasElement | null = null;
/** A fine grain pattern at one tile pixel per canvas pixel, whatever the current scale */
export function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (!grainTile) {
    const n = 96;
    grainTile = Object.assign(document.createElement("canvas"), { width: n, height: n });
    const g = grainTile.getContext("2d")!;
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = rand(i * 0.917 + 3.1) * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const p = ctx.createPattern(grainTile, "repeat")!;
  const a = ctx.getTransform().a || 1;
  p.setTransform(new DOMMatrix([1 / a, 0, 0, 1 / a, 0, 0]));
  return p;
}

/** Canvas letterSpacing where supported (a no-op elsewhere) */
export function track(ctx: CanvasRenderingContext2D, mm: number) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${mm}px`;
}

/** Sets `weight size font`, shrinking the size until `text` fits `max` (mm); returns the size */
export function fit(ctx: CanvasRenderingContext2D, text: string, weight: number | string, size: number, max: number, font: string) {
  let s = size;
  ctx.font = `${weight} ${s}px ${font}`;
  while (s > 1.2 && ctx.measureText(text).width > max) {
    s *= 0.94;
    ctx.font = `${weight} ${s}px ${font}`;
  }
  return s;
}

/** Draws `img` to cover the rect (centre crop) */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || 1;
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 1;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** Serif and handwriting stacks (system fonts only; no font ships with the repo) */
export const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", serif';
export const HAND = '"Bradley Hand", "Segoe Print", "Chalkboard SE", Noteworthy, "Marker Felt", "Kaiti SC", STKaiti, KaiTi, cursive';
export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace';
