import "@fontsource/shippori-mincho/400.css";
import "@fontsource/shippori-mincho/500.css";
import "@fontsource/shippori-mincho/600.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import { StrictMode, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import type { AddonContext, SceneAddon } from "../../src/book/addon";
import type { CaseSpec } from "../../src/book/binder";
import { BookView, type BookViewHandle } from "../../src/book/BookView";
import { BOOKLET_COVERS, DEFAULT_COVER, type CoverSpec } from "../../src/book/cover";
import { createBook, type Book, type BookState, type BookTheme } from "../../src/book/scene";
import { profile as sample } from "../../profile/en";
import { photo } from "./folio.photo";

/*
 * Harness for the ring-less résumé folio (src/book with case.rings = false, sheets: 0) and the scene-addon hook.
 * A stand-in addon lies on the inside of the back board: a translucent "film" (transparent, depthWrite off — the frost-ordering
 * check), and four flat coloured boxes on a trivial spring that feel the board's apparent gravity and acceleration (so tilting /
 * shaking the book visibly moves them). Boxes can be dragged (pointer routing); a drag anywhere else tilts the book.
 * The page carries the site's desk tokens and fonts (folio.html), so the printed liner and the cover stamp are set as on the site.
 *
 * Query: ?cover=frost|cloth|leather &color=aitetsu|seiji|ginnezu|… &foil=silver|gold|blind &narrow=0|1
 *        &tilt=0 (default on) &film=0 (no translucent plane) &auto=0 (stay closed) &box=WxH
 *        &via=view (mount through <BookView> instead of createBook: addons factory, ref shake / setTilt / setCover)
 *        &pouch=1 (the real clear pouch from src/bag instead of the stand-in) &portrait=1 (a procedural portrait for the liner)
 *        &shot=1 (hide the harness buttons)
 * Exposes window.__book, __ready, __state, __addon (stats), __sounds (the onSound cues: { t: ms, name, gain?, pan? }),
 * __setCover(partial cover) (live case swap: BookView prop through ?via=view, book.setCover otherwise).
 */

const q = new URLSearchParams(location.search);
if (q.get("shot") === "1") document.body.dataset.shot = "";

const cover: CoverSpec = {
  ...DEFAULT_COVER,
  ...BOOKLET_COVERS.resume,
  ...(q.get("cover") && { material: q.get("cover") as CoverSpec["material"] }),
  ...(q.get("color") && { color: q.get("color") as CoverSpec["color"] }),
  ...(q.get("foil") && { foil: q.get("foil") as CoverSpec["foil"] }),
  title: sample.coverTitle,
};
/** The page's tokens, as BookView reads them (the direct path passes the same theme by hand) */
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const theme: BookTheme = { background: () => css("--folio-bg"), font: css("--sans"), serif: css("--serif"), mono: css("--mono") };

/** A procedural photograph (folio.photo.ts): the liner's tipped-in photo path, without shipping a picture */
const portraitUrl = () => photo().toDataURL("image/jpeg", 0.9);

type Stats = { updates: number; moving: boolean; opens: number[]; downs: number; moves: number; ups: number; hovers: number; attached: boolean; disposed: boolean; anchor: number[] };

/** Units: the anchor frame is in scene units (1 mm = 0.01), x right, y away from the viewer, z out of the board. */
function standIn(film: boolean): SceneAddon & { stats: Stats; kick(): void; screen(i: number): [number, number] | null } {
  const stats: Stats = { updates: 0, moving: false, opens: [], downs: 0, moves: 0, ups: 0, hovers: 0, attached: false, disposed: false, anchor: [] };
  const group = new THREE.Group();
  group.name = "stand-in";
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // a soft rectangular contact-shadow texture (blurred rounded rect)
  const shadowTex = keep(
    new THREE.CanvasTexture(
      (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d")!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, 128, 128);
        g.filter = "blur(9px)";
        g.fillStyle = "#fff";
        g.fillRect(22, 22, 84, 84);
        return c;
      })(),
    ),
  );

  if (film) {
    // translucent film over the board: the transparent test plane (frost ordering)
    const m = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(2.25, 3.15)),
      keep(new THREE.MeshPhysicalMaterial({ color: 0xf4f7fa, transparent: true, opacity: 0.32, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06, depthWrite: false })),
    );
    m.position.z = 0.13;
    m.renderOrder = 10;
    m.name = "film";
    group.add(m);
  }

  const specs = [
    { w: 0.92, h: 0.56, d: 0.011, color: "#e9573f", x: -0.45, y: 0.95 },
    { w: 1.05, h: 1.48, d: 0.014, color: "#f2efe8", x: 0.4, y: 0.25 },
    { w: 0.55, h: 1.4, d: 0.008, color: "#3f6fb5", x: -0.62, y: -0.55 },
    { w: 0.42, h: 0.42, d: 0.03, color: "#2f9e6e", x: 0.55, y: -1.05 },
  ];
  type Box = { mesh: THREE.Mesh; shadow: THREE.Mesh; w: number; h: number; rx: number; ry: number; x: number; y: number; vx: number; vy: number; held: boolean };
  const boxes: Box[] = specs.map((s) => {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(s.w, s.h, s.d)), keep(new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.62 })));
    const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(s.w * 1.3, s.h * 1.3)), keep(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex, transparent: true, opacity: 0.28, depthWrite: false })));
    shadow.renderOrder = 2;
    shadow.raycast = () => {};
    group.add(shadow, mesh);
    return { mesh, shadow, w: s.w, h: s.h, rx: s.x, ry: s.y, x: s.x, y: s.y, vx: 0, vy: 0, held: false };
  });
  const place = () => {
    for (const b of boxes) {
      const lift = b.held ? 0.05 : 0;
      b.mesh.position.set(b.x, b.y, (b.mesh.geometry as THREE.BoxGeometry).parameters.depth / 2 + 0.004 + lift);
      b.shadow.position.set(b.x + 0.015 + lift * 0.4, b.y - 0.02 - lift * 0.4, 0.002);
      (b.shadow.material as THREE.MeshBasicMaterial).opacity = b.held ? 0.16 : 0.28;
    }
  };
  place();

  // apparent gravity / acceleration of the anchor frame
  const hist: THREE.Vector3[] = [];
  const o = new THREE.Vector3();
  const ex = new THREE.Vector3();
  const ey = new THREE.Vector3();
  const ez = new THREE.Vector3();
  const gApp = new THREE.Vector3();
  const K = 60;
  const C = 2 * 0.3 * Math.sqrt(K);
  const S = 0.025;
  let open = 0;
  let ctx: AddonContext | null = null;

  const inv = new THREE.Matrix4();
  const local = new THREE.Ray();
  const hitP = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.01);
  const toLocal = (ray: THREE.Ray) => {
    group.updateWorldMatrix(true, false);
    inv.copy(group.matrixWorld).invert();
    local.copy(ray).applyMatrix4(inv);
    return local.intersectPlane(plane, hitP) ? hitP : null;
  };
  const boxAt = (p: THREE.Vector3 | null) => {
    if (!p) return null;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i]!;
      if (Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2) return b;
    }
    return null;
  };
  let hold: { b: Box; dx: number; dy: number; t: number } | null = null;

  return {
    anchor: "back-inside",
    object: group,
    stats,
    /** Client position of box i's centre (for the headless runner) */
    screen(i) {
      const b = boxes[i];
      if (!b || !ctx) return null;
      const v = b.mesh.getWorldPosition(new THREE.Vector3()).project(ctx.camera);
      const rect = ctx.renderer.domElement.getBoundingClientRect();
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
    },
    kick() {
      for (const b of boxes) {
        b.vx += (Math.random() - 0.5) * 2;
        b.vy += (Math.random() - 0.5) * 2;
      }
      ctx?.invalidate();
    },
    attach(c) {
      ctx = c;
      stats.attached = true;
    },
    update(dt, _t, m) {
      stats.updates++;
      stats.anchor = m.elements.slice();
      m.extractBasis(ex, ey, ez);
      o.setFromMatrixPosition(m);
      hist.push(o.clone());
      if (hist.length > 3) hist.shift();
      gApp.set(0, 0, -981);
      if (hist.length === 3 && dt > 1e-4) {
        // a = (o2 - 2 o1 + o0) / dt²; apparent gravity = g - a
        const a = hist[2]!.clone().addScaledVector(hist[1]!, -2).add(hist[0]!).divideScalar(dt * dt);
        if (a.length() < 1e5) gApp.sub(a);
      }
      const gx = gApp.dot(ex);
      const gy = gApp.dot(ey);
      let moving = !!hold;
      const h = Math.min(Math.max(dt, 0), 0.05);
      const n = Math.max(1, Math.ceil(h * 240));
      for (const b of boxes) {
        if (b.held) continue;
        for (let i = 0; i < n; i++) {
          const ax = -K * (b.x - b.rx) - C * b.vx + S * gx;
          const ay = -K * (b.y - b.ry) - C * b.vy + S * gy;
          b.vx += (ax * h) / n;
          b.vy += (ay * h) / n;
          b.x += (b.vx * h) / n;
          b.y += (b.vy * h) / n;
        }
        if (Math.hypot(b.vx, b.vy) > 2e-3) moving = true;
      }
      // the in-plane gravity alone (no acceleration) would keep a steady offset: that is rest, not motion
      place();
      stats.moving = moving;
      return moving;
    },
    pointer: {
      down(ray) {
        if (open < 1) return false;
        const p = toLocal(ray);
        const b = boxAt(p);
        if (!b || !p) return false;
        stats.downs++;
        b.held = true;
        b.vx = b.vy = 0;
        hold = { b, dx: b.x - p.x, dy: b.y - p.y, t: performance.now() };
        place();
        return true;
      },
      move(ray) {
        stats.moves++;
        const p = toLocal(ray);
        if (!hold || !p) return;
        hold.b.x = p.x + hold.dx;
        hold.b.y = p.y + hold.dy;
        place();
      },
      up() {
        stats.ups++;
        if (!hold) return;
        hold.b.held = false;
        hold = null;
        place();
      },
      hover(ray) {
        stats.hovers++;
        return !!boxAt(toLocal(ray));
      },
    },
    setOpen(c) {
      if (open < 1 && c >= 1) for (const b of boxes) b.vy -= 0.6;
      open = c;
      stats.opens.push(+c.toFixed(3));
      if (stats.opens.length > 400) stats.opens.splice(0, 200);
    },
    dispose() {
      stats.disposed = true;
      for (const d of disposables) d.dispose();
    },
  };
}

type StandIn = ReturnType<typeof standIn>;
type SoundCue = { t: number; name: string; gain?: number; pan?: number };
const w = window as unknown as { __book: Book | null; __ready: boolean; __state: BookState | null; __addon: StandIn | null; __sounds: SoundCue[] };
w.__book = null;
w.__ready = false;
w.__state = null;
w.__addon = null;
w.__sounds = [];
const onSound = (name: string, o?: { gain?: number; pan?: number }) => w.__sounds.push({ t: performance.now(), name, ...o });

const stage = document.getElementById("stage")!;
const box = (q.get("box") ?? "").split("x").map(Number);
if (box[0] && box[1]) Object.assign(stage.style, { width: `${box[0]}px`, height: `${box[1]}px`, inset: "auto", left: "0", top: "0" });
const r = stage.getBoundingClientRect();
const narrowQ = q.get("narrow");
const narrow = narrowQ === null ? r.width < 700 || r.width / Math.max(1, r.height) < 0.75 : narrowQ === "1";

const caseSpec: CaseSpec = {
  rings: false,
  board: { w: 250, h: 340 },
  depth: 16,
  liner: {
    title: sample.name,
    subtitle: sample.nameLocal,
    role: sample.role,
    place: sample.location,
    lines: [sample.role, sample.location ?? "", sample.handle ?? "", sample.links[0]?.href.replace(/^mailto:/, "") ?? ""].filter(Boolean),
    ...(q.get("portrait") === "1" && { portrait: { src: portraitUrl() } }),
  },
};
const tilt = q.get("tilt") !== "0";
const autoOpen = q.get("auto") !== "0";

/** ?pouch=1: the real pouch (src/bag), loaded before the book like the résumé stage does */
const bag = q.get("pouch") === "1" ? await import("../../src/bag") : null;
const picks: string[] = [];
(window as unknown as { __picks: string[] }).__picks = picks;
const makeAddon = (): SceneAddon => {
  if (bag) {
    // loosely typed: src/bag's options are changing under this harness (dark goes away there too)
    const opts = { profile: sample, dark: false, fit: { width: 2.5, height: 3.4 }, onPick: (id: string) => picks.push(id), font: { serif: css("--serif"), sans: css("--sans"), mono: css("--mono") } };
    const p = bag.createPouchAddon(opts as unknown as Parameters<typeof bag.createPouchAddon>[0]);
    (window as unknown as { __pouch: unknown }).__pouch = p;
    return p;
  }
  const a = standIn(q.get("film") !== "0");
  w.__addon = a;
  return a;
};
// fonts first, like the site: the liner, the stamp and the pouch's print are set in them
await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

/** The live book: direct (createBook) by default; ?via=view mounts the same folio through <BookView> (addons factory, ref handle). */
let book: Pick<Book, "toggleCover" | "shake" | "setTilt" | "next" | "prev">;
let swapCover: (c: Partial<CoverSpec>) => void;
if (q.get("via") === "view") {
  const handle = createRef<BookViewHandle>();
  (window as unknown as { __handle: typeof handle }).__handle = handle;
  let setLive: (c: CoverSpec) => void = () => {};
  function View() {
    const [live, set] = useState(cover);
    setLive = set;
    return (
      <BookView
        sheets={0}
        case={caseSpec}
        addons={() => [makeAddon()]}
        tilt={tilt}
        autoOpen={autoOpen}
        cover={live}
        narrow={narrow}
        ref={handle}
        onBook={(b) => (w.__book = b)}
        onState={(s) => (w.__state = s)}
        onReady={() => (w.__ready = true)}
        onSound={onSound}
      />
    );
  }
  createRoot(stage).render(
    <StrictMode>
      <View />
    </StrictMode>,
  );
  let cur = cover;
  swapCover = (c) => {
    cur = { ...cur, ...c };
    setLive(cur);
  };
  book = {
    toggleCover: () => handle.current?.toggleCover(),
    shake: (s) => handle.current?.shake(s),
    setTilt: (x, y) => handle.current?.setTilt(x, y),
    next: () => handle.current?.next(),
    prev: () => handle.current?.prev(),
  };
} else {
  const direct = await createBook(stage, {
    sheets: 0,
    case: caseSpec,
    addons: [makeAddon()],
    tilt,
    autoOpen,
    cover,
    narrow,
    theme,
    insets: { top: 0, bottom: 0 },
    onState: (s) => (w.__state = s),
    onOpenCard: () => {},
    onReady: () => (w.__ready = true),
    onLost: () => console.warn("context lost"),
    onSound,
  });
  w.__book = direct;
  book = direct;
  let cur = cover;
  swapCover = (c) => {
    cur = { ...cur, ...c };
    direct.setCover(cur);
  };
}
(window as unknown as { __setCover: typeof swapCover }).__setCover = (c) => swapCover(c);

const bar = document.getElementById("bar")!;
// BookView brings its own controls along the foot: the harness buttons go to the top
if (q.get("via") === "view") Object.assign(bar.style, { top: "12px", bottom: "auto" });
for (const [label, fn] of [
  ["Open / close", () => book.toggleCover()],
  ["Shake", () => book.shake(1)],
  ["Tilt", () => book.setTilt(0.25, -0.3)],
  ["Level", () => book.setTilt(0, 0)],
  ["Leather", () => swapCover({ material: "leather" })],
  ["Cloth", () => swapCover({ material: "cloth" })],
  ["Frost", () => swapCover({ material: "frost" })],
] as const) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  bar.appendChild(b);
}
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "ArrowRight") book.next();
  if (e.key === "ArrowLeft") book.prev();
});
