/*
 * The résumé: A4 sheets bound along one edge and lying open on the desk. Each sheet is a flexible chain from physics.ts (no cards,
 * 3 + 3 links, the paper preset) with its root fixed at the binding. There is no binding hardware: where the sheets meet, the paper
 * sits in its own shade (a gutter ramp in the paper shader), like the art direction's spread (§7.9).
 *
 * Two ways of binding, by host:
 *  - book (a wide host, the spread fits): double-sided leaves bound at the centre, open like the printed spread of the art direction —
 *    pages 1 | 2, then 3 | 4 … Leaf 0 lies on the left with page 1 on its back; leaf k ≥ 1 carries page 2k on its front and 2k + 1 on
 *    its back (blank where there is none). Turning a leaf shows its own back coming up, never anything else.
 *  - loose (a narrow host, one page at a time): single-sided sheets, page k on sheet k's front and blank backs; a turned sheet slides
 *    off to the left.
 * Either way a face shows its own print, and the other side's only as the faintest mirrored show-through.
 *
 * Turning: drag the page (the grabbed point follows the pointer), click a page (right → forward, left → back), or next() / prev();
 * hovering the free edge lifts it a little.
 *
 * Framing (view): a wide host frames the open spread; a narrow host (a phone) always frames the page on the right.
 *
 * Chain frame = this model's group frame: x across the page from the binding, y along the binding, z up off the desk (scene units,
 * 1 = 100 mm). The group is not rotated, so it is also the world frame.
 */
import * as THREE from "three";
import { carryPage, createPage, freePage, grabPage, grabPoint, pullPage, restPage, stepPage, type PageBody } from "../book/physics";
import type { ResumeItem } from "../profile/schema";
import { CAST_N, chainUniforms, columns, faceGeometry, paperMaterial, rimGeometry, setKnots, type ChainUniforms } from "./material";
import { FLAT_ENV, MM, PAGE_GEOM, PAGE_H, PAGE_W, createKnots, keepOrder, knotPoint, paperKnots, paperPhysics, smooth, turnProgress, type Knots } from "./presets";
import { INK, canvasMeasure, layoutResume, paintPaper, paintResume, type Owner } from "./typeset";
import type { LayoutOpts, Model, ModelCtx, PaperState, Rect } from "./viewer";

/** visual spacing of the stacked sheets, and their thickness */
const PITCH = 0.16 * MM;
const SHEET_T = 0.1 * MM;
/** hover: the free edge rises ~3 % of the page width */
const LIFT = 0.035;
/** dragging: radius floor of the pointer circle (a grab near the binding still moves sensibly), flat → circle blend */
const DRAG_R = 0.4;
const DRAG_FLAT: [number, number] = [0.3, 0.65];
/** while dragging, the held edge stays this far (rad) above lying flat on the far side */
const FAR = 0.28;
/** release: progress / s, progress that counts as turned */
const COMMIT_V = 0.9;
const COMMIT_P = 0.22;
/** click / key turn: a virtual hand lifts the free edge along a smooth profile, then carries it over */
const TURN = { u: 0.95, dur: 0.36, top: 1.9 };
/**
 * Sound cues (PaperViewerOptions.onSound). turn: progress a dragged sheet must reach before it sounds its pageTurn; gap: a sheet that
 * turned less than this ago (s) does not again. band / lift / hold / slow / full / floor: the landing — every link within `band` of
 * flat (rad) is down, a motion must have lifted a link `lift` (rad) unless it made its pageTurn, the speed peak decays over `hold` (s),
 * gain floor at `slow`, full at `full` (rad/s of the fastest link; paper floats down: a click turn settles at about 1.2 rad/s, a gain
 * of about 0.3). rustle: every `mm` of travel of the grabbed point, at most every `every` s, not in the first `settle` s of a drag (the
 * pageTurn of a quick drag comes right then) nor within `afterTurn` s of the sheet's pageTurn; full gain at `fullMm` since the last one.
 */
const SOUND = { turn: 0.05, gap: 0.15, band: 0.12, lift: 0.15, hold: 0.15, slow: 0.3, full: 3.5, floor: 0.12, rustle: { mm: 4, every: 0.4, settle: 0.25, afterTurn: 0.3, fullMm: 60 } };
/**
 * Type scale. The printed page is set at the art direction's sizes (body 2.05 cqw ≈ 4.3 mm) and keeps them whenever two pages fit side
 * by side: the résumé is two pages, like the paper. Only a narrow host (one page at a time, a phone) scales the type up so the body is
 * about BODY_PX CSS px on screen, and the text flows onto more pages; the body may come down to BODY_PX_MIN when that saves a page
 * (the sample: three full pages on a phone rather than four with a stub).
 */
const BODY_PX = 10.5;
const BODY_PX_MIN = 9.5;
const BODY_MM = 2.05 * 2.1;
/** the open spread at most about 960 CSS px wide on screen (its near edge; a large window leaves the paper at reading size) */
const MAX_PX_PER_MM = 2.25;
/**
 * Page textures (brief r4 E4): a texel per device pixel of the page as it rests on screen (CSS px per mm × 297 mm × the canvas's
 * pixel ratio), a little over (`margin`: the near edge of the tilted page is a touch larger, and a texture just above the screen's
 * size keeps the sharpest mip), within these bounds (and the GPU's maximum). Typeset again when the page needs `grow` × more texels,
 * or `shrink` × fewer (the dialog got much smaller): a resize back and forth does not repaint.
 */
const TEX = { margin: 1.1, min: 1100, max: 3072, grow: 1.05, shrink: 0.7 };
/** Texture height (px) of a page for this screen size and pixel ratio, capped by the GPU's largest texture */
export function pageTexPx(pxPerMm: number, dpr: number, maxTexture = Infinity): number {
  const want = Math.ceil(((pxPerMm * PAGE_H) / MM) * dpr * TEX.margin);
  return Math.min(TEX.max, maxTexture, Math.max(TEX.min, want));
}

type Script = { t0: number; to: 0 | 1 };
/** A sheet motion the visitor started, followed for its sound cues until it lands (see SOUND) */
type SheetSound = { motion: boolean; lift: number; peak: number; turned: boolean; turnT: number; dir: 1 | -1 };
type Sheet = {
  index: number;
  body: PageBody;
  knots: Knots;
  chain: ChainUniforms;
  meshes: THREE.Mesh[];
  hovering: boolean;
  script: Script | null;
  prev: Float64Array;
  snd: SheetSound;
};
type Drag = {
  sheet: Sheet;
  dir: 1 | -1;
  base: 0 | 1;
  lever: boolean;
  /** pointer offset (px) from the lever point at grab, kept for the whole drag */
  off: [number, number];
  x0: number;
  spanPx: number;
  samples: { t: number; x: number }[];
  /** the pointer now (client px): the goal is re-aimed from it every frame, so a camera move under a still finger is followed */
  px: number;
  py: number;
  /** sound: this drag's sheet made its pageTurn; when the drag began (sim clock); the grabbed point's travel (mm) since the last rustle, and where it was */
  turned: boolean;
  t0: number;
  travel: number;
  gx: number;
  gz: number;
};

export async function createResumeModel(firstItem: ResumeItem, firstOwner: Owner | undefined, ctx: ModelCtx): Promise<Model> {
  /** what is printed: setItem() swaps it (another language), the next layout() sets it */
  let item = firstItem;
  let owner = firstOwner;
  const P = paperPhysics();
  const group = new THREE.Group();
  group.name = "resume";
  const W = PAGE_W;
  const H = PAGE_H;

  let sheets: Sheet[] = [];
  let page = 0;
  /** the type scale this host asks for (the layout may set it a little smaller to save a page) */
  let wanted = 0;
  let texPx = 0;
  let narrow = false;
  /** bound as a book (wide host) or as loose sheets (narrow host); see the top of the file */
  let book = false;
  /** printed pages, and their textures (a leaf's faces refer to them) */
  let total = 0;
  let pageTex: THREE.Texture[] = [];
  const state: PaperState = { page: 0, count: 0, first: 1, last: 1, total: 0 };
  /** `page` is the sheet on top of the right stack; a book always keeps leaf 0 on the left */
  const minPage = () => (book ? 1 : 0);
  /** the printed pages on view (1-based) */
  function onView(): [number, number] {
    if (!book) return [page + 1, page + 1];
    const a = 2 * (page - 1) + 1;
    return [a, Math.min(total, a + 1)];
  }
  function syncState() {
    const [a, b] = onView();
    state.page = page - minPage();
    state.count = book ? sheets.length - 1 : sheets.length;
    state.first = a;
    state.last = b;
    state.total = total;
  }

  /* ── shared materials / geometry ── */
  const us = columns(84);
  const geoFront = faceGeometry(us, "front");
  const geoBack = faceGeometry(us, "back");
  const geoRim = rimGeometry(us);
  const grain = ctx.grain;
  let backTex: THREE.CanvasTexture | null = null;

  /** Type scale for the on-screen page size (CSS px per mm); only a narrow host scales */
  const scaleFor = (pxPerMm: number, isNarrow: boolean) => (isNarrow ? Math.min(2, Math.max(1, BODY_PX / (BODY_MM * pxPerMm))) : 1);

  function canvasTexture(c: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ctx.anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** (Re)typeset and (re)build the sheets for this on-screen size. Keeps the current page where possible. */
  async function layout(o: LayoutOpts) {
    const s = scaleFor(o.pxPerMm, o.narrow);
    const lo = o.narrow ? Math.min(s, Math.max(1, BODY_PX_MIN / (BODY_MM * o.pxPerMm))) : s;
    const px = pageTexPx(o.pxPerMm, o.dpr, ctx.maxTexture);
    narrow = o.narrow;
    const isBook = !o.narrow;
    // same binding, type scale (±10 %) and texture size (enough texels, not far too many): nothing to do
    if (!o.force && sheets.length && isBook === book && Math.abs(s / wanted - 1) < 0.1 && px <= texPx * TEX.grow && px >= texPx * TEX.shrink) return;
    wanted = s;
    texPx = px;
    // the first printed page on view now stays on view
    const first = sheets.length ? onView()[0] : 1;
    await ctx.fontsReady;
    const measure = canvasMeasure(ctx.lang);
    // the fewest pages between the wanted scale and the smallest allowed one; the largest scale that gets there
    let L = layoutResume(item, owner, s, measure);
    for (let k = s - 0.02; k >= lo - 1e-9; k -= 0.02) {
      const t = layoutResume(item, owner, k, measure);
      if (t.pages.length < L.pages.length) L = t;
    }
    const canvases = paintResume(L, px, ctx.lang);
    // the blank back of every sheet (paper only)
    if (!backTex || (backTex.image as HTMLCanvasElement).height !== canvases[0]!.height) {
      backTex?.dispose();
      const c = document.createElement("canvas");
      c.width = canvases[0]!.width;
      c.height = canvases[0]!.height;
      paintPaper(c.getContext("2d")!, c.width, c.height, 3);
      backTex = canvasTexture(c);
    }
    // a drag or hover in progress refers to the old sheets: drop it (the pointer's next down starts fresh), and its cursor
    drag = null;
    down = null;
    hoverSheet = null;
    ctx.setCursor("");
    for (const s of sheets) disposeSheet(s);
    for (const t of pageTex) t.dispose();
    pageTex = canvases.map(canvasTexture);
    total = canvases.length;
    book = isBook;
    if (book) {
      // leaves 0 … S: leaf 0's back is page 1, leaf k's front page 2k and back page 2k + 1
      const S = Math.ceil(total / 2);
      sheets = Array.from({ length: S + 1 }, (_, k) => makeSheet(k, k ? (pageTex[2 * k - 1] ?? null) : null, pageTex[2 * k] ?? null));
      page = Math.min(S, Math.max(1, 1 + Math.floor((first - 1) / 2)));
    } else {
      sheets = pageTex.map((t, i) => makeSheet(i, t, null));
      page = Math.min(total - 1, Math.max(0, first - 1));
    }
    sheets.forEach((s) => restPage(s.body, s.index < page ? 1 : 0, FLAT_ENV));
    syncState();
    ctx.emit();
    ctx.invalidate();
  }

  /** A sheet with its two printed faces (null = blank paper); each face shows the other's print only as show-through */
  function makeSheet(index: number, front: THREE.Texture | null, back: THREE.Texture | null): Sheet {
    const body = createPage(PAGE_GEOM, 0, 0, P);
    restPage(body, 0, FLAT_ENV);
    const chain = chainUniforms(W, H, SHEET_T);
    const id = index + 1;
    const face = { chain, shadow: ctx.shadow, normalMap: grain, normalScale: 0.28, roughness: 0.9, id, gutter: 1 };
    // show-through: visible on a blank face (the back of a loose sheet), barely there under a printed one (it must never read as text)
    const through = (own: THREE.Texture | null) => (own ? 0.02 : 0.045);
    const frontMesh = new THREE.Mesh(geoFront, paperMaterial({ ...face, side: "front", map: front ?? backTex, other: back, through: through(front) }));
    const backMesh = new THREE.Mesh(geoBack, paperMaterial({ ...face, side: "back", map: back ?? backTex, other: front, through: through(back) }));
    const rim = new THREE.Mesh(geoRim, paperMaterial({ chain, shadow: ctx.shadow, side: "rim", color: INK.paper, edge: "#e9ecea", roughness: 0.95, id }));
    const meshes = [frontMesh, backMesh, rim];
    for (const m of meshes) {
      m.frustumCulled = false;
      group.add(m);
    }
    return { index, body, knots: createKnots(), chain, meshes, hovering: false, script: null, prev: Float64Array.from(body.a), snd: { motion: false, lift: 0, peak: 0, turned: false, turnT: -Infinity, dir: 1 } };
  }

  function disposeSheet(s: Sheet) {
    for (const m of s.meshes) {
      group.remove(m);
      (m.material as THREE.Material).dispose();
    }
  }
  // the grain tile is ~38 mm of paper
  grain.repeat.set(W / 0.38, H / 0.38);

  /* ── stack heights: right stack bottom-up from the last sheet, left stack bottom-up from the first ── */
  const zRight = (i: number) => (sheets.length - 1 - i) * PITCH + SHEET_T / 2;
  const zLeft = (i: number) => i * PITCH + SHEET_T / 2;

  /* ── sound cues: a sheet motion the visitor started is followed until it lands ── */
  let lastRustle = -Infinity;
  let lastSync = Number.NaN;
  function follow(s: Sheet, dir: 1 | -1) {
    const k = s.snd;
    if (!k.motion) {
      k.lift = 0;
      k.peak = 0;
      k.turned = false;
    }
    k.motion = true;
    k.dir = dir;
  }
  function turnSound(s: Sheet, gain: number) {
    const k = s.snd;
    k.turned = true;
    const t = ctx.time();
    if (t - k.turnT < SOUND.gap) return;
    k.turnT = t;
    ctx.sound("pageTurn", { gain, pan: k.dir === 1 ? 0.15 : -0.15 });
  }
  /** Once per rendered frame, after the physics: the drag's turn threshold and its rustle, landings */
  function followSounds() {
    const t = ctx.time();
    const dt = Number.isFinite(lastSync) ? Math.max(0, t - lastSync) : 0;
    lastSync = t;
    const d = drag;
    if (d) {
      const s = d.sheet;
      if (!d.turned && (rel(s) - d.base) * d.dir > SOUND.turn) {
        d.turned = true;
        const q = Math.min(1, Math.abs(s.body.w[0]!) / 3);
        turnSound(s, 0.5 + 0.5 * smooth(q));
      }
      // the hand on the paper: the grabbed point's travel
      const [, , gx, gz] = grabPoint(s.body, FLAT_ENV);
      d.travel += Math.hypot(gx - d.gx, gz - d.gz) / MM;
      d.gx = gx;
      d.gz = gz;
      const R = SOUND.rustle;
      if (d.travel >= R.mm && t - lastRustle >= R.every && t - d.t0 >= R.settle && t - s.snd.turnT >= R.afterTurn) {
        ctx.sound("paperRustle", { gain: 0.4 + 0.6 * smooth(Math.min(1, d.travel / R.fullMm)), pan: d.dir === 1 ? 0.2 : -0.2 });
        lastRustle = t;
        d.travel = 0;
      }
    }
    for (const s of sheets) {
      const k = s.snd;
      if (!k.motion) continue;
      const b = s.body;
      let d0 = 0;
      let d1 = 0;
      let w = 0;
      for (let i = 0; i < b.n; i++) {
        d0 = Math.max(d0, Math.abs(b.a[i]!));
        d1 = Math.max(d1, Math.abs(b.a[i]! - Math.PI));
        w = Math.max(w, Math.abs(b.w[i]!));
      }
      const dev = Math.min(d0, d1);
      k.peak = Math.max(w, k.peak * Math.exp(-dt / SOUND.hold));
      k.lift = Math.max(k.lift, dev);
      // still in the hand, or the click turn's scripted lift: it lands once let go
      if (d?.sheet === s || s.script || dev > SOUND.band) continue;
      if (k.lift >= SOUND.lift || (k.turned && k.lift > SOUND.band)) {
        const q = Math.min(1, Math.max(0, (k.peak - SOUND.slow) / (SOUND.full - SOUND.slow)));
        ctx.sound("pageLand", { gain: SOUND.floor + (1 - SOUND.floor) * smooth(q), pan: d1 < d0 ? -0.3 : 0.3 });
        k.motion = false;
      } else if (b.asleep) k.motion = false;
    }
  }

  /* ── turning ── */
  function startTurn(s: Sheet, to: 0 | 1) {
    s.hovering = false;
    grabPage(s.body, W * TURN.u, to === 1 ? 0 : Math.PI);
    s.script = { t0: ctx.time(), to };
    follow(s, to === 1 ? 1 : -1);
    turnSound(s, 1);
  }
  function next() {
    if (page >= sheets.length - 1) return;
    startTurn(sheets[page]!, 1);
    page++;
    changed();
  }
  function prev() {
    if (page <= minPage()) return;
    startTurn(sheets[page - 1]!, 0);
    page--;
    changed();
  }
  function changed() {
    syncState();
    ctx.emit();
    ctx.invalidate();
  }

  /* ── physics ── */
  function step(h: number, t: number): boolean {
    let awake = false;
    for (const s of sheets) {
      const sc = s.script;
      if (sc) {
        const q = Math.min(1, (t - sc.t0) / TURN.dur);
        const e = smooth(q) * TURN.top;
        pullPage(s.body, sc.to === 1 ? e : Math.PI - e);
        if (q >= 1) {
          carryPage(s.body, FLAT_ENV, sc.to, t, P);
          s.script = null;
        }
      }
      if (stepPage(s.body, FLAT_ENV, h, t, P)) awake = true;
    }
    if (sheets.length > 1) keepOrder(sheets.map((s) => s.body));
    return awake || sheets.some((s) => !!s.script);
  }

  /* ── per frame: shape → uniforms, the caster, desk footprints ── */
  const stats = { frameMax: 0, max: 0 };
  function sync(): boolean {
    let best: Sheet | null = null;
    let bestLift = 0.4 * MM;
    stats.frameMax = 0;
    for (const s of sheets) {
      paperKnots(s.body, s.knots);
      setKnots(s.chain, s.knots);
      const p = smooth(turnProgress(s.body));
      s.chain.uRoot.value.set(0, 0, zRight(s.index) + (zLeft(s.index) - zRight(s.index)) * p);
      for (let i = 0; i < s.body.n; i++) stats.frameMax = Math.max(stats.frameMax, Math.abs(s.body.a[i]! - s.prev[i]!));
      s.prev.set(s.body.a);
      // how high the sheet is off its rest: the caster is the one highest in the air
      let lift = 0;
      for (let i = 0; i < s.body.n; i++) lift = Math.max(lift, Math.sin(Math.min(Math.PI, Math.max(0, s.body.a[i]!))) * PAGE_W);
      if (lift > bestLift) {
        bestLift = lift;
        best = s;
      }
    }
    stats.max = Math.max(stats.max, stats.frameMax);
    // a phone shows one page, centred: a loose sheet that has slid off and lies turned on the left is put away (not a sliver of it
    // left in the gutter beside the page on view); it comes back the moment it is turned back or taken
    for (const s of sheets) {
      const away = narrow && turnProgress(s.body) > 0.98 && s.body.asleep && !s.body.hand && !s.script;
      for (const m of s.meshes) m.visible = !away;
    }
    followSounds();
    // the hand follows the finger even when only the camera moved
    if (drag) pullPage(drag.sheet.body, dragGoal(drag, drag.px, drag.py));
    const sh = ctx.shadow;
    if (best) {
      const z0 = best.chain.uRoot.value.z;
      for (let j = 0; j < CAST_N; j++) {
        const [x, z] = knotPoint(best.knots, (j / (CAST_N - 1)) * W);
        sh.uCast.value[j]!.set(x, 0, z0 + z, 1);
      }
      sh.uCastN.value = CAST_N;
      sh.uCastY.value.set(-H / 2, H / 2);
      sh.uCastId.value = best.index + 1;
    } else sh.uCastN.value = 0;
    // desk footprints: the two stacks (only sheets lying flat count: a sheet in the air throws its own shadow)
    const R = ctx.desk.uRects.value;
    let n = 0;
    if (sheets.some((s) => turnProgress(s.body) < 0.02)) R[n++]!.set(0, -H / 2, W, H / 2);
    if (!narrow && sheets.some((s) => turnProgress(s.body) > 0.98)) R[n++]!.set(-W, -H / 2, 0, H / 2);
    ctx.desk.uRectN.value = n;
    return sheets.some((s) => !s.body.asleep || !!s.script);
  }

  /* ── framing ── */
  const single: Rect = { x0: 0, y0: -H / 2, x1: W, y1: H / 2 };
  const spread: Rect = { x0: -W, y0: -H / 2, x1: W, y1: H / 2 };
  /** where a sheet in flight reaches: its corners on the circle about the binding (a curl stays inside it) */
  const air: [number, number, number][] = [];
  for (let k = 1; k < 18; k++) for (const y of [-H / 2, H / 2]) air.push([W * Math.cos((k * Math.PI) / 18), y, W * Math.sin((k * Math.PI) / 18)]);
  /**
   * Can a sheet be turned in this binding? Only then does one ever stand up in flight, and only then is room kept for it: a two-page
   * résumé bound as a book (both pages open on the desk) never turns, so its spread is framed as large as the host allows. Before
   * the first layout (nothing typeset yet) the room is kept, as for any résumé.
   */
  const turns = () => !sheets.length || sheets.length - 1 > minPage();
  /** Something lies, or is on its way, on the left */
  const used = () => book || page > 0 || !!drag || sheets.some((s) => !!s.script || turnProgress(s.body) > 0.01);
  function view(isNarrow: boolean): Rect {
    if (isNarrow) return single;
    return used() ? spread : single;
  }

  /* ── pointer ── */
  let down: { id: number; x: number; y: number; t: number; hit: THREE.Vector3 | null; mouse: boolean } | null = null;
  let drag: Drag | null = null;
  let hoverSheet: Sheet | null = null;

  const rel = (s: Sheet) => turnProgress(s.body);

  function deskHit(x: number, y: number): THREE.Vector3 | null {
    const ray = ctx.rayLocal(x, y, group);
    if (Math.abs(ray.direction.z) < 1e-4) return null;
    const t = (sheets.length * PITCH - ray.origin.z) / ray.direction.z;
    return t > 0 ? ray.origin.clone().addScaledVector(ray.direction, t) : null;
  }

  /** Direction (from the root) of the pointer ray's crossing with the circle of radius r about the root; flat near either rest. */
  function pointerAngle(px: number, py: number, rz: number, r: number): number {
    const ray = ctx.rayLocal(px, py, group);
    const o = ray.origin;
    const d = ray.direction;
    const k = d.x / Math.min(-1e-4, d.z);
    const c = o.x + k * (rz - o.z);
    const flat = Math.acos(Math.min(1, Math.max(-1, c / r)));
    const disc = r * r * (1 + k * k) - c * c;
    let circ: number;
    if (disc > 0) {
      const uz = (-c * k + Math.sqrt(disc)) / (1 + k * k);
      circ = Math.atan2(uz, c + k * uz);
    } else {
      const uz = (-c * k) / (1 + k * k);
      circ = Math.atan2(Math.max(0, uz), c + k * uz);
    }
    const lift = Math.min(flat, Math.PI - flat);
    const m = smooth((lift - DRAG_FLAT[0]) / (DRAG_FLAT[1] - DRAG_FLAT[0]));
    const unwrapped = circ + 2 * Math.PI * Math.round((flat - circ) / (2 * Math.PI));
    return flat + (unwrapped - flat) * m;
  }

  function pageSpanPx(): number {
    const a = ctx.project(new THREE.Vector3(0, 0, 0), group);
    const b = ctx.project(new THREE.Vector3(W, 0, 0), group);
    return Math.max(80, Math.abs(b[0] - a[0]));
  }

  function beginDrag(dir: 1 | -1, x: number, y: number): Drag | null {
    if (!down) return null;
    const s = dir === 1 ? sheets[page] : sheets[page - 1];
    if (!s || (dir === 1 && page >= sheets.length - 1) || (dir === -1 && page <= minPage())) return null;
    const base: 0 | 1 = dir === 1 ? 0 : 1;
    // must be lying on its side (not mid-flight the other way)
    if (Math.abs(rel(s) - base) > 0.35) return null;
    s.hovering = false;
    s.script = null;
    const hit = down.hit;
    const onPage = !!hit && Math.abs(hit.y) < H / 2 && (dir === 1 ? hit.x > 0.03 && hit.x < W : hit.x < -0.03 && hit.x > -W);
    const u = onPage ? Math.min(W - 0.02, Math.max(0.3 * W, Math.abs(hit!.x))) : 0.9 * W;
    grabPage(s.body, u, base * Math.PI);
    const [rx, rz, gx, gz] = grabPoint(s.body, FLAT_ENV);
    const a = Math.atan2(gz - rz, gx - rx);
    pullPage(s.body, a);
    s.body.hand!.th = a;
    const z0 = s.chain.uRoot.value.z;
    const r0 = Math.hypot(gx - rx, gz - rz);
    const L = Math.max(DRAG_R, r0);
    const lp = ctx.project(new THREE.Vector3(rx + L * Math.cos(a), hit ? hit.y : 0, z0 + rz + L * Math.sin(a)), group);
    // the left page's edge is off screen on a phone: follow the swipe instead of the pointer's position
    const lever = !onPage;
    drag = { sheet: s, dir, base, lever, off: [lp[0] - down.x, lp[1] - down.y], x0: x, spanPx: pageSpanPx(), samples: [{ t: performance.now(), x }], px: x, py: y, turned: false, t0: ctx.time(), travel: 0, gx, gz };
    follow(s, dir);
    return drag;
  }

  function dragGoal(d: Drag, px: number, py: number): number {
    const s = d.sheet;
    // a captured pointer can wander far outside the canvas; past its edge the page has nowhere further to go
    const box = ctx.canvas.getBoundingClientRect();
    const x = Math.min(box.right + 24, Math.max(box.left - 24, px));
    const y = Math.min(box.bottom + 24, Math.max(box.top - 24, py));
    if (d.lever) {
      const k = Math.min(1.1, Math.max(-0.1, ((x - d.x0) * -d.dir) / d.spanPx));
      return d.base === 0 ? k * Math.PI : Math.PI - k * Math.PI;
    }
    const [rx, rz, gx, gz] = grabPoint(s.body, FLAT_ENV);
    const r = Math.max(DRAG_R, Math.hypot(gx - rx, gz - rz));
    const g = pointerAngle(x + d.off[0], y + d.off[1], s.chain.uRoot.value.z + rz, r);
    // the hand never lays the edge down on the far side itself (pinning the edge flat closer than a page width buckles the
    // sheet through a snap); it holds it a little above, and the release carries it the rest of the way
    return d.base === 0 ? Math.min(Math.PI - FAR, Math.max(-0.06, g)) : Math.min(Math.PI + 0.06, Math.max(FAR, g));
  }

  function pointerDown(e: PointerEvent): boolean {
    if (down) return false;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), hit: deskHit(e.clientX, e.clientY), mouse: e.pointerType === "mouse" };
    setHover(null);
    return true;
  }

  function pointerMove(e: PointerEvent) {
    if (!down || e.pointerId !== down.id) {
      if (e.pointerType === "mouse" && !down) hoverAt(e.clientX, e.clientY);
      return;
    }
    if (drag) {
      drag.samples.push({ t: performance.now(), x: e.clientX });
      if (drag.samples.length > 8) drag.samples.shift();
      drag.px = e.clientX;
      drag.py = e.clientY;
      pullPage(drag.sheet.body, dragGoal(drag, e.clientX, e.clientY));
      ctx.invalidate();
      return;
    }
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) < 6) return;
    if (Math.abs(dx) < Math.abs(dy) * 0.6) return;
    const d = beginDrag(dx < 0 ? 1 : -1, e.clientX, e.clientY);
    if (d) pullPage(d.sheet.body, dragGoal(d, e.clientX, e.clientY));
    ctx.invalidate();
  }

  function pointerUp(e: PointerEvent) {
    if (!down || e.pointerId !== down.id) return;
    const dn = down;
    down = null;
    const d = drag;
    drag = null;
    if (d) {
      d.samples.push({ t: performance.now(), x: e.clientX });
      const a = d.samples[0]!;
      const b = d.samples[d.samples.length - 1]!;
      const v = b.t - a.t > 8 ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
      const pv = Math.min(4, Math.max(-4, (-v * d.dir) / d.spanPx));
      const moved = (rel(d.sheet) - d.base) * (d.base === 0 ? 1 : -1);
      const commit = e.type !== "pointercancel" && (pv > COMMIT_V || (moved > COMMIT_P && pv > -0.05));
      if (commit) {
        // a fling released before the turn threshold still turns the sheet: it sounds now
        if (!d.turned) turnSound(d.sheet, 0.9);
        carryPage(d.sheet.body, FLAT_ENV, d.base === 0 ? 1 : 0, ctx.time(), P);
        page = Math.min(sheets.length - 1, Math.max(minPage(), page + d.dir));
        changed();
      } else {
        freePage(d.sheet.body);
        d.sheet.body.goal = d.base;
      }
      ctx.invalidate();
      return;
    }
    if (e.type === "pointercancel") return;
    // a click: on the right page → forward, on the left page → back. A phone shows only the right page: a tap on its first third
    // goes back, anywhere else forward.
    if (performance.now() - dn.t < 500 && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) < 6) {
      if (narrow) {
        const r = ctx.canvas.getBoundingClientRect();
        const [lx] = ctx.project(new THREE.Vector3(0, 0, 0), group);
        const [rx] = ctx.project(new THREE.Vector3(W, 0, 0), group);
        const u = (e.clientX - Math.max(r.left, lx)) / Math.max(1, Math.min(r.right, rx) - Math.max(r.left, lx));
        if (u < 0.3) prev();
        else next();
        return;
      }
      const hit = dn.hit;
      if (!hit || Math.abs(hit.y) > H / 2 + 0.02) return;
      if (hit.x > 0 && hit.x < W + 0.02) next();
      else if (hit.x < 0 && hit.x > -W - 0.02) prev();
    }
  }

  /** Hovering near a free edge lifts it a little (a soft hand under the edge). */
  function hoverAt(x: number, y: number) {
    const hit = deskHit(x, y);
    let want: Sheet | null = null;
    if (hit && Math.abs(hit.y) < H / 2) {
      if (hit.x > W * 0.78 && hit.x < W + 0.02 && page < sheets.length - 1) want = sheets[page] ?? null;
      else if (hit.x < -W * 0.78 && hit.x > -W - 0.02 && page > minPage()) want = sheets[page - 1] ?? null;
    }
    setHover(want);
    const onPaper = hit && Math.abs(hit.y) < H / 2 && ((hit.x > 0 && hit.x < W && page < sheets.length - 1) || (hit.x < 0 && hit.x > -W && page > minPage()));
    ctx.setCursor(want ? "grab" : onPaper ? "pointer" : "");
  }
  function setHover(want: Sheet | null) {
    if (hoverSheet && hoverSheet !== want) {
      const s = hoverSheet;
      hoverSheet = null;
      if (s.hovering) {
        s.hovering = false;
        if (drag?.sheet !== s) freePage(s.body);
      }
    }
    if (want && want !== hoverSheet && want.body.asleep && !want.body.hand && !want.script) {
      const side = rel(want) > 0.5 ? 1 : 0;
      want.hovering = true;
      grabPage(want.body, W - 0.03, side * Math.PI, 1);
      pullPage(want.body, side === 0 ? LIFT : Math.PI - LIFT);
      hoverSheet = want;
    }
    ctx.invalidate();
  }

  function leave() {
    if (!down) {
      setHover(null);
      ctx.setCursor("");
    }
  }

  function dispose() {
    for (const s of sheets) disposeSheet(s);
    sheets = [];
    for (const t of pageTex) t.dispose();
    pageTex = [];
    geoFront.dispose();
    geoBack.dispose();
    geoRim.dispose();
    backTex?.dispose();
  }

  return {
    group,
    state,
    view,
    frames: () => ({ single, spread, maxPxPerMm: MAX_PX_PER_MM, ...(turns() ? { air } : {}) }),
    layout,
    setItem(next, nextOwner) {
      if (next.kind !== "resume") return false;
      item = next;
      owner = nextOwner;
      return true;
    },
    step,
    sync,
    holding: () => !!drag,
    pointer: { down: pointerDown, move: pointerMove, up: pointerUp, leave },
    next,
    prev,
    texPx: () => texPx,
    stats: () => ({ frameMax: stats.frameMax, max: stats.max, progress: sheets.map((s) => turnProgress(s.body)) }),
    resetStats: () => {
      stats.max = 0;
    },
    dispose,
  };
}
