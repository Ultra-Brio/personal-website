import { ensureFonts, type FontRun } from "../../fonts";
import { printWebOn, usePrintWeb } from "./paint";
import type { BookLayout, LayoutPreset, LayoutSpec, Rect } from "../layout";
import { paintFlatCard } from "../textures";

/*
 * What a pocket-grid book holds (BookOptions.content). Pure canvas, no three: the engine loads the pictures a face asks for, then paints
 * each side as chrome (film, seams, holes) → paintSlot for every filled pocket → overlay (the film's haze and the pocket mouth).
 * Item order: sides in reading order, pockets row by row from the top-left of each side (layout.itemIndex). In a double-sided layout
 * (postcards) one item fills a pocket for both sides of the sheet: the front film shows its "front" face, the back film its "back".
 */

export type SlotFace = "front" | "back";

/** What the shell needs of an item: an id (onPick), a name (screen readers, the flat book) and an optional link. */
export type ContentItem = { id: string; label?: string; href?: string };

export type SlotCell = {
  side: number;
  slot: number;
  /** Item index in `items` */
  index: number;
  face: SlotFace;
  /** This side is a sheet's back, seen on the left with the holes on the right */
  mirrored: boolean;
  /** The pocket (mm, the side as seen: x right, y down) */
  pocket: Rect;
  /** Where the item lies: the layout's item size, centred with a small fixed jitter, its tilt (rad) and corner radius (mm) */
  place: Rect & { tilt: number; r: number };
  /** Stable per item (index + 1): use it for any deterministic variation */
  seed: number;
};

export type PaintEnv = {
  layout: BookLayout;
  /** Canvas pixels per mm (for blurs and hairlines that should stay a pixel wide) */
  pxPerMm: number;
  /** The book's UI font stack (theme.font) */
  font: string;
  /** sasshi: the page's serif and mono stacks (theme.serif / theme.mono); painters fall back to their system stacks */
  serif?: string;
  mono?: string;
  /** A picture this face asked for in sources(), once it has loaded (null until then, or when it failed) */
  image(src: string): CanvasImageSource | null;
};

export interface ContentSource {
  readonly items: readonly ContentItem[];
  /** The layout this content is made for; BookOptions.layout wins when both are given */
  readonly layout?: LayoutPreset | LayoutSpec;
  /** Picture URLs a face needs; the side is painted at once with what is there, and once more when they have all arrived */
  sources(index: number, face: SlotFace): readonly string[];
  /**
   * Resolves when the web-font glyphs the faces print have loaded (src/fonts ensureFonts with the exact strings: 郵便はがき, the 和色
   * kanji, the handwriting). Canvas text never fetches a font by itself, so a host that painted a side before this resolves paints it
   * once more (as it does when the pictures arrive). Never rejects.
   */
  readonly ready?: Promise<void>;
  /** Paints one item in its pocket; ctx is already in mm (see SlotCell). Draw only inside `place` (a little shadow around it is fine). */
  paintSlot(ctx: CanvasRenderingContext2D, cell: SlotCell, env: PaintEnv): void;
}

/** A pocket-grid item: an id, a picture or a colour, a name, a link */
export type PocketItem = ContentItem & { src?: string; color?: string | null };

export type SlotPainter<T> = (ctx: CanvasRenderingContext2D, item: T, cell: SlotCell, env: PaintEnv) => void;

/**
 * Today's card behaviour: each item is a rounded card in its colour with its picture (src) on it. `paint` replaces the face (see
 * cards.ts / postcards.ts); `sources` says which pictures a face needs (default: src, on the front face only).
 */
export function createPocketGrid<T extends PocketItem>(o: {
  items: readonly T[];
  paint?: SlotPainter<T>;
  sources?: (item: T, face: SlotFace) => readonly string[];
  layout?: LayoutPreset | LayoutSpec;
  /**
   * the strings the faces print; `ready` follows them. They are fetched FONTS_AFTER_PAINT ms after the first face is painted with all
   * its pictures in (the moment the engine counts the first spread as loaded and shows the book), or FONTS_LATEST ms after this call
   * at the latest: the booklet's first paint never waits on the kanji, the handwriting or 郵便はがき (spec §1.3: ≤ 250 KB of woff2
   * before it). Until then the faces print in the system Mincho / Gothic behind the web face; the engine paints every side once more
   * when they are in, while the cover is still swinging open. A content made once a book has printed in the web faces (the same album in
   * another language, a booklet opened later) loads its faces at once: `ready` then says when its sides can be painted in them.
   */
  fonts?: readonly FontRun[];
}): ContentSource {
  const paint: SlotPainter<T> = o.paint ?? paintPlainCard;
  const sources = o.sources ?? ((item: T, face: SlotFace) => (face === "front" && item.src ? [item.src] : []));
  let kick = () => {};
  const runs = o.fonts?.length ? [...o.fonts] : null;
  const ready = !runs
    ? undefined
    : printWebOn()
      ? ensureFonts(runs)
      : new Promise<void>((go) => {
          const timer = setTimeout(go, FONTS_LATEST);
          kick = () => {
            kick = () => {};
            clearTimeout(timer);
            setTimeout(go, FONTS_AFTER_PAINT);
          };
        }).then(() => {
          usePrintWeb();
          return ensureFonts(runs);
        });
  return {
    items: o.items,
    layout: o.layout,
    ...(ready && { ready }),
    sources: (i, face) => {
      const item = o.items[i];
      return item ? sources(item, face) : [];
    },
    paintSlot(ctx, cell, env) {
      const item = o.items[cell.index];
      if (!item) return;
      paint(ctx, item, cell, env);
      if (sources(item, cell.face).every((src) => env.image(src))) kick();
    },
  };
}

/**
 * Whether `b` can take `a`'s place in a built book without building it again (the same album in another language, brief r4 E1): the
 * same layout and the same items in the same pockets (ids), each face needing the same pictures. The host then keeps its sheets and
 * paints every side again from `b` once `b.ready` (its fonts) has settled — the pictures are the ones it holds already.
 */
export function sameGrid(a: ContentSource, b: ContentSource): boolean {
  if (a.items.length !== b.items.length || JSON.stringify(a.layout ?? null) !== JSON.stringify(b.layout ?? null)) return false;
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((s, i) => s === y[i]);
  return a.items.every((it, i) => it.id === b.items[i]!.id && same(a.sources(i, "front"), b.sources(i, "front")) && same(a.sources(i, "back"), b.sources(i, "back")));
}

/** The content's print faces are requested this long after the first complete face is painted (ms)… */
const FONTS_AFTER_PAINT = 600;
/** …or this long after the content is made, at the latest (a book that never paints a side, a picture that never loads). */
const FONTS_LATEST = 3000;

/** The default painter: the card binder's flat card (colour, picture, shadow, edge) — pixel for pixel what the card binder always drew */
export function paintPlainCard(ctx: CanvasRenderingContext2D, item: PocketItem, cell: SlotCell, env: PaintEnv) {
  const img = item.src ? env.image(item.src) : null;
  paintFlatCard(ctx, cell.place, { w: cell.place.w, h: cell.place.h, r: cell.place.r }, item.color ?? null, img, env.pxPerMm);
}
