/*
 * The folded business card: two 90 × 54 mm panels of 600 gsm cotton joined by a scored crease along the long top edge (a "top fold"
 * card). It lies closed on the desk; drag the cover's edge (or click) and it swings open about the crease, showing the inside: the
 * seal and the tagline on the cover's back, the contact rows on the inner panel. Drag it back down to close.
 *
 * The cover (and the outer back) are printed by the pouch's own painters (src/bag/objects/card.ts), so the card in the dialog is the
 * card in the pouch; the inside is set in the same system: the cover's back carries the inside note in Shippori Mincho under a small
 * 藍 ○, the inner panel the contact rows on hairlines in Zen Kaku (letterpress = ink plus a bitten impression with a soft shoulder
 * in the bump map, a satin ink film in the roughness map).
 *
 * Physics: a two-link chain from physics.ts (cards in both columns = two rigid panels, the seam joint = the crease). The root is the
 * inner panel's free edge, the inner panel is pinned flat on the desk, the cover is the second link. The hand is given a reach, so the
 * pointer sets both where and how far the cover's edge goes (direction alone cannot open a fold). The crease spring and gravity make
 * the card bistable: past ~130° it falls shut onto its hard stop, below that it falls open.
 *
 * Chain frame (the group): x along the card from the inner panel's free edge (0) across the crease (CARD_L) to the cover's tip,
 * y along the crease, z up. The group is turned so x points up the screen and the crease sits at world y = 0.
 */
import * as THREE from "three";
import { createPage, freePage, grabPage, posePage, pullPage, seamFold, stepPage, type PageBody } from "../book/physics";
import { COTTON, COTTON_EDGE, paintCardBack, paintCardFront } from "../bag/objects/card";
import { PRINT, deferStocks, disc, inkTooth, makeStocks, paintStock } from "../bag/objects/shared";
import { wrapUnits } from "../print/kinsoku";
import type { BusinessCardItem } from "../profile/schema";
import { CAST_N, chainUniforms, columns, faceGeometry, paperMaterial, rimGeometry, setKnots } from "./material";
import { CARD, CARD_CLOSED, CARD_GEOM, CARD_L, CARD_SPAN, FLAT_ENV, MM, cardKnots, cardPhysics, createKnots, knotPoint, smooth } from "./presets";
import { cssFont, paintText, type TextStyle } from "./typeset";
import type { Model, ModelCtx, Rect } from "./viewer";

/** the pouch card's cut edge */
const EDGE = COTTON_EDGE;
/** grab the cover this far in from its tip */
const TIP_IN = 0.01;
/** hover peek on the closed card: the cover's edge rises ~3 % of its length */
const PEEK = CARD_CLOSED - 0.11;
/** fully open target (a hair into the desk so it lands, not hovers) */
const OPEN = -0.03;
/** on screen the card is at most this many CSS px per mm (90 mm → 612 px: the detail view shows it about 600 wide at 1440) */
const MAX_PX_PER_MM = 6.8;
/** canvas px per mm of the printed faces: by default, and the range the size on screen picks from (cardPrintK) */
const PRINT_K = 14;
const PRINT_K_MIN = 10;
const PRINT_K_MAX = 18;
/**
 * Canvas px per mm for a card seen at about `devicePxPerMm` device px per mm (ModelCtx.printPxPerMm; brief r4 E4): a texel per device
 * pixel and a little over, within 10 … 18 (a phone's card needs fewer, a large screen's more; 18 keeps the six faces' canvases under
 * 20 Mpx).
 */
export function cardPrintK(devicePxPerMm: number | undefined): number {
  if (!devicePxPerMm || !Number.isFinite(devicePxPerMm)) return PRINT_K;
  return Math.min(PRINT_K_MAX, Math.max(PRINT_K_MIN, Math.ceil(devicePxPerMm * 1.05)));
}
export { MAX_PX_PER_MM as CARD_MAX_PX_PER_MM };

type Script = { t0: number; from: number; to: number; dur: number; release: boolean };
type CardOwner = { nameLocal?: string; name?: string; role?: string };
/** the inside's micro-label over the contact rows */
export const CONTACT = { en: "Contact", zh: "联系方式" };

export async function createCardModel(firstItem: BusinessCardItem, firstOwner: CardOwner | undefined, ctx: ModelCtx): Promise<Model> {
  /** what is printed: setItem() swaps it (another language), the next repaint() prints it */
  let item = firstItem;
  let owner = firstOwner;
  const P = cardPhysics();
  const group = new THREE.Group();
  group.name = "card";
  group.rotation.z = Math.PI / 2;
  group.position.y = -CARD_L;
  group.updateMatrixWorld(true);

  const body: PageBody = createPage(CARD_GEOM, 1, 1, P);
  posePage(body, 0, FLAT_ENV, CARD_CLOSED);
  const knots = createKnots();
  const chain = chainUniforms(2 * CARD_L, CARD_SPAN, CARD.t * MM);
  chain.uRoot.value.set(0, 0, (CARD.t * MM) / 2);

  /* ── art ── */
  await ctx.fontsReady;
  const K = cardPrintK(ctx.printPxPerMm);
  let gone = false;
  const art = await paintCardSliced(item, owner, ctx.lang, K, () => !gone);
  const tex = (c: HTMLCanvasElement, color: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = ctx.anisotropy;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const T = {
    inColor: tex(art.inside.color, true),
    inBump: tex(art.inside.bump, false),
    inRough: tex(art.inside.rough, false),
    outColor: tex(art.outside.color, true),
    outBump: tex(art.outside.bump, false),
    outRough: tex(art.outside.rough, false),
  };
  const us = columns(64, [0.5 - 0.012, 0.5 + 0.012, ...Array.from({ length: 9 }, (_, i) => 0.5 - 0.01 + (i * 0.02) / 8)]);
  const geo = [faceGeometry(us, "front"), faceGeometry(us, "back"), rimGeometry(us)];
  const cotton = { roughness: 1, sheen: 0.45, other: null };
  // the bite: deep enough that the window light (top right) catches the lower-left inner edge of a stroke and shades the upper-right
  const bite = 2.6;
  const mats = [
    paperMaterial({ chain, shadow: ctx.shadow, side: "front", map: T.inColor, bumpMap: T.inBump, bumpScale: bite, roughnessMap: T.inRough, ...cotton }),
    paperMaterial({ chain, shadow: ctx.shadow, side: "back", map: T.outColor, bumpMap: T.outBump, bumpScale: bite, roughnessMap: T.outRough, ...cotton }),
    paperMaterial({ chain, shadow: ctx.shadow, side: "rim", edge: EDGE, core: null, roughness: 0.93 }),
  ];
  const meshes = geo.map((g, i) => {
    const m = new THREE.Mesh(g, mats[i]!);
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  // 600 gsm stock barely lets light through; a small object's ambient shadow hugs it
  ctx.shadow.uTrans.value = 0.05;
  ctx.desk.uAmbient.value.set(0.12, 0.13);

  /** the print fonts arrived after the first paint: print the faces again into the same canvases */
  async function repaint() {
    const again = await paintCardSliced(item, owner, ctx.lang, K, () => !gone).catch(() => null);
    if (!again || gone) return;
    for (const [k, c] of [
      ["inColor", again.inside.color],
      ["inBump", again.inside.bump],
      ["inRough", again.inside.rough],
      ["outColor", again.outside.color],
      ["outBump", again.outside.bump],
      ["outRough", again.outside.rough],
    ] as const) {
      const t = T[k];
      const dst = t.image as HTMLCanvasElement;
      dst.getContext("2d")!.drawImage(c, 0, 0);
      t.needsUpdate = true;
    }
  }

  /* ── state ── */
  const state = { page: 0, count: 2 };
  let open = false;
  let script: Script | null = null;
  let hovering = false;

  /** cover angle (absolute angle of the second link): π closed … 0 open */
  const beta = () => body.a[1]!;
  /** hand target for the cover tip at angle b about the crease (chain frame, relative to the root) */
  const rho = CARD_L - TIP_IN;
  const tipAt = (b: number): [number, number] => [CARD_L + rho * Math.cos(b), rho * Math.sin(b)];
  const pullTo = (b: number) => {
    const [x, z] = tipAt(b);
    pullPage(body, Math.atan2(z, x), Math.hypot(x, z));
  };
  const grab = (soft = 1) => {
    if (body.hand) return;
    const [x, z] = tipAt(beta());
    grabPage(body, 2 * CARD_L - TIP_IN, Math.atan2(z, x), soft);
    pullTo(beta());
  };

  function animateTo(to: number, release: boolean, speed = 1) {
    grab();
    const from = beta();
    script = { t0: ctx.time(), from, to, dur: (0.32 + (0.5 * Math.abs(to - from)) / Math.PI) / speed, release };
    ctx.invalidate();
  }
  function setOpen(o: boolean) {
    if (open !== o) {
      open = o;
      state.page = o ? 1 : 0;
      ctx.emit();
    }
  }
  /** Sound cue: the card starts opening or closing (not for a hover peek, nor when it is already where it is asked to go) */
  const unfoldSound = (to: number, gain = 1) => {
    if (Math.abs(to - beta()) > 0.2) ctx.sound("cardUnfold", { gain });
  };
  const next = () => {
    hovering = false;
    setOpen(true);
    unfoldSound(OPEN);
    animateTo(OPEN, true);
  };
  const prev = () => {
    hovering = false;
    setOpen(false);
    unfoldSound(CARD_CLOSED);
    animateTo(CARD_CLOSED, true);
  };

  /* ── physics ── */
  function step(h: number, t: number): boolean {
    if (script) {
      const q = Math.min(1, (t - script.t0) / script.dur);
      pullTo(script.from + (script.to - script.from) * smooth(q));
      if (q >= 1) {
        if (script.release) freePage(body);
        script = null;
      }
    }
    const awake = stepPage(body, FLAT_ENV, h, t, P);
    // the inner panel lies on the desk
    body.a[0] = 0;
    body.w[0] = 0;
    return awake || !!script;
  }

  const stats = { frameMax: 0, max: 0, prev: beta() };
  function sync(): boolean {
    cardKnots(body, knots);
    setKnots(chain, knots);
    stats.frameMax = Math.abs(beta() - stats.prev);
    stats.prev = beta();
    stats.max = Math.max(stats.max, stats.frameMax);
    // the cover is the caster once it is off the inner panel
    const sh = ctx.shadow;
    const lifted = Math.sin(Math.min(Math.PI, Math.max(0, beta()))) * CARD_L > 1.2 * MM && beta() < CARD_CLOSED - 0.02;
    if (lifted) {
      for (let j = 0; j < CAST_N; j++) {
        const [x, z] = knotPoint(knots, CARD_L + (j / (CAST_N - 1)) * CARD_L);
        sh.uCast.value[j]!.set(x, 0, chain.uRoot.value.z + z, 1);
      }
      sh.uCastN.value = CAST_N;
      sh.uCastY.value.set(-CARD_SPAN / 2, CARD_SPAN / 2);
    } else sh.uCastN.value = 0;
    // desk footprints: the inner panel always, the cover where it lies when open
    const R = ctx.desk.uRects.value;
    R[0]!.set(0, -CARD_SPAN / 2, CARD_L, CARD_SPAN / 2);
    let n = 1;
    if (beta() < 0.5) R[n++]!.set(CARD_L, -CARD_SPAN / 2, CARD_L + Math.cos(Math.max(0, beta())) * CARD_L, CARD_SPAN / 2);
    ctx.desk.uRectN.value = n;
    return !body.asleep || !!script;
  }

  /* ── framing: the closed card, or the opened card (world frame: x across, y up the screen, crease at y = 0) ── */
  const m = 0.03;
  const closedRect: Rect = { x0: -CARD_SPAN / 2 - m, y0: -CARD_L - m, x1: CARD_SPAN / 2 + m, y1: m };
  const openRect: Rect = { x0: -CARD_SPAN / 2 - m, y0: -CARD_L - m, x1: CARD_SPAN / 2 + m, y1: CARD_L + m };
  const view = (): Rect => (open ? openRect : closedRect);
  /** the card itself, without the 3 mm the framing keeps round it */
  const paper = (): Rect => {
    const r = view();
    return { x0: r.x0 + m, y0: r.y0 + m, x1: r.x1 - m, y1: r.y1 - m };
  };
  /**
   * Where the cover's free edge reaches as it swings about the crease (world frame). Only while the cover is (or may be) up: the
   * closed card at rest is framed as itself, centred, and the camera eases to the open framing as the card unfolds (and back once
   * the cover is past upright on its way shut). A hover peek does not move the camera.
   */
  const air: [number, number, number][] = [];
  const none: [number, number, number][] = [];
  const swinging = () => open || !!drag || beta() < Math.PI * 0.6;
  for (let k = 1; k < 12; k++)
    for (const y of [-CARD_SPAN / 2, CARD_SPAN / 2]) {
      const b = (k * Math.PI) / 12;
      const p = group.localToWorld(new THREE.Vector3(CARD_L + CARD_L * Math.cos(b), y, CARD_L * Math.sin(b)));
      air.push([p.x, p.y, p.z]);
    }

  /* ── pointer: the cover's tip follows the pointer round the crease ── */
  let down: { id: number; x: number; y: number; t: number } | null = null;
  let drag: { off: [number, number]; hist: { t: number; b: number }[]; b: number } | null = null;
  const tmp = new THREE.Vector3();
  const screenOfTip = (b: number): [number, number] => {
    const [x, z] = tipAt(b);
    tmp.set(x, 0, chain.uRoot.value.z + z);
    return ctx.project(tmp, group);
  };
  /** the cover angle whose tip lands closest to (px, py) on screen; searched near the last one so the fold never jumps */
  function betaAt(px: number, py: number, near: number): number {
    const d2 = (b: number) => {
      const [sx, sy] = screenOfTip(b);
      return (sx - px) ** 2 + (sy - py) ** 2;
    };
    const lo = OPEN;
    const hi = CARD_CLOSED;
    let best = near;
    let bd = d2(near);
    for (let i = 0; i <= 72; i++) {
      const b = lo + ((hi - lo) * i) / 72;
      // a small pull towards the last angle: where two angles land on the same spot, keep the one the hand is at
      const v = d2(b) + 400 * (b - near) ** 2;
      if (v < bd) {
        bd = v;
        best = b;
      }
    }
    // refine
    let a = Math.max(lo, best - (hi - lo) / 72);
    let c = Math.min(hi, best + (hi - lo) / 72);
    for (let i = 0; i < 24; i++) {
      const m1 = a + (c - a) / 3;
      const m2 = c - (c - a) / 3;
      if (d2(m1) < d2(m2)) c = m2;
      else a = m1;
    }
    return (a + c) / 2;
  }

  function overCard(x: number, y: number): boolean {
    const ray = ctx.rayLocal(x, y, group);
    if (Math.abs(ray.direction.z) < 1e-4) return false;
    const t = -ray.origin.z / ray.direction.z;
    const p = ray.origin.clone().addScaledVector(ray.direction, t);
    const far = open ? 2 * CARD_L : CARD_L;
    return p.x > -0.05 && p.x < far + 0.05 && Math.abs(p.y) < CARD_SPAN / 2 + 0.05;
  }

  function pointerDown(e: PointerEvent): boolean {
    if (down) return false;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    hovering = false;
    return true;
  }
  function pointerMove(e: PointerEvent) {
    if (!down || e.pointerId !== down.id) {
      if (e.pointerType === "mouse" && !down) hoverAt(e.clientX, e.clientY);
      return;
    }
    if (!drag) {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      script = null;
      if (!body.hand) grab();
      const [sx, sy] = screenOfTip(beta());
      drag = { off: [sx - down.x, sy - down.y], hist: [], b: beta() };
      // the hand takes the cover: the crease starts to move (one cue per drag; the release only finishes the motion)
      ctx.sound("cardUnfold", { gain: 0.85 });
    }
    const b = betaAt(e.clientX + drag.off[0], e.clientY + drag.off[1], drag.b);
    drag.b = b;
    drag.hist.push({ t: performance.now(), b });
    if (drag.hist.length > 8) drag.hist.shift();
    pullTo(b);
    body.asleep = false;
    ctx.invalidate();
  }
  function pointerUp(e: PointerEvent) {
    if (!down || e.pointerId !== down.id) return;
    const dn = down;
    down = null;
    const d = drag;
    drag = null;
    if (d) {
      const a = d.hist[0];
      const z = d.hist[d.hist.length - 1];
      const v = a && z && z.t - a.t > 8 ? ((z.b - a.b) / (z.t - a.t)) * 1000 : 0;
      // where it would be in 0.15 s at this speed decides
      const wantOpen = d.b + v * 0.15 < Math.PI / 2;
      setOpen(wantOpen);
      animateTo(wantOpen ? OPEN : CARD_CLOSED, true, 1.4);
      return;
    }
    if (e.type === "pointercancel") return;
    if (performance.now() - dn.t < 500 && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) < 6 && overCard(e.clientX, e.clientY)) {
      if (open) prev();
      else next();
    }
  }
  function hoverAt(x: number, y: number) {
    const over = overCard(x, y);
    ctx.setCursor(over ? "pointer" : "");
    if (over && !open && !hovering && !script && body.asleep) {
      hovering = true;
      animateTo(PEEK, false, 1.6);
    } else if (!over && hovering) {
      hovering = false;
      if (!open) animateTo(CARD_CLOSED, true, 1.6);
    }
  }
  function leave() {
    if (down) return;
    ctx.setCursor("");
    if (hovering) {
      hovering = false;
      if (!open) animateTo(CARD_CLOSED, true, 1.6);
    }
  }

  function dispose() {
    gone = true;
    for (const m of meshes) group.remove(m);
    geo.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    Object.values(T).forEach((t) => t.dispose());
  }

  return {
    group,
    state,
    view,
    paper,
    frames: () => ({ single: openRect, maxPxPerMm: MAX_PX_PER_MM, air: swinging() ? air : none }),
    repaint,
    setItem(next, nextOwner) {
      if (next.kind !== "card") return false;
      item = next;
      owner = nextOwner ? { name: nextOwner.name, ...(nextOwner.nameLocal ? { nameLocal: nextOwner.nameLocal } : {}), ...(nextOwner.role ? { role: nextOwner.role } : {}) } : undefined;
      return true;
    },
    step,
    sync,
    holding: () => !!drag,
    pointer: { down: pointerDown, move: pointerMove, up: pointerUp, leave },
    next,
    prev,
    stats: () => ({ frameMax: stats.frameMax, max: stats.max, progress: [1 - Math.min(1, Math.max(0, seamFold(body) / CARD_CLOSED))] }),
    resetStats: () => {
      stats.max = 0;
    },
    dispose,
  };
}

/* ── card art: colour, bump (deboss) and roughness canvases for both faces ── */

/**
 * paintCard, with the paper stocks under its faces made a slice at a time first (makeStocks: idle moments, ≤ 8 ms a task). They are a
 * few million texels of noise — ≈ 400 ms in one task at 18 px / mm (2512 × 1233 at DPR 2), the business card's open; a first paint
 * with the stocks painted flat (deferStocks) lists them, and the paint after finds them kept (for 20 s: when they are all still kept,
 * the first paint is already the whole thing).
 */
async function paintCardSliced(item: BusinessCardItem, owner: CardOwner | undefined, lang: string | undefined, K: number, alive: () => boolean) {
  const { value, jobs } = deferStocks(() => paintCard(item, owner, lang, K));
  // every stock was kept: that paint is the whole thing
  if (!jobs.length) return value;
  await makeStocks(jobs, alive);
  // (a model disposed meanwhile does not paint: makeStocks stopped, and the stocks it left would be made at once)
  if (!alive()) throw new Error("disposed");
  return paintCard(item, owner, lang, K);
}

type Layers = { color: HTMLCanvasElement; bump: HTMLCanvasElement; rough: HTMLCanvasElement };

/**
 * Both faces are 108 (along the chain) × 90 mm (along the crease) canvases. Each is drawn "as seen": the inside as the open card
 * lies (90 wide × 108 tall, the cover's back on top, the crease at 54), the outside's cover as the closed card lies (90 × 54, the
 * crease on top).
 */
export function paintCard(item: BusinessCardItem, owner: CardOwner | undefined, lang?: string, K = PRINT_K) {
  const W = 2 * CARD.h * K;
  const H = CARD.w * K;
  const make = (seed: number): Layers & { g: [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D] } => {
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      return c;
    };
    const color = mk();
    const bump = mk();
    const rough = mk();
    const g = [color, bump, rough].map((c) => c.getContext("2d")!) as [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D];
    // a quiet cloud: the dialog shows the card large, where a stronger mottle reads as stains
    paintStock(g[0], W, H, { color: COTTON, seed, mottle: 1.1, grain: 2.2, bump: g[1], tooth: 22 });
    g[2].fillStyle = "rgb(0,235,0)";
    g[2].fillRect(0, 0, W, H);
    return { color, bump, rough, g };
  };
  const inside = make(21);
  const outside = make(22);
  const cardOwner = owner ? { name: owner.name ?? item.front.name, ...(owner.nameLocal ? { nameLocal: owner.nameLocal } : {}), ...(owner.role ? { role: owner.role } : {}) } : undefined;

  /* outside: the cover is the pouch card's front, painted by the pouch's own painter and laid in turned (crease on top); the inner
     panel's outside is the pouch card's outer back, laid in on the other side of the crease */
  {
    const cw = CARD.w * K;
    const ch = CARD.h * K;
    const layers = () => {
      const cv = [0, 1, 2].map(() => {
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        return c;
      });
      return { cv, g: cv.map((c) => c.getContext("2d")!) as [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D] };
    };
    const front = layers();
    paintCardFront(item, cardOwner, lang, K, { color: front.g[0], bump: front.g[1], rough: front.g[2] }, cw, ch, 0x51ed);
    const back = layers();
    paintCardBack(item, lang, K, { color: back.g[0], bump: back.g[1], rough: back.g[2] }, cw, ch, 0xbac);
    outside.g.forEach((g, i) => {
      g.save();
      g.setTransform(0, 1, -1, 0, ch, 0);
      g.drawImage(front.cv[i]!, 0, 0);
      g.restore();
      g.save();
      g.setTransform(0, -1, 1, 0, ch, cw);
      g.drawImage(back.cv[i]!, 0, 0);
      g.restore();
    });
  }

  /* inside: drawn in mm as the open card lies (u across 0…90, v down 0…108, the crease at v = 54) */
  inside.g.forEach((g) => g.setTransform(0, K, -K, 0, W, 0));
  const [gc, gb, gr] = inside.g;
  /** letterpress: ink on the colour, a bitten impression with a soft shoulder on the bump, a satin film on the roughness */
  const press = (draw: (g: CanvasRenderingContext2D, color: string) => void, ink: string, depth = 58) => {
    draw(gc, ink);
    gb.save();
    const v = 128 - depth;
    gb.shadowColor = `rgb(${v},${v},${v})`;
    gb.shadowBlur = 0.22 * K;
    draw(gb, `rgb(${v},${v},${v})`);
    gb.restore();
    draw(gr, "rgb(0,170,0)");
  };
  /** width in mm of a string set in a style (sizes in mm) */
  const widthOf = (s: string, st: TextStyle) => {
    gc.save();
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.font = cssFont(st, 100, s, lang);
    if ("letterSpacing" in gc) (gc as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(st.track ?? 0) * 100}px`;
    const w = (gc.measureText(st.caps ? s.toUpperCase() : s).width / 100) * st.size;
    gc.restore();
    return w;
  };
  const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, st: TextStyle, align: CanvasTextAlign = "left", maxW = 0) => {
    let style = st;
    if (maxW) {
      const w = widthOf(s, st);
      if (w > maxW) style = { ...st, size: (st.size * maxW) / w };
    }
    // paintText works in the context's current units: sizes in mm under the mm transform
    paintText(g, s, x, y, style, style.size, lang, align);
  };
  const st = (face: TextStyle["face"], size: number, color: string, extra: Partial<TextStyle> = {}): TextStyle => ({ face, size, color, ...extra });
  const zh = /^zh/i.test(lang ?? "") || /\p{Script=Han}/u.test(item.inside.map((r) => r.k).join(""));

  /* the cover's back (top half): the inside note in Mincho, centred under a small 藍 ○ */
  const note = item.insideNote?.trim();
  press((g, c) => {
    g.fillStyle = c;
    disc(g, 45, note ? 15.5 : 27, 0.75);
  }, PRINT.ai, 50);
  if (note) {
    const ns = st("serif", zh ? 3.5 : 3.7, PRINT.ink2, { track: zh ? 0.06 : 0.01 });
    // centred, so balanced: 「2027 年春天起，/ 接一些小而用心的项目。」, never a full line over a short one
    let lines = wrapUnits(note, 66, (s) => widthOf(s, ns), { balance: true });
    if (lines.length > 3) lines = wrapUnits(note, 74, (s) => widthOf(s, ns), { balance: true }).slice(0, 3);
    const lh = ns.size * 1.75;
    const y0 = 29 - ((lines.length - 1) * lh) / 2 + ns.size * 0.35;
    lines.forEach((l, i) => press((g, c) => text(g, l, 45, y0 + i * lh, { ...ns, color: c }, "center", 76), PRINT.ink2, 48));
    press((g, c) => {
      g.fillStyle = c;
      g.fillRect(40, y0 + (lines.length - 1) * lh + 6.4, 10, 0.16);
    }, PRINT.rule, 10);
  }

  /* the inner panel (bottom half): the contact rows, label left and value right, on hairlines */
  const rows = item.inside.slice(0, 4);
  press((g, c) => text(g, zh ? CONTACT.zh : CONTACT.en, 9, 54 + 11.2, st("sans", 2, c, { weight: 500, track: zh ? 0.12 : 0.08 })), PRINT.muted, 36);
  const top = 54 + 15.4;
  const rowH = Math.min(9.6, 30 / Math.max(1, rows.length));
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    press((g, c) => {
      g.fillStyle = c;
      g.fillRect(9, y, 72, 0.14);
      if (i === rows.length - 1) g.fillRect(9, y + rowH, 72, 0.14);
    }, PRINT.rule, 10);
    const yb = y + rowH / 2 + 0.95;
    press((g, c) => text(g, row.k, 9, yb, st("sans", 2, c)), PRINT.muted, 34);
    press((g, c) => text(g, row.v, 81, yb, st("sans", 2.4, c, { track: 0.01 }), "right", 50), PRINT.ink, 50);
  });
  inkTooth(gc, W, H, COTTON, 0x1ee7, 0.22, 0.05);

  /* the crease: a scored groove on the inside, a soft ridge on the outside; a faint shade on both colours */
  for (const [L, inner] of [
    [inside, true],
    [outside, false],
  ] as const) {
    const [c, b] = L.g;
    for (const g of [c, b]) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    const x = CARD.h * K;
    const grad = c.createLinearGradient(x - 0.9 * K, 0, x + 0.9 * K, 0);
    grad.addColorStop(0, "rgba(40,52,66,0)");
    grad.addColorStop(0.5, inner ? "rgba(40,52,66,0.09)" : "rgba(255,255,255,0.12)");
    grad.addColorStop(1, "rgba(40,52,66,0)");
    c.fillStyle = grad;
    c.fillRect(x - 0.9 * K, 0, 1.8 * K, H);
    const bg = b.createLinearGradient(x - 0.6 * K, 0, x + 0.6 * K, 0);
    const tone = inner ? 70 : 186;
    bg.addColorStop(0, "rgba(128,128,128,0)");
    bg.addColorStop(0.5, `rgba(${tone},${tone},${tone},1)`);
    bg.addColorStop(1, "rgba(128,128,128,0)");
    b.fillStyle = bg;
    b.fillRect(x - 0.6 * K, 0, 1.2 * K, H);
    for (const g of [c, b]) g.restore();
  }

  const strip = (L: typeof inside): Layers => ({ color: L.color, bump: L.bump, rough: L.rough });
  return { inside: strip(inside), outside: strip(outside) };
}
