import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { AlbumCard } from "../profile/schema";
import type { SceneAddon } from "./addon";
import type { CaseSpec } from "./binder";
import { createCardContent } from "./content/cards";
import { createPocketGrid, type ContentSource } from "./content/grid";
import { createPostcardContent, type PostcardItem } from "./content/postcards";
import { FlatBook } from "./FlatBook";
import { DEFAULT_COVER, type CoverSpec } from "./cover";
import { DEFAULT_LABELS, type BookLabels } from "./labels";
import { resolveLayout, spreadSides, type LayoutPreset, type LayoutSpec } from "./layout";
import type { Book, BookCard, BookQuality, BookSoundName, BookSoundOptions, BookState, BookTheme, Insets } from "./scene";
import { canRender3d } from "./support";
import "./book.css";

/*
 * The React shell around the 3D album, modal-free: it fills its parent element (give the parent a size), mounts the scene through a dynamic
 * import of ./scene (three only loads when a 3D book is actually shown), and brings its own prev / next / open-close buttons.
 * Falls back to FlatBook when WebGL is not worth it (canRender3d), when createBook fails or the
 * context stays lost (a lost context the browser gives back within the scene's RESTORE_WAIT is rebuilt in place: no fallback). Unlike CardArt's AlbumBook it never refuses portrait phones: below 700 px wide (or a tall box) the engine runs in its
 * narrow mode, one page at a time. Browser-only: mount it on the client.
 * What it holds: `content` (a ContentSource), or `items` + `kind` ("cards" → createCardContent, "postcards" → createPostcardContent),
 * or the card binder's `cards`. A ring-less folio: sheets={0} case={{ rings: false, … }} addons={() => [pouch]} tilt.
 */

/**
 * The imperative side (ref): whole-book shake / tilt (needs `tilt`), page and cover moves that work in 3D and flat alike (for a host that
 * draws its own controls from onState), and the live 3D handle (null while there is none or in flat mode).
 */
export type BookViewHandle = {
  shake(strength?: number): void;
  setTilt(x: number, y: number): void;
  /** Next / previous page (from closed, next() opens) */
  next(): void;
  prev(): void;
  /** Open when closed, close when open */
  toggleCover(): void;
  readonly book: Book | null;
};

export type BookViewProps = {
  /** The card binder's items (shorthand; `content` or `items` win) */
  cards?: BookCard[];
  /**
   * What the pockets hold (content/). Wins over `items` and `cards`. A new content (or new `items`) with the same grid — the same
   * items in the same pockets with the same pictures, e.g. the album in another language — is printed again in place
   * (Book.setContent: the page, the cover and the camera stay); anything else builds the book again.
   */
  content?: ContentSource;
  /** Album items, painted by kind: "cards" (default) or "postcards" */
  items?: readonly AlbumCard[] | readonly PostcardItem[];
  kind?: "cards" | "postcards";
  /** Pocket grid: a preset or a LayoutSpec (default: the content's own layout, else idCard2x3) */
  layout?: LayoutPreset | LayoutSpec;
  /** Sheet count override; 0 = no pages at all (the résumé folio) */
  sheets?: number;
  /**
   * The case: board size, spine depth, rings, the printed liner inside the front board. A new print (the liner, the 題簽 slip: another
   * language) is swapped in place with the cover (Book.setCover); a new shape (board, depth, rings) builds the book again.
   */
  case?: CaseSpec;
  /**
   * Scene addons, as a factory: called once for every scene the view builds (StrictMode and rebuilds build more than one), and the book
   * disposes what it was given. Read through a ref, so a new function identity does not rebuild the scene.
   */
  addons?: () => SceneAddon[];
  /** Whole-book tilt / shake: drags on the desk tilt it; the ref's shake() / setTilt() work */
  tilt?: boolean;
  /** Open by itself once painted (default true) */
  autoOpen?: boolean;
  /** The case. A new value swaps the case in place (Book.setCover: a short cross-fade; pages, addons and the open state stay). */
  cover?: CoverSpec;
  theme?: BookTheme;
  quality?: BookQuality;
  labels?: Partial<BookLabels>;
  /** "auto": 3D when the device is capable and motion is allowed, else flat. "flat" / "3d" force one. */
  mode?: "auto" | "3d" | "flat";
  /** Force one page at a time (true) or two (false); default: measured from the box (< 700 px wide or taller than 3:4). */
  narrow?: boolean;
  /**
   * sasshi: what of the box the page keeps for itself (px from each edge; see Insets). The book is framed in what is left,
   * while the canvas still fills the whole box (mount the view full-bleed and pass the DOM's book box as insets). A new value
   * reframes in place. Default: the view's own foot (its prev / next bar), as before.
   */
  insets?: Insets;
  /** An item was clicked or activated: its index in the content and its id. newTab: ⌘ / Ctrl / middle click. */
  onPick?: (index: number, o: { newTab: boolean; id: string }) => void;
  /** Page position, open / closed. */
  onState?: (s: BookState) => void;
  /** The first spread is painted. */
  onReady?: () => void;
  /** The live 3D handle (and its `debug` object), null while there is none. */
  onBook?: (book: Book | null) => void;
  /**
   * Sound cues of the 3D book (pageTurn, pageLand, coverOpen, coverClose; see BookOptions.onSound). The latest callback is used,
   * read through a ref: a new function identity does not rebuild the scene. The flat book makes none.
   */
  onSound?: (name: BookSoundName, o?: BookSoundOptions) => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<BookViewHandle>;
};

let sceneModule: Promise<typeof import("./scene")> | null = null;
const loadScene = () => (sceneModule ??= import("./scene"));

/** Show the loading bar only after this long: when it is quick there is nothing to flash. */
const LOADER_DELAY = 300;

/** Decided once per mount: a capable device (reduced motion keeps the 3D: the scene opens without the swing, its light still). */
const capable = () => typeof window !== "undefined" && canRender3d();

export function BookView({
  cards,
  content: contentProp,
  items,
  kind: itemKind = "cards",
  layout: layoutProp,
  sheets: sheetsProp,
  case: caseSpec,
  addons,
  tilt = false,
  autoOpen,
  cover = DEFAULT_COVER,
  theme,
  quality,
  labels,
  mode = "auto",
  narrow: narrowProp,
  insets,
  onPick: onPickProp,
  onState,
  onReady,
  onBook,
  onSound,
  className,
  style,
  ref,
}: BookViewProps) {
  const L: BookLabels = { ...DEFAULT_LABELS, ...labels };
  // the album painters lay their faces out in the grid given (any rows; brief r3 D3), else their own default
  const content = useMemo<ContentSource>(
    () =>
      contentProp ??
      (items
        ? itemKind === "postcards"
          ? createPostcardContent(items as readonly PostcardItem[], ...(layoutProp ? [layoutProp] : []))
          : createCardContent(items as readonly AlbumCard[], ...(layoutProp ? [layoutProp] : []))
        : createPocketGrid({ items: cards ?? [] })),
    [contentProp, items, itemKind, cards, layoutProp],
  );
  const layout = resolveLayout(layoutProp ?? content.layout ?? "idCard2x3");
  const count = content.items.length;
  const onPick = onPickProp && ((i: number, o: { newTab: boolean }) => onPickProp(i, { ...o, id: content.items[i]?.id ?? "" }));
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const [can3d] = useState(capable);
  const [failed, setFailed] = useState(false);
  const kind: "3d" | "flat" = failed || mode === "flat" || (mode === "auto" && !can3d) ? "flat" : "3d";
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [sceneState, setSceneState] = useState<BookState | null>(null);
  const [flatIndex, setFlatIndex] = useState(0);
  const [flatClosed, setFlatClosed] = useState(false);

  // Measure the box itself (not the viewport): the book is inline and may be any size.
  useLayoutEffect(() => {
    const el = rootRef.current!;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((p) => (p && p.w === w && p.h === h ? p : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = narrowProp ?? (size ? size.w < 700 || size.w / Math.max(1, size.h) < 0.75 : false);

  const sheets = Math.max(0, Math.floor(sheetsProp ?? layout.sheetCount(count)));
  const pages = sheets === 0 ? 1 : layout.pageCount(count);
  const state: BookState =
    kind === "3d" && sceneState
      ? sceneState
      : narrow
        ? { index: Math.min(flatIndex, pages - 1), count: pages, narrow, closed: flatClosed }
        : { index: Math.min(flatIndex, sheets), count: sheets + 1, narrow, closed: flatClosed };

  // Latest callbacks and values for the long-lived scene closure
  const live = useRef({ onPick, onState, onReady, onBook, onSound, narrow, theme, addons, cover, caseSpec, content, insets, go: (_: 1 | -1) => {}, toggle: () => {} });
  live.current = { onPick, onState, onReady, onBook, onSound, narrow, theme, addons, cover, caseSpec, content, insets, go: (d: 1 | -1) => go(d), toggle: () => toggleCover() };
  useImperativeHandle(
    ref,
    () => ({
      shake: (s?: number) => bookRef.current?.shake(s),
      setTilt: (x: number, y: number) => bookRef.current?.setTilt(x, y),
      next: () => live.current.go(1),
      prev: () => live.current.go(-1),
      toggleCover: () => live.current.toggle(),
      get book() {
        return bookRef.current;
      },
    }),
    [],
  );
  useEffect(() => {
    live.current.onState?.(state);
  }, [state.index, state.count, state.narrow, state.closed]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (dir: 1 | -1, repeat = false) => {
    // Holding ← stops at the first page instead of closing the cover (closing takes a fresh press)
    if (repeat && dir === -1 && !state.closed && state.index === 0) return;
    if (kind === "3d") {
      if (dir === 1) bookRef.current?.next();
      else bookRef.current?.prev();
      return;
    }
    // Flat: forward from closed opens; back from the first page closes
    if (state.closed) {
      if (dir === 1) setFlatClosed(false);
      return;
    }
    if (dir === -1 && state.index === 0) return setFlatClosed(true);
    setFlatIndex((i) => Math.max(0, Math.min(state.count - 1, i + dir)));
  };
  const toggleCover = () => {
    if (kind === "3d") bookRef.current?.toggleCover();
    else setFlatClosed((c) => !c);
  };

  // One page ↔ one spread when the box flips between wide and narrow (flat keeps its own position)
  const prevNarrow = useRef(narrow);
  useEffect(() => {
    if (prevNarrow.current === narrow) return;
    prevNarrow.current = narrow;
    setFlatIndex((i) => (narrow ? Math.min(pages - 1, i < sheets ? 2 * i : 2 * i - 1) : Math.ceil(i / 2)));
  }, [narrow, pages, sheets]);

  // The 3D scene. Rebuilt only when the shape changes: the items (their ids), the layout, the sheets, the case's shape. Anything printed
  // is swapped in place (effects below): another cover or case print (Book.setCover), the same items in other words (Book.setContent:
  // another language) — unless the book says the new content does not fit it (other pictures), which builds it again (`fresh`).
  const measured = size !== null;
  const [fresh, setFresh] = useState(0);
  const cardsKey = JSON.stringify([content.items.map((it) => it.id), layout.hash, sheetsProp ?? null, caseSpec?.board ?? null, caseSpec?.depth ?? null, caseSpec?.rings ?? null, tilt, autoOpen ?? true, fresh]);
  useEffect(() => {
    if (kind !== "3d" || !measured) return;
    let dead = false;
    let book: Book | null = null;
    setReady(false);
    setSceneState(null);
    const root = rootRef.current!;
    const css = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
    loadScene()
      .then((m) =>
        dead
          ? null
          : m.createBook(stageRef.current!, {
              content,
              layout: layoutProp,
              sheets: sheetsProp,
              case: caseSpec,
              addons: live.current.addons?.(),
              tilt,
              autoOpen,
              cover: live.current.cover,
              narrow: live.current.narrow,
              insets: live.current.insets ?? { top: 0, bottom: footRef.current?.offsetHeight ?? 0 },
              quality,
              // The page colour is the root's resolved --f-bg (set --folio-bg on an ancestor): what the frosted cover sees behind it
              // sasshi: and the page's serif and mono (--f-serif / --f-mono: --folio-serif, else the page's --serif) for the print
              theme: { background: () => css("--f-bg"), font: css("--f-font"), ...(css("--f-serif") && { serif: css("--f-serif") }), ...(css("--f-mono") && { mono: css("--f-mono") }), ...live.current.theme },
              onState: (s) => !dead && setSceneState(s),
              onOpenCard: (i, newTab) => !dead && live.current.onPick?.(i, { newTab }),
              onReady: () => {
                if (dead) return;
                setReady(true);
                live.current.onReady?.();
              },
              onProgress: (f) => setProgress(0.15 + 0.85 * f),
              onLost: () => !dead && setFailed(true),
              onSound: (name, o) => {
                if (!dead) live.current.onSound?.(name, o);
              },
            }),
      )
      .then((b) => {
        if (!b) return;
        if (dead) return b.dispose();
        book = b;
        bookRef.current = b;
        // what changed while it was being built (a language switch during the load) goes in now
        const now = live.current;
        if (now.content !== content && !b.setContent(now.content)) return setFresh((n) => n + 1);
        b.setCover(now.cover, now.caseSpec ?? {});
        now.onBook?.(b);
      })
      .catch((err: unknown) => {
        console.warn("[sasshi] 3D book failed, using the flat one", err);
        if (!dead) setFailed(true);
      });
    return () => {
      dead = true;
      book?.dispose();
      bookRef.current = null;
      live.current.onBook?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt on the content key only; the rest is read through `live`
  }, [kind, cardsKey, measured]);

  // A new cover or case print: swap the case in place, both in one go (the scene compares and ignores an equal one)
  const coverKey = JSON.stringify([cover.material, cover.color, cover.foil, cover.title, cover.window?.src ?? "", cover.window?.color ?? ""]);
  const caseKey = JSON.stringify(caseSpec ?? null);
  useEffect(() => {
    bookRef.current?.setCover(live.current.cover, live.current.caseSpec ?? {});
  }, [coverKey, caseKey]);
  // The same items in other words: printed again in place; content that does not fit the book as built builds it again
  useEffect(() => {
    const b = bookRef.current;
    if (b && !b.setContent(content)) setFresh((n) => n + 1);
  }, [content]);
  useEffect(() => {
    bookRef.current?.setNarrow(narrow);
  }, [narrow]);

  // The controls sit over the canvas: tell the camera how much of the bottom they cover, and let the flat book keep clear of them too.
  // sasshi: insets given by the host win (a full-bleed view framed on the page's book box)
  const insetsKey = insets ? JSON.stringify([insets.top, insets.bottom, insets.left ?? 0, insets.right ?? 0, insets.anchor ?? null]) : "";
  useEffect(() => {
    const foot = footRef.current!;
    const update = () => {
      rootRef.current?.style.setProperty("--folio-foot-h", `${foot.offsetHeight}px`);
      bookRef.current?.setInsets(live.current.insets ?? { top: 0, bottom: foot.offsetHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(foot);
    return () => ro.disconnect();
  }, [kind, ready, insetsKey]);

  // Loading bar: appears after LOADER_DELAY, creeps forward while three downloads (no real progress there), fills when the first spread is painted
  const loading = kind === "3d" && !ready;
  const progress = useRef(0.08);
  const setProgress = (p: number) => {
    progress.current = Math.max(progress.current, Math.min(1, p));
    loaderRef.current?.style.setProperty("--p", progress.current.toFixed(3));
  };
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setWaiting(true), LOADER_DELAY);
    const creep = setInterval(() => setProgress(progress.current + (0.85 - progress.current) * 0.04), 250);
    return () => {
      clearTimeout(timer);
      clearInterval(creep);
    };
  }, [loading]);
  useEffect(() => {
    if (loading) return;
    setProgress(1);
    const timer = setTimeout(() => setWaiting(false), 700);
    return () => clearTimeout(timer);
  }, [loading]);

  // Arrow keys when the book (or a control in it) has focus
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      go(-1, e.repeat);
    }
  };

  // Cards on the visible pages: real links / buttons for screen readers and keyboard users, invisible until focused
  // (a double-sided item shows on both sides of its sheet: listed once)
  const visibleSides = state.closed || sheets === 0 ? [] : state.narrow ? [state.index] : spreadSides(state.index, sheets).filter((s) => s >= 0);
  const seen = new Set<number>();
  for (const side of visibleSides)
    for (let slot = 0; slot < layout.perSide; slot++) {
      const i = layout.itemIndex(side, slot, count);
      if (i >= 0) seen.add(i);
    }
  const visibleCards = [...seen].sort((a, b) => a - b).map((i) => [content.items[i]!, i] as const);
  const counter = L.pageOf(state.index + 1, state.count);

  return (
    <div
      ref={rootRef}
      className={className ? `folio-book ${className}` : "folio-book"}
      style={style}
      role="group"
      aria-roledescription="album"
      aria-label={L.region}
      tabIndex={0}
      data-mode={kind}
      data-ready={kind === "flat" || ready ? "" : undefined}
      data-narrow={narrow ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      <div ref={stageRef} className="folio-stage">
        {kind === "flat" && <FlatBook content={content} layout={layout} sheets={sheets} cover={cover} index={state.index} narrow={state.narrow} closed={state.closed} onTurn={go} onPick={onPick} labels={labels} />}
      </div>
      <div ref={footRef} className="folio-foot">
        {state.closed ? (
          <div className="folio-nav" data-closed="">
            <button type="button" className="folio-btn folio-btn-primary" onClick={() => go(1)}>
              <OpenIcon />
              <span>{L.openBook}</span>
            </button>
          </div>
        ) : (
          <div className="folio-nav">
            <button type="button" className="folio-btn" aria-label={L.prev} onClick={() => go(-1)}>
              <ChevronIcon dir="left" />
            </button>
            <p className="folio-count" aria-live="polite">
              <span aria-hidden="true">
                {state.index + 1} <span className="folio-count-sep">/</span> {state.count}
              </span>
              <span className="folio-sr">{counter}</span>
            </p>
            <button type="button" className="folio-btn" aria-label={L.next} onClick={() => go(1)} disabled={state.index >= state.count - 1}>
              <ChevronIcon dir="right" />
            </button>
            <span className="folio-nav-rule" aria-hidden="true" />
            <button type="button" className="folio-btn" aria-label={L.closeBook} onClick={toggleCover}>
              <ClosedIcon />
            </button>
          </div>
        )}
      </div>
      {kind === "3d" && (
        <nav className="folio-links" aria-label={L.cardsHere}>
          <ul>
            {visibleCards.map(([c, i]) => (
              <li key={c.id}>
                {c.href ? (
                  <a href={c.href} onClick={(e) => (onPick && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) ? (e.preventDefault(), onPick(i, { newTab: false })) : undefined)}>
                    {L.openCard(c.label ?? c.id, c)}
                  </a>
                ) : (
                  <button type="button" onClick={(e) => onPick?.(i, { newTab: e.metaKey || e.ctrlKey })}>
                    {L.openCard(c.label ?? c.id, c)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
      {waiting && (
        <div className="folio-loading" role="status" data-done={loading ? undefined : ""}>
          <div ref={loaderRef} className="folio-loader" style={{ "--p": progress.current.toFixed(3) } as CSSProperties}>
            <span className="folio-loader-fill" aria-hidden="true" />
          </div>
          <p>{L.loading}</p>
        </div>
      )}
    </div>
  );
}

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const ChevronIcon = ({ dir }: { dir: "left" | "right" }) => <Svg>{dir === "left" ? <path d="M14.5 6 8.5 12l6 6" /> : <path d="m9.5 6 6 6-6 6" />}</Svg>;
/** A book lying open */
const OpenIcon = () => (
  <Svg>
    <path d="M12 7.2C10.4 6 8 5.5 4.5 5.5v11.8c3.5 0 5.9.5 7.5 1.7 1.6-1.2 4-1.7 7.5-1.7V5.5c-3.5 0-5.9.5-7.5 1.7Z" />
    <path d="M12 7.2V19" />
  </Svg>
);
/** A closed book, standing */
const ClosedIcon = () => (
  <Svg>
    <path d="M6.5 4.5h10a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-10Z" />
    <path d="M6.5 4.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5" />
    <path d="M10 9h5" />
  </Svg>
);
