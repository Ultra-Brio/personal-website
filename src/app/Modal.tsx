import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { profileHan } from "../fonts";
import type { Profile } from "../profile/schema";
import { useT } from "./i18n";
import { SIDE_COL, sideBox, useFrame, type Rect } from "./layout";
import { Hashira, Identity } from "./Shell";
import { prefersReducedMotion } from "./util";

const CloseContext = createContext<() => void>(() => {});
/** Lets any child (the Put it back word) run the animated close. */
export const useLightboxClose = () => useContext(CloseContext);

export type LightboxProps = {
  /** id of the element that names the dialog */
  labelledBy: string;
  /** exposed as data-kind for styling */
  kind?: string;
  onClose(): void;
  /** ← / → (and phone swipes) while nothing inside consumed them */
  onPrev?(): void;
  onNext?(): void;
  /** Space: open it / turn over (when the object has a second face) */
  onSpace?: (() => void) | undefined;
  /** Esc / the cancel gesture: return true to keep the dialog open (an inner state stepped back instead) */
  onEscape?(): boolean;
  /** Where focus goes when the opener is gone or was never focusable (e.g. a canvas click). */
  fallbackFocus?(): void;
  children: ReactNode;
};

/*
 * The detail view (§1.6.10): an object lifted out of the pouch, or a card out of an album. A native modal <dialog> with no visible
 * container: the room goes behind a pale veil (::backdrop), the thing is held up into the light, and the page's own frame stays
 * where it was — the identity and the words column (now the caption), the hashira (now the object's kind), the controls on the
 * bottom line — drawn again inside the dialog because the platform's top layer sits above the page. The platform gives the focus
 * trap, the inert page, the top layer and Esc. This adds: focus on the dialog itself (no ring on open), an animated close, clicks
 * on empty space put the thing back, ← / → and Space, phone swipes (left / right = next / previous, down = put it back), and
 * explicit focus return to the opener.
 */
export function Lightbox({ labelledBy, kind, onClose, onPrev, onNext, onSpace, onEscape, fallbackFocus, children }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const finished = useRef(false);
  const downOnEmpty = useRef(false);
  /** set when our own cleanup closes the dialog (StrictMode re-mount, unmount): that "close" event is not a user close */
  const suppressClose = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const swipe = useRef<{ x: number; y: number; t: number; id: number } | null>(null);

  const restoreFocus = useCallback(() => {
    const el = opener.current;
    if (el && el !== document.body && el.isConnected && !el.closest("dialog")) el.focus({ preventScroll: true });
    else fallbackRef.current?.();
  }, []);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!opener.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    // the dialog itself takes focus: no ring flashes on a control after a pointer click; the first Tab reaches the object
    d.focus({ preventScroll: true });
    return () => {
      if (d.open) {
        suppressClose.current = true;
        d.close();
      }
    };
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    const d = ref.current;
    if (d?.open) d.close();
    restoreFocus();
    onCloseRef.current();
  }, [restoreFocus]);

  const request = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) return finish();
    setClosing(true);
  }, [finish]);

  // Close after the exit transition (with a safety net if it never reports: background tab, display:none ancestors)
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(finish, 380);
    return () => window.clearTimeout(t);
  }, [closing, finish]);

  const refocusInside = () =>
    requestAnimationFrame(() => {
      const d = ref.current;
      if (d && !d.contains(document.activeElement)) d.focus({ preventScroll: true });
    });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === " " && onSpace && !t.closest("button, a")) {
      e.preventDefault();
      onSpace();
      return;
    }
    const step = e.key === "ArrowLeft" ? onPrev : e.key === "ArrowRight" ? onNext : undefined;
    if (!step) return;
    // a scrolling caption keeps its own arrow keys
    if (t.closest(".lb-cap")) return;
    e.preventDefault();
    step();
    // stepping remounts the content; if focus sat inside it, it would drop to <body>
    refocusInside();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDialogElement>) => {
    const el = e.target as HTMLElement;
    downOnEmpty.current = el === e.currentTarget || el.classList.contains("lb-room");
    // phone swipes: from the room or a still object (the paper viewer, the caption and buttons keep their own gestures)
    if (e.pointerType === "touch" && !el.closest("canvas, button, a, .lb-cap")) swipe.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDialogElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (performance.now() - s.t > 700) return;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      (dx < 0 ? onNext : onPrev)?.();
      refocusInside();
    } else if (dy > 80 && dy > Math.abs(dx) * 1.4) request();
  };

  return (
    <dialog
      ref={ref}
      className="lb"
      data-kind={kind}
      data-closing={closing || undefined}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        if (escapeRef.current?.()) return;
        request();
      }}
      onClose={() => {
        // Closed from outside our own path (form method=dialog, devtools): still tell the parent exactly once.
        if (suppressClose.current) {
          suppressClose.current = false;
          return;
        }
        if (!finished.current) {
          finished.current = true;
          restoreFocus();
          onCloseRef.current();
        }
      }}
      onBlur={(e) => {
        // focus that falls out of the dialog (a focused control unmounted) comes back to it, so the keys keep working
        if (e.relatedTarget) return;
        requestAnimationFrame(() => {
          const d = ref.current;
          if (d?.open && (document.activeElement === document.body || document.activeElement === null)) d.focus({ preventScroll: true });
        });
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if ((el === e.currentTarget || el.classList.contains("lb-room")) && downOnEmpty.current) request();
        downOnEmpty.current = false;
      }}
      onKeyDown={onKeyDown}
    >
      <CloseContext.Provider value={request}>
        <div className="lb-room">{children}</div>
      </CloseContext.Provider>
    </dialog>
  );
}

/** One `dt / dd` row of a caption's spec sheet or actions (the descender rule of §1.6.5: 20 px line boxes, nothing clipped). */
export type Row = { k: string; v: ReactNode; lang?: string; han?: string };

/**
 * The frame inside the dialog: the object in its rect, the caption in the words column (plus the 間 column on a desk), the actions
 * at the column's foot, the kind in the hashira, the controls on the bottom line. `rect` is where the object is drawn, `obj` the
 * object itself when that differs (the paper viewer's host keeps gutters round the paper).
 */
export function DetailFrame({ profile, rect, obj = rect, hashira, caption, actions, controls, object, id }: { profile: Profile; rect: Rect; obj?: Rect; hashira: { local: string; latin: string }; caption: ReactNode; actions?: ReactNode; controls: ReactNode; object: ReactNode; id: string }) {
  const t = useT();
  const f = useFrame();
  const han = profileHan(profile);
  const chromeHan = t.lang === "zh" ? "zh-Hans" : "ja";
  const phone = f.cls === "p" || f.cls === "t";
  // more caption below the fold: the column's foot fades (and a fine pointer has its hairline scrollbar)
  const cap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = cap.current;
    if (!el) return;
    const read = () => el.toggleAttribute("data-more", el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [id, f]);
  // a landscape tablet window: the caption beside the object, as on a desk (layout.ts sideBox)
  const side = sideBox(f);
  const style = {
    ...(side ? { "--sl": `${side.left}px`, "--sc": `${SIDE_COL}px` } : {}),
    "--ol": `${rect.left}px`,
    "--ot": `${rect.top}px`,
    "--ow": `${rect.right - rect.left}px`,
    "--oh": `${rect.bottom - rect.top}px`,
    // the object's own foot (the caption hangs under it on a phone) and its inset in the host (the paper viewer's gutters)
    "--ob": `${obj.bottom}px`,
    "--ox": `${obj.left - rect.left}px`,
    "--oy": `${obj.top - rect.top}px`,
  } as CSSProperties;
  return (
    <div className="lb-frame" style={style} data-side={side ? "" : undefined}>
      <div className="lb-obj" key={`o-${id}`}>
        {object}
      </div>
      <aside className="lb-col">
        {f.cls !== "l" ? <Identity profile={profile} han={han} asHeading={false} /> : null}
        <div className="lb-cap" key={`c-${id}`} ref={cap} tabIndex={phone ? undefined : -1}>
          {caption}
        </div>
        {actions && !phone ? <div className="lb-acts">{actions}</div> : null}
      </aside>
      {f.cls !== "l" ? <Hashira local={hashira.local} latin={hashira.latin} han={chromeHan} /> : null}
      <div className="lb-hands">
        <div className="ctl" role="toolbar" aria-label={t.controls.toolbar}>
          {controls}
        </div>
      </div>
    </div>
  );
}

/** The spec sheet: label at the left, value at the right, hairlines, 32 px rows (the descender rule: never clipped). */
export function SpecRows({ rows, className = "lb-specs" }: { rows: Row[]; className?: string }) {
  if (!rows.length) return null;
  return (
    <dl className={className}>
      {rows.map((r, i) => (
        <div key={`${r.k}${i}`} className="sr">
          <dt>{r.k}</dt>
          <dd {...(r.lang ? { lang: r.lang } : {})} {...(r.han ? { "data-han": r.han } : {})}>
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
