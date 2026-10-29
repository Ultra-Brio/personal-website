import { canvasFont, hanLangOf, type FontRun, type HanLang } from "../fonts";
import { SEAL_INK, sealArtFor, sealChars, sealRun, sealSquare } from "../print/seal";
import type { SealArt } from "../profile/schema";
import type { CoverColor, CoverMaterial } from "./cover";
import { COVER_HEX } from "./cover-style";
import { hash } from "./layout";
import { finish, loadedFaces } from "./textures";

/*
 * The printed liner inside the résumé folio's front board (BookOptions.case.liner): an endpaper with a bookplate tipped in on it.
 * Pure canvas, no three. Returns the colour map and a height map (the binder feeds it to the liner's bumpMap), so under the scene's
 * raking key light the bookplate sits a sheet's thickness proud of the endpaper and its type is pressed into it, like letterpress.
 *
 * - Endpaper: 雲龍紙 (unryū), kōzo paper with long fibres laid in it — the case's liner paper (look.paper) with a little formation,
 *   900 fibres (most of them a lighter white, a few a cool grey) and the paper's tooth. Quiet at arm's length, fibrous up close.
 *   Frosted PP has none (look.paper null): the bookplate (and a portrait) is held on the bare board, transparent round it.
 * - Bookplate (蔵書票): a small slip of white stock, tipped in (a hair of shadow), framed in 子持ち罫 (a heavy rule with a hairline
 *   inside it), the name in Mincho, the name in its own script, a short hairline, role and place in Gothic (sentence case), and the
 *   owner's square 朱文 seal in 藍 (src/print/seal.ts) — the only colour on the liner. No capitals, no form rows, no numbers.
 * - Portrait: only when the spec has a picture (portrait.src) and it has arrived: tipped in above the plate with four photo corners.
 *   Never a placeholder.
 * Type is set in the src/fonts faces for each string's Han language (spec.lang: a Chinese profile prints Chinese glyph forms). Canvas
 * text never loads a web font by itself: the binder awaits ensureFonts(linerFontRuns(spec)) and paints again when they arrive.
 * Sizes are in mm (wMm × hMm, `width` canvas px wide); text is set at its real pixel size.
 * Painting costs tens of ms at 1536 px, so the last two results are kept (a case swap between leather and cloth, or back, reuses them).
 */

export type LinerSpec = {
  /** The name, set large on the bookplate */
  title: string;
  /** The name in its own script (e.g. 林文), under the name; its first characters are cut into the seal */
  subtitle?: string;
  /** Role and place, in small Gothic under the hairline */
  role?: string;
  place?: string;
  /** Older form: short rows. When role / place are absent, lines[0] is the role and lines[1] the place; the rest is not printed. */
  lines?: string[];
  /** A photograph tipped in above the plate (only when src is given; nothing is drawn without one) */
  portrait?: { src?: string; color?: string } | null;
  /**
   * sasshi: the profile's language (Profile.lang, a BCP 47 tag): which Han faces the plate's strings are set in
   * (src/fonts hanLangOf: kana → Japanese; zh-Hant / TW / HK → TC; anything else → SC). Latin always comes from the Japanese faces.
   */
  lang?: string;
  /** sasshi: the profile's name seal in small seal script (Profile.seal); used while it matches the name, else the seal is typeset */
  seal?: SealArt | null;
};

/** Colours of one liner: the endpaper's ground (null: no endpaper, see above), the plate's stock and the press ink */
export type LinerLook = { paper: string | null; plate: string; ink: string; seed?: number };

/** Plate stock (蔵書票), the press ink (墨) and the muted ink of the plate's small lines are the same on every case */
const PLATE = "#f7f8f6";
const INK = "#1c232b";
const MUTE = "#56626d";

/**
 * The liner's colours for a case. Cloth and leather: the endpaper is the case's own liner paper (COVER_HEX.liner). Frosted PP: no
 * endpaper (owner 2026-10-24) — the plate alone on the board, so the PP shows round it, open or closed.
 */
export function linerLookFor(material: CoverMaterial, color: CoverColor): LinerLook {
  return { paper: material === "frost" ? null : COVER_HEX[color].liner, plate: PLATE, ink: INK };
}

/** The plate's strings in print order (role and place from the older `lines` form when absent) */
function plateText(spec: LinerSpec) {
  return { name: spec.title, local: spec.subtitle?.trim() || undefined, role: (spec.role ?? spec.lines?.[0])?.trim() || undefined, place: (spec.place ?? spec.lines?.[1])?.trim() || undefined };
}
/** The Han faces the seal is cut in: the local name's, in the profile's language */
const sealHan = (spec: LinerSpec): HanLang => hanLangOf(spec.subtitle ?? spec.title, spec.lang);

/** The strings the liner prints, in the faces it sets them in: await ensureFonts() with these before (or after) painting */
export function linerFontRuns(spec: LinerSpec): FontRun[] {
  const t = plateText(spec);
  const han = (s: string) => hanLangOf(s, spec.lang);
  const runs: FontRun[] = [{ role: "serif", weight: 500, text: t.name, han: han(t.name) }];
  if (t.local) runs.push({ role: "serif", weight: 500, text: t.local, han: han(t.local) });
  for (const s of [t.role, t.place]) if (s) runs.push({ role: "sans", weight: 400, text: s, han: han(s) });
  if (!sealArtFor(spec.seal, t.local, t.name)) runs.push(sealRun(sealChars(t.local, t.name), sealHan(spec)));
  return runs;
}

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/* ── noise ── */
function lattice(x: number, y: number, seed: number) {
  return hash(x * 157.31 + y * 311.7 + seed * 71.13);
}
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(xi, yi, seed);
  const b = lattice(xi + 1, yi, seed);
  const c = lattice(xi, yi + 1, seed);
  const d = lattice(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number, seed: number, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f, seed + i * 13);
    f *= 2.03;
    amp *= 0.5;
  }
  return v / (1 - Math.pow(0.5, oct));
}

/**
 * Low-frequency clouds (features of about `scaleMm`), painted at a fraction of the canvas resolution and drawn up smoothly:
 * a grey canvas whose alpha is `amount` × the distance from mid grey (white above, black below), for soft-light / masks.
 */
function clouds(W: number, H: number, k: number, scaleMm: number, seed: number, amount: number, signed = true) {
  // a sample every ~1.5 mm is plenty for features this size
  const s = Math.max(4, Math.round(1.5 * k));
  const lw = Math.ceil(W / s) + 1;
  const lh = Math.ceil(H / s) + 1;
  const low = canvas(lw, lh);
  const lc = low.getContext("2d")!;
  const im = lc.createImageData(lw, lh);
  for (let y = 0; y < lh; y++)
    for (let x = 0; x < lw; x++) {
      const v = fbm((x * s) / k / scaleMm, (y * s) / k / scaleMm, seed, 4);
      const o = (y * lw + x) * 4;
      if (signed) {
        im.data[o] = im.data[o + 1] = im.data[o + 2] = v > 0.5 ? 255 : 0;
        im.data[o + 3] = Math.min(255, Math.abs(v - 0.5) * 2 * 255 * amount);
      } else {
        im.data[o] = im.data[o + 1] = im.data[o + 2] = 0;
        im.data[o + 3] = Math.min(255, Math.max(0, v) * 255 * amount);
      }
    }
  lc.putImageData(im, 0, 0);
  return { low, s };
}

/** A tile of fine paper grain (0–255 grey), shared */
let toothTile: HTMLCanvasElement | null = null;
function tooth() {
  if (toothTile) return toothTile;
  const n = 192;
  const c = canvas(n, n);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // fibres: a little stretched along x, plus pixel grain
      const f = vnoise((x / n) * 48, (y / n) * 96, 5) * 0.55 + hash(x * 0.37 + y * 91.3) * 0.45;
      const v = 128 + (f - 0.5) * 120;
      const o = (y * n + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return (toothTile = c);
}

/**
 * 雲龍紙 fibres: long kōzo fibres laid in the endpaper, most a lighter white than the ground, some a cool grey, every one a gentle
 * S-curve. Painted on the ground in mm units (ctx already scaled to mm), from a seeded generator so a repaint is the same sheet.
 */
function unryu(ctx: Ctx, wMm: number, hMm: number, seed: number) {
  let s = (seed * 7919 + 17) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  ctx.lineCap = "round";
  for (let i = 0; i < 900; i++) {
    const x = rnd() * wMm;
    const y = rnd() * hMm;
    const len = 6 + rnd() * rnd() * 70;
    const a = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * 14;
    ctx.strokeStyle = rnd() < 0.72 ? `rgba(255,255,255,${0.35 + rnd() * 0.4})` : `rgba(96,116,132,${0.05 + rnd() * 0.07})`;
    ctx.lineWidth = 0.08 + rnd() * rnd() * 0.5;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (ex - x) * 0.3 + bend * 0.6, y + (ey - y) * 0.3 - bend * 0.4, x + (ex - x) * 0.7 - bend * 0.5, y + (ey - y) * 0.7 + bend * 0.6, ex, ey);
    ctx.stroke();
  }
}

/** The last results (see the note at the top): key → canvases. Callers never draw into them. */
const painted: { key: string; out: { color: HTMLCanvasElement; height: HTMLCanvasElement } }[] = [];
const PAINT_CACHE = 2;
const imageIds = new WeakMap<object, number>();
let nextImageId = 1;
const imageId = (img: CanvasImageSource | null) => {
  if (!img) return 0;
  let id = imageIds.get(img);
  if (!id) imageIds.set(img, (id = nextImageId++));
  return id;
};

/**
 * Paints the liner. `img` is the portrait once it has arrived (drawn only when spec.portrait.src is set).
 * Returns the colour canvas (`width` px wide) and a height canvas at the same size (grey 128 = the endpaper's surface).
 * The canvases may be shared with an earlier call with the same inputs: treat them as read-only.
 */
export function drawFolioLiner(width: number, wMm: number, hMm: number, look: LinerLook, spec: LinerSpec, img: CanvasImageSource | null = null): { color: HTMLCanvasElement; height: HTMLCanvasElement } {
  return finish(folioLinerSteps(width, wMm, hMm, look, spec, img));
}

/**
 * sasshi (round 4, E1): drawFolioLiner in steps — the endpaper, its height, the bookplate — into the same cache: a host paints a
 * liner in another language ahead a step a task (binder.ts prepaintSteps), and the case built after finds it painted.
 */
export function* folioLinerSteps(width: number, wMm: number, hMm: number, look: LinerLook, spec: LinerSpec, img: CanvasImageSource | null = null): Generator<void, { color: HTMLCanvasElement; height: HTMLCanvasElement }> {
  const photo = spec.portrait?.src && img ? img : null;
  const key = JSON.stringify([width, wMm, hMm, look, spec.title, spec.subtitle, spec.role, spec.place, spec.lines?.slice(0, 2), spec.lang ?? "", spec.seal?.name ?? "", spec.seal?.glyphs.length ?? 0, imageId(photo), loadedFaces()]);
  const hit = painted.find((p) => p.key === key);
  if (hit) return hit.out;
  const out = yield* paintLiner(width, wMm, hMm, look, spec, photo);
  painted.unshift({ key, out });
  painted.length = Math.min(painted.length, PAINT_CACHE);
  return out;
}

function* paintLiner(width: number, wMm: number, hMm: number, look: LinerLook, spec: LinerSpec, img: CanvasImageSource | null): Generator<void, { color: HTMLCanvasElement; height: HTMLCanvasElement }> {
  const k = width / wMm;
  const W = width;
  const H = Math.round(hMm * k);
  const color = canvas(W, H);
  const height = canvas(W, H);
  const ctx = color.getContext("2d")!;
  const hx = height.getContext("2d")!;
  const seed = look.seed ?? 3;
  ctx.imageSmoothingQuality = "high";

  /* ── endpaper (none on frosted PP: the canvas stays transparent round the plate) ── */
  if (look.paper) {
    ctx.fillStyle = look.paper;
    ctx.fillRect(0, 0, W, H);
    // cloudy formation of handmade paper: very low-frequency density changes
    {
      const f = clouds(W, H, k, 38, seed + 40, 0.09);
      ctx.globalCompositeOperation = "soft-light";
      ctx.drawImage(f.low, 0, 0, f.low.width * f.s, f.low.height * f.s);
      ctx.globalCompositeOperation = "source-over";
    }
    yield;
    // the long fibres laid in the sheet
    ctx.save();
    ctx.scale(k, k);
    unryu(ctx, wMm, hMm, seed);
    ctx.restore();
    // the paper's tooth over everything
    ctx.globalAlpha = 0.07;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = ctx.createPattern(tooth(), "repeat")!;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // height: the endpaper's surface with its tooth
  hx.fillStyle = "rgb(128,128,128)";
  hx.fillRect(0, 0, W, H);
  hx.globalAlpha = 0.35;
  hx.fillStyle = hx.createPattern(tooth(), "repeat")!;
  hx.fillRect(0, 0, W, H);
  hx.globalAlpha = 1;
  yield;

  /* ── composition: the plate's centre at 44 % of the board's height; with a portrait, the photo above it and the pair centred there ── */
  const pw = PLATE_MM.w;
  const ph = PLATE_MM.h;
  const photo = img ? { w: Math.min(62, wMm * 0.25), h: Math.min(62, wMm * 0.25) * 1.25 } : null;
  const gap = 14;
  const block = ph + (photo ? photo.h + gap : 0);
  const top = Math.max(hMm * 0.05, hMm * 0.44 - block / 2);
  const py = top + (photo ? photo.h + gap : 0);
  if (photo && img) tipIn(ctx, hx, k, (wMm - photo.w) / 2, top, photo.w, photo.h, img, seed);
  bookplate(ctx, hx, k, (wMm - pw) / 2, py, look, spec);
  return { color, height };
}

/** The bookplate's slip (mm) */
const PLATE_MM = { w: 92, h: 124 };

function trackPx(ctx: Ctx, px: number) {
  (ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/**
 * The bookplate (蔵書票), tipped in: a hair of shadow and a sheet's thickness of lift on the endpaper (height map), the stock with its
 * own tooth, the 子持ち罫 frame, then the type, printed (ink spread, a little starvation, the impression in the height map), and the
 * seal pressed last. (x, y) is the slip's top-left in mm; px out.
 */
function bookplate(ctx: Ctx, hx: Ctx, k: number, x: number, y: number, look: LinerLook, spec: LinerSpec) {
  const { w, h } = PLATE_MM;
  const X = Math.round(x * k);
  const Y = Math.round(y * k);
  const Wp = Math.round(w * k);
  const Hp = Math.round(h * k);
  const mm = (v: number) => v * k;
  // tipped in: only the slip's edge throws a hairline of shade, down and to the right of the window light
  ctx.fillStyle = "rgba(21,35,58,0.10)";
  ctx.fillRect(X + mm(0.25), Y + mm(0.45), Wp, Hp);
  ctx.fillStyle = look.plate;
  ctx.fillRect(X, Y, Wp, Hp);
  // the stock: its own tooth, a lighter rim where the cut edge catches the light
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, Y, Wp, Hp);
  ctx.clip();
  ctx.globalAlpha = 0.06;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(tooth(), "repeat")!;
  ctx.fillRect(X, Y, Wp, Hp);
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(X, Y, Wp, Math.max(1, 0.18 * k));
  ctx.fillRect(X, Y, Math.max(1, 0.18 * k), Hp);

  // height: the slip stands .3 mm proud of the endpaper, its edge a little rounded by the paste
  hx.save();
  hx.filter = `blur(${0.25 * k}px)`;
  hx.fillStyle = "rgb(166,166,166)";
  hx.fillRect(X, Y, Wp, Hp);
  hx.restore();

  /* ── the type, set on an ink layer, then printed ── */
  const t = plateText(spec);
  const han = (s: string) => hanLangOf(s, spec.lang);
  const inkLayer = canvas(Wp, Hp);
  const ic = inkLayer.getContext("2d")!;
  ic.textAlign = "center";
  ic.textBaseline = "alphabetic";
  ic.fillStyle = look.ink;
  ic.strokeStyle = look.ink;
  const cx = Wp / 2;
  // 子持ち罫: a heavy rule and, 1.3 mm inside it, a hairline
  const m = 5;
  ic.lineWidth = mm(0.7);
  ic.strokeRect(mm(m), mm(m), Wp - 2 * mm(m), Hp - 2 * mm(m));
  ic.lineWidth = mm(0.2);
  ic.strokeRect(mm(m + 1.3), mm(m + 1.3), Wp - 2 * mm(m + 1.3), Hp - 2 * mm(m + 1.3));
  /** The widest a line may set (mm): inside the hairline frame, with room to breathe */
  const measure = w - 2 * (m + 1.3) - 8;
  /** Sets `text` centred at baseline yMm, `sizeMm` tall, shrunk to the measure when it is wider */
  const line = (text: string, role: "serif" | "sans", weight: number, sizeMm: number, yMm: number, trackMm = 0) => {
    let size = sizeMm;
    const set = () => {
      ic.font = canvasFont(role, weight, mm(size), han(text));
      trackPx(ic, mm(trackMm * (size / sizeMm)));
    };
    set();
    while (size > sizeMm * 0.5 && ic.measureText(text).width > mm(measure)) {
      size *= 0.95;
      set();
    }
    // letter-spacing adds space after the last glyph too: shift by half of it to stay centred
    ic.fillText(text, cx + mm(trackMm * (size / sizeMm)) / 2, mm(yMm));
    trackPx(ic, 0);
  };
  line(t.name, "serif", 500, 11, 38);
  if (t.local) line(t.local, "serif", 500, 4.6, 47, 1.6);
  ic.fillStyle = MUTE;
  ic.fillRect(cx - mm(6), mm(53) - mm(0.125), mm(12), mm(0.25));
  if (t.role) line(t.role, "sans", 400, 3.6, 61);
  if (t.place) line(t.place, "sans", 400, 3.6, 67);

  // print: a little starvation (speckles knocked out where the forme met less paper), then the impression
  ic.globalCompositeOperation = "destination-out";
  ic.globalAlpha = 0.16;
  ic.fillStyle = ic.createPattern(tooth(), "repeat")!;
  ic.fillRect(0, 0, Wp, Hp);
  ic.globalAlpha = 1;
  ic.globalCompositeOperation = "source-over";
  ctx.save();
  // ink sinks into the stock: multiply, and a hair of spread around the edges
  ctx.globalCompositeOperation = "multiply";
  ctx.filter = `blur(${Math.max(0.35, 0.04 * k)}px)`;
  ctx.globalAlpha = 0.35;
  ctx.drawImage(inkLayer, X, Y);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.drawImage(inkLayer, X, Y);
  ctx.restore();
  // height: the type pressed into the stock (a soft-edged dip a little wider than the ink)
  const dip = canvas(Wp, Hp);
  const dc = dip.getContext("2d")!;
  dc.drawImage(inkLayer, 0, 0);
  dc.globalCompositeOperation = "source-in";
  dc.fillStyle = "rgb(118,118,118)";
  dc.fillRect(0, 0, Wp, Hp);
  hx.save();
  hx.filter = `blur(${0.18 * k}px)`;
  hx.drawImage(dip, X, Y);
  hx.restore();

  // 落款: the owner's seal in 藍, 20 mm, pressed last (sealSquare presses it with multiply at α .9, turned −2°)
  sealSquare(ctx, X + Wp / 2, Y + mm(92), mm(20), sealChars(t.local, t.name), SEAL_INK, sealHan(spec), false, sealArtFor(spec.seal, t.local, t.name));
}

/**
 * A photograph tipped in with four photo corners (black paper, slipped over the print's corners), a hair off square, with a white
 * border like a darkroom print. The colour canvas is px; mm in.
 */
function tipIn(ctx: Ctx, hx: Ctx, k: number, x: number, y: number, w: number, h: number, img: CanvasImageSource, seed: number) {
  const rot = (hash(seed * 9.1) - 0.5) * 0.035;
  const cx = (x + w / 2) * k;
  const cy = (y + h / 2) * k;
  const draw = (target: Ctx, fn: (t: Ctx) => void) => {
    target.save();
    target.translate(cx, cy);
    target.rotate(rot);
    target.translate(-w * k * 0.5, -h * k * 0.5);
    fn(target);
    target.restore();
  };
  const b = 2.4 * k;
  draw(ctx, (t) => {
    t.save();
    t.shadowColor = "rgba(30, 20, 10, 0.3)";
    t.shadowBlur = 1.2 * k;
    t.shadowOffsetX = 0.3 * k;
    t.shadowOffsetY = 0.45 * k;
    t.fillStyle = "#f7f4ee";
    t.fillRect(0, 0, w * k, h * k);
    t.restore();
    const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || 1;
    const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 1;
    const bw = w * k - 2 * b;
    const bh = h * k - 2 * b;
    const s = Math.max(bw / iw, bh / ih);
    t.drawImage(img, (iw - bw / s) / 2, (ih - bh / s) / 2, bw / s, bh / s, b, b, bw, bh);
    // a matte print: lift the blacks a touch, warm it a hair
    t.fillStyle = "rgba(246, 236, 220, 0.08)";
    t.fillRect(b, b, bw, bh);
    // the four corners
    const cs = 7 * k;
    t.fillStyle = "#26221d";
    for (const [sx, sy] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      const ox = sx ? w * k : 0;
      const oy = sy ? h * k : 0;
      const dx = sx ? -1 : 1;
      const dy = sy ? -1 : 1;
      t.save();
      t.shadowColor = "rgba(0,0,0,0.3)";
      t.shadowBlur = 0.5 * k;
      t.shadowOffsetY = 0.2 * k;
      t.beginPath();
      t.moveTo(ox - dx * 0.8 * k, oy - dy * 0.8 * k);
      t.lineTo(ox + dx * cs, oy - dy * 0.8 * k);
      t.lineTo(ox - dx * 0.8 * k, oy + dy * cs);
      t.closePath();
      t.fill();
      t.restore();
      // the fold of the corner catches the light
      t.strokeStyle = "rgba(255,255,255,0.14)";
      t.lineWidth = 0.15 * k;
      t.beginPath();
      t.moveTo(ox + dx * cs, oy - dy * 0.8 * k);
      t.lineTo(ox - dx * 0.8 * k, oy + dy * cs);
      t.stroke();
    }
  });
  draw(hx, (t) => {
    t.filter = `blur(${0.3 * k}px)`;
    t.fillStyle = "rgb(166,166,166)";
    t.fillRect(0, 0, w * k, h * k);
  });
}
