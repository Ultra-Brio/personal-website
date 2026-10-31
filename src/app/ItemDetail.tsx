import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { canRender3d } from "../book/support";
import { profileHan } from "../fonts";
import type { PaperState, PaperViewer, PaperViewerOptions } from "../paper";
import type { BusinessCardItem, NoteItem, PocketItem, PolaroidItem, Profile, ResumeItem, TicketItem } from "../profile/schema";
import { FoldedCard } from "./FoldedCard";
import { run, textProps, useFontRuns } from "./fonts";
import { useT, type Dict } from "./i18n";
import { held, POLAROID_TILT, stillPx, useFrame, type Rect, type Rest } from "./layout";
import { DetailFrame, Lightbox, SpecRows, useLightboxClose, type Row } from "./Modal";
import { NoteArt, PolaroidBack, PolaroidFront, TicketArt, TicketBack } from "./ObjectArt";
import { ResumePages } from "./ResumeBook";
import { Pager, Sep, Word } from "./Shell";
import { play } from "./sound";
import type { Snapshot, Still } from "./types";
import { NE_ARROW, isExternal, pad2, pageUrl, prefersReducedMotion, specRows } from "./util";

/*
 * The detail view of one pouch object (§1.6.10, brief O2): the object large in the book box, the caption in the words column
 * (count, title, local name, anecdote, story, spec rows, links), the actions at the column's foot, the controls on the bottom line.
 * The résumé and the business card are real paper (src/paper: the pages turn, the card opens); the ticket, the polaroid and the
 * note are the pouch's own 3D objects, rendered once by the stage's renderer (snapshot) — the same thing you just picked up, not
 * a drawing of it — and the ticket and polaroid turn over to their printed backs. DOM versions stand in where there is no 3D (no
 * WebGL, no stage, a still that cannot be rendered).
 */

/** Creations are chained: at most one paper WebGL context at a time, next to the stage's own. */
let paperQueue: Promise<unknown> = Promise.resolve();

/**
 * What the controls can do with the paper in view. `first`…`last` of `total`: the printed pages on view (1-based; the résumé).
 * `rest`: where the viewer's paper comes to rest in its host (the phone places the paper and its caption by it).
 */
type Control = { page: number; count: number; first: number; last: number; total: number; next(): void; prev(): void; ready: boolean; flat: boolean; rest?: Rest | null };

/** Whose paper it is: what the paper viewer prints besides the item (the running heads, the card's name). */
const ownerOf = (profile: Profile) => ({ name: profile.name, ...(profile.nameLocal ? { nameLocal: profile.nameLocal } : {}), role: profile.role, ...(profile.location ? { location: profile.location } : {}), ...(profile.handle ? { handle: profile.handle } : {}), links: profile.links, ...(profile.lang ? { lang: profile.lang } : {}) });

/** The résumé / business card: the paper viewer in a host the size of the held rect, or the DOM version. */
function PaperObject({ profile, item, phone, onControl }: { profile: Profile; item: ResumeItem | BusinessCardItem; phone: boolean; onControl(c: Control | null): void }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<PaperViewer | null>(null);
  const [state, setState] = useState<PaperState | null>(null);
  const [failed, setFailed] = useState(() => !canRender3d());
  const [flat, setFlat] = useState(0);
  const [rest, setRest] = useState<Rest | null>(null);
  /** a new viewer: another object, or another language the one on view could not take (setContent said false) */
  const [fresh, setFresh] = useState(0);
  // the latest words for a viewer being made, and the item the one on view prints
  const words = useRef({ item, profile, t });
  words.current = { item, profile, t };
  const printed = useRef<ResumeItem | BusinessCardItem | null>(null);

  useEffect(() => {
    if (failed) return;
    const el = host.current;
    if (!el) return;
    let dead = false;
    let made: PaperViewer | null = null;
    const { item, profile, t } = words.current;
    const owner = ownerOf(profile);
    const run = paperQueue.then(async () => {
      if (dead) return;
      const m = await import("../paper");
      if (dead) return;
      const opts: PaperViewerOptions = {
        item,
        owner,
        ...(profile.lang ? { lang: profile.lang } : {}),
        labels: t.paper,
        onSound: play,
        onChange: (s: PaperState) => {
          if (!dead) setState({ ...s });
        },
        onClose: () => {
          if (dead) return;
          setFailed(true);
          // the context is gone: free the rest outside the viewer's own event handler
          const gone = made;
          made = null;
          viewer.current = null;
          queueMicrotask(() => gone?.dispose());
        },
      };
      const v = await m.createPaperViewer(el, opts);
      if (dead) return v.dispose();
      made = v;
      viewer.current = v;
      printed.current = item;
      setState({ ...v.state });
      // the words changed while it was being made: print them
      if (words.current.item !== item) reprint();
    });
    paperQueue = run.catch(() => {});
    run.catch((err: unknown) => {
      console.warn("[sasshi] paper viewer unavailable, showing the flat version", err);
      if (!dead) setFailed(true);
    });
    return () => {
      dead = true;
      made?.dispose();
      made = null;
      viewer.current = null;
      printed.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one viewer per object; its words change in place (reprint)
  }, [failed, item.id, fresh]);

  // Another language (brief r4 E1): the viewer sets the same paper in the new words in place (the page on view and the open card
  // stay); one that cannot (another kind) is made again
  function reprint() {
    const v = viewer.current;
    const { item, profile, t } = words.current;
    if (!v || printed.current === item) return;
    printed.current = item;
    if (!v.setContent) return setFresh((n) => n + 1);
    void v.setContent({ item, owner: ownerOf(profile), ...(profile.lang ? { lang: profile.lang } : {}), labels: t.paper }).then((ok) => {
      if (!ok && viewer.current === v && words.current.item === item) setFresh((n) => n + 1);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reprint, [item, profile, t]);

  // where the viewer's paper comes to rest in its host, read again whenever the host changes size or the paper its state (after the
  // viewer's own resize has reframed it: a frame later)
  const page = state?.page ?? -1;
  useEffect(() => {
    const el = host.current;
    if (failed || !el || page < 0) return;
    let raf = 0;
    let tries = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = viewer.current?.restRect();
        // (no answer before the viewer has framed its paper once: ask again on the next frames)
        if (!r) {
          if (++tries < 90) read();
          return;
        }
        // (the same box restRect measures from; the size without the lift's scale)
        const h = el.getBoundingClientRect();
        const next = { left: r.left - h.left, top: r.top - h.top, right: r.right - h.left, bottom: r.bottom - h.top, w: el.offsetWidth, h: el.offsetHeight };
        setRest((cur) => (cur && (Object.keys(next) as (keyof Rest)[]).every((k) => Math.abs(cur[k] - next[k]) < 0.5) ? cur : next));
      });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [failed, page]);

  // the DOM versions: the card is closed (0) or open (1); the résumé shows a spread (desk) or one page (phone)
  const flatCount = item.kind === "card" ? 2 : phone ? 2 : 1;
  useEffect(() => {
    if (failed) {
      const page = Math.min(flat, flatCount - 1);
      const [first, last] = item.kind === "resume" && !phone ? [1, 2] : [page + 1, page + 1];
      onControl({ page, count: flatCount, first, last, total: 2, ready: true, flat: true, next: () => setFlat((p) => Math.min(flatCount - 1, p + 1)), prev: () => setFlat((p) => Math.max(0, p - 1)) });
      return;
    }
    onControl(
      state
        ? { page: state.page, count: state.count, first: state.first ?? state.page + 1, last: state.last ?? state.page + 1, total: state.total ?? state.count, ready: true, flat: false, rest, next: () => viewer.current?.next(), prev: () => viewer.current?.prev() }
        : { page: 0, count: 1, first: 1, last: item.kind === "resume" && !phone ? 2 : 1, total: 2, ready: false, flat: false, next: () => {}, prev: () => {} },
    );
  }, [failed, flat, flatCount, state, rest, onControl, item.kind, phone]);
  useEffect(() => () => onControl(null), [onControl]);

  if (failed)
    return item.kind === "card" ? (
      <div className="paper-flat" data-kind="card">
        <FoldedCard item={item} open={flat === 1} onOpenChange={(o) => setFlat(o ? 1 : 0)} />
      </div>
    ) : (
      <div className="paper-flat" data-kind="resume">
        <ResumePages profile={profile} item={item} page={flat} />
      </div>
    );
  return <div className="paper-host" data-kind={item.kind} data-ready={state ? "" : undefined} ref={host} />;
}

/** A still, decoded (its pixel size known before it is shown). */
type Shot = Still & { w: number; h: number };
async function decode(s: Still): Promise<Shot> {
  const img = new Image();
  img.src = s.url;
  await img.decode();
  return { ...s, w: img.naturalWidth, h: img.naturalHeight };
}
/**
 * The still's size on screen: the object itself (the image minus its margin, `pad` × the image's width on every side) fitted into
 * the rect, the margin with its baked shadow round it. The negative margin keeps the layout box the object's own, so the object
 * lands exactly where a still without a margin would.
 */
function stillStyle(s: Shot, rect: Rect): CSSProperties {
  const m = s.pad * s.w;
  const k = Math.min((rect.right - rect.left) / Math.max(1, s.w - 2 * m), (rect.bottom - rect.top) / Math.max(1, s.h - 2 * m));
  return { width: s.w * k, height: s.h * k, margin: -m * k };
}

/**
 * How long the lift waits for a still (≈ 60–160 ms; the first of a page waits for the print's fonts too) before the DOM version
 * stands in — and then stays: it is never swapped for a late still.
 */
const STILL_WAIT = 2500;
/** The lift (detail.css .lb-obj): the back's still is rendered after it, not during it. */
const LIFT_MS = 500;

/**
 * The ticket, the polaroid and the note: the pouch's own object, rendered alone by the stage (soft studio light, transparent),
 * shown as an image with a small pointer tilt; the ticket and the polaroid turn over to their printed backs. With a stage, the
 * object is not shown until its still is ready (the lift waits for it: detail.css data-wait), so nothing is ever swapped while it
 * rises; the back is rendered once the front has risen, and the flip waits for it too. The DOM version stands in only when there
 * is no stage (opened from the text version, no WebGL), when the stage cannot render the still, or when it is late (STILL_WAIT).
 */
function StillObject({ item, rect, snapshot, turned }: { item: TicketItem | PolaroidItem | NoteItem; rect: Rect; snapshot?: Snapshot | undefined; turned: boolean }) {
  const [front, setFront] = useState<Shot | null>(null);
  const [back, setBack] = useState<Shot | null>(null);
  // the DOM version, for good (front, back): no stage, no still, or a late one
  const [dom, setDom] = useState(!snapshot);
  const [backDom, setBackDom] = useState(!snapshot);
  const tilt = useRef<HTMLDivElement>(null);
  const two = item.kind !== "note";
  // the still's width in device px (the object's own width: the baked shadow's margin is added round it)
  const px = stillPx(rect);
  useEffect(() => {
    if (!snapshot) return;
    let dead = false;
    const late = window.setTimeout(() => {
      dead = true;
      setDom(true);
    }, STILL_WAIT);
    const done = (s: Shot | null) => {
      if (dead) return;
      window.clearTimeout(late);
      if (s) setFront(s);
      else setDom(true);
    };
    snapshot(item.id, px, { shadow: true })
      .then((s) => (s ? decode(s) : null))
      .then(done, () => done(null));
    return () => {
      dead = true;
      window.clearTimeout(late);
    };
    // a new size does not re-render the still: it is drawn at 2–3× and scaled. Another language (the same id, a new item) does: the
    // old one stays until the new one is there
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, snapshot]);
  // the back, once the front has risen (so the flip finds it ready; at once when turned over sooner); a front that fell back to the
  // DOM keeps the DOM back too
  const wantBack = two && !!front && !back && !backDom;
  useEffect(() => {
    if (!snapshot || !wantBack) return;
    let dead = false;
    const late = turned
      ? window.setTimeout(() => {
          dead = true;
          setBackDom(true);
        }, STILL_WAIT)
      : 0;
    const done = (s: Shot | null) => {
      if (dead) return;
      window.clearTimeout(late);
      if (s) setBack(s);
      else setBackDom(true);
    };
    const start = window.setTimeout(() => {
      snapshot(item.id, px, { side: "back", shadow: true })
        .then((s) => (s && s.url !== front?.url ? decode(s) : null))
        .then(done, () => done(null));
    }, turned ? 0 : LIFT_MS);
    return () => {
      dead = true;
      window.clearTimeout(late);
      window.clearTimeout(start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, snapshot, wantBack, turned]);
  const img = (s: Shot) => <img className="still-img" src={s.url} alt="" draggable={false} data-shadow={s.shadow ? "" : undefined} data-pad={s.pad.toFixed(5)} style={stillStyle(s, rect)} />;

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || prefersReducedMotion() || !tilt.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    const dy = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    tilt.current.style.setProperty("--ry", `${(dx * 5).toFixed(2)}deg`);
    tilt.current.style.setProperty("--rx", `${(-dy * 5).toFixed(2)}deg`);
  };
  const leave = () => {
    tilt.current?.style.setProperty("--ry", "0deg");
    tilt.current?.style.setProperty("--rx", "0deg");
  };

  // nothing until the still is ready (the lift waits), the DOM version only when it stands in for good
  const frontNode = front ? img(front) : !dom ? null : item.kind === "ticket" ? <TicketArt item={item} /> : item.kind === "polaroid" ? <PolaroidFront item={item} /> : <NoteArt item={item} />;
  const domBack = dom || backDom;
  const backNode = !two ? null : back ? img(back) : !domBack ? null : item.kind === "ticket" ? <TicketBack item={item} /> : item.kind === "polaroid" ? <PolaroidBack item={item} /> : null;
  // the flip waits for the back's still
  const flipped = turned && (!!back || domBack);
  return (
    <div className="still" data-kind={item.kind} data-snap={front ? "" : undefined} data-wait={!front && !dom ? "" : undefined} onPointerMove={move} onPointerLeave={leave}>
      <div className="still-tilt" ref={tilt}>
        {two ? (
          <div className="flip" data-turned={flipped || undefined}>
            <div className="flip-face front" inert={flipped}>
              {frontNode}
            </div>
            <div className="flip-face back" inert={!flipped} data-snap={back ? "" : undefined}>
              {backNode}
            </div>
          </div>
        ) : (
          frontNode
        )}
      </div>
    </div>
  );
}

function PutBack({ short }: { short: boolean }) {
  const t = useT();
  const close = useLightboxClose();
  return <Word onClick={close}>{short ? t.controls.putBackShort : t.controls.putBack}</Word>;
}

/** The kind's own lines for the caption (and the text view): what is printed on it, then the author's rows. */
export function itemRows(item: PocketItem, t: Dict): Row[] {
  return specRows(item, t).map((r) => ({ k: r.k, v: r.v }));
}

/** A row's value gets its `lang` (and Han face) from its text. */
export function withLang(r: Row, lang: string | undefined, han: ReturnType<typeof profileHan>): Row {
  const p = textProps(String(r.v), lang, han);
  const h = p["data-han"];
  return { ...r, lang: p.lang, ...(h ? { han: h } : {}) };
}

type Props = {
  profile: Profile;
  /** index into profile.items */
  index: number;
  onIndex(i: number): void;
  onClose(): void;
  fallbackFocus?(): void;
  /** The stage's renderer, for the still objects (none without a live résumé stage). */
  snapshot?: Snapshot | undefined;
};

export function ItemDetail({ profile, index, onIndex, onClose, fallbackFocus, snapshot }: Props) {
  const t = useT();
  const f = useFrame();
  const uid = useId();
  const titleId = `${uid}-title`;
  const items = profile.items;
  const item = items[index];
  const [ctl, setCtl] = useState<Control | null>(null);
  const [turned, setTurned] = useState(false);
  const onControl = useCallback((c: Control | null) => setCtl(c), []);
  const han = profileHan(profile);
  const phone = f.cls === "p" || f.cls === "t";
  useEffect(() => setTurned(false), [index]);
  const kind = item?.kind ?? "card";
  // the card unfolded takes twice its height on a phone (the caption moves down under it)
  const { host: rect, obj } = held(f, kind, { open: kind === "card" && ctl?.page === 1, flat: !!ctl?.flat, rest: ctl?.rest });
  const local = t.held[kind].local;
  useFontRuns(
    item
      ? [
          ...run("serif", 500, han, item.label),
          ...run("serif", 400, han, item.anecdote),
          ...run("sans", 400, han, item.story, ...specRows(item, t).map((r) => r.v)),
          ...run("sans", 500, han, ...specRows(item, t).map((r) => r.k)),
          ...run("serif", 400, t.lang === "zh" ? "zh-Hans" : "ja", local),
          ...run("sans", 500, han, ...(item.links ?? []).map((l) => l.label), item.href ? t.detail.page : ""),
        ]
      : [],
  );
  if (!item) return null;
  const n = items.length;
  const stepObject = (d: number) => {
    const j = index + d;
    if (j >= 0 && j < n) onIndex(j);
  };
  const pdf = item.kind === "resume" ? item.pdf : undefined;
  const paper = item.kind === "resume" || item.kind === "card";
  const resume = item.kind === "resume";

  // ← / →: the résumé's pages first, then the neighbouring objects; Space: open the card / turn over
  const prev = () => (resume && ctl && ctl.page > 0 ? ctl.prev() : stepObject(-1));
  const next = () => (resume && ctl && ctl.page < ctl.count - 1 ? ctl.next() : stepObject(1));
  const turn = () => {
    play("pageTurn", { gain: 0.4 });
    setTurned((x) => !x);
  };
  const space = item.kind === "card" ? () => (ctl?.page === 1 ? ctl.prev() : ctl?.next()) : item.kind === "ticket" || item.kind === "polaroid" ? turn : undefined;

  const rows = itemRows(item, t);
  // the thing's own page is the caption's entry row (cap-go); any further links stay a plain list
  const pageLabel = item.href ? ((item.links ?? []).find((l) => l.href === item.href)?.label ?? t.detail.page) : "";
  const links = (item.links ?? []).filter((l) => l.href !== item.href);
  const atStart = index === 0 && (!resume || !ctl || ctl.page <= 0);
  const atEnd = index === n - 1 && (!resume || !ctl || ctl.page >= ctl.count - 1);
  const pagerText = resume && ctl ? (phone ? `${ctl.first} / ${ctl.total}` : t.controls.pages(ctl.first, ctl.last)) : `${index + 1} / ${n}`;
  const pagerLabel = resume && ctl ? t.controls.pagesAria(ctl.first, ctl.last, ctl.total) : t.controls.objectOf(index + 1, n);

  const actions: Row[] = resume
    ? [
        ...(pdf
          ? [
              {
                k: t.detail.pdf,
                v: (
                  <a className="v" href={pdf} download aria-label={t.detail.downloadAria}>
                    {t.detail.download}
                    <span className="go" aria-hidden="true">
                      ↓
                    </span>
                  </a>
                ),
              },
            ]
          : []),
        {
          k: t.detail.text,
          v: (
            <a className="v" href={pageUrl({ view: "text", tab: "resume" })}>
              {t.detail.readAsText}
              <span className="go" aria-hidden="true">
                →
              </span>
            </a>
          ),
        },
      ]
    : [];
  const actionsNode = actions.length ? <SpecRows rows={actions} className="lb-act-rows" /> : null;

  const caption = (
    <>
      <p className="cap-count" aria-live="polite" aria-atomic="true">
        <span aria-hidden="true">
          {pad2(index + 1)}
          <i>/</i>
          {pad2(n)}
        </span>
        <span className="sr-only">{t.controls.objectOf(index + 1, n)}</span>
      </p>
      <h2 id={titleId} className="cap-title" {...textProps(item.label, profile.lang, han)}>
        {item.label}
      </h2>
      {/* the kind's local name, unless the title already says it (大会门票 · 门票) */}
      {local && !item.label.includes(local) ? (
        <p className="cap-local" {...textProps(local, t.lang === "zh" ? "zh-CN" : "ja", han)}>
          {local}
        </p>
      ) : null}
      {item.anecdote ? (
        <p className="cap-anec" {...textProps(item.anecdote, profile.lang, han)}>
          {item.anecdote}
        </p>
      ) : null}
      {item.story ? (
        <p className="cap-story" {...textProps(item.story, profile.lang, han)}>
          {item.story}
        </p>
      ) : null}
      {item.href ? (
        <a className="cap-go" href={item.href}>
          <span className="nm" {...textProps(pageLabel, profile.lang, han)}>
            {pageLabel}
          </span>
          <span className="lead" aria-hidden="true" />
          <span className="go" aria-hidden="true">
            →
          </span>
        </a>
      ) : null}
      <SpecRows rows={rows.map((r) => withLang(r, profile.lang, han))} />
      {links.length ? (
        <ul className="cap-links">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} {...(isExternal(l.href) ? { target: "_blank", rel: "noopener" } : {})}>
                <span {...textProps(l.label, profile.lang, han)}>{l.label}</span>
                {isExternal(l.href) ? (
                  <span className="go" aria-hidden="true">
                    {" "}
                    {NE_ARROW}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {phone && actionsNode ? <div className="lb-acts">{actionsNode}</div> : null}
    </>
  );

  const object = paper ? <PaperObject profile={profile} item={item} phone={phone} onControl={onControl} /> : <StillObject item={item} rect={rect} snapshot={snapshot} turned={turned} />;
  const controls = (
    <>
      <span className="cg">
        <Pager text={pagerText} label={pagerLabel} onPrev={prev} onNext={next} atStart={atStart} atEnd={atEnd} prevLabel={resume ? t.controls.prevPage : t.controls.prev} nextLabel={resume ? t.controls.nextPage : t.controls.next} />
      </span>
      <Sep />
      <span className="cg">
      {item.kind === "card" ? (
        <>
          <Word onClick={space} disabled={!ctl?.ready} pressed={ctl?.page === 1}>
            {ctl?.page === 1 ? t.controls.foldIt : t.controls.openIt}
          </Word>
          <Sep />
        </>
      ) : null}
      {item.kind === "ticket" || item.kind === "polaroid" ? (
        <>
          <Word onClick={turn} pressed={turned}>
            {turned ? t.controls.turnBack : t.controls.turnOver}
          </Word>
          <Sep />
        </>
      ) : null}
      <PutBack short={phone || f.cls === "l"} />
      </span>
    </>
  );

  return (
    <Lightbox labelledBy={titleId} kind={item.kind} onClose={onClose} onPrev={prev} onNext={next} onSpace={space} {...(fallbackFocus ? { fallbackFocus } : {})}>
      <DetailFrame
        id={item.id}
        profile={profile}
        rect={rect}
        obj={obj}
        hashira={{ local, latin: t.held[kind].latin }}
        caption={caption}
        actions={actionsNode}
        controls={controls}
        object={<div className="held" data-kind={item.kind} style={{ "--rot": item.kind === "polaroid" ? `${-POLAROID_TILT}rad` : "0deg" } as CSSProperties}>{object}</div>}
      />
    </Lightbox>
  );
}
