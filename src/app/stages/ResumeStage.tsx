import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PerspectiveCamera } from "three";
import type { PouchAddon, PouchAddonOptions } from "../../bag";
import { BookView, type BookViewHandle } from "../../book/BookView";
import type { CaseSpec } from "../../book/binder";
import type { CoverSpec } from "../../book/cover";
import type { BookState } from "../../book/scene";
import { canRender3d } from "../../book/support";
import { booklet } from "../booklets";
import { impact, play } from "../sound";
import type { MotionUi, Snapshot, SnapshotOptions, StageProps } from "../types";
import { coarsePointer, finePointer, pad2 } from "../util";
import { useWindowLight } from "./light";

/*
 * The résumé folio: a ring-less clamshell (BookView, sheets 0) whose back board carries the clear zip pouch (src/bag) with the
 * person's things in it under 2D physics. Drags on the desk tilt the folio; Shake jiggles it (and, on a phone, Tilt hands it to the
 * phone's own motion). A click on an object lifts it out (the detail view); the same objects are reachable from a keyboard list.
 *
 * Gate first: without a capable WebGL2 device the shell shows the printed version (reduced motion keeps the 3D: the scene opens it
 * without the swing and leaves the window light still).
 * Only then are the pouch (three + planck) and the book scene loaded, before BookView mounts: its addon factory is synchronous.
 * The canvas is full-bleed; `insets` frame the folio into the page's book box.
 */

type Bag = typeof import("../../bag");
/** What the pouch's snapshot answers: a data URL, or (asked for a baked shadow) the image and its margin. */
type RawSnap = (id: string, px: number, o?: SnapshotOptions) => Promise<string | { url: string; pad: number } | null>;

const B = booklet("resume");
/** Pouch fit inside the 250 x 340 mm board, in scene units (1 mm = 0.01). */
const FIT = { width: 2.5, height: 3.4 };
const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

export default function ResumeStage({ profile, material, insets, narrow, labels, ambient, onPickItem, onUnsupported, onStage }: StageProps) {
  const [capable] = useState(() => canRender3d());
  const [bag, setBag] = useState<Bag | null>(null);
  const [closed, setClosed] = useState(false);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [motion, setMotion] = useState<MotionUi>("off");
  const [coarse] = useState(coarsePointer);
  const [fine] = useState(finePointer);
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
  const [tipOn, setTipOn] = useState(false);
  const handle = useRef<BookViewHandle>(null);
  const pouch = useRef<PouchAddon | null>(null);
  const camera = useRef<PerspectiveCamera | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const onBook = useWindowLight(ambient);
  // Latest callbacks for the long-lived pouch (it outlives renders; the factory runs once per scene build)
  const live = useRef({ onPickItem });
  live.current = { onPickItem };

  useEffect(() => {
    if (!capable) {
      onUnsupported();
      return;
    }
    let dead = false;
    Promise.all([import("../../bag"), import("../../book/scene")]).then(
      ([m]) => {
        if (dead) return;
        setBag(m);
        if (m.motionEnabled()) setMotion("on");
      },
      (err: unknown) => {
        console.warn("[sasshi] the résumé folio failed to load, showing the printed version", err);
        if (!dead) onUnsupported();
      },
    );
    return () => {
      dead = true;
    };
  }, [capable, onUnsupported]);

  const caseSpec = useMemo<CaseSpec>(
    () => ({
      rings: false,
      board: { w: 250, h: 340 },
      depth: 16,
      // lang: the bookplate's Han (and its seal) in the profile's own glyph forms
      liner: { title: profile.name, ...(profile.nameLocal ? { subtitle: profile.nameLocal } : {}), role: profile.role, ...(profile.location ? { place: profile.location } : {}), ...(profile.lang ? { lang: profile.lang } : {}), seal: profile.seal ?? null },
    }),
    [profile],
  );
  const cover = useMemo<CoverSpec>(() => ({ material, color: B.color, foil: B.foil, window: null, title: profile.coverTitle }), [material, profile.coverTitle]);

  // Called by BookView for every scene it builds (StrictMode builds two); the book disposes what it was given. The profile is read
  // when it is called (a ref): another language reprints the pouch in place (below), it never makes a new pouch by itself
  const words = useRef(profile);
  words.current = profile;
  const addons = useCallback(() => {
    if (!bag) return [];
    const opts: PouchAddonOptions = {
      profile: words.current,
      fit: FIT,
      onPick: (id: string) => live.current.onPickItem(id),
      onHover: setHover,
      onImpact: impact,
      onSound: play,
    };
    const p = bag.createPouchAddon(opts);
    const attach = p.attach.bind(p);
    p.attach = (ctx) => {
      camera.current = (ctx as { camera?: PerspectiveCamera }).camera ?? null;
      attach(ctx);
    };
    pouch.current = p;
    return [p];
  }, [bag]);

  // Another language (brief r4 E1): the pouch reprints its things in place (they keep where they lie). Other things in the pouch
  // (another list, another photograph) cannot be reprinted (setProfile says false): the book is built again with them (its key)
  const things = profile.items.map((it) => `${it.kind}:${it.id}${it.kind === "polaroid" ? `:${it.image}` : ""}`).join(" ");
  const printed = useRef(profile);
  useEffect(() => {
    if (printed.current === profile) return;
    printed.current = profile;
    void pouch.current?.setProfile?.(profile);
  }, [profile]);

  // BookView falls back to its flat book when the 3D scene fails (a ring binder with nothing in it): the printed version is the
  // résumé's own fallback, so hand over to it instead
  useEffect(() => {
    const el = root.current;
    if (!el || !bag) return;
    const read = () => {
      if (el.querySelector('.folio-book[data-mode="flat"]')) onUnsupported();
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-mode"], childList: true });
    return () => mo.disconnect();
  }, [bag, onUnsupported]);

  const onState = useCallback((s: BookState) => setClosed(s.closed), []);
  const onReady = useCallback(() => {
    setReady(true);
    // the detail view's paper viewer is the next thing a visitor opens: fetch its chunk once the folio is up
    void import("../../paper").catch(() => {});
  }, []);

  const shake = useCallback(() => {
    handle.current?.shake(0.8);
    pouch.current?.shake(1);
  }, []);
  const toggle = useCallback(() => handle.current?.book?.toggleCover(), []);
  const toggleMotion = useCallback(() => {
    const p = pouch.current;
    if (!bag || !p) return;
    if (motion === "on") {
      bag.disableMotion();
      setMotion("off");
      return;
    }
    // iOS only grants the permission when the request is the first thing a tap does
    const asked = p.enableMotion();
    setMotion("asking");
    void asked.then((s) => setMotion(s === "granted" ? "on" : s));
  }, [bag, motion]);
  /**
   * The object alone, rendered by this stage's renderer; `side: "back"` for a printed back (when the pouch can draw one); `shadow`
   * with its lift shadow baked in. A pouch that answers a bare data URL (no baked shadow) gives a still with no margin, and the page
   * draws the shadow itself.
   */
  const snapshot = useCallback<Snapshot>(async (id, px, o) => {
    const p = pouch.current;
    if (!p?.snapshot) return null;
    const got = await (p.snapshot as unknown as RawSnap).call(p, id, px, o);
    if (!got) return null;
    return typeof got === "string" ? { url: got, pad: 0, shadow: false } : { url: got.url, pad: Math.max(0, got.pad || 0), shadow: !!o?.shadow };
  }, []);

  // Tell the shell what it can do with the folio (the controls, the keys, the detail view's stills)
  useEffect(() => {
    onStage?.({ ready: ready && !!bag, open: !closed, shake, toggle, snapshot, ...(coarse ? { motion: { state: motion, toggle: toggleMotion } } : {}) });
  }, [onStage, ready, bag, closed, shake, toggle, snapshot, coarse, motion, toggleMotion]);
  useEffect(() => () => onStage?.(null), [onStage]);

  // Harness / debugging handle (?debug): the live pouch and book, and screen points for each object.
  useEffect(() => {
    if (!DEBUG || !bag) return;
    const w = window as unknown as { __folio?: unknown };
    w.__folio = {
      items: profile.items.map(({ id, kind, label }) => ({ id, kind, label })),
      book: () => handle.current?.book ?? null,
      pouch: () => pouch.current,
      /** For every object: a client-px point where a click would pick it (null when it is fully covered). */
      targets: async () => {
        const THREE = await import("three");
        const p = pouch.current;
        const cam = camera.current;
        const canvas = root.current?.querySelector<HTMLCanvasElement>(".folio-stage > canvas");
        if (!p || !cam || !canvas) return {};
        const r = canvas.getBoundingClientRect();
        const out: Record<string, [number, number] | null> = {};
        const states = p.debug.sim.state();
        for (const o of p.debug.objects) {
          const id = String(o.object.userData.bodyId);
          const s = states.find((b) => b.id === id);
          out[id] = null;
          if (!s) continue;
          const half = Math.min(o.body.w, o.body.h) * 0.35;
          const offsets: [number, number][] = [[0, 0]];
          for (const f of [0.5, 1]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) offsets.push([dx * half * f, dy * half * f]);
          for (const [dx, dy] of offsets) {
            const local = new THREE.Vector3(dx, dy, 0);
            const world = o.object.localToWorld(local);
            const ndc = world.clone().project(cam);
            const px: [number, number] = [r.left + ((ndc.x + 1) / 2) * r.width, r.top + ((1 - ndc.y) / 2) * r.height];
            const origin = cam.getWorldPosition(new THREE.Vector3());
            const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(cam).sub(origin).normalize();
            const hit = p.debug.hit(new THREE.Ray(origin, dir));
            if (hit?.id === id && px[0] > r.left + 4 && px[0] < r.right - 4 && px[1] > r.top + 4 && px[1] < r.bottom - 4) {
              out[id] = px;
              break;
            }
          }
        }
        return out;
      },
    };
    return () => {
      delete w.__folio;
    };
  }, [bag, profile]);

  // the hovered thing's name, in a glass tooltip after 400 ms (fine pointers only)
  useEffect(() => {
    setTipOn(false);
    if (!hover || !fine) return;
    const id = window.setTimeout(() => setTipOn(true), 400);
    return () => window.clearTimeout(id);
  }, [hover, fine]);
  const items = profile.items;
  const hovered = hover ? items.find((i) => i.id === hover) : undefined;
  const onMove = (e: ReactPointerEvent) => {
    if (!fine || e.pointerType !== "mouse") return;
    setTipAt({ x: e.clientX + 14, y: e.clientY - 14 });
  };

  return (
    <div className="stage-book stage-folio" data-stage="resume" ref={root} data-closed={closed || undefined} onPointerMove={onMove} onPointerLeave={() => setTipAt(null)}>
      {/* first in the tab order: the objects themselves, for keyboard and screen-reader visitors */}
      <nav className="pouch-index" aria-label={labels?.cardsHere ?? "In the pouch"}>
        <ol>
          {items.map((it, i) => (
            <li key={it.id}>
              <button type="button" onClick={() => onPickItem(it.id)}>
                <span className="n">{pad2(i + 1)}</span>
                <span>{it.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {bag ? <BookView key={things} ref={handle} sheets={0} case={caseSpec} addons={addons} tilt autoOpen cover={cover} insets={insets} {...(narrow !== undefined ? { narrow } : {})} {...(labels ? { labels } : {})} onState={onState} onReady={onReady} onBook={onBook} onSound={play} /> : null}
      {fine && typeof document !== "undefined"
        ? createPortal(
            <span className="tip tip-at" role="tooltip" data-show={(hovered && tipAt && tipOn) || undefined} style={tipAt ? { left: tipAt.x, top: tipAt.y } : undefined}>
              {hovered?.label ?? ""}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
}
