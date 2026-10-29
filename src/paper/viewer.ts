/*
 * The paper viewer: a small three.js stage for one printed object inside a detail dialog — the résumé (A4 sheets bound on the left,
 * turned like real paper) or the folded business card (unfolds about its crease). Its own WebGLRenderer: the dialog opens over the
 * folio, so one extra context is alive while it is open; dispose() frees everything and parks the context, its drawing buffer shrunk to
 * 1 × 1, for the next viewer (making one is a chain of synchronous waits on the GPU; warmPaper() parks one ahead of the first open).
 *
 * The canvas is transparent (whatever is behind the host shows through); shadows are drawn by a shadow-catcher plane. It renders on
 * demand: frames run while something moves and stop when everything is asleep. If WebGL is unavailable the promise rejects before
 * touching the host, so the dialog can show its DOM version.
 *
 * Framing: the host is "wide" when the open résumé spread fits it at a readable size; the camera then keeps the spread's scale,
 * centres page 1 while nothing lies on the left and pans to the whole spread as soon as a sheet lifts. Otherwise it is "narrow" (a
 * phone): the camera stays on the page on the right and a turned sheet slides off to the left. Either way the canvas overscans the
 * host (it is pointer-transparent; the host takes the input) up to the window's edges, so a sheet standing up or sliding away is
 * never cut at the host's edge — except a résumé whose pages all lie open on a wide host: nothing of it ever flies, and its canvas
 * covers just the paper and its shadow (reach), which keeps the device's full density within the pixel budget.
 */
import * as THREE from "three";
import type { BusinessCardItem, ResumeItem } from "../profile/schema";
import { CARD_MAX_PX_PER_MM, CONTACT as CARD_WORDS, createCardModel } from "./card";
import { loadPrintFonts } from "./fonts";
import { deskMaterial, grainTexture, shadowUniforms, type DeskUniforms, type ShadowUniforms } from "./material";
import { createResumeModel } from "./resume";
import { resumeLang, resumeWords, type Owner } from "./typeset";

/**
 * page: 0-based position, count: positions (the card: 0 closed / 1 open of 2). The résumé also says which printed pages are on view
 * (1-based first … last of total): a wide host shows spreads ("Pages 1–2 of 2", one position), a narrow host one page at a time.
 */
export type PaperState = { page: number; count: number; first?: number; last?: number; total?: number };

/** Sound cues of the paper viewer (PaperViewerOptions.onSound). The viewer only reports; the host owns the audio. */
export type PaperSoundName = "pageTurn" | "pageLand" | "cardUnfold" | "paperRustle";
/** gain 0 … 1, pan −1 (left) … 1 (right) */
export type PaperSoundOptions = { gain?: number; pan?: number };

export type PaperLabels = {
  resume: string;
  card: string;
  /** "Page 1 of 2" (page is 1-based here) */
  page(page: number, count: number): string;
  /** an open spread: "Pages 1–2 of 2" */
  pages(first: number, last: number, total: number): string;
  cardClosed: string;
  cardOpen: string;
  hint: string;
  cardHint: string;
};
export const DEFAULT_PAPER_LABELS: PaperLabels = {
  resume: "Résumé",
  card: "Business card",
  page: (p, n) => `Page ${p} of ${n}`,
  pages: (a, b, n) => `Pages ${a}–${b} of ${n}`,
  cardClosed: "closed",
  cardOpen: "open",
  hint: "Drag a page, click it or use the arrow keys to turn.",
  cardHint: "Drag the cover or click to open and close.",
};

export type PaperViewerOptions = {
  item: ResumeItem | BusinessCardItem;
  /** @deprecated light only; ignored */
  dark?: boolean;
  labels?: Partial<PaperLabels>;
  /** Called when the viewer can no longer render (the WebGL context was lost): the host should close it or swap in its DOM version. */
  onClose?(reason: "lost"): void;
  /** Called whenever the page (or the card's open state) changes. */
  onChange?(state: PaperState): void;
  /** The person, for the résumé's head (name, local name, role, location, handle, links). Falls back to the item's label. */
  owner?: Owner;
  /**
   * The profile's language (Profile.lang; also accepted as owner.lang): Chinese labels on a Chinese résumé, and the Han faces with
   * the text (src/fonts). Without it a résumé written in Chinese is still recognised from its own words.
   */
  lang?: string;
  /** @deprecated the print is set through src/fonts; ignored */
  fonts?: Partial<Record<"serif" | "sans" | "mono", string>>;
  /**
   * The paper's largest size on screen, in CSS px per mm (a large host leaves it at reading size). Default: the object's own cap
   * (résumé 2.25 — an A4 page 668 px tall at 1440 × 900 —, card 6.8) times the page's scale on large screens, k = min(window width /
   * 1440, height / 900) within 1 … 1.6 (brief r4 E3/E4: the 1440 × 900 composition scaled as a whole). 0 or Infinity: no cap (the
   * host alone decides).
   */
  maxPxPerMm?: number;
  /**
   * Sound cues, reported as they happen (never on open, resize / re-typeset, theme or the hover peeks):
   *  - "pageTurn": a résumé sheet starts a turn — a click / key / next() / prev() at once (pan +0.15 forward, −0.15 back), a drag once
   *    the sheet is lifted past 0.05 of a turn (gain from its speed), a fling released before that. At most one per sheet motion.
   *  - "pageLand": that sheet coming down flat on a stack, in the frame its edge meets it (every pageTurn is followed by one; a sheet
   *    a drag lifted less than the turn threshold lands with a quiet one only if its edge rose at least 0.15 rad). gain from the
   *    landing speed (quiet for slow drops); pan −0.3 on the left stack, +0.3 on the right.
   *  - "paperRustle": the hand on a dragged sheet: each time the grabbed point has travelled 4 mm, at most every 400 ms (not within
   *    300 ms of that sheet's pageTurn). gain from how far it moved since the last one.
   *  - "cardUnfold": the business card starts opening or closing — a click / key / next() / prev(), or the start of a drag on it.
   */
  onSound?: (name: PaperSoundName, o?: PaperSoundOptions) => void;
};

export type PaperDebug = {
  /** Stop the animation loop; frames only advance through advance(). */
  manual(on: boolean): void;
  /** Advance time by dt seconds (physics + camera) and render one frame. */
  advance(dt: number): void;
  /** Per-frame max link-angle change (rad) of the last frame and since resetStats, and each sheet's turn progress (0 right … 1 left). */
  stats(): { frameMax: number; max: number; progress: number[] };
  resetStats(): void;
  /** world point → client px (for scripted pointer input) */
  project(x: number, y: number, z: number): [number, number];
  /** "wide" (the spread fits) or "narrow" (one page at a time) */
  mode(): "wide" | "narrow";
  /** texture height (px) of a printed page (the résumé; 0 for the card) */
  texPx(): number;
  renderer: THREE.WebGLRenderer;
};

/** A box on the page in client CSS px (as getBoundingClientRect gives it). */
export type ScreenRect = { left: number; top: number; right: number; bottom: number };

export type PaperViewer = {
  next(): void;
  prev(): void;
  dispose(): void;
  setDark(d: boolean): void;
  /**
   * Where the paper itself lies on the page once the camera has come to rest in its current framing (client CSS px, the bounding box
   * of its corners as drawn — the camera looks from a little in front, so the far edge is a touch narrower): the résumé's page (or the
   * open spread once a sheet has turned on a wide host), the business card closed or opened. Not the host, not the frame's margin:
   * what a caption hangs under. Null before the model is in, or after dispose().
   */
  restRect(): ScreenRect | null;
  /**
   * The same object in another language (brief r4 E1): the print is set again in its words, in place — the page on view, the camera
   * and the open state stay (a résumé that now takes another number of pages keeps the first page on view where it can). Loads the
   * new strings' print faces first (up to the usual timeout; a face that is later still paints once more when it arrives). `owner`
   * and `lang` as in the options; `labels` replace the accessible labels. Resolves true once the new print is on view, false when
   * `item` is of another kind (a business card for a résumé: make a new viewer), after dispose(), or when a later call overtook it.
   */
  setContent(o: { item: ResumeItem | BusinessCardItem; owner?: Owner; lang?: string; labels?: Partial<PaperLabels> }): Promise<boolean>;
  /** live: page is 0-based (card: 0 closed, 1 open) */
  state: PaperState;
  debug: PaperDebug;
};

/* ── what a model (résumé / card) gets from the stage, and gives back ── */
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type LayoutOpts = {
  /** CSS px per mm of the page on screen, in its framing at rest */
  pxPerMm: number;
  dpr: number;
  /** the host shows one page at a time */
  narrow: boolean;
  /** typeset and paint again even if nothing changed (the print fonts arrived late) */
  force?: boolean;
};
export type ModelCtx = {
  canvas: HTMLCanvasElement;
  shadow: ShadowUniforms;
  desk: DeskUniforms;
  grain: THREE.Texture;
  anisotropy: number;
  /** the GPU's largest texture side (px) */
  maxTexture: number;
  /** about how many device px per mm the object will be seen at, at rest (set before a card model is made: its print resolution) */
  printPxPerMm?: number;
  /** the language the print is in (for its labels and Han faces) */
  lang: string | undefined;
  fontsReady: Promise<unknown>;
  /** simulation time (s) */
  time(): number;
  invalidate(): void;
  emit(): void;
  /** report a sound cue (PaperViewerOptions.onSound); never changes anything */
  sound(name: PaperSoundName, o?: PaperSoundOptions): void;
  /** pointer ray (client px) in obj's local frame */
  rayLocal(x: number, y: number, obj: THREE.Object3D): THREE.Ray;
  /** obj-local point → client px */
  project(v: THREE.Vector3, obj: THREE.Object3D): [number, number];
  /** the pointer cursor over the paper */
  setCursor(c: string): void;
};
export type Model = {
  group: THREE.Group;
  state: PaperState;
  /** the world rect (desk plane) to frame now */
  view(narrow: boolean): Rect;
  /** the paper itself within that view, when the view keeps a margin round it (the card's 3 mm); default: the view */
  paper?(narrow: boolean): Rect;
  /**
   * The rects the host is measured against: one page, and (the résumé) the open spread; maxPxPerMm caps the object's size on screen.
   * air: world points a sheet or cover in flight reaches (a sheet standing up at the binding comes towards the camera and grows):
   * they must stay inside the canvas (vertically always, sideways too on a wide host), while the rects fit inside the host.
   */
  frames(): { single: Rect; spread?: Rect; maxPxPerMm?: number; air?: readonly (readonly [number, number, number])[] };
  /** (re)typeset for the on-screen page size; résumé only */
  layout?(o: LayoutOpts): Promise<void>;
  /** paint the print again (the print fonts arrived late, or setItem gave it new words); card only */
  repaint?(): Promise<void>;
  /** print this item instead (another language, same kind) from the next layout() / repaint(); false for another kind */
  setItem?(item: ResumeItem | BusinessCardItem, owner: Owner | undefined): boolean;
  step(h: number, t: number): boolean;
  sync(): boolean;
  /** a drag is in progress (frames keep coming) */
  holding(): boolean;
  pointer: { down(e: PointerEvent): boolean; move(e: PointerEvent): void; up(e: PointerEvent): void; leave(): void };
  next(): void;
  prev(): void;
  stats(): { frameMax: number; max: number; progress: number[] };
  resetStats(): void;
  /** texture height (px) of a printed page now (résumé), for harnesses */
  texPx?(): number;
  dispose(): void;
};

/** a longish lens: a sheet standing up at the binding does not balloon towards the viewer */
const FOV = 20;
/** camera tilt from straight down (towards the viewer), radians */
const TILT = 0.12;
/** key light: up, from the window at the top right and a little from behind (shadows fall left and towards the viewer, as on the page) */
const LIGHT = new THREE.Vector3(0.42, 0.3, 1).normalize();
const HZ = 480;
/** linear exposure: a page lying flat renders at about its print colour in the light theme, a little dimmer in the dark */
const EXPOSURE = { light: 0.86, dark: 0.8 };
/** the camera eases between framings like a critically damped spring that lands in about T seconds (art direction §8) */
const CAM_T = 0.75;
/**
 * The host is wide when the open spread fits it with the pages at least this many CSS px per mm (1.6 → an A4 page ≥ 336 px wide, its
 * print-size body text ≥ 7 px; the lightbox at 1280×720 gives 1.67, at 1440×900 2.0). Hysteresis: in / out. An absolute floor, not
 * "nearly as large as one page alone": a tall host makes a single page large and would otherwise never let the spread win.
 */
const WIDE_IN = 1.6;
const WIDE_OUT = 1.5;
/**
 * The canvas overscans the host (it is pointer-transparent; the host takes the input), so nothing in flight is ever cut at the host's
 * edge: up to OVERSCAN_Y CSS px above and below, up to OVERSCAN_X sideways (OVERSCAN_SLIDE on a narrow résumé, whose turned sheets
 * slide off to the left), always within the window.
 */
const OVERSCAN_Y = 220;
const OVERSCAN_X = 56;
const OVERSCAN_SLIDE = 480;
/**
 * The canvas's backing store at most this many device pixels (brief r4 E7): the device's full density (up to 3) wherever that fits.
 * A résumé lying open is covered only where it is drawn (reach), so on every desktop up to the largest page (k = 1.6: 2560 × 1440,
 * a 1663 × 1178 CSS px canvas, 7.8 Mpx at DPR 2; 2512 × 1233: 5.7 Mpx) it draws at the full density 2. Any lower ratio is resampled by
 * the compositor and the type visibly softens: on 1:1 crops at DPR 2 (r4-print/polish) the body text keeps 70–83 % of its edge
 * contrast at ratios 1.49–1.82, 100 % at 2. A business card, or a résumé that turns, keeps room round the host for what is in flight
 * and comes down to the budget (2512 × 1233 at DPR 2: ≈ 1.78). The stage's canvas behind it (src/book/scene.ts PIXEL_BUDGET, 6.5 Mpx)
 * draws nothing while the paper is open.
 */
export const PIXEL_BUDGET = 8e6;
/** a change of at most this many CSS px in the room round the same host keeps the canvas as it is (measure) */
const ROOM_SLACK = 32;
/** how far the paper's shadow on the desk reaches round a résumé lying open (mm; the canvas covers it, see reach) */
const SHADOW_MM = 16;
/** in-flight points keep this many CSS px inside the canvas */
const AIR_MARGIN = 6;
/**
 * sasshi: the wheel brings the résumé closer, up to ZOOM_MAX × its rest framing (a pinch on a trackpad too: ctrl + wheel). The view
 * follows the pointer across the host (the point under it stays under it), and the zoom and the pan ease in over about ZOOM_T s.
 */
const ZOOM_MAX = 2.5;
const ZOOM_T = 0.08;
const ZOOM_FADE = 36;

type Overscan = { l: number; t: number; r: number; b: number };
const NO_OVERSCAN: Overscan = { l: 0, t: 0, r: 0, b: 0 };

/** The page's scale on large screens (brief r4 E3): k = min(width / 1440, height / 900) within 1 … 1.6. */
export function screenScale(w: number, h: number): number {
  return Math.min(1.6, Math.max(1, Math.min(w / 1440, h / 900)));
}

type GlContext = { canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer };
/** The context a disposed viewer left for the next one (the folio opens one at a time), or warmPaper()'s */
let parked: GlContext | null = null;
/** The parked context, or a new one: on a 1 × 1 drawing buffer, so the (multisampled) buffer is allocated once, at its final size */
function takeContext(): GlContext {
  const p = parked;
  parked = null;
  if (p && !p.renderer.getContext().isContextLost()) return p;
  p?.renderer.dispose();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, stencil: false, powerPreference: "default" });
  if (!gl) throw new Error("WebGL2 is not available");
  return { canvas, renderer: new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true, premultipliedAlpha: true }) };
}
/** Keep a context whose viewer is gone (detached, everything drawn with it freed) for the next one: its drawing buffer shrinks to 1 × 1 */
function parkContext(c: GlContext) {
  if (parked || c.renderer.getContext().isContextLost()) {
    c.renderer.forceContextLoss();
    c.renderer.dispose();
    return;
  }
  c.renderer.setDrawingBufferSize(1, 1, 1);
  for (const a of ["style", "role", "tabindex", "aria-label"]) c.canvas.removeAttribute(a);
  parked = c;
}
/**
 * Make the paper viewer's WebGL context ahead of time (e.g. when the page is idle after loading), so the first createPaperViewer() does
 * not: a new context is a chain of synchronous waits on the GPU (≈ 15–70 ms, the open's longest task, brief r4 E7). Cheap to call again;
 * false where WebGL 2 is not available.
 */
export function warmPaper(): boolean {
  if (parked) return true;
  try {
    parkContext(takeContext());
    return true;
  } catch {
    return false;
  }
}

/** Resolve in a task of its own (after anything already queued), so the work before and after it are not one long task. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The owner and the print language of an item, as the options give them. */
function printOf(item: ResumeItem | BusinessCardItem, o: { owner?: Owner | undefined; lang?: string | undefined }): { owner: Owner | undefined; lang: string | undefined } {
  const owner: Owner | undefined = o.owner || o.lang ? { ...(o.owner ?? { name: "" }), ...(o.lang ? { lang: o.lang } : {}) } : undefined;
  return { owner, lang: item.kind === "resume" ? resumeLang(item, owner) : (owner?.lang ?? undefined) };
}
const cardOwner = (owner: Owner | undefined) => (owner ? { name: owner.name, ...(owner.nameLocal ? { nameLocal: owner.nameLocal } : {}), ...(owner.role ? { role: owner.role } : {}) } : undefined);

export function createPaperViewer(host: HTMLElement, opts: PaperViewerOptions): Promise<PaperViewer> {
  let labels: PaperLabels = { ...DEFAULT_PAPER_LABELS, ...opts.labels };
  /** what is printed (setContent swaps it for another language) */
  let item = opts.item;
  let { owner, lang } = printOf(item, opts);

  /* ── WebGL first: reject cleanly, without touching the host ── */
  let gl: GlContext;
  try {
    gl = takeContext();
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  const { canvas, renderer } = gl;

  // a few quads: render at the device's full density (up to 3, within PIXEL_BUDGET: measure) so the type stays crisp on phones (the
  // ratio is set with the drawing buffer's size, once: setPixelRatio here would size the 1 × 1 buffer again, a wait on the GPU each)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // linear: a sheet lying in the key light comes out at its printed white (#f8f9f7, the cool stock), and the shading of a
  // sheet in flight keeps its full range (a filmic curve greys the white and flattens the turn)
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.setClearColor(0x000000, 0);
  // the shaders are fixed: their logs are read back (a synchronous wait on the GPU per program, at its first use) only in development
  renderer.debug.checkShaderErrors = !!import.meta.env?.DEV;
  // the canvas only draws; the host takes the pointer (so the sideways overscan never steals clicks from the dialog around it)
  Object.assign(canvas.style, { position: "absolute", display: "block", top: "0", left: "0", pointerEvents: "none", outline: "none", opacity: "0", transition: "opacity 260ms ease-out" });
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  const hostStyle = { position: host.style.position, touchAction: host.style.touchAction, cursor: host.style.cursor };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
  /*
   * Light: a soft room (sky above the desk, the cool desk bounce below), a key from the upper right (the window) and a low fill from the left; all
   * of it the cool white of six in the morning. Paper is never grey: the back of a sheet standing up (lit by the room, the fill and the
   * light coming through it) stays at about 70 % of a sheet lying in the key light.
   */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xdce2e7, 1.6);
  hemi.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xf8fafc, 2.0);
  key.position.copy(LIGHT).multiplyScalar(10);
  const fill = new THREE.DirectionalLight(0xedf2f7, 0.9);
  fill.position.set(-0.8, -0.35, 0.5).multiplyScalar(10);
  scene.add(hemi, key, key.target, fill, fill.target);

  const shadow = shadowUniforms();
  shadow.uLightW.value.copy(LIGHT);
  shadow.uTrans.value = 0.35;
  const { mat: deskMat, uniforms: desk } = deskMaterial(shadow);
  const grain = grainTexture();
  grain.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const printFonts = loadPrintFonts(printedTexts(item, owner, lang), lang);
  let fontsIn = false;
  const fontsReady = printFonts.ready.then((ok) => (fontsIn = ok));

  let simT = 0;
  let simAcc = 0;
  let raf = 0;
  let last = 0;
  let manual = false;
  /**
   * The first frame has been drawn (at the end of the opening). Until then nothing renders on its own: a frame asked for while the
   * programs were still compiling (the print's layout invalidates) drew with them at once, a synchronous link in an animation frame.
   */
  let started = false;
  let disposed = false;
  let dark = false;
  const state: PaperState = { page: 0, count: 0 };
  let model: Model | null = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const inv = new THREE.Matrix4();

  /* ── framing ── */
  const cam = { x: 0, y: 0, d: 6, vx: 0, vy: 0, vd: 0, tx: 0, ty: 0, td: 6, snapped: false };
  const scratch = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
  const corner = new THREE.Vector3();
  /** the host's box (CSS px) */
  const size = { w: 1, h: 1 };
  /** the canvas's overscan beyond the host on each side (CSS px) */
  let os: Overscan = { l: 0, t: 0, r: 0, b: 0 };
  let narrow = true;
  /** sasshi: the zoom (1 … ZOOM_MAX) and the pointer across the host (−1 … 1 each way, y up), as they are and as they go */
  const zoom = { z: 1, tz: 1, nx: 0, ny: 0, tnx: 0, tny: 0 };
  const zoomed = () => zoom.tz > 1 || zoom.z > 1 + 1e-3;
  /** what the canvas covers round the host now (the overscan, or just the host while zoomed in) */
  let shown: Overscan = os;
  /** the print has the texels for ZOOM_MAX (asked for once the reader first zooms in) */
  let sharp = false;
  let sharpTimer = 0;
  /** the object's margin inside the host: a little more sideways (the host is the whole box, a little wider) than above and below */
  const gutter = () => ({ x: Math.max(16, size.w * 0.03), y: Math.max(12, size.h * 0.02) });
  /** how far the canvas may reach beyond the host: within the window, more sideways for a narrow résumé */
  function overscanFor(isNarrow: boolean): Overscan {
    const r = host.getBoundingClientRect();
    const side = isNarrow && model?.frames().spread ? OVERSCAN_SLIDE : OVERSCAN_X;
    const room = (v: number, cap: number) => Math.max(0, Math.min(cap, Math.floor(v)));
    return { l: room(r.left, side), t: room(r.top, OVERSCAN_Y), r: room(window.innerWidth - r.right, side), b: room(window.innerHeight - r.bottom, OVERSCAN_Y) };
  }
  function place(c: THREE.PerspectiveCamera, x: number, y: number, d: number) {
    c.position.set(x, y - d * Math.sin(TILT), d * Math.cos(TILT));
    c.up.set(0, 1, 0);
    c.lookAt(x, y, 0);
    // nothing comes closer than a sheet standing up at the binding: a far near plane keeps the stacked sheets' depth precise
    c.near = d * 0.3;
    c.far = d * 6;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }
  /**
   * The camera distance and aim (y of the point looked at) that fit the rect inside the host minus the gutters, keep the model's
   * in-flight points inside the canvas (sideways too, except on a narrow résumé whose turned sheets slide off), and keep the
   * object under its size cap. A sheet standing up at the binding leans towards the top of the screen (the camera looks from a little
   * in front), so the aim may sit a little above the rect's centre: the rest view then sits a little low in the host, using the room
   * below it instead of shrinking.
   */
  const fits = new Map<string, { d: number; y: number }>();
  function fit(r: Rect, wide = !narrow, o: Overscan = os): { d: number; y: number } {
    // the camera re-aims every frame: the answer only changes with the rect, the host and the overscan
    // (and with the in-flight points: the card adds its cover's swing only while the cover is up)
    const key = `${r.x0},${r.y0},${r.x1},${r.y1}|${size.w}x${size.h}|${o.l},${o.t},${o.r},${o.b}|${wide ? 1 : 0}|${model?.frames().air?.length ?? 0}|${capPxPerMm() ?? 0}`;
    let got = fits.get(key);
    if (!got) {
      if (fits.size > 16) fits.clear();
      got = fitNow(r, wide, o);
      fits.set(key, got);
    }
    return got;
  }
  function fitNow(r: Rect, wide: boolean, o: Overscan): { d: number; y: number } {
    scratch.aspect = size.w / size.h;
    const g = gutter();
    const lx = 1 - (2 * g.x) / size.w;
    const ly = 1 - (2 * g.y) / size.h;
    // the canvas in the host's NDC
    const ax0 = -1 - (2 * (o.l - AIR_MARGIN)) / size.w;
    const ax1 = 1 + (2 * (o.r - AIR_MARGIN)) / size.w;
    const ay0 = -1 - (2 * (o.b - AIR_MARGIN)) / size.h;
    const ay1 = 1 + (2 * (o.t - AIR_MARGIN)) / size.h;
    const air = model?.frames().air ?? [];
    // a narrow résumé's turned sheets slide off sideways by design; everything else stays inside the canvas
    const sideways = wide || !model?.frames().spread;
    const flat = [
      [r.x0, r.y0, 0],
      [r.x1, r.y0, 0],
      [r.x0, r.y1, 0],
      [r.x1, r.y1, 0],
    ] as const;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    /** do all points fit with the camera at (cx, y, d)? also returns the NDC shift that would centre the slack */
    const check = (y: number, d: number): { ok: boolean; shift: number } => {
      place(scratch, cx, y, d);
      let fTop = -Infinity;
      let fBot = Infinity;
      let aTop = -Infinity;
      let aBot = Infinity;
      let ok = true;
      for (const [x, py, z] of flat) {
        corner.set(x, py, z).project(scratch);
        if (Math.abs(corner.x) > lx) ok = false;
        fTop = Math.max(fTop, corner.y);
        fBot = Math.min(fBot, corner.y);
      }
      for (const [x, py, z] of air) {
        corner.set(x, py, z).project(scratch);
        if (Math.abs(corner.z) > 1 || (sideways && (corner.x < ax0 || corner.x > ax1))) ok = false;
        aTop = Math.max(aTop, corner.y);
        aBot = Math.min(aBot, corner.y);
      }
      // a vertical shift s (NDC) of everything must satisfy: flat within ±ly, air within [ay0, ay1]
      const hiS = Math.min(ly - fTop, ay1 - aTop);
      const loS = Math.max(-ly - fBot, ay0 - aBot);
      if (loS > hiS + 1e-6) ok = false;
      return { ok, shift: Math.min(hiS, Math.max(loS, 0)) };
    };
    let lo = 0.2;
    let hi = 120;
    let aimY = cy;
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2;
      let { ok, shift } = check(cy, d);
      let y = cy;
      if (ok && Math.abs(shift) > 1e-6) {
        // shifting the content up by s NDC = looking s · (half the view height on the desk) lower
        y = cy - (shift * d * tanH) / Math.cos(TILT);
        ok = check(y, d).ok;
      }
      if (ok) {
        hi = d;
        aimY = y;
      } else lo = d;
    }
    const cap = capPxPerMm();
    // px per scene unit = size.h / (2 d tan(fov / 2)); 1 unit = 100 mm
    if (cap && size.h / (2 * hi * tanH * 100) > cap) {
      // farther than the fit needs: everything is smaller, but the in-flight points still decide the aim (centred when they allow)
      const d = size.h / (2 * tanH * cap * 100);
      const { shift } = check(cy, d);
      return { d, y: Math.abs(shift) > 1e-6 ? cy - (shift * d * tanH) / Math.cos(TILT) : cy };
    }
    return { d: hi, y: aimY };
  }
  /** The size cap in force (see PaperViewerOptions.maxPxPerMm), or undefined for none. */
  function capPxPerMm(): number | undefined {
    return capFor(model?.frames().maxPxPerMm);
  }
  /** The cap for an object whose own cap is `c` (the option wins; else `c` scaled with the screen). */
  function capFor(c: number | undefined): number | undefined {
    const o = opts.maxPxPerMm;
    if (o !== undefined) return o > 0 && Number.isFinite(o) ? o : undefined;
    return c ? c * screenScale(window.innerWidth, window.innerHeight) : undefined;
  }
  const pxPerUnit = (d: number) => size.h / (2 * d * Math.tan(THREE.MathUtils.degToRad(FOV) / 2));
  /** wide or narrow, for this host (with a little hysteresis so a resize near the threshold does not flip back and forth) */
  function decideMode(): boolean {
    if (!model) return true;
    const f = model.frames();
    if (!f.spread) return true;
    const k = pxPerUnit(fit(f.spread, true, overscanFor(false)).d) / 100;
    return narrow ? k < WIDE_IN : k < WIDE_OUT;
  }
  /**
   * Aim at the model's current view. A wide host keeps the scale of the whole spread and only pans (page 1 alone sits in the
   * middle; once a sheet lifts the spread is centred), so the paper never changes size under the reader's eyes.
   */
  function aim() {
    const g = goal();
    if (!g) return;
    cam.tx = g.x;
    cam.ty = g.y;
    cam.td = g.d;
    if (!cam.snapped) snap();
  }
  /** Where the camera comes to rest for the model's current view. */
  function goal(): { x: number; y: number; d: number } | null {
    if (!model) return null;
    const r = model.view(narrow);
    const spread = model.frames().spread;
    // the scale (and the aim's offset from centre) of the whole spread on a wide host; the rect's own on a narrow one
    const base = !narrow && spread ? spread : r;
    const f = fit(base);
    return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 + f.y - (base.y0 + base.y1) / 2, d: f.d };
  }
  /** The paper's corners through the camera where it comes to rest (the host's own frustum: the canvas shows it at the host). */
  function restRect(): ScreenRect | null {
    const r = disposed ? null : restBox(0);
    if (!r) return null;
    const hr = host.getBoundingClientRect();
    return { left: hr.left + r.left, top: hr.top + r.top, right: hr.left + r.right, bottom: hr.top + r.bottom };
  }
  /** The same box in the host's own CSS px, the paper's rect grown by `m` scene units on every side first */
  function restBox(m: number): ScreenRect | null {
    const g = goal();
    if (!model || !g) return null;
    const r = model.paper?.(narrow) ?? model.view(narrow);
    scratch.aspect = size.w / size.h;
    place(scratch, g.x, g.y, g.d);
    let l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity;
    for (const [x, y] of [[r.x0 - m, r.y0 - m], [r.x1 + m, r.y0 - m], [r.x0 - m, r.y1 + m], [r.x1 + m, r.y1 + m]] as const) {
      corner.set(x, y, 0).project(scratch);
      const px = ((corner.x + 1) / 2) * size.w;
      const py = ((1 - corner.y) / 2) * size.h;
      l = Math.min(l, px);
      rr = Math.max(rr, px);
      t = Math.min(t, py);
      b = Math.max(b, py);
    }
    return { left: l, top: t, right: rr, bottom: b };
  }
  function snap() {
    cam.x = cam.tx;
    cam.y = cam.ty;
    cam.d = cam.td;
    cam.vx = cam.vy = cam.vd = 0;
    cam.snapped = true;
  }
  function moveCamera(dt: number): boolean {
    aim();
    // critically damped: k = (2π / 1.2T)², c = 2√k; substeps keep it stable at any frame time
    const k = (2 * Math.PI / (1.2 * CAM_T)) ** 2;
    const c = 2 * Math.sqrt(k);
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      cam.vx += (k * (cam.tx - cam.x) - c * cam.vx) * h;
      cam.vy += (k * (cam.ty - cam.y) - c * cam.vy) * h;
      cam.vd += (k * (cam.td - cam.d) - c * cam.vd) * h;
      cam.x += cam.vx * h;
      cam.y += cam.vy * h;
      cam.d += cam.vd * h;
    }
    const zoomBusy = stepZoom(dt);
    fadeEdges();
    // zoomed in: closer by z, and moved towards the pointer so far that the edges of the view reach the rest view's own (half its
    // size on the desk, less the zoomed view's half)
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const zk = 1 - 1 / zoom.z;
    place(camera, cam.x + zoom.nx * cam.d * tanH * (size.w / size.h) * zk, cam.y + (zoom.ny * cam.d * tanH * zk) / Math.cos(TILT), cam.d / zoom.z);
    const busy = Math.abs(cam.tx - cam.x) + Math.abs(cam.ty - cam.y) + Math.abs(cam.td - cam.d) > 1e-4 * cam.d || Math.abs(cam.vx) + Math.abs(cam.vy) + Math.abs(cam.vd) > 1e-4 * cam.d;
    if (!busy) snap();
    return busy || zoomBusy;
  }
  /**
   * sasshi: zoomed in, the paper runs past the host: its edges fade out over up to ZOOM_FADE CSS px instead of ending in a cut (none
   * at 1, where the paper's own edges lie a few px inside the host)
   */
  let fade = -1;
  function fadeEdges() {
    const f = shown === NO_OVERSCAN ? Math.round(ZOOM_FADE * Math.min(1, (zoom.z - 1) / 0.25)) : 0;
    if (f === fade) return;
    fade = f;
    const m = f ? `linear-gradient(to right, transparent, #000 ${f}px, #000 calc(100% - ${f}px), transparent), linear-gradient(transparent, #000 ${f}px, #000 calc(100% - ${f}px), transparent)` : "";
    Object.assign(canvas.style, { maskImage: m, webkitMaskImage: m, maskComposite: f ? "intersect" : "", webkitMaskComposite: f ? "source-in" : "" });
  }
  /** sasshi: the zoom and the pan towards their targets; back at 1, the canvas covers what it does at rest again */
  function stepZoom(dt: number): boolean {
    const a = 1 - Math.exp(-dt / ZOOM_T);
    zoom.z += (zoom.tz - zoom.z) * a;
    zoom.nx += (zoom.tnx - zoom.nx) * a;
    zoom.ny += (zoom.tny - zoom.ny) * a;
    const busy = Math.abs(zoom.tz - zoom.z) > 1e-4 || Math.abs(zoom.tnx - zoom.nx) + Math.abs(zoom.tny - zoom.ny) > 1e-4;
    if (busy) return true;
    zoom.z = zoom.tz;
    zoom.nx = zoom.tnx;
    zoom.ny = zoom.tny;
    if (!zoomed() && shown === NO_OVERSCAN) measure(false, true);
    return false;
  }

  /* ── context handed to the model ── */
  const ctx: ModelCtx = {
    canvas,
    shadow,
    desk,
    grain,
    anisotropy: renderer.capabilities.getMaxAnisotropy(),
    maxTexture: renderer.capabilities.maxTextureSize,
    lang,
    fontsReady,
    time: () => simT,
    invalidate,
    emit,
    sound(name, o) {
      const cb = opts.onSound;
      if (!cb || disposed) return;
      try {
        cb(name, o);
      } catch (e) {
        console.error("[sasshi] paper onSound failed", e);
      }
    },
    rayLocal(x, y, obj) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      obj.updateMatrixWorld();
      return raycaster.ray.clone().applyMatrix4(inv.copy(obj.matrixWorld).invert());
    },
    project(v, obj) {
      const r = canvas.getBoundingClientRect();
      const p = v.clone().applyMatrix4(obj.matrixWorld).project(camera);
      return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
    },
    setCursor(c) {
      host.style.cursor = c;
    },
  };

  function emit() {
    if (!model) return;
    Object.assign(state, model.state);
    const kind = item.kind;
    const { first, last, total } = state;
    const where = first && last && total ? (last > first ? labels.pages(first, last, total) : labels.page(first, total)) : labels.page(state.page + 1, state.count);
    // the turning hint only when there is something to turn to
    const hint = state.count > 1 ? ` ${labels.hint}` : "";
    canvas.setAttribute("aria-label", kind === "resume" ? `${labels.resume}. ${where}.${hint}` : `${labels.card}, ${state.page ? labels.cardOpen : labels.cardClosed}. ${labels.cardHint}`);
    opts.onChange?.({ ...state });
  }

  /* ── loop ── */
  function frame(dt: number): boolean {
    if (!model) return false;
    const H = 1 / HZ;
    simAcc = Math.min(simAcc + dt, 0.1);
    let awake = false;
    while (simAcc >= H) {
      simAcc -= H;
      simT += H;
      if (model.step(H, simT)) awake = true;
    }
    const moving = model.sync();
    const camBusy = moveCamera(dt);
    renderer.render(scene, camera);
    return awake || moving || camBusy || model.holding();
  }
  function tick(now: number) {
    raf = 0;
    if (disposed || manual) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (frame(dt)) raf = requestAnimationFrame(tick);
  }
  function invalidate() {
    if (raf || manual || disposed || !started) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  /* ── size, light, dark ── */
  let layoutTimer = 0;
  /** the canvas's pixel ratio at cw × ch CSS px: the device's full density (up to 3) within PIXEL_BUDGET */
  const ratioFor = (cw: number, ch: number) => Math.min(3, window.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / (cw * ch)));
  /** the host's size the canvas was last sized for */
  const sized = { w: 0, h: 0 };
  /**
   * Measure the host, pick wide / narrow, size the canvas with its overscan. The camera keeps the host's frustum (the fit is done for
   * the host) and the canvas shows it widened by the overscan (a view offset), so the host's part of the canvas is exactly the host.
   */
  function measure(force = false, keepMode = false) {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const wasNarrow = narrow;
    size.w = w;
    size.h = h;
    if (!keepMode) narrow = decideMode();
    let o = reach();
    // the room round the host is read through its ancestors' transforms, and the dialog's lift moves and scales it by up to ≈ 20 px
    // while the viewer is made: a change that small round the same host keeps the canvas (its drawing buffer is not allocated again,
    // ≈ 30–40 ms at this size); the camera fits against the overscan in force, so nothing in flight is cut
    if (!force && w === sized.w && h === sized.h && wasNarrow === narrow && Math.max(Math.abs(o.l - os.l), Math.abs(o.t - os.t), Math.abs(o.r - os.r), Math.abs(o.b - os.b)) <= ROOM_SLACK) o = os;
    os = o;
    // sasshi: zoomed in, the canvas covers just the host (the paper never spills over the caption beside it); the framing still
    // fits against the overscan
    const c = zoomed() ? NO_OVERSCAN : o;
    const cw = w + c.l + c.r;
    const ch = h + c.t + c.b;
    const ratio = ratioFor(cw, ch);
    // (three sizes the buffer at floor(css × ratio))
    const bw = Math.floor(cw * ratio);
    const bh = Math.floor(ch * ratio);
    const changed = force || c.l !== shown.l || c.t !== shown.t || c.r !== shown.r || c.b !== shown.b || canvas.width !== bw || canvas.height !== bh;
    shown = c;
    if (changed) {
      Object.assign(canvas.style, { left: `${-c.l}px`, top: `${-c.t}px`, width: `${cw}px`, height: `${ch}px` });
      // one allocation: setting the size and the ratio apart (setPixelRatio, then setSize) sized the buffer twice
      if (canvas.width !== bw || canvas.height !== bh) renderer.setDrawingBufferSize(cw, ch, ratio);
      camera.aspect = w / h;
      camera.setViewOffset(w, h, -c.l, -c.t, cw, ch);
      sized.w = w;
      sized.h = h;
    }
    return changed || wasNarrow !== narrow;
  }
  /**
   * How far the canvas reaches round the host (CSS px; negative: short of it). Whatever overscanFor() allows; but a résumé whose pages
   * all lie open on a wide host (nothing can turn: nothing in flight, the camera never pans) is covered only where it is drawn, the
   * paper and its shadow on the desk: at 2512 × 1233 ≈ 1440 × 1030 CSS px instead of ≈ 2030 × 1240, which fits the device's full
   * density in PIXEL_BUDGET, so the print stays as sharp as the screen (r4 E7).
   */
  function reach(): Overscan {
    const room = overscanFor(narrow);
    const f = model?.frames();
    const b = f?.spread && !narrow && !f.air?.length ? restBox(SHADOW_MM / 100) : null;
    if (!b) return room;
    return { l: Math.min(room.l, Math.ceil(-b.left)), t: Math.min(room.t, Math.ceil(-b.top)), r: Math.min(room.r, Math.ceil(b.right - size.w)), b: Math.min(room.b, Math.ceil(b.bottom - size.h)) };
  }
  /** The framing before anything is drawn: the host's size, the mode and the room round it (the canvas is sized by measure()) */
  function plan() {
    size.w = Math.max(1, host.clientWidth);
    size.h = Math.max(1, host.clientHeight);
    narrow = decideMode();
    os = overscanFor(narrow);
  }
  function resize() {
    if (!measure() && cam.snapped) {
      invalidate();
      return;
    }
    cam.snapped = false;
    aim();
    if (model?.layout) {
      window.clearTimeout(layoutTimer);
      layoutTimer = window.setTimeout(() => void relayout(), 220);
    }
    invalidate();
  }
  /** CSS px per mm of the page in its rest framing on this host (the spread when wide), for the type scale and texture size */
  function restPxPerMm(): number {
    if (!model) return 2;
    const f = model.frames();
    const r = !narrow && f.spread ? f.spread : f.single;
    return pxPerUnit(fit(r).d) / 100;
  }
  async function relayout(force = false) {
    if (!model?.layout || disposed) return;
    // (before the canvas has a size — the opening's first layout — the print is made for the device's full density)
    // (zoomed in once, the print keeps the texels for ZOOM_MAX: only the texture grows, the type is set as before)
    const dpr = (sized.w ? renderer.getPixelRatio() : Math.min(3, window.devicePixelRatio || 1)) * (sharp ? ZOOM_MAX : 1);
    await model.layout({ pxPerMm: restPxPerMm(), dpr, narrow, force });
    if (disposed) return;
    // the new print may turn where the old could not (or no longer; another language, another size): the canvas reaches as far as
    // that needs (once it has a size). A canvas sized again is cleared: drawn in this task, no frame shows it empty
    if (sized.w && measure(false, true)) {
      cam.snapped = false;
      aim();
      if (started && !manual) frame(0);
    }
    invalidate();
  }
  /** Light only (朝の光): kept for callers that still pass a theme; the paper is always lit as on the morning desk. */
  function setDark(_d: boolean) {
    const d = false;
    dark = d;
    // paper stays paper in the dark; it just is not lit like a white page on a bright desk, and its shadow needs more weight
    renderer.toneMappingExposure = d ? EXPOSURE.dark : EXPOSURE.light;
    hemi.intensity = d ? 1.4 : 1.6;
    desk.uOpacity.value = d ? 1.35 : 1;
    invalidate();
  }

  /* ── input (on the host: the canvas is pointer-transparent) ── */
  const onDown = (e: PointerEvent) => {
    if (!model || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (model.pointer.down(e)) {
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        // capture can fail on a synthetic or already-ended pointer
      }
      invalidate();
    }
  };
  /** sasshi: the pointer's place across the host, which the zoomed view follows (not while a sheet is in the hand) */
  function follow(e: PointerEvent | WheelEvent) {
    if (model?.holding()) return;
    const r = host.getBoundingClientRect();
    // a little beyond the host's edge reaches the paper's edge
    const at = (v: number) => Math.max(-1, Math.min(1, v * 1.1));
    zoom.tnx = at(((e.clientX - r.left) / r.width) * 2 - 1);
    zoom.tny = at(1 - ((e.clientY - r.top) / r.height) * 2);
  }
  const onMove = (e: PointerEvent) => {
    if (zoomed() && e.pointerType === "mouse") {
      follow(e);
      invalidate();
    }
    model?.pointer.move(e);
  };
  const onWheel = (e: WheelEvent) => {
    if (!model || item.kind !== "resume" || !e.deltaY) return;
    e.preventDefault();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1);
    const was = zoomed();
    // a notch of a mouse wheel (100 px) ≈ × 1.22; a pinch comes in small steps
    const z = zoom.tz * Math.exp(-px * (e.ctrlKey ? 0.01 : 0.002));
    zoom.tz = z < 1.02 ? 1 : Math.min(ZOOM_MAX, z);
    follow(e);
    if (!was && zoomed()) {
      measure(false, true);
      // the print's texels for the zoom, once the wheel rests
      if (!sharp) {
        window.clearTimeout(sharpTimer);
        sharpTimer = window.setTimeout(() => {
          sharp = true;
          void relayout();
        }, 160);
      }
    }
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    model?.pointer.up(e);
    invalidate();
  };
  const onLeave = () => model?.pointer.leave();
  const onKey = (e: KeyboardEvent) => {
    if (!model || e.altKey || e.ctrlKey || e.metaKey) return;
    const fwd = e.key === "ArrowRight" || e.key === "PageDown";
    const back = e.key === "ArrowLeft" || e.key === "PageUp";
    if (!fwd && !back) return;
    // at the ends the keys fall through to the dialog (which steps between objects)
    const s = model.state;
    if (fwd && s.page >= s.count - 1) return;
    if (back && s.page <= 0) return;
    e.preventDefault();
    if (fwd) model.next();
    else model.prev();
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    opts.onClose?.("lost");
  };
  const onWindow = () => resize();

  let ro: ResizeObserver | null = null;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(layoutTimer);
    window.clearTimeout(sharpTimer);
    ro?.disconnect();
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onUp);
    host.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("keydown", onKey);
    canvas.removeEventListener("webglcontextlost", onLost);
    window.removeEventListener("resize", onWindow);
    Object.assign(host.style, hostStyle);
    model?.dispose();
    model = null;
    deskGeo.dispose();
    deskMat.dispose();
    grain.dispose();
    renderer.renderLists.dispose();
    canvas.remove();
    parkContext(gl);
  }

  const deskGeo = new THREE.PlaneGeometry(40, 40);
  const deskMesh = new THREE.Mesh(deskGeo, deskMat);
  deskMesh.position.z = -0.0004;
  deskMesh.renderOrder = -1;

  return (async () => {
    // the canvas is positioned against the host (it overscans sideways on narrow hosts)
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.style.touchAction = "none";
    host.appendChild(canvas);
    size.w = Math.max(1, host.clientWidth);
    size.h = Math.max(1, host.clientHeight);
    // (the drawing buffer stays 1 × 1 until measure() knows the canvas's final size)
    Object.assign(canvas.style, { width: `${size.w}px`, height: `${size.h}px` });
    try {
      // the open card (≈ 108 × 90 mm with its margin, either way up) in this host, under its size cap, in device px (at the ratio its
      // canvas will have: the card's overscan does not depend on the model)
      if (item.kind === "card") {
        const o = overscanFor(false);
        ctx.printPxPerMm = Math.min(capFor(CARD_MAX_PX_PER_MM) ?? Infinity, Math.min(size.w, size.h) / 110) * ratioFor(size.w + o.l + o.r, size.h + o.t + o.b);
      }
      model = item.kind === "resume" ? await createResumeModel(item, owner, ctx) : await createCardModel(item, cardOwner(owner), ctx);
      if (disposed) throw new Error("disposed");
      model.group.add(deskMesh);
      scene.add(model.group);
      model.group.updateMatrixWorld(true);
      // the key light in the model's own frame (the card's group is turned)
      shadow.uLightL.value.copy(LIGHT).applyQuaternion(model.group.getWorldQuaternion(new THREE.Quaternion()).invert());
      // the framing first, the print for it (its textures at the device's density), and then the drawing buffer, once, at its final
      // size (that depends on the print: a résumé that cannot turn needs no room for a sheet in flight), in a task of its own (its
      // allocation is a synchronous wait on the GPU); the second layout is a no-op within the layout's tolerance
      plan();
      cam.snapped = false;
      aim();
      await relayout();
      if (disposed) throw new Error("disposed");
      await nextTask();
      if (disposed) throw new Error("disposed");
      measure(true);
      await nextTask();
      if (disposed) throw new Error("disposed");
      cam.snapped = false;
      aim();
      await relayout();
      if (disposed) throw new Error("disposed");
      setDark(dark);
      // the programs compile in parallel (KHR_parallel_shader_compile) before the first frame: a synchronous compile there was the
      // open's longest task (≈ 45 ms of waiting on the link)
      await renderer.compileAsync(scene, camera).catch(() => {});
      if (disposed) throw new Error("disposed");
      // and their first use (three reads their uniforms and attributes back: a synchronous wait on the GPU) now, while nothing else
      // is queued: in the first frame it waited behind the drawing buffer and the pages' uploads (13–70 ms at 2512 × 1233, r4-print)
      for (const p of renderer.info.programs ?? []) p.getUniforms();
      await nextTask();
      if (disposed) throw new Error("disposed");
      emit();
      started = true;
      frame(0);
      canvas.style.opacity = "1";
    } catch (err) {
      dispose();
      throw err;
    }
    // the print fonts were late: paint once more when they arrive
    if (!fontsIn)
      void printFonts.late.then((ok) => {
        if (!ok || disposed || !model) return;
        if (model.layout) void relayout(true);
        else void model.repaint?.().then(invalidate);
      });
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("webglcontextlost", onLost);
    window.addEventListener("resize", onWindow);
    ro = new ResizeObserver(resize);
    ro.observe(host);
    invalidate();

    /** setContent calls, one after the other; a later one makes an earlier one that has not printed yet stop */
    let contentGen = 0;
    let contents: Promise<unknown> = Promise.resolve();
    function setContent(o: { item: ResumeItem | BusinessCardItem; owner?: Owner; lang?: string; labels?: Partial<PaperLabels> }): Promise<boolean> {
      if (disposed || !model || o.item.kind !== item.kind) return Promise.resolve(false);
      const gen = ++contentGen;
      const run = contents.then(async () => {
        const live = () => !disposed && !!model && gen === contentGen;
        if (!live()) return false;
        const next = printOf(o.item, o);
        // the new strings' faces first: the print never shows them in a fallback face
        const fonts = loadPrintFonts(printedTexts(o.item, next.owner, next.lang), next.lang);
        const inTime = await fonts.ready;
        if (!live() || !model!.setItem?.(o.item, next.owner)) return false;
        item = o.item;
        owner = next.owner;
        lang = next.lang;
        ctx.lang = lang;
        ctx.fontsReady = fonts.ready;
        if (o.labels) labels = { ...DEFAULT_PAPER_LABELS, ...o.labels };
        if (model!.layout) await relayout(true);
        else await model!.repaint?.();
        if (disposed) return false;
        emit();
        invalidate();
        if (!inTime)
          void fonts.late.then((ok) => {
            if (!ok || !live()) return;
            if (model!.layout) void relayout(true);
            else void model!.repaint?.().then(invalidate);
          });
        return true;
      });
      contents = run.catch(() => {});
      return run.then((ok) => ok && gen === contentGen, () => false);
    }

    const debug: PaperDebug = {
      manual(on) {
        manual = on;
        if (on) {
          cancelAnimationFrame(raf);
          raf = 0;
        } else invalidate();
      },
      advance(dt) {
        frame(dt);
      },
      stats: () => model?.stats() ?? { frameMax: 0, max: 0, progress: [] },
      resetStats: () => model?.resetStats(),
      project: (x, y, z) => ctx.project(new THREE.Vector3(x, y, z), scene),
      mode: () => (narrow ? "narrow" : "wide"),
      texPx: () => model?.texPx?.() ?? 0,
      renderer,
    };
    return {
      next: () => model?.next(),
      prev: () => model?.prev(),
      dispose,
      setDark,
      restRect,
      setContent,
      state,
      debug,
    };
  })();
}

/**
 * Every string the viewer may print for this item (the résumé's words and labels, the card's faces): what the fonts must cover.
 * The printed labels only in the language the print is in (an English résumé never asks for 简介 …).
 */
function printedTexts(item: ResumeItem | BusinessCardItem, owner: Owner | undefined, lang: string | undefined): (string | undefined)[] {
  const o = owner ? [owner.name, owner.nameLocal, owner.role, owner.location, owner.handle, ...(owner.links ?? []).flatMap((l) => [l.label, l.href])] : [];
  const zh = /^zh/i.test(lang ?? "");
  if (item.kind === "card") return [...o, item.label, item.front.name, item.front.role, item.front.tagline, item.insideNote, ...item.inside.flatMap((r) => [r.k, r.v]), `${zh ? CARD_WORDS.zh : CARD_WORDS.en} 01234 ○`];
  const W = resumeWords(lang);
  return [
    ...o,
    item.label,
    item.summary,
    ...item.experience.flatMap((e) => [e.org, e.role, e.from, e.to, ...e.bullets]),
    ...item.education.flatMap((e) => [e.school, e.degree, e.from, e.to]),
    ...item.skills,
    ...(item.languages ?? []),
    `${W.profile} ${W.experience} ${W.education} ${W.skills} ${W.languages} ${W.elsewhere}${W.comma}${W.dash}— · / – 0123456789`,
  ];
}
