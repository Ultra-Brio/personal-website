import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { CoverPreview } from "./CoverPreview";
import type { CoverSpec } from "./cover";
import { COVER_HEX } from "./cover-style";
import { createPocketGrid, type ContentSource, type SlotCell } from "./content/grid";
import { DEFAULT_LABELS, type BookLabels } from "./labels";
import { resolveLayout, spreadSides, type BookLayout } from "./layout";
import type { BookCard } from "./scene";
import { DEFAULT_FONT } from "./textures";

/*
 * The flat album (when 3D is not used): the same layout (layout.ts) drawn in CSS: the clear pockets, seams, holes and the rings on
 * the spine.
 * Desktop shows one spread at a time, a narrow screen one page; a page change fades in and slides in gently (with reduced motion it
 * only fades in). The card faces are real links.
 * sasshi: driven by the same layout and content as the 3D book — each item is painted by content.paintSlot into a small canvas
 * (the picture side through a front film, the message side through a back film for double-sided layouts); `label` names it, `href`
 * makes it a real link (otherwise a button). No router.
 */

export type FlatBookProps = {
  /** What the pockets hold (default: a pocket grid of `cards`) */
  content?: ContentSource;
  /** The card binder's items (shorthand) */
  cards?: BookCard[];
  /** Default: the content's layout, else idCard2x3 */
  layout?: BookLayout;
  /** Sheet count (default: what the content needs); 0 shows the case's inside only */
  sheets?: number;
  cover: CoverSpec;
  index: number;
  narrow: boolean;
  /** Closed: only the cover shows (CoverPreview) */
  closed: boolean;
  onTurn: (dir: 1 | -1) => void;
  /** An item was activated. Plain click: newTab false (an `<a>` has its default prevented). ⌘ / Ctrl / middle click on an `<a>` is left to the browser. */
  onPick?: (index: number, o: { newTab: boolean }) => void;
  labels?: Partial<BookLabels>;
};

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
/** How far the cover reaches past the pages on every side (mm, as in the 3D scene) */
const PAD = 7;

/**
 * The layout as CSS variables: the whole book's aspect ratio, the cover margin (relative to the whole book's width), the shares of
 * the content width taken by a page and by the spine
 */
function bookVars(L: BookLayout, narrow: boolean): CSSProperties {
  const inner = narrow ? L.pageW : 2 * L.pageW + 2 * L.hinge;
  const total = inner + PAD * 2;
  return {
    "--fb-ratio": (total / (L.pageH + PAD * 2)).toFixed(4),
    "--fb-pad": `calc(min(100cqw, 100cqh * ${(total / (L.pageH + PAD * 2)).toFixed(4)}) * ${(PAD / total).toFixed(4)})`,
    "--fb-side": pct(L.pageW, inner),
    "--fb-spine": pct(2 * L.hinge, inner),
    "--fb-page-ratio": (L.pageW / L.pageH).toFixed(4),
    "--fb-ring": pct(2 * L.ring.r + 2 * L.ring.wire, 2 * L.hinge),
  } as CSSProperties;
}

export function FlatBook({ content: contentProp, cards, layout: layoutProp, sheets: sheetsProp, cover, index, narrow, closed, onTurn, onPick, labels }: FlatBookProps) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const content = contentProp ?? createPocketGrid({ items: cards ?? [] });
  const layout = layoutProp ?? resolveLayout(content.layout ?? "idCard2x3");
  const count = content.items.length;
  const last = useRef({ index, narrow });
  // turning forward slides in from the right, turning back from the left
  const dir = last.current.narrow === narrow && index < last.current.index ? "prev" : "next";
  useEffect(() => {
    last.current = { index, narrow };
  });
  const sheets = sheetsProp ?? layout.sheetCount(count);
  // a horizontal swipe turns the page (touch): more than 48px across, and more than it moves vertically
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) onTurn(dx < 0 ? 1 : -1);
  };
  const hex = COVER_HEX[cover.color];
  const look = {
    // case and liner: cloth and soft leather use their base colour and liner colour; frosted PP has no liner, its inside is just the
    // translucent board
    "--fb-leather": cover.material === "frost" ? `color-mix(in oklab, ${hex.frost} 78%, transparent)` : hex.base,
    "--fb-liner": cover.material === "frost" ? `color-mix(in oklab, ${hex.frost} 60%, white)` : hex.liner,
  } as CSSProperties;
  if (closed) {
    return (
      <div className="folio-flat" style={{ ...bookVars(layout, narrow), ...look }} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (swipe.current = null)}>
        <button type="button" className="folio-flat-cover" aria-label={L.openBook} onClick={() => onTurn(1)}>
          <CoverPreview cover={cover} />
        </button>
      </div>
    );
  }
  const [left, right] = narrow ? [index % 2 === 1 ? index : -2, index % 2 === 0 ? index : -2] : spreadSides(index, sheets);
  const sideProps = { content, layout, count, onPick, labels: L };
  return (
    <div className="folio-flat" data-narrow={narrow ? "" : undefined} data-material={cover.material} style={{ ...bookVars(layout, narrow), ...look }} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (swipe.current = null)}>
      <div key={`${narrow ? "n" : "w"}${index}`} className="folio-flat-book" data-dir={dir}>
        {(!narrow || left !== -2) && <Side side={sheets === 0 ? -1 : left} mirrored title={index === 0 ? cover.title : null} {...sideProps} />}
        {!narrow && <Spine layout={layout} />}
        {(!narrow || right !== -2) && <Side side={sheets === 0 ? -1 : right} mirrored={false} title={null} {...sideProps} />}
      </div>
    </div>
  );
}

type SideProps = { side: number; mirrored: boolean; title: string | null; content: ContentSource; layout: BookLayout; count: number; onPick?: FlatBookProps["onPick"]; labels: BookLabels };

function Side({ side, mirrored, title, content, layout, count, onPick, labels }: SideProps) {
  if (side < 0) {
    // inside of the front / back cover: the liner; the inside of the front cover has the album name printed at its lower left
    return (
      <div className="folio-flat-liner" data-side={mirrored ? "left" : "right"}>
        {title && <p className="folio-flat-ex">{title}</p>}
      </div>
    );
  }
  const holeX = mirrored ? layout.pageW - layout.hole.x : layout.hole.x;
  const face = layout.faceOf(side);
  return (
    <div className="folio-flat-page" data-side={mirrored ? "left" : "right"}>
      {layout.rings.map((y) => (
        <span
          key={y}
          className="folio-flat-hole"
          aria-hidden="true"
          style={{ left: pct(holeX - layout.hole.r, layout.pageW), top: pct(layout.pageH / 2 - y - layout.hole.r, layout.pageH), width: pct(layout.hole.r * 2, layout.pageW) } as CSSProperties}
        />
      ))}
      {Array.from({ length: layout.perSide }, (_, s) => {
        const r = layout.pocketRect(s, mirrored);
        const i = layout.itemIndex(side, s, count);
        const at = i >= 0 ? layout.itemRect(s, mirrored, i + 1, face === "back") : null;
        const cell: SlotCell | null = at && { side, slot: s, index: i, face, mirrored, pocket: r, place: { ...at, r: layout.item.r }, seed: i + 1 };
        return (
          <div key={s} className="folio-flat-pocket" style={{ left: pct(r.x, layout.pageW), top: pct(r.y, layout.pageH), width: pct(r.w, layout.pageW), height: pct(r.h, layout.pageH) }}>
            {cell && <Item cell={cell} content={content} layout={layout} onPick={onPick} labels={labels} />}
          </div>
        );
      })}
    </div>
  );
}

function Item({ cell, content, layout, onPick, labels }: { cell: SlotCell; content: ContentSource; layout: BookLayout; onPick?: FlatBookProps["onPick"]; labels: BookLabels }) {
  const item = content.items[cell.index]!;
  const props = { className: "folio-flat-item", draggable: false };
  const inner = (
    <>
      <ItemCanvas cell={cell} content={content} layout={layout} />
      <span className="folio-sr">{labels.openCard(item.label ?? item.id, item)}</span>
    </>
  );
  if (item.href) {
    return (
      <a
        {...props}
        href={item.href}
        onClick={(e: MouseEvent) => {
          if (!onPick || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onPick(cell.index, { newTab: false });
        }}
      >
        {inner}
      </a>
    );
  }
  return (
    <button {...props} type="button" onClick={(e) => onPick?.(cell.index, { newTab: e.metaKey || e.ctrlKey })}>
      {inner}
    </button>
  );
}

/** The item painted by the content (the same painter as the 3D sides) into a canvas the size of its pocket; repainted as pictures arrive */
function ItemCanvas({ cell, content, layout }: { cell: SlotCell; content: ContentSource; layout: BookLayout }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { side, slot, index, face } = cell;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = 3.2 * Math.min(2, window.devicePixelRatio || 1);
    const p = cell.pocket;
    c.width = Math.max(1, Math.round(p.w * k));
    c.height = Math.max(1, Math.round(p.h * k));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const images = new Map<string, HTMLImageElement>();
    const paint = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(k, 0, 0, k, -p.x * k, -p.y * k);
      content.paintSlot(ctx, cell, { layout, pxPerMm: k, font: DEFAULT_FONT, image: (src) => images.get(src) ?? null });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    paint();
    let dead = false;
    for (const src of content.sources(index, face)) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (dead) return;
        images.set(src, img);
        paint();
      };
      img.src = src;
    }
    return () => {
      dead = true;
    };
    // the cell is derived from these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, layout, side, slot, index, face]);
  return <canvas ref={ref} aria-hidden="true" />;
}

/** Spine: a row of rings on the base */
function Spine({ layout }: { layout: BookLayout }) {
  return (
    <div className="folio-flat-spine" aria-hidden="true">
      {layout.rings.map((y) => (
        <span key={y} className="folio-flat-ring" style={{ top: pct(layout.pageH / 2 - y, layout.pageH) }} />
      ))}
    </div>
  );
}
