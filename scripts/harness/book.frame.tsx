import "@fontsource/shippori-mincho/400.css";
import "@fontsource/shippori-mincho/500.css";
import "@fontsource/shippori-mincho/600.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import { StrictMode, createRef, useState } from "react";
import * as THREE from "three";
import type { BookLabels } from "../../src/book/labels";
import { createRoot } from "react-dom/client";
import type { SceneAddon } from "../../src/book/addon";
import type { CaseSpec } from "../../src/book/binder";
import { BookView, type BookViewHandle } from "../../src/book/BookView";
import { BOOKLET_COVERS, type CoverSpec } from "../../src/book/cover";
import type { LayoutPreset } from "../../src/book/layout";
import type { Book, BookState, Insets } from "../../src/book/scene";
import { frameOf, lightFade } from "../../src/app/layout";
import type { HanLang } from "../../src/fonts";
import { profile as sampleEn } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";

/*
 * Framing harness for the full-bleed canvas (spec §2.1, §2.3, brief O3): one booklet mounted the way the morning-light shell mounts
 * it — BookView over the whole viewport (position: fixed; inset: 0), a transparent canvas over the desk and its fibres, the book
 * framed in the DOM's book box through four-sided insets computed from the viewport like the shell's grid (§1.5).
 *
 * Query: ?b=cards|postcards|resume  &material=frost|cloth|leather (default: the booklet's)  &auto=0 (stay closed)  &zh=1 (the Chinese sample)
 *        &insets=auto|none|T,B,L,R  &fibres=0 (bare desk)  &box=1 (outline the book box)  &pouch=0 (résumé: no pouch)
 *        &clear=opaque (the old opaque clear, for the A/B of §2.1: every setClearColor gets alpha 1)  &tilt=0
 *        &labels=zh (the zh openCard contract: 细看「nameLocal ?? placeLocal ?? title」)  &mode=flat|3d (BookView's mode)
 *        &fade=0 (the window light unmasked; default: the shell's lightFade)  &ambient=0 (no sway)  &n=7 (albums: the first n items only)
 *        &narrow=0|1 (default: the shell's rule — phones and portrait tablets one page at a time)
 * Exposes window.__book (Book | null), __ready, __state, __insets (what was passed), __box (the book box, client px), __handle,
 * __pouchRect() (the résumé pouch's film, client px, as last rendered: the content plane's gutter check; null without a pouch),
 * __setZh(on) (round 4, E1: the other sample's language in place — the items, the cover title, the slip or the liner — as the shell
 * switches it; the pouch keeps its own words).
 */

const q = new URLSearchParams(location.search);
if (q.get("fibres") === "0") document.body.dataset.fibres = "0";
if (q.get("box") === "1") document.body.dataset.box = "";

/*
 * The A/B of §2.1: the same page with the old opaque clear. three keeps setClearColor on the renderer instance (not its prototype), so
 * this works a level down: a transparent clear of the canvas itself (the default framebuffer) becomes the desk colour, opaque — what
 * setClearColor(bg, 1) used to do. Render-target clears (shadow maps, PMREM, the frost pass) are left alone.
 */
if (q.get("clear") === "opaque") {
  // #e3e8eb as stored in the canvas (sRGB bytes; three encodes in its shaders, the default framebuffer takes the bytes as they are)
  const desk = { r: 227 / 255, g: 232 / 255, b: 235 / 255 };
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const P = C.prototype as WebGLRenderingContext;
    const clearColor = P.clearColor;
    const clear = P.clear;
    const last = new WeakMap<object, [number, number, number, number]>();
    P.clearColor = function (this: WebGLRenderingContext, r: number, g: number, b: number, a: number) {
      last.set(this, [r, g, b, a]);
      clearColor.call(this, r, g, b, a);
    };
    P.clear = function (this: WebGLRenderingContext, mask: number) {
      const l = last.get(this);
      if (l && l[3] === 0 && mask & this.COLOR_BUFFER_BIT && this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
        clearColor.call(this, desk.r, desk.g, desk.b, 1);
        clear.call(this, mask);
        clearColor.call(this, ...l);
        return;
      }
      clear.call(this, mask);
    };
  }
}

type Booklet = "cards" | "postcards" | "resume";
const which = (q.get("b") ?? "resume") as Booklet;
const zh = q.get("zh") === "1";
const sample = zh ? sampleZh : sampleEn;
const titles = (zh: boolean): Record<Booklet, string> =>
  zh ? { cards: "卡册", postcards: "明信片", resume: sampleZh.coverTitle } : { cards: "Cards", postcards: "Postcards", resume: sampleEn.coverTitle };
/** The albums' 題簽 (booklets.ts `local`): Japanese flavour in English, Chinese in Chinese */
const slips = (zh: boolean): Record<"cards" | "postcards", { title: string; han: HanLang }> =>
  zh ? { cards: { title: "卡册", han: "zh-Hans" }, postcards: { title: "明信片", han: "zh-Hans" } } : { cards: { title: "カード帖", han: "ja" }, postcards: { title: "絵葉書", han: "ja" } };
const coverFor = (zh: boolean): CoverSpec => ({
  ...BOOKLET_COVERS[which],
  ...(q.get("material") && { material: q.get("material") as CoverSpec["material"] }),
  ...(q.get("color") && { color: q.get("color") as CoverSpec["color"] }),
  title: titles(zh)[which],
  window: null,
});
const cover = coverFor(zh);

type Box = { left: number; top: number; right: number; bottom: number };
/** The DOM's book box (spec §1.5) for a viewport, and the insets the shell passes for it: the shell's own grid (src/app/layout.ts) */
function layout(W: number, H: number): { box: Box; insets: Insets } {
  const f = frameOf(W, H);
  // the albums get the wider box (App: frame.wide, frame.wideCards for cards), the résumé the plain one
  return { box: f.box, insets: which === "resume" ? f.insets : which === "cards" ? f.wideCards : f.wide };
}
const W = innerWidth;
const H = innerHeight;
const L = layout(W, H);
const insetsQ = q.get("insets") ?? "auto";
const insets: Insets | undefined =
  insetsQ === "none" ? { top: 0, bottom: 0, left: 0, right: 0 } : insetsQ === "auto" ? L.insets : (([top, bottom, left, right]) => ({ top: top!, bottom: bottom!, left, right }))(insetsQ.split(",").map(Number));
const boxEl = document.getElementById("box")!;
Object.assign(boxEl.style, { left: `${L.box.left}px`, top: `${L.box.top}px`, width: `${L.box.right - L.box.left}px`, height: `${L.box.bottom - L.box.top}px` });

const w = window as unknown as {
  __book: Book | null;
  __ready: boolean;
  __state: BookState | null;
  __insets: Insets | undefined;
  __box: Box;
  __handle: unknown;
  __setCover(c: Partial<CoverSpec>): void;
  __setZh(on: boolean): void;
  __pouchRect(): Box | null;
};
w.__pouchRect = () => null;
w.__book = null;
w.__ready = false;
w.__state = null;
w.__insets = insets;
w.__box = L.box;

const caseFor = (zh: boolean): CaseSpec => {
  const s = zh ? sampleZh : sampleEn;
  return which === "resume"
    ? {
        rings: false,
        board: { w: 250, h: 340 },
        depth: 16,
        liner: { title: s.name, ...(s.nameLocal && { subtitle: s.nameLocal }), role: s.role, place: s.location, ...(s.lang && { lang: s.lang }) },
      }
    : { slip: slips(zh)[which] };
};
const CASES = { en: caseFor(false), zh: caseFor(true) };
/** &n: the first n items of each sample (made once: a new array every render would be new content every render) */
const PART = which === "resume" ? { en: [], zh: [] } : { en: sampleEn.albums[which].slice(0, Math.max(0, Number(q.get("n") ?? 0))), zh: sampleZh.albums[which].slice(0, Math.max(0, Number(q.get("n") ?? 0))) };

/** The real pouch (src/bag) for the résumé folio, loaded before the book like the shell does; none when it fails to load */
const bag = which === "resume" && q.get("pouch") !== "0" ? await import("../../src/bag").catch((e: unknown) => (console.warn("pouch unavailable", e), null)) : null;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const addons = (): SceneAddon[] => {
  if (!bag) return [];
  try {
    // loosely typed: src/bag's options are changing under this harness (dark goes away there too)
    const opts = { profile: sample, dark: false, fit: { width: 2.5, height: 3.4 }, font: { serif: css("--serif"), sans: css("--sans"), mono: css("--mono") }, onPick: () => {} };
    const p = bag.createPouchAddon(opts as unknown as Parameters<typeof bag.createPouchAddon>[0]);
    const attach = p.attach.bind(p);
    p.attach = (ctx) => {
      const cam = (ctx as { camera?: THREE.Camera }).camera;
      // the pouch's film group: its world box's eight corners, projected with the book's camera
      w.__pouchRect = () => {
        const film = p.object.getObjectByName("bag-pouch");
        if (!film || !cam) return null;
        const box = new THREE.Box3().setFromObject(film, true);
        const r = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        const v = new THREE.Vector3();
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              v.set(x, y, z).project(cam);
              const px = ((v.x + 1) / 2) * innerWidth;
              const py = ((1 - v.y) / 2) * innerHeight;
              r.left = Math.min(r.left, px);
              r.right = Math.max(r.right, px);
              r.top = Math.min(r.top, py);
              r.bottom = Math.max(r.bottom, py);
            }
        return r;
      };
      attach(ctx);
    };
    return [p];
  } catch (e) {
    console.warn("pouch failed", e);
    return [];
  }
};
await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);

/** The shell's zh openCard (contract (b)): the item's name in its own script when it has one */
const labels: Partial<BookLabels> | undefined = q.get("labels") === "zh" ? { openCard: (title, item) => `细看「${item?.nameLocal ?? item?.placeLocal ?? title}」` } : undefined;
const mode = (q.get("mode") ?? "auto") as "auto" | "3d" | "flat";
/** One page at a time where the shell has it so (App: phones, and a portrait tablet); &narrow=0|1 forces it */
const lf = frameOf(W, H);
const narrowQ = q.get("narrow");
const narrow = narrowQ !== null ? narrowQ === "1" : lf.cls === "p" || (lf.cls === "t" && H >= W) ? true : lf.cls === "t" ? false : undefined;

const handle = createRef<BookViewHandle>();
w.__handle = handle;
let setLive: (c: CoverSpec) => void = () => {};
let setLang: (zh: boolean) => void = () => {};
/** __setCover's changes, kept over a language switch */
let coverOver: Partial<CoverSpec> = {};
function View() {
  const [live, set] = useState(cover);
  const [zhNow, setZhNow] = useState(zh);
  setLive = set;
  setLang = (on) => {
    setZhNow(on);
    set({ ...coverFor(on), ...coverOver });
  };
  const sample = zhNow ? sampleZh : sampleEn;
  const caseSpec = zhNow ? CASES.zh : CASES.en;
  const common = {
    ref: handle,
    cover: live,
    insets,
    tilt: q.get("tilt") !== "0",
    autoOpen: q.get("auto") !== "0",
    onBook: (b: Book | null) => {
      w.__book = b;
      // the shell's window-light mask (src/app/stages/light.ts); &fade=0 leaves the light unmasked
      if (b && q.get("fade") !== "0") b.setLightFade(lightFade(frameOf(W, H)));
      if (b && q.get("ambient") === "0") b.setAmbient(false);
    },
    onState: (s: BookState) => (w.__state = s),
    onReady: () => (w.__ready = true),
    labels,
    mode,
    ...(narrow !== undefined ? { narrow } : {}),
  };
  if (which === "resume") return <BookView {...common} sheets={0} case={caseSpec} addons={addons} />;
  // &layout=idCard2x4|postcard2x3|… : the album's pocket grid (default: the booklet's, as booklets.ts gives it)
  const layout = (q.get("layout") ?? (which === "cards" ? "idCard2x4" : "postcard2x3")) as LayoutPreset;
  // &n=7 : only the first n items (a part-filled last sheet: empty pockets, an empty soft column)
  const n = q.get("n");
  const items = n ? (zhNow ? PART.zh : PART.en) : sample.albums[which];
  return <BookView {...common} kind={which} items={items} case={caseSpec} layout={layout} />;
}
let cur = cover;
w.__setCover = (c) => {
  coverOver = { ...coverOver, ...c };
  cur = { ...cur, ...c };
  setLive(cur);
};
w.__setZh = (on) => setLang(on);
createRoot(document.getElementById("stage")!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
