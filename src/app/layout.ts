import { useSyncExternalStore } from "react";
import type { LightFade } from "../book/scene";

/*
 * The page's grid (spec §1.5): one place that turns the viewport into the words column, the book box and the camera insets, so the
 * CSS (through custom properties on <html>), the 3D engine (insets) and the window light (§1.4) always agree.
 *
 *   d  desktop ≥ 1360 wide           m 48, gutter 24, 12 columns; words column 204; one empty column of 間 before the book box
 *                                    above 1440 × 900 the book box grows and the book leans to the middle (the words keep their
 *                                    size: scaleOf, K_MAX); wider than 2.1 : 1 it stops at 2.1 H and stands centred
 *   s  desktop 961–1359              m 40
 *   t  tablet / narrow window 601–960   the phone structure with m 32
 *   p  phone portrait ≤ 600          m 20 + safe areas; book box full width from 150 to H − 104
 *   l  phone landscape (height ≤ 500, wider than tall)   words column 172 at the left, the book box beside it
 *
 * The DOM never clips the canvas: the canvas is full-bleed and the book is framed into the box by the camera (insets).
 */

export type LayoutClass = "d" | "s" | "t" | "p" | "l";
/** Edges in viewport px: left / top are x / y of the near edges, right / bottom of the far ones. */
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Safe = { top: number; right: number; bottom: number; left: number };
/** What the engine is told (src/book/scene.ts Insets): `anchor` is the x the book leans toward on a desk. */
export type Insets = { top: number; bottom: number; left?: number; right?: number; anchor?: number };
type Sides = Required<Omit<Insets, "anchor">> & Pick<Insets, "anchor">;

export type Frame = {
  cls: LayoutClass;
  W: number;
  H: number;
  /** margin, gutter, column */
  m: number;
  g: number;
  c: number;
  /**
   * The desk's scale (brief r4 E3): the 1440 × 900 composition drawn k times larger — margins, gutters, the words column, its type,
   * the rows and the controls. 1 at 1440 × 900 and below, on every phone and tablet.
   */
  k: number;
  /** Where the composition starts: 0, or the empty desk at each side of a very wide one (centred, at most WIDE × H wide). */
  x0: number;
  safe: Safe;
  /** the words column (desktop and landscape; on phones the header) */
  words: Rect;
  /** where the book lies */
  box: Rect;
  /** what the engine is told (the box widened by the frame padding on a desk) */
  insets: Sides;
  /**
   * What the engine is told for the two albums (brief r3 D3): their open spreads are wide and width-bound, so on a desk they reach
   * left into the 間 column, but the album itself stands a margin (m) clear of the words column, and its insets keep a margin at
   * the right, where the hashira stands. Elsewhere the same as `insets`.
   */
  wide: Sides;
  /**
   * The card album's: its case keeps more air inside its insets than the postcard album's (≈ 16 px against ≈ 8 at 1440 × 900), so
   * they reach 12 px further left for the same margin to the words, which also keeps it near the brief's 560 px open height (561 in
   * the frosted case, 558 in its leather default).
   */
  wideCards: Sides;
  /** fine pointer, coarse pointer */
  coarse: boolean;
};

export const WORDS = 204;
export const ROW = 40;
/**
 * The reference desk the composition is drawn for, its largest scale, and the widest it stands (× H) before it is centred. K_MAX is 1:
 * on a large desk only the book grows (it fills the box and leans to the middle of the screen), the words, the hashira and the rows
 * stay at their 1440 size (the owner, 2026-10-20: the scaled words read too large). Raise it to let them grow with the screen.
 */
const REF_W = 1440;
const REF_H = 900;
const K_MAX = 1;
const WIDE = 2.1;

export function classOf(W: number, H: number): LayoutClass {
  if (H <= 500 && W > H) return "l";
  if (W <= 600) return "p";
  if (W <= 960) return "t";
  if (W < 1360) return "s";
  return "d";
}

/**
 * The desk's scale (brief r4 E3): k = clamp(min(W / 1440, H / 900), 1, K_MAX), so the composition grows with the smaller of the two
 * ratios — it always fits — and a 1440 × 900 desk (or anything smaller) is drawn as before. Only a desk (class d) is ever above 1;
 * with K_MAX at 1, none is.
 */
export function scaleOf(W: number, H: number): number {
  return classOf(W, H) === "d" ? Math.min(K_MAX, Math.max(1, Math.min(W / REF_W, H / REF_H))) : 1;
}

const ZERO: Safe = { top: 0, right: 0, bottom: 0, left: 0 };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function frameOf(W: number, H: number, safe: Safe = ZERO, coarse = false): Frame {
  const cls = classOf(W, H);
  if (cls === "d" || cls === "s") {
    const k = scaleOf(W, H);
    const m = r2((cls === "d" ? 48 : 40) * k);
    const g = r2(24 * k);
    const words = r2(WORDS * k);
    const row = ROW * k;
    // A very wide desk (21:9) would pull the words a long way from the book: the composition stops at WIDE × H and stands in the
    // middle, the desk going on at both sides (the canvas, the light and the book's shadow still fill the window)
    const Wc = cls === "d" ? Math.min(W, Math.round(WIDE * H)) : W;
    const x0 = Math.round((W - Wc) / 2);
    const c = (Wc - 2 * m - 11 * g) / 12;
    // the book box fills the grid from one column of 間 after the words to the right margin, where the hashira stands
    const left = Math.round(x0 + m + words + 2 * g + c);
    const box = { left, top: m, right: x0 + Wc - m, bottom: r2(H - m - row - g) };
    // every booklet leans toward the middle of the screen as far as its box leaves room (Insets.anchor: it never gets smaller for it)
    const anchor = W / 2;
    const insets = { left: r2(box.left - 12 * k), right: r2(W - box.right - 12 * k), top: r2(box.top - 24 * k), bottom: r2(H - box.bottom - 24 * k), anchor };
    // the albums: from the 間 line (a margin after the words column) to a margin short of the right edge of the composition
    const albums = { ...insets, left: Math.min(insets.left, x0 + m + words + m), right: Math.max(insets.right, W - box.right) };
    return {
      cls, W, H, m, g, c, k, x0, safe, coarse,
      words: { left: x0 + m, top: m, right: x0 + m + words, bottom: H - m },
      box,
      // the résumé reaches to the 間 line too, so it can come to the middle (the owner, 2026-10-20: the book as central as it can be)
      insets: { ...insets, left: albums.left },
      wide: albums,
      wideCards: { ...albums, left: r2(albums.left - 12 * k) },
    };
  }
  if (cls === "l") {
    const left = 20 + safe.left;
    const box = { left: 212 + safe.left, top: 8, right: W - 8 - safe.right, bottom: H - 8 };
    const insets = { left: box.left, right: W - box.right, top: box.top, bottom: H - box.bottom };
    return {
      cls, W, H, m: 16, g: 16, c: 0, k: 1, x0: 0, safe, coarse,
      words: { left, top: 16, right: left + 172, bottom: H - 16 },
      box,
      insets,
      wide: insets,
      wideCards: insets,
    };
  }
  // phone portrait and the tablet: a header, the book box full width, a hint and the bottom row
  const m = cls === "t" ? 32 : 20;
  const box = cls === "t" ? { left: 0, top: 220 + safe.top, right: W, bottom: H - 112 - safe.bottom } : { left: 0, top: 150 + safe.top, right: W, bottom: H - 104 - safe.bottom };
  const insets = { left: 0, right: 0, top: box.top, bottom: H - box.bottom };
  return {
    cls, W, H, m, g: 16, c: 0, k: 1, x0: 0, safe, coarse,
    words: { left: m + safe.left, top: m + safe.top, right: W - m - safe.right, bottom: box.top },
    box,
    insets,
    wide: insets,
    wideCards: insets,
  };
}

/* ------------------------------------------------------------------ the window light (§1.4): C's geometry, per class */
export type LightGeo = { patch: [number, number][]; bars: [number, number, number, number, number][]; twig: string; blur: { patch: number; bar: number; umbra: number; penumbra: number } };
type Ref = { w: number; h: number; patch: [number, number][]; bars: [number, number, number, number, number][]; twig: [number, number, number] };
const REF: Record<"d" | "s" | "p" | "l", Ref> = {
  d: { w: 1440, h: 900, patch: [[560, -60], [1520, -60], [1520, 690], [1240, 960], [300, 960]], bars: [[910, -60, 730, 960, 16]], twig: [560, -14, 1] },
  s: { w: 1280, h: 720, patch: [[500, -60], [1360, -60], [1360, 560], [1100, 780], [280, 780]], bars: [[800, -60, 650, 780, 14]], twig: [500, -14, 0.85] },
  p: { w: 390, h: 844, patch: [[150, -40], [470, -40], [470, 640], [40, 900]], bars: [[322, -40, 214, 900, 12], [60, 300, 470, 250, 10]], twig: [70, 96, 0.4] },
  l: { w: 844, h: 390, patch: [[380, -40], [900, -40], [900, 300], [700, 420], [200, 420]], bars: [[600, -40, 520, 420, 10]], twig: [390, -6, 0.42] },
};

/** The light for a viewport: the class's reference geometry scaled by W / Wref and H / Href (the twig uniformly). */
export function lightOf(f: Frame): LightGeo {
  const ref = REF[f.cls === "t" ? "p" : f.cls];
  const sx = f.W / ref.w;
  const sy = f.H / ref.h;
  const small = f.cls === "p" || f.cls === "t" || f.cls === "l";
  const k = Math.sqrt(sx * sy);
  const [tx, ty, ts] = ref.twig;
  return {
    patch: ref.patch.map(([x, y]) => [x * sx, y * sy]),
    bars: ref.bars.map(([x1, y1, x2, y2, w]) => [x1 * sx, y1 * sy, x2 * sx, y2 * sy, w * Math.min(1.25, k)]),
    twig: `translate(${(tx * sx).toFixed(1)} ${(ty * sy).toFixed(1)}) scale(${(ts * k).toFixed(3)})`,
    blur: small ? { patch: 9, bar: 5, umbra: 1.1, penumbra: 5 } : { patch: 16, bar: 10, umbra: 2.2, penumbra: 12 },
  };
}

const NONE = { from: 0, to: 0 };
/**
 * Where the window light must keep off the words (brief r3 D2; Book.setLightFade), in screen space: for each viewport edge, the
 * distance in CSS px from that edge up to which the engine's sun and its shadows on the desk are gone (`from`) and from which they
 * are whole (`to`; equal: no fade). Desk: the words column and a gutter at the left, the hashira's margin at the right, the hands row
 * at the foot. Phones: the header and the foot; held sideways: the words column. The pattern itself is fixed to the desk; only this
 * mask is the screen's, so it never drifts onto the words while the camera moves.
 */
export function lightFade(f: Frame): LightFade {
  if (f.cls === "d" || f.cls === "s") {
    // (scaled with the desk; at the right, from the composition's margin, where the hashira stands)
    const r = f.W - f.box.right;
    return { left: { from: f.words.right + f.g, to: f.words.right + 3 * f.g }, right: { from: r, to: r + f.m }, top: NONE, bottom: { from: r2(f.m + (ROW + 4) * f.k), to: r2(f.m + (ROW + 28) * f.k) } };
  }
  if (f.cls === "l") return { left: { from: 200 + f.safe.left, to: 260 + f.safe.left }, right: NONE, top: NONE, bottom: NONE };
  const t = f.cls === "t";
  return { left: NONE, right: NONE, top: { from: (t ? 200 : 128) + f.safe.top, to: (t ? 260 : 196) + f.safe.top }, bottom: { from: (t ? 108 : 100) + f.safe.bottom, to: (t ? 140 : 132) + f.safe.bottom } };
}

/* ------------------------------------------------------------------ the held object (§1.6.10, brief O2) */
export type HeldKind = "resume" | "card" | "ticket" | "polaroid" | "note" | "cards" | "postcards";
/** Width × height at 1440 × 900 (the box there is 1002 × 740). Heights of the snapshots follow their images. */
const HELD: Record<HeldKind, [number, number]> = {
  resume: [960, 690],
  card: [600, 600],
  ticket: [780, 390],
  polaroid: [420, 511],
  note: [300, 666],
  cards: [680, 429],
  postcards: [860, 610],
};
/**
 * Phones: each object's width at 390 wide (CSS px) and its own shape (width / height: the résumé one A4 page, the card closed), so
 * the thing fills its rect and nothing floats in empty space between it and the caption.
 */
const HELD_PHONE: Record<HeldKind, [number, number]> = {
  resume: [315, 210 / 297],
  card: [342, 91 / 55],
  ticket: [358, 150 / 58],
  polaroid: [270, 88 / 107],
  note: [190, 82 / 182],
  cards: [342, 85.6 / 54],
  postcards: [358, 148 / 105],
};
/** The business card opened flat: two panels, 91 × 110. */
const CARD_OPEN = 91 / 110;
/** How large, and how low, the paper viewer draws a phone's paper against its rect, until it says so itself (see held, Rest). */
const PAPER_REST = { resume: { size: 0.96, up: 0.02 }, card: { size: 0.97, up: 0.02 }, open: { size: 0.958, up: 0.026 } };
/** The polaroid is held a little askew (ItemDetail's --rot). */
export const POLAROID_TILT = (2 * Math.PI) / 180;
/** On a phone the caption keeps at least this much under the object: the count, the title, the local name, two lines of anecdote. */
const CAPTION_MIN = 150;
/**
 * The résumé on a phone (brief r4 E4): one page as wide as the screen less its margins, held right under the identity (the tabs
 * are gone while a thing is held); its caption keeps at least the count, the title and the kind's name whole (20 + 10 + 26 + 4 +
 * 18; the rest scrolls), so a short phone (375 × 667, 396 × 690) holds the page a little narrower: there a full-width A4 page
 * would leave the caption less than its count.
 */
const PHONE_RESUME = { top: 64, caption: 78 };
/** The phone's bottom row (44 at 20) and the 8 px above it. */
const PHONE_FOOT = 72;

/**
 * Where the held thing lies. `host` is the element it is drawn in, `obj` the object itself: the same rect for the stills and the
 * album things; the paper viewer's host is the paper plus the viewer's own gutters (src/paper/viewer.ts: x max(16, 3 %), y max(12,
 * 2 %)), so the paper lands on `obj`. On a phone the object's top edge sits 24 px under the book box's top (the résumé's page: under
 * the identity, PHONE_RESUME) and the caption hangs 14 px under its foot; `open`: the business card unfolded (the same width, twice
 * as tall: the caption moves down).
 */
export type Held = { host: Rect; obj: Rect };
/**
 * Where the paper viewer says its paper comes to rest (PaperViewer.restRect), in px from its host's top-left, and the host's size
 * it was measured in: the phone's paper is placed by it (a measure taken in another host size is ignored).
 */
export type Rest = Rect & { w: number; h: number };
export function held(f: Frame, kind: HeldKind, o: { open?: boolean; flat?: boolean; rest?: Rest | null | undefined } = {}): Held {
  const side = sideBox(f);
  if (side) {
    const host = deskRect(f, kind, side);
    return { host, obj: host };
  }
  if (f.cls === "p" || f.cls === "t") {
    const [w0, aspect] = HELD_PHONE[kind];
    const s = Math.min(1.5, (f.W - (f.cls === "t" ? 64 : 0)) / 390);
    const page = kind === "resume";
    const top = page ? f.m + f.safe.top + PHONE_RESUME.top : f.box.top + 24;
    // what the object may take before the caption's own minimum and the bottom row
    const room = f.H - f.safe.bottom - PHONE_FOOT - (page ? PHONE_RESUME.caption : CAPTION_MIN) - 14 - top;
    // the résumé's page is measured as the viewer draws it (PAPER_REST.size of its rect): that page is as wide as the screen less
    // its margins, and it is what must fit above the caption
    const fill = page && !o.flat ? PAPER_REST.resume.size : 1;
    // the content gutter on each side (16 on a phone, the margin on the tablet)
    let w = page ? (f.W - 2 * f.m - f.safe.left - f.safe.right) / fill : Math.min(w0 * s, f.W - 2 * (f.cls === "t" ? f.m : 16));
    // the card is sized open, so opening it never changes its scale; the askew polaroid reaches a little lower
    w = Math.min(w, (Math.max(80, room - (kind === "polaroid" ? 12 : 0)) * (kind === "card" ? CARD_OPEN : aspect)) / fill);
    const h = w / (kind === "card" && o.open ? CARD_OPEN : aspect);
    const cx = f.W / 2;
    const obj = { left: cx - w / 2, top, right: cx + w / 2, bottom: top + h };
    if (kind === "polaroid") {
      // held at −2° (ItemDetail): its top corner rises and its foot corner drops by about half its width × sin 2°
      const lift = (w * Math.sin(POLAROID_TILT) + h * (Math.cos(POLAROID_TILT) - 1)) / 2;
      const host = { left: obj.left, top: top + lift, right: obj.right, bottom: obj.bottom + lift };
      return { host, obj: { ...host, top, bottom: host.bottom + lift } };
    }
    if (kind !== "resume" && kind !== "card") return { host: obj, obj };
    // the paper viewer frames the card with 3 mm round it (src/paper/card.ts), then keeps its gutters (viewer.ts gutter: x max(16,
    // 3 %), y max(12, 2 %)); the résumé's page is framed as it is
    const fm = kind === "card" ? (3 * w) / 91 : 0;
    const fw = w + 2 * fm;
    const fh = h + 2 * fm;
    const hw = Math.max(fw + 32, fw / 0.94);
    const hh = Math.max(fh + 24, fh / 0.96);
    // the viewer's own word for where the paper lies in this host: the host moves so the paper's top lands on `top`
    const r = o.rest;
    if (r && !o.flat && Math.abs(r.w - hw) < 1 && Math.abs(r.h - hh) < 1) {
      const left = cx - hw / 2;
      const hostTop = top - r.top;
      return { host: { left, top: hostTop, right: left + hw, bottom: hostTop + hh }, obj: { left: left + r.left, top, right: left + r.right, bottom: top + r.bottom - r.top } };
    }
    // Until it has: the viewer's camera looks from a little in front (its far edge foreshortened) and keeps room inside the window for a
    // résumé sheet standing up mid-turn (src/paper/resume.ts air): it draws the paper at about PAPER_REST.size of its rect, a little
    // low in the host (measured at 360 × 800, 390 × 844, 834 × 1112). The host moves up by PAPER_REST.up of the paper's height, and
    // the caption hangs under the paper as it is drawn.
    // (the DOM paper, no WebGL, fills its padded host exactly)
    const k = o.flat ? { size: 1, up: 0 } : PAPER_REST[kind === "card" && o.open ? "open" : kind];
    const up = k.up * h;
    return { host: { left: cx - hw / 2, top: top - fm - (hh - fh) / 2 - up, right: cx + hw / 2, bottom: top + h + fm + (hh - fh) / 2 - up }, obj: { left: cx - (k.size * w) / 2, top, right: cx + (k.size * w) / 2, bottom: top + k.size * h } };
  }
  const host = deskRect(f, kind);
  return { host, obj: host };
}

/**
 * The width in device px a held still (the ticket, the polaroid, the note) is rendered at: the object's own width in its rect (all
 * three are width-bound there), at 2–3×; the still's baked shadow margin is added round it.
 */
export function stillPx(rect: Rect): number {
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  return Math.round((rect.right - rect.left) * Math.max(2, Math.min(3, dpr)));
}

/** Where the held object is drawn (see held). */
export function heldRect(f: Frame, kind: HeldKind, o: { open?: boolean; flat?: boolean; rest?: Rest | null } = {}): Rect {
  return held(f, kind, o).host;
}

/** The caption column of a detail view held side by side (sideBox), and the gap after it. */
export const SIDE_COL = 248;
/**
 * A tablet-sized window held landscape (900 × 600) keeps the phone structure for the page, but its detail view is set as on a desk:
 * a portrait phone stacks the object over the caption, and a landscape window has no height for that. The caption goes in a column
 * at the left (SIDE_COL), the object in the box beside it (under the identity's top, over the bottom row). Null for every other frame.
 */
export function sideBox(f: Frame): Rect | null {
  if ((f.cls !== "t" && f.cls !== "p") || f.W <= f.H) return null;
  const left = f.m + f.safe.left + SIDE_COL + 2 * f.g;
  return { left, top: f.m + f.safe.top, right: f.W - f.m - f.safe.right - 28, bottom: f.H - f.m - f.safe.bottom - 44 - f.g };
}

/**
 * The width the paper viewer's host keeps per px of its height on a desk before the paper would get smaller: the résumé spread (two
 * A4 pages with the viewer's gutters, ≈ 1.3) and the business card (opened, its two 91 × 55 panels one above the other: 91 × 110 in
 * a 3 mm frame, ≈ 0.9), with room.
 */
const HOST_ASPECT = { resume: 1.5, card: 1 };
/**
 * Desks and sideways phones: in the book box at the brief's sizes, leaning toward the middle of the screen on a desk (`box`: another
 * box for the detail view, see sideBox, where it stands in the middle of that box).
 */
function deskRect(f: Frame, kind: HeldKind, box: Rect = f.box): Rect {
  const bw = box.right - box.left;
  const bh = box.bottom - box.top;
  // the paper viewer frames the résumé spread and the open card itself, keeping air for a sheet in flight: its host is the whole
  // box, a little wider (the viewer's canvas overscans the host, so nothing is ever cut)
  // The viewer keeps a 4 % gutter and, above the spread, room for a sheet standing up mid-turn (inside the window), so the résumé's
  // host reaches down to the hands row: the spread's foot then lands on the box's foot and the spread is as large as the window
  // lets it be (≈ 930 wide at 1440 × 900).
  const pad = 24 * f.k;
  // On a desk the held thing leans toward the middle of the screen like the book (layout Insets.anchor), as far as its box allows
  const mid = box === f.box ? f.W / 2 : null;
  if (kind === "resume" || kind === "card") {
    const r = { left: box.left - pad, top: box.top, right: box.right + pad, bottom: kind === "resume" && box === f.box ? f.H - f.m - ROW * f.k : box.bottom };
    if (mid === null) return r;
    // the viewer draws the paper as large as the host's height lets it while the host is at least HOST_ASPECT × its height wide:
    // narrower than the box by as much as that leaves, centred on the screen's middle where it can be
    const half = Math.max(Math.min(r.right - r.left, (r.bottom - r.top) * HOST_ASPECT[kind]) / 2, Math.min(mid - r.left, r.right - mid));
    const cx = Math.min(Math.max(mid, r.left + half), r.right - half);
    return { ...r, left: cx - half, right: cx + half };
  }
  // (a larger desk holds them larger with the rest of the composition: brief r4 E3)
  const s = Math.max(0.4, Math.min(1.3 * f.k, bw / 1002, bh / 740));
  const [w0, h0] = HELD[kind];
  let w = w0 * s;
  let h = h0 * s;
  // never past the box (a little air on every side)
  const k = Math.min(1, (bw - 16) / w, (bh - 8) / h);
  w *= k;
  h *= k;
  // (a margin and a gutter of air after the 間 line, so a small desk does not push it against the caption column)
  const cx = mid === null ? (box.left + box.right) / 2 : Math.min(Math.max(mid, box.left + f.m + f.g + w / 2), box.right - 8 - w / 2);
  const cy = (box.top + box.bottom) / 2;
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

/* ------------------------------------------------------------------ one live frame for the page */
function readSafe(): Safe {
  if (typeof document === "undefined") return ZERO;
  const probe = document.getElementById("safe-probe");
  if (!probe) return ZERO;
  const s = getComputedStyle(probe);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
}
function readCoarse(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

let current: Frame | null = null;
const subs = new Set<() => void>();

/** Writes the frame onto <html>: data-layout, and the edges the CSS places things by. */
function publish(f: Frame): void {
  const root = document.documentElement;
  root.dataset.layout = f.cls;
  const set = (k: string, v: number) => root.style.setProperty(k, `${Math.round(v * 100) / 100}px`);
  set("--m", f.m);
  set("--g", f.g);
  set("--col", f.c);
  set("--box-l", f.box.left);
  set("--box-t", f.box.top);
  set("--box-r", f.box.right);
  set("--box-b", f.box.bottom);
  set("--box-w", f.box.right - f.box.left);
  set("--box-h", f.box.bottom - f.box.top);
  // the 間 line the albums keep clear of the words (their focus ring's left edge)
  set("--wide-l", f.wide.left);
  set("--vw", f.W);
  set("--vh", f.H);
  // the desk's scale (a number: the CSS multiplies its type, rows and controls by it) and where the composition starts
  root.style.setProperty("--k", String(Math.round(f.k * 10000) / 10000));
  set("--x0", f.x0);
}

function measure(): Frame {
  const f = frameOf(window.innerWidth, window.innerHeight, readSafe(), readCoarse());
  const same = current && current.W === f.W && current.H === f.H && current.cls === f.cls && current.safe.top === f.safe.top && current.safe.bottom === f.safe.bottom && current.safe.left === f.safe.left && current.safe.right === f.safe.right;
  if (!same) {
    current = f;
    publish(f);
  }
  return current!;
}

let listening = false;
function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const on = () => {
    const before = current;
    measure();
    if (current !== before) for (const fn of subs) fn();
  };
  window.addEventListener("resize", on);
  window.addEventListener("orientationchange", on);
}

/** Call once before the first render (main.tsx): the CSS has its numbers before anything paints. */
export function initFrame(): Frame {
  listen();
  return measure();
}

export function getFrame(): Frame {
  return current ?? initFrame();
}

/** The live frame; components re-render when the viewport changes class or size. */
export function useFrame(): Frame {
  return useSyncExternalStore(
    (fn) => {
      listen();
      subs.add(fn);
      return () => subs.delete(fn);
    },
    getFrame,
    getFrame,
  );
}
