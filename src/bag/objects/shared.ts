/*
 * Shared helpers for the procedural pouch objects: deterministic PRNG, resource tracking (dispose() must free everything),
 * a tiny refcounted cache for textures several objects share, canvas drawing / text helpers, noise + normal-map baking,
 * and the silhouette contact-shadow texture. Pure three + 2D canvas, no assets.
 */
import * as THREE from "three";
import { canvasFont, canvasFontLocal, hanLangOf, type FontRun, type HanLang, type Role } from "../../fonts";
import { wrapUnits, type WrapOptions } from "../../print/kinsoku";
import type { ObjectCtx } from "./types";

export type V2 = readonly [number, number];

/* ---------- determinism ---------- */

/** FNV-1a string hash -> uint32. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, seedable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- resource tracking ---------- */

type Disposable = { dispose(): void };

/** Collects everything an object allocates so dispose() can free it in one call. */
export class Tracker {
  private items: Disposable[] = [];
  private frees: (() => void)[] = [];

  add<T extends Disposable>(x: T): T {
    this.items.push(x);
    return x;
  }

  /** A material and every texture it references (textures obtained from `acquire` are clones; the shared base is released separately). */
  material<T extends THREE.Material>(m: T): T {
    this.items.push(m);
    for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) this.items.push(v as THREE.Texture);
    return m;
  }

  /** Run on dispose (e.g. a cache release). */
  onFree(fn: () => void) {
    this.frees.push(fn);
  }

  dispose() {
    for (const it of this.items) it.dispose();
    for (const fn of this.frees) fn();
    this.items = [];
    this.frees = [];
  }
}

const cache = new Map<string, { value: unknown; refs: number; free: () => void }>();

/** Refcounted shared resource: the factory runs for the first user; `free` runs when the last user releases. */
export function acquire<T>(key: string, make: () => { value: T; free: () => void }): { value: T; release: () => void } {
  let e = cache.get(key);
  if (!e) {
    const m = make();
    e = { value: m.value, refs: 0, free: m.free };
    cache.set(key, e);
  }
  e.refs++;
  const entry = e;
  let released = false;
  return {
    value: entry.value as T,
    release() {
      if (released) return;
      released = true;
      if (--entry.refs <= 0) {
        entry.free();
        cache.delete(key);
      }
    },
  };
}

/** Number of live shared resources (tests / leak checks). */
export function sharedCount() {
  return cache.size;
}

/* ---------- the window's sun ---------- */

let depthNone: THREE.MeshDepthMaterial | null = null;
/**
 * The depth material of a mesh that only receives: it writes nothing. Three draws every `receiveShadow` mesh into a VSM shadow map
 * (as if it cast), so without it the front film would shade everything under it, a flexing card (bent in its vertex shader, flat
 * in three's depth pass) would shade itself, and each object would cast a second, symmetric halo onto the film beside the contact
 * shadow it draws itself. three sets `alphaTest`, `map` and `alphaMap` on a custom depth material from the mesh's own material
 * before every draw; a flip of `alphaTest` across 0 bumps the material's version (a program switch per draw), so those are pinned.
 */
function noDepth(): THREE.MeshDepthMaterial {
  if (depthNone) return depthNone;
  const m = new THREE.MeshDepthMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  m.name = "bag-receive-only";
  for (const k of ["alphaTest", "map", "alphaMap", "displacementMap"] as const) {
    const v = k === "alphaTest" ? 0 : null;
    Object.defineProperty(m, k, { get: () => v, set: () => {}, configurable: true });
  }
  depthNone = m;
  return m;
}

/**
 * Every mesh under `o` takes the host's sun shadow (the window's bars and leaves fall on the pouch and its print, with parallax) and
 * casts none of its own into it: the pouch draws its own contact shadows. The contact-shadow quads are left alone.
 */
export function receiveSun(o: THREE.Object3D): void {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh || m.name === "contact-shadow") return;
    m.receiveShadow = true;
    m.castShadow = false;
    m.customDepthMaterial = noDepth();
  });
}

/* ---------- canvas ---------- */

/** ObjectCtx.printScale, clamped to 1 … 1.6. */
export function printScaleOf(ctx: Pick<ObjectCtx, "printScale">): number {
  const k = ctx.printScale ?? 1;
  return Number.isFinite(k) ? Math.min(1.6, Math.max(1, k)) : 1;
}

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d", { willReadFrequently: false });
  if (!g) throw new Error("2D canvas unavailable");
  return { c, g };
}

/** Colour canvas -> sRGB texture with mipmaps and the requested anisotropy. */
export function colorTexture(c: HTMLCanvasElement, ctx: Pick<ObjectCtx, "anisotropy">): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ctx.anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Data canvas (normal / bump / roughness / mask) -> linear texture. */
export function dataTexture(c: HTMLCanvasElement, ctx: Pick<ObjectCtx, "anisotropy">, wrap = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = ctx.anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/* ---------- fonts / text ---------- */

/*
 * Every string is set through src/fonts: the role (serif = Shippori Mincho, sans = Zen Kaku Gothic New, hand = Klee One) and the Han
 * faces the string needs (`hanLangOf(text, lang)`: kana → Japanese faces; Chinese → Noto SC / LXGW WenKai). Latin always comes from the
 * Japanese faces. The painters list what they print (FontRun) so the addon can load exactly those glyphs and paint again.
 */

export type TextOpts = {
  role: Role;
  px: number;
  weight?: number;
  color: string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  /** letter spacing in px */
  ls?: number;
  /** shrink the font so the text is at most this wide (px) */
  maxW?: number;
  alpha?: number;
  /** the Han faces; default hanLangOf(text, lang) */
  han?: HanLang;
  /** the profile's language (Profile.lang), for hanLangOf */
  lang?: string;
};

type FontOpts = Pick<TextOpts, "role" | "weight" | "han" | "lang" | "ls">;

/**
 * The pouch's print uses the web faces only once the addon has asked for them (the cover starts to open) and they have arrived: until
 * then every object paints with canvasFontLocal, which never starts a download (Chrome fetches a registered face as soon as canvas text
 * is set in it), so the folio's first paint does not pay for the handwriting, 一筆箋 or the Org's 600. The addon repaints everything after.
 */
let printWeb = false;
/** Switch the pouch's print to the web faces (once; see printWeb). */
export function usePrintWeb(): void {
  printWeb = true;
}
/** True once the pouch's print is set in the web faces. */
export function printWebOn(): boolean {
  return printWeb;
}

export function setFont(g: CanvasRenderingContext2D, o: FontOpts, px: number, text: string) {
  g.font = (printWeb ? canvasFont : canvasFontLocal)(o.role, o.weight ?? 400, px, o.han ?? hanLangOf(text, o.lang));
}

/** Draw a single line; returns the font size actually used. */
export function drawText(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts): number {
  let px = o.px;
  g.save();
  g.textAlign = o.align ?? "left";
  g.textBaseline = o.base ?? "alphabetic";
  if ("letterSpacing" in g) g.letterSpacing = `${o.ls ?? 0}px`;
  setFont(g, o, px, s);
  if (o.maxW) {
    const w = g.measureText(s).width;
    if (w > o.maxW) {
      px = px * (o.maxW / w);
      setFont(g, o, px, s);
      if ("letterSpacing" in g) g.letterSpacing = `${(o.ls ?? 0) * (o.maxW / w)}px`;
    }
  }
  g.fillStyle = o.color;
  g.globalAlpha = o.alpha ?? 1;
  g.fillText(s, x, y);
  g.restore();
  return px;
}

export function measure(g: CanvasRenderingContext2D, s: string, o: FontOpts, px: number): number {
  g.save();
  setFont(g, o, px, s);
  if ("letterSpacing" in g) g.letterSpacing = `${o.ls ?? 0}px`;
  const w = g.measureText(s).width;
  g.restore();
  return w;
}

/** Small tracked capitals are for Latin micro-labels only: Han text is never "capitalised" (it has no case anyway, but no tracking either). */
export function caps(s: string): string {
  return s.toUpperCase();
}

/** The font runs a painter needs for these strings in one role and weight (for ensureFonts). */
export function runsOf(role: Role, weight: number, texts: (string | undefined)[], lang?: string, han?: HanLang): FontRun[] {
  const out: FontRun[] = [];
  for (const t of texts) if (t && t.trim()) out.push({ role, weight, text: t, han: han ?? hanLangOf(t, lang) });
  return out;
}

/**
 * Wrap into at most `maxLines` lines no wider than `maxW` (px), shrinking the size until it fits. Latin breaks at spaces, CJK between
 * characters with kinsoku (no line starts with ，。」 or ends with 「). `wrap.balance` evens the lines out (see wrapUnits).
 */
export function wrapText(g: CanvasRenderingContext2D, text: string, o: FontOpts, px: number, maxW: number, maxLines: number, wrap: WrapOptions = {}): { lines: string[]; px: number } {
  for (let size = px; size > px * 0.45; size *= 0.95) {
    const lines = wrapUnits(text, maxW, (s) => measure(g, s, o, size), wrap);
    if (lines.length <= maxLines && lines.every((l) => measure(g, l, o, size) <= maxW * 1.04)) return { lines, px: size };
  }
  return { lines: wrapUnits(text, maxW, (s) => measure(g, s, o, px * 0.45)).slice(0, maxLines), px: px * 0.45 };
}

/* ---------- pictures ---------- */

const decoded = new Map<string, Promise<HTMLImageElement>>();
/**
 * A picture, loaded and decoded once per URL for every user (the pouch's object and its lightbox snapshot paint the same pixels).
 * Rejects when it fails to load; the failure is not cached, so a later call tries again.
 */
export function decodedImage(src: string): Promise<HTMLImageElement> {
  let p = decoded.get(src);
  if (!p) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = src;
    p = img.decode().then(
      () => img,
      (e: unknown) => {
        decoded.delete(src);
        throw e instanceof Error ? e : new Error(`could not load ${src}`);
      },
    );
    decoded.set(src, p);
  }
  return p;
}

/** Fill a polygon given in metres through `px` mapping. */
export function fillPoly(g: CanvasRenderingContext2D, pts: readonly V2[], map: (p: V2) => V2) {
  g.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = map(p);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fill();
}

/** Add uniform luminance grain to the RGB of a canvas (alpha untouched). */
export function addGrain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const r = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 2 * amount;
    d[i] = clamp(d[i]! + n, 0, 255);
    d[i + 1] = clamp(d[i + 1]! + n, 0, 255);
    d[i + 2] = clamp(d[i + 2]! + n, 0, 255);
  }
  g.putImageData(img, 0, 0);
}

/** The print palette (朝の光): cool inks on cool white stock, 藍 the one accent (the ○ disc, the seal, a spot colour). */
export const PRINT = {
  ink: "#1c232b",
  ink2: "#384450",
  body: "#2e3946",
  muted: "#56626d",
  faint: "#949fa9",
  rule: "#d3dae0",
  /** 藍 */
  ai: "#2f4f73",
  seal: "#2f4f73",
  /** handwriting */
  pen: "#24324a",
} as const;

/**
 * The stocks painted lately, kept a little while as canvases (the whole canvas as it stood after paintStock, and its bump): an
 * object paints its print again when the web fonts arrive — while the cover swings open — and the noise under the print is the
 * costly part of a paint and does not change, so the repaint takes it from here. Dropped STOCK_KEEP ms after their last use, or
 * at once by releaseStocks() (the pouch calls it after its late repaint).
 */
type Stock = { color: HTMLCanvasElement; bump: HTMLCanvasElement | null; timer: ReturnType<typeof setTimeout> };
const stocks = new Map<string, Stock>();
const STOCK_KEEP = 20000;
function dropStock(key: string) {
  const s = stocks.get(key);
  if (!s) return;
  clearTimeout(s.timer);
  // a zero-sized canvas frees its backing store at once
  s.color.width = s.color.height = 0;
  if (s.bump) s.bump.width = s.bump.height = 0;
  stocks.delete(key);
}
/** Forget every kept stock (see `stocks`). */
export function releaseStocks(): void {
  for (const k of [...stocks.keys()]) dropStock(k);
}
function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(src, 0, 0);
  return c;
}
function putCanvas(g: CanvasRenderingContext2D, from: HTMLCanvasElement) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.filter = "none";
  g.globalCompositeOperation = "copy";
  g.drawImage(from, 0, 0);
  g.restore();
}

const opaque = new Map<string, [number, number, number] | null>();
let probeG: CanvasRenderingContext2D | null = null;
/** The bytes an opaque CSS colour fills with (null for a translucent one). */
function opaqueRGB(css: string): [number, number, number] | null {
  let v = opaque.get(css);
  if (v !== undefined) return v;
  probeG ??= makeCanvas(1, 1).g;
  probeG.clearRect(0, 0, 1, 1);
  probeG.fillStyle = css;
  probeG.fillRect(0, 0, 1, 1);
  const d = probeG.getImageData(0, 0, 1, 1).data;
  v = d[3] === 255 ? [d[0]!, d[1]!, d[2]!] : null;
  opaque.set(css, v);
  return v;
}

export type StockOpts = { color: string; seed: number; mottle?: number; fibres?: number; grain?: number; bump?: CanvasRenderingContext2D; tooth?: number };

/** Texels per step of a stock's pixel work (a millisecond or two), and fibres per step. */
const STOCK_BAND = 1 << 16;
const FIBRE_BAND = 1500;

/**
 * The work of paintStock, in steps (it yields after each band of rows and each run of fibres): run to the end at once by
 * paintStock, or a few steps per idle moment by makeStocks. The same steps either way, so the stock comes out the same.
 */
function* stockSteps(g: CanvasRenderingContext2D, w: number, h: number, o: StockOpts): Generator<void, void, void> {
  const m = g.getTransform();
  const r = rng(o.seed);
  // the whole canvas, untransformed, in an opaque colour: its pixels are known without reading them back from the canvas
  const rgb = m.isIdentity && w === g.canvas.width && h === g.canvas.height ? opaqueRGB(o.color) : null;
  let img: ImageData;
  if (rgb) img = g.createImageData(w, h);
  else {
    g.fillStyle = o.color;
    g.fillRect(0, 0, w, h);
    img = g.getImageData(0, 0, w, h);
  }
  const d = img.data;
  const mot = o.mottle ?? 4;
  const cells = Math.max(4, Math.round(w / 90));
  const f1 = noiseLattice(w, h, cells, Math.max(4, Math.round((cells * h) / w)), r);
  const f2 = noiseLattice(w, h, cells * 4, Math.max(8, Math.round((cells * 4 * h) / w)), r);
  const n1 = new Float32Array(w * h);
  const n2 = new Float32Array(w * h);
  const gr = o.grain ?? 3;
  const band = Math.max(1, Math.floor(STOCK_BAND / w));
  const [cr, cg, cb] = rgb ?? [0, 0, 0];
  for (let y0 = 0; y0 < h; y0 += band) {
    const y1 = Math.min(h, y0 + band);
    noiseRows(f1, n1, y0, y1);
    noiseRows(f2, n2, y0, y1);
    // (a Uint8ClampedArray clamps and rounds on its own)
    const end = y1 * w;
    if (rgb)
      for (let p = y0 * w, i = p * 4; p < end; i += 4, p++) {
        const v = (n1[p]! - 0.5) * mot * 2 + (n2[p]! - 0.5) * mot + (r() - 0.5) * gr * 2;
        d[i] = cr + v;
        d[i + 1] = cg + v;
        d[i + 2] = cb + v;
        d[i + 3] = 255;
      }
    else
      for (let p = y0 * w, i = p * 4; p < end; i += 4, p++) {
        const v = (n1[p]! - 0.5) * mot * 2 + (n2[p]! - 0.5) * mot + (r() - 0.5) * gr * 2;
        d[i] = d[i]! + v;
        d[i + 1] = d[i + 1]! + v;
        d[i + 2] = d[i + 2]! + v;
      }
    yield;
  }
  g.putImageData(img, 0, 0);
  const nf = o.fibres ?? Math.round((w * h) / 900);
  g.save();
  g.lineCap = "round";
  for (let i = 0; i < nf; i++) {
    const x = r() * w, y = r() * h, l = 2 + r() * 7, a = r() * Math.PI;
    g.strokeStyle = r() < 0.55 ? "rgba(84,96,108,0.06)" : "rgba(255,255,255,0.3)";
    g.lineWidth = 0.6 + r() * 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
    if (i % FIBRE_BAND === FIBRE_BAND - 1) yield;
  }
  g.restore();
  if (o.bump) {
    const b = o.bump;
    const bi = b.createImageData(w, h);
    const bd = bi.data;
    const t1 = noiseLattice(w, h, Math.round(w / 3), Math.round(h / 3), r);
    const t2 = noiseLattice(w, h, Math.round(w / 9), Math.round(h / 9), r);
    // the band's rows of both, in buffers of one band
    const r1 = new Float32Array(band * w);
    const r2 = new Float32Array(band * w);
    const k = o.tooth ?? 18;
    for (let y0 = 0; y0 < h; y0 += band) {
      const y1 = Math.min(h, y0 + band);
      noiseRows(t1, r1, y0, y1, y0 * w);
      noiseRows(t2, r2, y0, y1, y0 * w);
      for (let p = y0 * w, q = 0, i = p * 4, end = y1 * w; p < end; i += 4, p++, q++) {
        const v = 128 + (r1[q]! - 0.5) * k + (r2[q]! - 0.5) * k * 0.8 + (n1[p]! - 0.5) * k * 0.6;
        bd[i] = bd[i + 1] = bd[i + 2] = v;
        bd[i + 3] = 255;
      }
      yield;
    }
    b.putImageData(bi, 0, 0);
  }
}

/** A stock asked for while first paints are deferred (deferStocks): painted flat for now, made in steps by makeStocks. */
export type StockJob = { key: string; steps: Generator<void, void, void>; color: HTMLCanvasElement; bump: HTMLCanvasElement | null; made: boolean };
/** Jobs queued and not made yet, by stock key: a paint that asks for one of these meanwhile gets the flat stand-in too. */
const queued = new Map<string, StockJob>();
let deferring: StockJob[] | null = null;
/**
 * How to make a stock again on a blank canvas (remakeStocks): its key, the canvas (size, transform) and the call. An object's first
 * paint is on fresh canvases, so a stock made again from its recipe is the very one that paint kept.
 */
export type StockRecipe = { key: string; cw: number; ch: number; m: [number, number, number, number, number, number]; w: number; h: number; o: Omit<StockOpts, "bump">; bump: [number, number] | null };
/** The stocks the paints inside deferStocks asked for, kept or not (deferStocks' `recipes`). */
let recording: Map<string, StockRecipe> | null = null;

/**
 * Run `fn` (an object's build, whose first paint asks for its stocks) with every stock that is not kept already painted flat — the
 * base colour, the bump at mid grey — and queued: `jobs` are what makeStocks has to make before the object is painted again (then
 * paintStock finds them kept). The costly part of a first paint (the noise of a few million texels) leaves the build's task.
 */
export function deferStocks<T>(fn: () => T): { value: T; jobs: StockJob[]; recipes: StockRecipe[] } {
  const outer = deferring;
  const outerRec = recording;
  const jobs: StockJob[] = [];
  const rec = new Map<string, StockRecipe>();
  deferring = jobs;
  recording = rec;
  try {
    return { value: fn(), jobs, recipes: [...rec.values()] };
  } finally {
    deferring = outer;
    recording = outerRec;
  }
}

/**
 * Jobs that make these stocks again, for makeStocks (an object about to be painted again long after its first paint, when the kept
 * stocks are gone: a language switch). Only the ones neither kept nor queued already; the paint that follows finds them kept.
 */
export function remakeStocks(recipes: readonly StockRecipe[]): StockJob[] {
  const out: StockJob[] = [];
  for (const r of recipes) {
    const k = stocks.get(r.key);
    if ((k && (!r.bump || k.bump)) || queued.has(r.key)) continue;
    const c = document.createElement("canvas");
    c.width = r.cw;
    c.height = r.ch;
    const g = c.getContext("2d");
    const bc = r.bump ? Object.assign(document.createElement("canvas"), { width: r.bump[0], height: r.bump[1] }) : null;
    const bg = bc?.getContext("2d") ?? null;
    if (!g || (bc && !bg)) continue;
    g.setTransform(...r.m);
    const job: StockJob = { key: r.key, steps: stockSteps(g, r.w, r.h, bg ? { ...r.o, bump: bg } : r.o), color: c, bump: bc, made: false };
    queued.set(r.key, job);
    out.push(job);
  }
  return out;
}

/**
 * Make queued stocks a few steps at a time, in idle moments (at most `sliceMs` per task; requestIdleCallback where there is one), and
 * keep each as paintStock would have. Stops early when `alive()` turns false: the jobs it leaves are no longer queued (a paint then
 * makes the stock at once), unless another caller is making them too (two pouches asked for the same stock).
 */
export async function makeStocks(jobs: readonly StockJob[], alive: () => boolean, sliceMs = 8): Promise<void> {
  const ric = typeof requestIdleCallback === "function" ? requestIdleCallback : null;
  const slice = () =>
    new Promise<number>((go) => {
      if (ric) ric((d) => go(d.didTimeout ? sliceMs / 2 : Math.max(2, Math.min(sliceMs, d.timeRemaining()))), { timeout: 120 });
      else setTimeout(() => go(sliceMs), 0);
    });
  let left = false;
  try {
    for (const job of jobs) {
      while (!job.made) {
        const budget = await slice();
        if (!alive()) return void (left = true);
        if (job.made) break;
        const end = performance.now() + budget;
        let done = false;
        do done = !!job.steps.next().done;
        while (!done && performance.now() < end);
        if (!done) continue;
        job.made = true;
        if (queued.get(job.key) === job) queued.delete(job.key);
        dropStock(job.key);
        stocks.set(job.key, { color: job.color, bump: job.bump, timer: setTimeout(() => dropStock(job.key), STOCK_KEEP) });
      }
    }
  } finally {
    if (left) for (const job of jobs) if (!job.made && queued.get(job.key) === job) queued.delete(job.key);
  }
}

/** The job for a stock: a canvas (and bump) of its own, as the paint's stood at the call (content, transform, the state that draws). */
function queueStock(key: string, g: CanvasRenderingContext2D, w: number, h: number, o: StockOpts): StockJob | null {
  const c = copyCanvas(g.canvas);
  const jg = c?.getContext("2d");
  const bc = o.bump ? copyCanvas(o.bump.canvas) : null;
  const jb = bc?.getContext("2d") ?? null;
  if (!c || !jg || (o.bump && !jb)) return null;
  jg.setTransform(g.getTransform());
  jg.globalAlpha = g.globalAlpha;
  jg.globalCompositeOperation = g.globalCompositeOperation;
  jg.filter = g.filter;
  const job: StockJob = { key, steps: stockSteps(jg, w, h, jb ? { ...o, bump: jb } : { ...o, bump: undefined }), color: c, bump: bc, made: false };
  queued.set(key, job);
  return job;
}

/** paintStock at once, also inside deferStocks: for a small stock painted once at build, outside the paint an object repeats. */
export function paintStockNow(g: CanvasRenderingContext2D, w: number, h: number, o: StockOpts) {
  const outer = deferring;
  const outerRec = recording;
  deferring = null;
  recording = null;
  try {
    paintStock(g, w, h, o);
  } finally {
    deferring = outer;
    recording = outerRec;
  }
}

/**
 * Uncoated stock: the base colour, a low-frequency mottle (formation: fibres never lie perfectly even), a few hundred short
 * fibres and a fine tooth. `bump` (optional) gets the matching relief around mid grey. Deterministic from `seed`; a stock painted
 * again within STOCK_KEEP ms with the same arguments on a canvas of the same size and transform is copied from the kept one.
 * Inside deferStocks (or while the same stock is still queued) a stock not kept yet is painted flat and queued instead.
 */
export function paintStock(g: CanvasRenderingContext2D, w: number, h: number, o: StockOpts) {
  const m = g.getTransform();
  const key = [g.canvas.width, g.canvas.height, w, h, m.a, m.b, m.c, m.d, m.e, m.f, o.color, o.seed, o.mottle, o.fibres, o.grain, o.tooth, o.bump ? `${o.bump.canvas.width}x${o.bump.canvas.height}` : ""].join("|");
  if (recording && !recording.has(key)) {
    const { bump, ...rest } = o;
    recording.set(key, { key, cw: g.canvas.width, ch: g.canvas.height, m: [m.a, m.b, m.c, m.d, m.e, m.f], w, h, o: rest, bump: bump ? [bump.canvas.width, bump.canvas.height] : null });
  }
  const kept = stocks.get(key);
  if (kept && (!o.bump || kept.bump)) {
    putCanvas(g, kept.color);
    if (o.bump && kept.bump) putCanvas(o.bump, kept.bump);
    clearTimeout(kept.timer);
    kept.timer = setTimeout(() => dropStock(key), STOCK_KEEP);
    return;
  }
  const job = queued.get(key) ?? (deferring ? queueStock(key, g, w, h, o) : null);
  if (job) {
    if (deferring && !deferring.includes(job)) deferring.push(job);
    g.fillStyle = o.color;
    g.fillRect(0, 0, w, h);
    if (o.bump) {
      const b = o.bump;
      b.save();
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalAlpha = 1;
      b.globalCompositeOperation = "source-over";
      b.fillStyle = "#808080";
      b.fillRect(0, 0, w, h);
      b.restore();
    }
    return;
  }
  const steps = stockSteps(g, w, h, o);
  while (!steps.next().done);
  const color = copyCanvas(g.canvas);
  const bump = o.bump ? copyCanvas(o.bump.canvas) : null;
  if (color && (!o.bump || bump)) {
    dropStock(key);
    stocks.set(key, { color, bump, timer: setTimeout(() => dropStock(key), STOCK_KEEP) });
  }
}

/** The ○ mark: a filled disc centred on (cx, cy). Fills with the current style. */
export function disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

/**
 * Letterpress / offset ink is never a perfect flat fill: lighten a fraction of the texels by a little (the paper's tooth shows
 * through where the ink did not reach). Paper-coloured specks are invisible on bare paper, so this only touches the ink.
 */
export function inkTooth(g: CanvasRenderingContext2D, w: number, h: number, paper: string, seed: number, amount = 0.22, density = 0.05) {
  const r = rng(seed);
  g.save();
  g.fillStyle = paper;
  const n = Math.round(w * h * density * 0.25);
  for (let i = 0; i < n; i++) {
    g.globalAlpha = amount * (0.4 + r() * 0.6);
    const s = 0.8 + r() * 1.4;
    g.fillRect(r() * w, r() * h, s, s);
  }
  g.restore();
}

/* ---------- colour ---------- */

export function parseColor(c: string): THREE.Color {
  const col = new THREE.Color();
  try {
    col.set(c);
  } catch {
    col.set("#888888");
  }
  return col;
}

/** Mix two CSS colours in sRGB, return "#rrggbb". */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseColor(a).getHex(THREE.SRGBColorSpace);
  const cb = parseColor(b).getHex(THREE.SRGBColorSpace);
  const ch = (v: number, s: number) => (v >> s) & 255;
  const m = (s: number) => Math.round(lerp(ch(ca, s), ch(cb, s), t));
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, "0")}`;
}

/** Relative luminance 0..1 of a CSS colour (sRGB). */
export function luminance(c: string): number {
  const v = parseColor(c).getHex(THREE.SRGBColorSpace);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

/* ---------- noise + normal maps ---------- */

/** A value-noise lattice (its random values drawn now, in order) and, per column, its two lattice columns and the eased weight. */
type NoiseLattice = { w: number; cellsX: number; cellsY: number; h: number; lat: Float32Array; c0: Int32Array; c1: Int32Array; sxs: Float64Array };
function noiseLattice(w: number, h: number, cellsX: number, cellsY: number, rand: () => number): NoiseLattice {
  const lat = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const c0 = new Int32Array(w);
  const c1 = new Int32Array(w);
  const sxs = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const fx = (x / w) * cellsX;
    const x0 = Math.floor(fx);
    const tx = fx - x0;
    sxs[x] = tx * tx * (3 - 2 * tx);
    c0[x] = x0 % cellsX;
    c1[x] = (x0 + 1) % cellsX;
  }
  return { w, h, cellsX, cellsY, lat, c0, c1, sxs };
}
/** Rows y0 … y1 - 1 of the noise into `out`, texel (x, y) at y · w + x − `base`. */
function noiseRows(n: NoiseLattice, out: Float32Array, y0: number, y1: number, base = 0) {
  const { w, h, cellsX, cellsY, lat, c0, c1, sxs } = n;
  for (let y = y0; y < y1; y++) {
    const fy = (y / h) * cellsY;
    const yl = Math.floor(fy);
    const ty = fy - yl;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (yl % cellsY) * cellsX;
    const r1 = ((yl + 1) % cellsY) * cellsX;
    const row = y * w - base;
    for (let x = 0; x < w; x++) {
      const sx = sxs[x]!;
      const a = lat[r0 + c0[x]!]!, b = lat[r0 + c1[x]!]!, c = lat[r1 + c0[x]!]!, d = lat[r1 + c1[x]!]!;
      const top = a + (b - a) * sx;
      const bot = c + (d - c) * sx;
      out[row + x] = top + (bot - top) * sy;
    }
  }
}

/** Tileable value noise, `cells` lattice cells across, bilinear-smoothstep interpolated. Returns 0..1 per texel. */
export function valueNoise(w: number, h: number, cellsX: number, cellsY: number, rand: () => number): Float32Array {
  const out = new Float32Array(w * h);
  noiseRows(noiseLattice(w, h, cellsX, cellsY, rand), out, 0, h);
  return out;
}

/** Height field -> tangent-space normal map canvas (Sobel, wrap-around so it tiles). */
export function heightToNormalCanvas(hf: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const at = (x: number, y: number) => hf[((y + h) % h) * w + ((x + w) % w)]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      // image y grows downward, texture v grows upward: flip dy
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Shared tileable paper-grain normal map (fibres + mottling). Returns a clone with its own repeat; the base lives while any clone does. */
export function paperNormal(ctx: Pick<ObjectCtx, "anisotropy">, tr: Tracker, repeatX: number, repeatY: number): THREE.Texture {
  const base = acquire("paper-normal", () => {
    const n = 256;
    const rand = rng(0x9a9e12);
    const hf = new Float32Array(n * n);
    const o1 = valueNoise(n, n, 64, 64, rand);
    const o2 = valueNoise(n, n, 16, 16, rand);
    const o3 = valueNoise(n, n, 4, 4, rand);
    for (let i = 0; i < hf.length; i++) hf[i] = o1[i]! * 0.55 + o2[i]! * 0.18 + o3[i]! * 0.04;
    // short fibres
    const { c, g } = makeCanvas(n, n);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, n, n);
    g.lineCap = "round";
    for (let i = 0; i < 900; i++) {
      const x = rand() * n;
      const y = rand() * n;
      const a = rand() * Math.PI;
      const l = 3 + rand() * 9;
      g.strokeStyle = rand() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)";
      g.lineWidth = 0.7 + rand() * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    const fib = g.getImageData(0, 0, n, n).data;
    for (let i = 0; i < hf.length; i++) hf[i] = hf[i]! * 0.7 + (fib[i * 4]! / 255) * 0.5;
    const nc = heightToNormalCanvas(hf, n, n, 2.2);
    const tex = new THREE.CanvasTexture(nc);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return { value: tex, free: () => tex.dispose() };
  });
  tr.onFree(base.release);
  const t = base.value.clone();
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = ctx.anisotropy;
  t.needsUpdate = true;
  tr.add(t);
  return t;
}

/* ---------- contact shadow texture ---------- */

export type ShadowTex = { tex: THREE.CanvasTexture; w: number; h: number; cx: number; cy: number };

/**
 * Blurred silhouette (alpha only) of a footprint polygon, padded by `padM` on every side.
 * The returned quad extent (w x h metres) is centred on (cx, cy) in body space. Mipmapped so the shader can lower its LOD to soften it.
 */
export function silhouetteShadow(outline: readonly V2[] | readonly (readonly V2[])[], padM = 0.012, blurM = 0.0026, holes?: readonly (readonly V2[])[]): ShadowTex {
  const first = outline[0] as readonly unknown[] | undefined;
  const polys: readonly (readonly V2[])[] = first && Array.isArray(first[0]) ? (outline as readonly (readonly V2[])[]) : [outline as readonly V2[]];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const w = maxX - minX + padM * 2;
  const h = maxY - minY + padM * 2;
  const texel = 0.0009;
  const tw = clamp(Math.ceil(w / texel), 32, 256);
  const th = clamp(Math.ceil(h / texel), 32, 256);
  const { c, g } = makeCanvas(tw, th);
  g.fillStyle = "#000";
  const sx = tw / w;
  const sy = th / h;
  for (const poly of polys) fillPoly(g, poly, ([x, y]) => [(x - minX + padM) * sx, (maxY + padM - y) * sy]);
  const img = g.getImageData(0, 0, tw, th);
  let a = new Float32Array(tw * th);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3]! / 255;
  const r = Math.max(1, Math.round(blurM / (w / tw)));
  let b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal then vertical box blur
    for (let y = 0; y < th; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * tw + clamp(x, 0, tw - 1)]!;
      for (let x = 0; x < tw; x++) {
        b[y * tw + x] = acc / (2 * r + 1);
        acc += a[y * tw + clamp(x + r + 1, 0, tw - 1)]! - a[y * tw + clamp(x - r, 0, tw - 1)]!;
      }
    }
    for (let x = 0; x < tw; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, th - 1) * tw + x]!;
      for (let y = 0; y < th; y++) {
        a[y * tw + x] = acc / (2 * r + 1);
        acc += b[clamp(y + r + 1, 0, th - 1) * tw + x]! - b[clamp(y - r, 0, th - 1) * tw + x]!;
      }
    }
  }
  const out = g.createImageData(tw, th);
  for (let i = 0; i < a.length; i++) {
    out.data[i * 4] = 0;
    out.data[i * 4 + 1] = 0;
    out.data[i * 4 + 2] = 0;
    out.data[i * 4 + 3] = clamp(a[i]! * 255, 0, 255);
  }
  g.putImageData(out, 0, 0);
  // holes through the object (a punch) let the light in after the blur: a crisp cut with a hair of softness
  if (holes?.length) {
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.filter = `blur(${Math.max(0.5, 0.0003 * sx).toFixed(2)}px)`;
    for (const poly of holes) fillPoly(g, poly, ([x, y]) => [(x - minX + padM) * sx, (maxY + padM - y) * sy]);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, w, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
