import * as THREE from "three";
import type { CoverMaterial, CoverSpec } from "./cover";
import { COVER_HEX, FOIL_HEX, MATERIAL_LOOK } from "./cover-style";
import { FROST_LAYER, HINGE_SCORE, frostCaster } from "./frost";
import { CARD_H, CARD_W, resolveLayout, type BookLayout } from "./layout";
import { MM, PITCH, SEG, panelRoot, restPhi, type Seg } from "./sheet";
import { hanLangOf, stack, type FontRun, type HanLang } from "../fonts";
import { drawFolioLiner, folioLinerSteps, linerFontRuns, linerLookFor, type LinerSpec } from "./liner";
import { SLIP_RECT, coverStampSteps, drawClothMaps, drawCoverStamp, drawLeatherNormal, drawLiner, drawSlip, drawWindowPocket, finish, loadedFaces, type LinerSlip } from "./textures";

/*
 * The binder's case and metal. The case: front board — crease — spine — crease — back board. Shut, the right crease bends 90° (the spine
 * stands up) and the left crease another 90° (the front board lies over the pages); the three boards are rigid bodies, the two creases
 * narrow strips bent live by angle. Cloth and leather are one piece of cloth wrapped round the three boards, one continuous sheet when
 * lying open; frosted PP is three separate round-cornered boards (each with a rounded, light-guiding cut edge all round that glows),
 * joined by two living hinges: lying open, the spine with its metal rests on the desk, FROST_STEP.drop lower than the two boards, each
 * hinge is a ramp with a score line at either end (the bend gathers on these two lines: one faces the light and glows, one faces away
 * and darkens); the spine's top and bottom ends are set in a little from the boards, and the outline has a U-shaped notch and a step at
 * each hinge, so the front board, spine and back board read as three parts with two hinges, not one flat piece.
 * The metal is riveted to the middle of the spine's inside: a base + a row of O rings, the ring centre D (> the ring radius) from the
 * spine's inner face, so shut, the whole of each ring is inside the box.
 * The sheets' holes hang on the rings (the ring centre moves with the spine; sheet.ts solves the sheets' positions from it), so the page
 * block slides with the rings as the case opens and shuts.
 * Sizes follow the sheet count: the ring radius by the whole stack's thickness, spine width = ring diameter + an allowance, the board
 * width leaves an outer margin past where the page block sits when shut.
 * Frosted PP is translucent (at any angle): the case is on layer 1 and frost.ts hooks screen-space frost into its material: what shows
 * through is the picture beyond the case blurred by distance (slightly soft where it touches, blurrier further off), no refraction
 * offset, no mipmaps, so nothing flickers or jumps as it opens and shuts.
 */

export type BinderDims = {
  /**
   * ring radius, the ring centre's distance from the spine's inner face, spine width, crease width, board thickness, the back board's
   * inner edge (open), board width, case height
   */
  R: number;
  D: number;
  S: number;
  h: number;
  CT: number;
  xb: number;
  B: number;
  H: number;
  /**
   * how far the spine (with its metal) sits below the two boards when lying open, and how far the spine's top and bottom ends are each
   * set in from the boards (frost only; 0 for cloth and leather)
   */
  drop: number;
  spineInset: number;
};

const PAD = 7 * MM;
const WIRE = 1.6 * MM;
/**
 * The frosted PP board's cut edge: the bevel's outward width and its depth through the thickness (from above, a rounded bright rim of
 * about 1 mm)
 */
const FROST_BEVEL = { size: 0.9 * MM, thick: 0.62 * MM };
/**
 * Frosted PP's living hinges: the boards' corner radius on the hinge side (the hinge's top and bottom ends are set in further, into the
 * spine's corners, so the outline breaks into a U-shaped notch here)
 */
const FROST_HINGE = { corner: 2.6 * MM };
/**
 * Frosted PP's heights when lying open: the spine with its metal rests on the desk, drop lower than the two boards (the hinges' memory
 * lifts each board's hinge side slightly); the spine's top and bottom ends are each set in from the boards by inset, so the outline
 * steps at the hinges rather than running straight
 */
const FROST_STEP = { drop: 2.2 * MM, inset: 1.6 * MM };
/** sasshi: the serif cover stamp's block: margin from the board's left edge (closed, seen from outside) and its bottom, height */
const STAMP = { side: 22 * MM, bottom: 20 * MM, h: 34 * MM };
/**
 * sasshi: the serif stamp's foils, by the case they sit on. Under the studio's dim zenith a flat, mostly metallic foil mirrors
 * grey: on a dark case (clay, slate, moss, ink) the gold is lighter and less metallic so it reads as bright foil, the silver as it was;
 * on a light case (paper, fog, sand, sage, and every frosted board) both are deeper, so the title keeps its contrast. The deboss walls
 * are a bit steeper than the original stamp's.
 */
const FOIL_SERIF = {
  dark: { gold: { color: "#e3c27e", metal: 0.3, rough: 0.3, normal: 0.9 }, silver: { color: FOIL_HEX.silver, metal: 0.7, rough: 0.32, normal: 0.9 } },
  light: { gold: { color: "#c39a50", metal: 0.45, rough: 0.3, normal: 0.9 }, silver: { color: "#b4bbc2", metal: 0.75, rough: 0.3, normal: 0.9 } },
};
/** sasshi: how deep the liner's relief reads under the key light (bumpMap scale: the bookplate's edge, its pressed type, the tooth) */
const LINER_BUMP = 0.9;


/** The displacement along a clockwise arc turning through a, of length L (starting direction τ) */
function arcCW(t: number, a: number, L: number): [number, number] {
  if (Math.abs(a) < 1e-5) return [L * Math.cos(t), L * Math.sin(t)];
  return [(L / a) * (Math.sin(t) - Math.sin(t - a)), (L / a) * (Math.cos(t - a) - Math.cos(t))];
}

/**
 * How far the spine (with its metal) sinks along its own inside normal: drop while the right crease lies flat, back to 0 soon after the
 * spine starts to rise (shut, it is one wall of the box)
 */
export function spineDrop(d: BinderDims, a1: number) {
  const g = Math.max(0, 1 - a1 / (Math.PI / 2));
  return d.drop * g * g;
}

/**
 * The positions of the case's segments (mid-plane): a1 the right crease's angle, a2 the left crease's (0 flat, π/2 shut). p1–p2 are the
 * spine's position before it sinks; the ring centre already includes the sink
 */
function chain(d: BinderDims, a1: number, a2: number) {
  const p0: [number, number] = [d.xb, -d.CT / 2];
  const c1 = arcCW(Math.PI, a1, d.h);
  const p1: [number, number] = [p0[0] + c1[0], p0[1] + c1[1]];
  const t1 = Math.PI - a1;
  const p2: [number, number] = [p1[0] + d.S * Math.cos(t1), p1[1] + d.S * Math.sin(t1)];
  const c2 = arcCW(t1, a2, d.h);
  const p3: [number, number] = [p2[0] + c2[0], p2[1] + c2[1]];
  const t2 = t1 - a2;
  // ring centre: the spine's midpoint moved CT/2 + D along the inside normal (sin τ, −cos τ) (the rings sink as far as the spine does)
  const mid: [number, number] = [p1[0] + (d.S / 2) * Math.cos(t1), p1[1] + (d.S / 2) * Math.sin(t1)];
  const up = d.CT / 2 + d.D - spineDrop(d, a1);
  const ring: [number, number] = [mid[0] + Math.sin(t1) * up, mid[1] - Math.cos(t1) * up];
  return { p0, p1, t1, p2, p3, t2, ring };
}

/** The three boards' mid-plane rectangles (front, spine, back) for a chain and the spine's sink */
function boardRects(d: BinderDims, k: ReturnType<typeof chain>, sink: number): BoardRect[] {
  // the mid-plane rectangle of a board running len from its start point at direction angle t; a before the start and b past the end take
  // in half a crease as well (so no light leaks between boards); off: the offset along the inside normal
  const rect = (p: [number, number], t: number, len: number, a: number, b: number, off = 0): BoardRect => {
    const cx = Math.cos(t);
    const cz = Math.sin(t);
    const m = (len + b - a) / 2;
    // off is along chain's inside normal (sin t, −cos t) (only the spine uses it: up when lying flat)
    return { o: [p[0] + cx * m + Math.sin(t) * off, 0, p[1] + cz * m - Math.cos(t) * off], x: [cx, 0, cz], n: [-cz, 0, cx], hw: (len + a + b) / 2, hh: d.H / 2 };
  };
  return [rect(k.p3, k.t2, d.B, d.h / 2, 0), rect(k.p1, k.t1, d.S, d.h / 2, d.h / 2, -sink), rect(k.p0, 0, d.B, d.h / 2, 0)];
}

/** sasshi: the boards at openness c (0 shut … 1 open) as Binder.pose(c) places them, posing nothing (camera framing, tests) */
export function boardsAt(d: BinderDims, c: number): BoardRect[] {
  const [a1, a2] = hingeAngles(c);
  return boardRects(d, chain(d, a1, a2), spineDrop(d, a1));
}

/**
 * Openness c (0 shut, 1 open) → the two creases' angles: the first half lifts the front board to upright (the spine stays put), the
 * second half lays it down to the left together with the spine. Linear within each half; the easing is the caller's (the tween of the
 * whole open / shut), so there is no pause at upright
 */
export function hingeAngles(c: number): [number, number] {
  const a2 = (Math.PI / 2) * (1 - Math.min(1, Math.max(0, c * 2)));
  const a1 = (Math.PI / 2) * (1 - Math.min(1, Math.max(0, c * 2 - 1)));
  return [a1, a2];
}

/**
 * Case geometry overrides (all optional; leaving them out gives the card binder exactly as before).
 * - board: the inner page area (mm) each board must cover; the board is that area plus the 7 mm pad all round.
 *   With sheets the board is never smaller than what the page stack needs.
 * - depth: inner spine depth (mm). Ring-less: the spine width is exactly this; with rings it can only widen the spine.
 * - rings: false removes the metal base, rings and rivets (a clamshell folder).
 */
export type CaseDims = { board?: { w: number; h: number }; depth?: number; rings?: boolean };

export function binderDims(sheets: number, material: CoverMaterial, o: CaseDims & { seg?: Seg } = {}): BinderDims {
  const seg = o.seg ?? SEG;
  const rings = o.rings !== false;
  const total = sheets * PITCH;
  const R = Math.max(13 * MM, total * 0.62 + 8 * MM);
  let D = R + 2.5 * MM;
  let S = 2 * D;
  const h = 5 * MM;
  const CT = (material === "frost" ? 1.6 : 3) * MM;
  if (o.depth !== undefined) {
    S = rings ? Math.max(S, o.depth * MM) : o.depth * MM;
    // Ring-less: D (the "ring centre" the pages would hang on, see chain()) is the middle of the closed box
    if (!rings) D = Math.max(0, S / 2 - CT / 2);
  }
  const xb = S / 2 + h;
  const H = Math.max(seg.h, (o.board?.h ?? 0) * MM) + PAD * 2;
  const frost = material === "frost";
  const d: BinderDims = { R, D, S, h, CT, xb, B: 0, H, drop: frost ? FROST_STEP.drop : 0, spineInset: frost ? FROST_STEP.inset : 0 };
  // board width: the right-hand stack's outer edge both shut and open, the farther of the two, plus 7 mm
  let far = 0;
  for (const c of [0, 1]) {
    const [a1, a2] = hingeAngles(c);
    const [cx, cz] = chain(d, a1, a2).ring;
    for (let k = 0; k < sheets; k++) {
      const z = (k + 0.5) * PITCH;
      const phi = restPhi(cx, cz, R, z, seg);
      const [rx] = panelRoot(cx + R * Math.cos(phi), cz + R * Math.sin(phi), phi, 0, seg);
      far = Math.max(far, rx + seg.w - seg.b1);
    }
  }
  const stack = sheets > 0 ? far - xb + PAD : 0;
  // No sheets and no board given: cover one page plate (the old formula gave a negative width here)
  const cover = o.board ? o.board.w * MM + PAD * 2 : sheets > 0 ? 0 : seg.w - seg.b1 + PAD * 2;
  d.B = Math.max(stack, cover);
  return d;
}

/** A board's mid-plane: centre, unit vector along its width, normal (world coordinates), half width, half height */
export type BoardRect = { o: [number, number, number]; x: [number, number, number]; n: [number, number, number]; hw: number; hh: number };

/**
 * The case of a book: CaseDims plus
 * - liner: the printed liner inside the front board (a paper insert, on every material): an endpaper with a tipped-in bookplate —
 *   the name, the name in its own script, role and place, the owner's seal — and a tipped-in photo when there is one (liner.ts);
 * - slip: sasshi: the album's 題簽, a vertical title slip on the inside of the front board (pasted on the liner of cloth and
 *   leather; on frosted PP a card of its own held on the board, round 3): `title` is the booklet's local title (カード帖, 絵葉書,
 *   卡册 …), `han` the Han faces it is set in (src/fonts). Without a slip the inside board is plain. A case with a printed liner has no
 *   slip.
 * The stamped cover title is set in the Han faces of the slip, else of the liner's language, else its own (src/fonts hanLangOf).
 */
export type CaseSpec = CaseDims & { liner?: LinerSpec | null; slip?: LinerSlip | null };

export type Binder = {
  group: THREE.Group;
  dims: BinderDims;
  /**
   * Empty frames on the inside faces of the two boards (see SceneAddon in addon.ts): origin at the board centre on its inside face
   * (on top of the liner paper), x along the board width (to the right when open), y along its height, z the inside normal.
   */
  anchors: { back: THREE.Object3D; front: THREE.Object3D };
  /** The liner's portrait picture arrived (case.liner.portrait.src) */
  setLinerPortrait(img: HTMLImageElement | null): void;
  /** sasshi: paint the printed parts again (the liner, the slip, the cover stamp) — the web fonts they are set in arrived late */
  repaint(): void;
  /**
   * Poses the case at openness c; returns the ring centre (xz), the front board's heading (π lying flat on the left … 0 closed on top)
   * and the front board's pivot (the left crease's far end, on the board's mid-plane), and the mid-plane rectangles of the three boards,
   * front board, spine and back board (for the frost's shadow: centre, unit vector along the width, normal, half width, half height)
   */
  pose(c: number): { ring: [number, number]; front: number; hinge: [number, number]; boards: BoardRect[] };
  /** sasshi: the boards' mid-plane rectangles at openness c, as pose(c) returns them, without posing anything (camera framing) */
  boards(c: number): BoardRect[];
  /** The case's extent in x when shut (for the camera framing) */
  closedSpan: [number, number];
  /** The picture of the card on the cover (the display pocket) arrived */
  setWindowImage(img: HTMLImageElement | null): void;
  /** The case's material; frost: frosted and translucent (frost.ts must be hooked up to it) */
  caseMaterial: THREE.MeshPhysicalMaterial;
  /**
   * The metal's material (base, rings, rivets): its specular highlights are suppressed while the frosted background is drawn (metal seen
   * through the frost is only a soft grey)
   */
  steel: THREE.MeshPhysicalMaterial;
  frost: boolean;
  dispose(): void;
};

/*
 * sasshi: the case's procedural canvases are kept (the cloth and leather maps once, the plain liners and — in liner.ts and
 * textures.ts — the printed liner and the serif stamp by their inputs), so a case swap does not paint them again. Textures are made
 * from them and disposed with each binder; the canvases themselves are never drawn into after they are painted.
 */
let clothCache: ReturnType<typeof drawClothMaps> | null = null;
let leatherCache: HTMLCanvasElement | null = null;
const clothMaps = () => (clothCache ??= drawClothMaps());
const leatherNormal = () => (leatherCache ??= drawLeatherNormal());
const plainLinerCache = new Map<string, HTMLCanvasElement>();
function plainLiner(...args: Parameters<typeof drawLiner>) {
  const key = JSON.stringify([...args, loadedFaces()]);
  let c = plainLinerCache.get(key);
  if (!c) {
    if (plainLinerCache.size > 6) plainLinerCache.delete(plainLinerCache.keys().next().value!);
    plainLinerCache.set(key, (c = drawLiner(...args)));
  }
  return c;
}

export type BinderOptions = { sheets: number; cover: CoverSpec; title: string; windowCard: { color: string | null } | null; maxAniso: number; linerPx?: number; case?: CaseSpec; seg?: Seg; layout?: BookLayout };

/** The printed liner's size (mm): cloth / leather take the plain liner's place; on frosted PP the area its bookplate is placed in */
const linerSizeOf = (d: BinderDims, frost: boolean): [number, number] => (frost ? [d.B / MM - 16, d.H / MM - 16] : [d.B / MM - 9, d.H / MM - 9]);
/** sasshi: a liner's coverage as an alphaMap (white where the canvas is painted, black where it is transparent), 512 px wide */
function coverageOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = Math.max(1, Math.round((512 * src.height) / src.width));
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
/** sasshi: the Han faces the stamped cover title is set in (see CaseSpec) */
const stampHan = (title: string, kase: CaseSpec): HanLang => kase.slip?.han ?? hanLangOf(title, kase.liner?.lang);
/** sasshi: the 題簽 inside the front board (a printed liner takes its place) */
const slipOf = (kase: CaseSpec): LinerSlip | null => (!kase.liner && kase.slip?.title.trim() ? kase.slip : null);
/** sasshi: a frosted album's slip card, px per mm */
const SLIP_PX = 12;
const slipCardCache = new Map<string, HTMLCanvasElement>();
function slipCard(slip: LinerSlip) {
  const key = JSON.stringify([slip.title, slip.han, loadedFaces()]);
  let c = slipCardCache.get(key);
  if (!c) {
    if (slipCardCache.size > 4) slipCardCache.delete(slipCardCache.keys().next().value!);
    slipCardCache.set(key, (c = drawSlip(SLIP_PX, slip)));
  }
  return c;
}
/** The serif stamp's block (scene units) on a board `d.B` wide */
const stampSize = (d: BinderDims) => ({ w: d.B - 2 * STAMP.side, h: STAMP.h });

/**
 * sasshi: the strings a case prints (the stamped title, the liner, the slip) in the faces it sets them in (src/fonts). Canvas
 * text never loads a web font by itself: the scene awaits ensureFonts() with these, and repaints the print when they arrive late.
 */
export function caseFontRuns(title: string, kase: CaseSpec = {}): FontRun[] {
  const runs: FontRun[] = [];
  if (title.trim()) runs.push({ role: "serif", weight: 500, text: title, han: stampHan(title, kase) });
  if (kase.liner) runs.push(...linerFontRuns(kase.liner));
  if (kase.slip?.title.trim()) runs.push({ role: "serif", weight: 500, text: kase.slip.title, han: kase.slip.han });
  return runs;
}

/**
 * sasshi: paint — into the caches above, liner.ts's and the serif stamp's — what createBinder(o) would paint, without building
 * anything. The scene calls it when idle for the materials not on show, so the first swap to one of them does not stall on painting.
 */
export function prepaintCase(o: BinderOptions) {
  finish(prepaintSteps(o));
}

/**
 * sasshi (round 4, E1): prepaintCase in steps — the material's maps, the plain liners (with the 題簽 slip), the printed liner (in
 * three: endpaper, its height, the bookplate), the stamp (in two: the type, its normal map) — a host runs one a task, so painting a case
 * ahead (another language, another material) never holds a frame for long.
 */
export function* prepaintSteps(o: BinderOptions): Generator<void, void> {
  const { cover } = o;
  const kase = o.case ?? {};
  const frost = cover.material === "frost";
  const d = binderDims(o.sheets, cover.material, { board: kase.board, depth: kase.depth, rings: kase.rings !== false, seg: o.seg });
  const hex = COVER_HEX[cover.color];
  if (cover.material === "cloth") clothMaps();
  if (cover.material === "leather") leatherNormal();
  yield;
  if (!frost) {
    // the same expressions as createBinder's, so the cache keys match to the last bit
    const [lw, lh] = [(d.B - 9 * MM) / MM, (d.H - 9 * MM) / MM];
    plainLiner(1024, lw, lh, hex.liner, null);
    const slip = slipOf(kase);
    if (slip) {
      yield;
      plainLiner(1024, lw, lh, hex.liner, slip);
    }
  } else {
    const slip = slipOf(kase);
    if (slip) slipCard(slip);
  }
  if (kase.liner) {
    yield;
    const [lw, lh] = linerSizeOf(d, frost);
    yield* folioLinerSteps(o.linerPx ?? 1536, lw, lh, linerLookFor(cover.material, cover.color), kase.liner, null);
  }
  yield;
  const st = stampSize(d);
  yield* coverStampSteps(o.title, st.w / MM, st.h / MM, undefined, stack("serif", stampHan(o.title, kase)), "serif");
}

export function createBinder(o: BinderOptions): Binder {
  const { cover } = o;
  // sasshi: the rings and the base follow the layout's page (card binder by default)
  const layout = o.layout ?? resolveLayout("idCard2x3");
  const kase = o.case ?? {};
  const rings = kase.rings !== false;
  const d = binderDims(o.sheets, cover.material, { board: kase.board, depth: kase.depth, rings, seg: o.seg });
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const hex = COVER_HEX[cover.color];
  const look = MATERIAL_LOOK[cover.material];
  const frost = cover.material === "frost";

  /* ── case material ── */
  let caseMat: THREE.MeshPhysicalMaterial;
  if (frost) {
    // frosted PP: milky white with a very faint gloss; the colour is a very faint tint. The translucency (light passing through, the
    // Fresnel brightening at grazing angles) is hooked up by frost.ts
    caseMat = new THREE.MeshPhysicalMaterial({
      color: hex.frost,
      roughness: look.roughness,
      clearcoat: look.clearcoat,
      // satin: on a board lying flat the softbox's reflection is a broad light-to-dark gradient, sliding across the boards as the case
      // opens and shuts
      clearcoatRoughness: 0.4,
      specularIntensity: 0.45,
    });
  } else if (cover.material === "cloth") {
    const maps = clothMaps();
    const albedo = keep(new THREE.CanvasTexture(maps.albedo));
    albedo.colorSpace = THREE.SRGBColorSpace;
    const normal = keep(new THREE.CanvasTexture(maps.normal));
    for (const t of [albedo, normal]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(3.2, 3.2);
      t.anisotropy = o.maxAniso;
    }
    caseMat = new THREE.MeshPhysicalMaterial({
      color: hex.base,
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: look.roughness,
      sheen: look.sheen,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(hex.base).lerp(new THREE.Color(0xffffff), 0.45),
    });
  } else {
    const normal = keep(new THREE.CanvasTexture(leatherNormal()));
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(9, 9);
    normal.anisotropy = o.maxAniso;
    caseMat = new THREE.MeshPhysicalMaterial({
      color: hex.base,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: look.roughness,
      clearcoat: look.clearcoat,
      clearcoatRoughness: 0.45,
      sheen: look.sheen,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(hex.base).lerp(new THREE.Color(0xffffff), 0.35),
    });
  }
  keep(caseMat);
  // frosted boards are translucent: they cast no shadow (light passes through; their soft shadow is frost.ts's analytic projection, and
  // they write no depth into the VSM shadow map), but they receive the shadows of turning pages; on layer 1 (left out when the background
  // seen through them is drawn)
  const noCast = frost ? keep(frostCaster()) : null;
  const shade = (m: THREE.Mesh) => {
    m.castShadow = !frost;
    m.receiveShadow = true;
    if (noCast) {
      m.layers.set(FROST_LAYER);
      m.customDepthMaterial = noCast;
    }
    return m;
  };
  /**
   * Frost: the board's sides (the extrusion's side walls and bevel, material group 1) are marked as the cut, shaded opaque with the
   * light-guiding cut edge glowing; aFrostGroove = −1 (not a hinge).
   * aFrostBow: a point's position on the board relative to that board (−1 … 1) and its facing (inside +1, outside −1, sides 0); by it
   * the shader tilts the normal slightly towards the board's centre, as the slight curl of a PP board's four edges once it has been
   * folded: each board has its own light-to-dark gradient, starting afresh at the hinges.
   * aFrostTilt: the whole board's tilt (along the board width, positive towards the local +x axis): the spine lies on the desk and the
   * two boards' hinge sides are lifted a little, so the front and back boards tilt slightly in different directions and the three
   * boards each have a tone of their own
   */
  const frostAttrs = (g: THREE.BufferGeometry, w: number, h: number, tilt: number) => {
    const n = g.attributes.position!.count;
    const e = new Float32Array(n);
    for (const gr of g.groups) if (gr.materialIndex === 1) e.fill(1, gr.start, Math.min(n, gr.start + gr.count));
    g.setAttribute("aFrostEdge", new THREE.BufferAttribute(e, 1));
    g.setAttribute("aFrostTilt", new THREE.BufferAttribute(new Float32Array(n).fill(tilt), 1));
    g.setAttribute("aFrostGroove", new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
    const pos = g.attributes.position!;
    const nrm = g.attributes.normal!;
    const bow = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const nz = nrm.getZ(i);
      bow[i * 3] = pos.getX(i) / (w / 2);
      bow[i * 3 + 1] = pos.getY(i) / (h / 2);
      bow[i * 3 + 2] = e[i] ? 0 : Math.sign(nz);
    }
    g.setAttribute("aFrostBow", new THREE.BufferAttribute(bow, 3));
    return g;
  };

  /* ── three rigid boards ──
   * Cloth, leather: one piece of cloth wraps the three boards, joined at the creases, the outline one straight edge.
   * Frosted PP: three separate boards, each with four rounded corners and a rounded cut edge all round (bevel FROST_BEVEL; the
   * light-guiding cut edge glows in the shader); the spine's top and bottom ends are set in by spineInset.
   * Between the boards are living hinges: the same sheet of PP as the boards and as thick, lying open a ramp falling from board to spine
   * with a score line at either end; their top and bottom ends are set in, into the corners, so the outline has a U-shaped notch at
   * each hinge */
  const r = 4 * MM;
  const sq = 0.6 * MM;
  const rh = frost ? FROST_HINGE.corner : sq;
  const bevel = frost ? FROST_BEVEL : null;
  const back = shade(new THREE.Mesh(keep(frostAttrs(slab(d.B, d.H, d.CT, [rh, r, r, rh], bevel), d.B, d.H, -1)), caseMat));
  back.position.set(d.xb + d.B / 2, 0, -d.CT / 2);
  const spinePivot = new THREE.Group();
  // the spine and the metal riveted to it: lying open they sink together along the spine's inside normal (chain() counts it in the ring
  // centre too)
  const spineBody = new THREE.Group();
  spinePivot.add(spineBody);
  const spineH = d.H - 2 * d.spineInset;
  const spine = shade(new THREE.Mesh(keep(frostAttrs(slab(d.S, spineH, d.CT, [rh, rh, rh, rh], bevel), d.S, spineH, 0)), caseMat));
  spine.position.set(-d.S / 2, 0, 0);
  spineBody.add(spine);
  const frontPivot = new THREE.Group();
  const front = shade(new THREE.Mesh(keep(frostAttrs(slab(d.B, d.H, d.CT, [r, rh, rh, r], bevel), d.B, d.H, 1)), caseMat));
  front.position.set(-d.B / 2, 0, 0);
  frontPivot.add(front);
  group.add(back, spinePivot, frontPivot);

  /* ── two creases: narrow strips rebuilt on the CPU by angle (frost: living hinges as thick as the boards, a ramp when flat) ── */
  const hingeShape = frost
    ? { thick: d.CT, inset: d.spineInset + FROST_HINGE.corner, ext: FROST_BEVEL.size * 0.85, score: true }
    : { thick: d.CT, inset: 0, ext: 0, score: false };
  const creaseR = crease(d, hingeShape);
  const creaseL = crease(d, hingeShape);
  for (const c of [creaseR, creaseL]) {
    keep(c.geometry);
    group.add(shade(new THREE.Mesh(c.geometry, caseMat)));
  }

  /** sasshi: the plain liner that carries the 題簽 (a frosted case: the slip card), repainted when its face arrives */
  let slipLiner: { tex: THREE.CanvasTexture; w: number; h: number; slip: LinerSlip } | null = null;
  let slipCardTex: { tex: THREE.CanvasTexture; slip: LinerSlip } | null = null;
  /* ── liners (cloth and leather only; a margin left all round for the turned-in edges) ── */
  if (!frost) {
    const lw = d.B - 9 * MM;
    const lh = d.H - 9 * MM;
    const slip = slipOf(kase);
    for (const [board, sl] of [
      [back, null],
      [front, slip],
    ] as const) {
      // sasshi: a case.liner replaces the front liner with the typeset insert below
      if (board === front && kase.liner) continue;
      const tex = keep(new THREE.CanvasTexture(plainLiner(1024, lw / MM, lh / MM, hex.liner, sl)));
      if (sl) slipLiner = { tex, w: lw, h: lh, slip: sl };
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = o.maxAniso;
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(lw, lh)), keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })));
      m.position.set(board === back ? -1.5 * MM : 1.5 * MM, 0, d.CT / 2 + 0.05 * MM);
      m.receiveShadow = true;
      board.add(m);
    }
  } else {
    /*
     * sasshi (round 3): a frosted album's 題簽 — the same slip as the cloth liner's, a white card on its own held on the inside of
     * the front board where the cloth one is pasted (so the open album's left board is not a blank grey plane). Layer 0, like the
     * printed insert: it lies on the board when the album is open; shut, it faces the pages.
     */
    const slip = slipOf(kase);
    if (slip) {
      const tex = keep(new THREE.CanvasTexture(slipCard(slip)));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = o.maxAniso;
      slipCardTex = { tex, slip };
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(SLIP_RECT.w * MM, SLIP_RECT.h * MM)), keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })));
      // where the cloth liner (B − 9 mm × H − 9 mm, 1.5 mm off centre) has it
      const lw = d.B - 9 * MM;
      const lh = d.H - 9 * MM;
      m.position.set(1.5 * MM - lw / 2 + (SLIP_RECT.x + SLIP_RECT.w / 2) * MM, lh / 2 - (SLIP_RECT.y + SLIP_RECT.h / 2) * MM, d.CT / 2 + 0.08 * MM);
      m.receiveShadow = true;
      front.add(m);
    }
  }

  /*
   * sasshi: the printed liner inside the front board (case.liner). On cloth / leather an endpaper in the plain liner's place (same
   * inset); on frosted PP only the bookplate, held on the bare board (the rest of the canvas is transparent, cut by alphaTest), so
   * the PP shows round it open or closed. Layer 0: closed, the plate's plain back shows through the frosted board, like a real slip.
   */
  /** mm (the painter's units; scene units for the mesh are × MM) */
  const linerSize = linerSizeOf(d, frost);
  const linerLook = linerLookFor(cover.material, cover.color);
  const linerPx = o.linerPx ?? 1536;
  let linerPortrait: HTMLImageElement | null = null;
  let liner: { color: THREE.CanvasTexture; height: THREE.CanvasTexture; alpha: THREE.CanvasTexture | null } | null = null;
  const paintLiner = () => {
    if (!kase.liner) return;
    const [lw, lh] = linerSize;
    const out = drawFolioLiner(linerPx, lw, lh, linerLook, kase.liner, kase.liner.portrait?.src ? linerPortrait : null);
    if (!liner) return out;
    // the painter keeps its recent canvases for the next case swap: point the live textures at the new ones, never draw into them
    for (const [tex, src] of [
      [liner.color, out.color],
      [liner.height, out.height],
    ] as const) {
      if (tex.image === src) continue;
      tex.image = src;
      tex.needsUpdate = true;
      if (tex === liner.color && liner.alpha) {
        liner.alpha.image = coverageOf(src);
        liner.alpha.needsUpdate = true;
      }
    }
    return out;
  };
  if (kase.liner) {
    const [lw, lh] = linerSize;
    const out = paintLiner()!;
    const color = keep(new THREE.CanvasTexture(out.color));
    color.colorSpace = THREE.SRGBColorSpace;
    color.anisotropy = o.maxAniso;
    const height = keep(new THREE.CanvasTexture(out.height));
    height.anisotropy = o.maxAniso;
    const alpha = frost ? keep(new THREE.CanvasTexture(coverageOf(out.color))) : null;
    liner = { color, height, alpha };
    const mat = keep(new THREE.MeshStandardMaterial({ map: color, bumpMap: height, bumpScale: LINER_BUMP, roughness: 0.9, alphaTest: frost ? 0.5 : 0 }));
    const geo = keep(new THREE.PlaneGeometry(lw * MM, lh * MM));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(frost ? 0 : 1.5 * MM, 0, d.CT / 2 + 0.05 * MM);
    m.receiveShadow = true;
    front.add(m);
    if (alpha) {
      // the plate's plain back: what the frosted board shows of it when the folio closes (the pouch shows round it)
      const b = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ color: linerLook.plate, alphaMap: alpha, alphaTest: 0.5, roughness: 0.9, side: THREE.BackSide })));
      b.position.copy(m.position);
      b.receiveShadow = true;
      front.add(b);
    }
  }

  /* sasshi: addon anchors on the inside faces (above the liner paper) */
  const anchors = { back: new THREE.Object3D(), front: new THREE.Object3D() };
  anchors.back.name = "anchor:back-inside";
  anchors.front.name = "anchor:front-inside";
  anchors.back.position.set(0, 0, d.CT / 2 + 0.1 * MM);
  anchors.front.position.set(0, 0, d.CT / 2 + 0.1 * MM);
  back.add(anchors.back);
  front.add(anchors.front);

  /* ── outside of the cover: the album name's foil stamp / blind stamp, the display pocket at the top right ── */
  // sasshi: the booklet's own stamp (textures.serifStamp): a block as wide as the board less its margins, the title sized to it,
  // set in Mincho 500 in the Han faces of the case's language (src/fonts)
  const { w: stampW, h: stampH } = stampSize(d);
  const stampFont = stack("serif", stampHan(o.title, kase));
  const drawStamp = () => drawCoverStamp(o.title, stampW / MM, stampH / MM, undefined, stampFont, "serif");
  const stamp = drawStamp();
  const stampAlpha = keep(new THREE.CanvasTexture(stamp.alpha));
  const stampNormal = keep(new THREE.CanvasTexture(stamp.normal));
  /** Repaints the stamp (and the frosted board's crescents, which are cut from it) into the live textures */
  const stampCrescents: { tex: THREE.CanvasTexture; dx: number; dy: number }[] = [];
  const paintStamp = () => {
    const next = drawStamp();
    // the serif stamp's canvases are shared with the painter's cache: point the textures at the new ones, never draw into them
    for (const [tex, src] of [
      [stampAlpha, next.alpha],
      [stampNormal, next.normal],
    ] as const) {
      if (tex.image === src) continue;
      tex.image = src;
      tex.needsUpdate = true;
    }
    for (const cr of stampCrescents) {
      const c = cr.tex.image as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(next.alpha, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(next.alpha, cr.dx, cr.dy);
      ctx.globalCompositeOperation = "source-over";
      cr.tex.needsUpdate = true;
    }
  };
  stampAlpha.anisotropy = stampNormal.anisotropy = o.maxAniso;
  const blind = cover.foil === "blind";
  // sasshi: the serif stamp's foil (FOIL_SERIF)
  const foil = blind ? null : FOIL_SERIF[!frost && hex.dark ? "dark" : "light"][cover.foil as "silver" | "gold"];
  const stampMat = keep(
    new THREE.MeshPhysicalMaterial({
      // blind: the same colour, darkened (pressed deeper on a light cover so it shows); foil: mostly metal, with a little diffuse left so
      // it does not turn black seen from straight above
      color: foil ? foil.color : new THREE.Color(frost ? 0xffffff : hex.base).multiplyScalar(frost ? 1 : hex.dark ? 0.78 : 0.7),
      metalness: foil ? foil.metal : 0,
      roughness: foil ? foil.rough : look.roughness * 0.8,
      alphaMap: stampAlpha,
      transparent: true,
      opacity: blind && frost ? 0.55 : 1,
      depthWrite: false,
      normalMap: stampNormal,
      normalScale: new THREE.Vector2(foil ? foil.normal : 1.4, foil ? foil.normal : 1.4),
    }),
  );
  const stampMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(stampW, stampH)), stampMat);
  // front board local coordinates: x outward (to the right when shut) is −x; the outer face is at −CT/2, facing −z
  stampMesh.position.set(d.B / 2 - STAMP.side - stampW / 2, -d.H / 2 + STAMP.bottom + stampH / 2, -d.CT / 2 - 0.06 * MM);
  stampMesh.rotation.y = Math.PI;
  // what sits on the outside of the cover stays out of the frost's background too (or, shut, it would show through once more beneath
  // itself)
  if (frost) stampMesh.layers.set(FROST_LAYER);
  front.add(stampMesh);
  if (frost) {
    // the stamp on a frosted board is pressed in: inside the letters the wall on the key light's side (sasshi: top right, the
    // window's side) faces away from the light, a thin dark edge, and the wall opposite faces the light, a thin bright edge: a directional
    // impression, not a symmetric halo all round (that reads as an outline, an outer glow). About 0.25 mm each, opacity no more than 0.2
    const px = stamp.alpha.width / (stampW / MM);
    const dd = Math.max(1, Math.round(px * 0.25));
    const crescent = (dx: number, dy: number) => {
      const c = document.createElement("canvas");
      c.width = stamp.alpha.width;
      c.height = stamp.alpha.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(stamp.alpha, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(stamp.alpha, dx, dy);
      const tex = keep(new THREE.CanvasTexture(c));
      stampCrescents.push({ tex, dx, dy });
      return tex;
    };
    // the stamp reads unmirrored on the closed cover: canvas x is screen x, so the dark wall is the glyph's upper right
    for (const [dx, dy, color, opacity] of [
      [-dd, dd, 0x15233a, 0.2],
      [dd, -dd, 0xffffff, 0.16],
    ] as const) {
      const m = new THREE.Mesh(stampMesh.geometry, keep(new THREE.MeshBasicMaterial({ color, alphaMap: crescent(dx, dy), transparent: true, opacity, depthWrite: false })));
      m.position.set(stampMesh.position.x, stampMesh.position.y, -d.CT / 2 - 0.07 * MM);
      m.rotation.y = Math.PI;
      m.renderOrder = 1;
      m.layers.set(FROST_LAYER);
      front.add(m);
    }
  }

  const winW = CARD_W * MM + 7 * MM;
  const winH = CARD_H * MM + 7 * MM;
  let winMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial> | null = null;
  if (o.windowCard) {
    const tex = keep(new THREE.CanvasTexture(drawWindowPocket(null, o.windowCard.color, winW / MM, winH / MM)));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = o.maxAniso;
    winMesh = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(winW, winH)),
      keep(new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, alphaTest: 0.02, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false })),
    );
    winMesh.position.set(-d.B / 2 + 20 * MM + winW / 2, d.H / 2 - 20 * MM - winH / 2, -d.CT / 2 - 0.08 * MM);
    winMesh.rotation.y = Math.PI;
    if (frost) winMesh.layers.set(FROST_LAYER);
    front.add(winMesh);
  }

  /* ── the metal: base + rings + two rivets in the middle of the spine's inside ── */
  const steel = keep(new THREE.MeshPhysicalMaterial({ color: 0xb8bec5, metalness: 1, roughness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.25 }));
  // sasshi: case.rings === false is a clamshell folder — no metal at all
  if (rings) {
    const housingLen = layout.pageH * MM - 18 * MM;
    // the base widens with the ring size (a 3-inch ring's base is much wider than a 1-inch one's)
    const housing = new THREE.Mesh(keep(bar(Math.max(11 * MM, d.R * 0.85), 3.2 * MM, housingLen)), steel);
    housing.position.set(-d.S / 2, 0, d.CT / 2);
    const ringGeo = keep(new THREE.TorusGeometry(d.R, WIRE, 14, 96));
    const rivetGeo = keep(new THREE.SphereGeometry(2.4 * MM, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
    for (const m of [housing]) {
      m.castShadow = true;
      m.receiveShadow = true;
      spineBody.add(m);
    }
    for (const y of layout.rings) {
      const ring = new THREE.Mesh(ringGeo, steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(-d.S / 2, y * MM, d.CT / 2 + d.D);
      ring.castShadow = true;
      ring.receiveShadow = true;
      spineBody.add(ring);
    }
    for (const y of [-1, 1]) {
      const rivet = new THREE.Mesh(rivetGeo, steel);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(-d.S / 2, y * (housingLen / 2 - 7 * MM), d.CT / 2 + 3.2 * MM);
      rivet.scale.set(1, 0.45, 1);
      spineBody.add(rivet);
    }
  }

  const closed = chain(d, Math.PI / 2, Math.PI / 2);

  const lastPose: { c: number; r: ReturnType<Binder["pose"]> | null } = { c: Number.NaN, r: null };
  const restBoards: [BoardRect[] | null, BoardRect[] | null] = [null, null];
  return {
    group,
    dims: d,
    anchors,
    setLinerPortrait(img) {
      if (!liner || !kase.liner?.portrait?.src) return;
      linerPortrait = img;
      paintLiner();
    },
    repaint() {
      paintLiner();
      paintStamp();
      if (slipLiner) {
        const next = plainLiner(1024, slipLiner.w / MM, slipLiner.h / MM, hex.liner, slipLiner.slip);
        if (slipLiner.tex.image !== next) {
          slipLiner.tex.image = next;
          slipLiner.tex.needsUpdate = true;
        }
      }
      if (slipCardTex) {
        const next = slipCard(slipCardTex.slip);
        if (slipCardTex.tex.image !== next) {
          slipCardTex.tex.image = next;
          slipCardTex.tex.needsUpdate = true;
        }
      }
    },
    caseMaterial: caseMat,
    steel,
    frost,
    closedSpan: [closed.p1[0] - d.CT, d.xb + d.B],
    pose(c) {
      // sasshi: posed every frame (step, render, the addons) — the same openness again changes nothing: the last result
      if (c === lastPose.c && lastPose.r) return lastPose.r;
      const [a1, a2] = hingeAngles(c);
      const k = chain(d, a1, a2);
      const sink = spineDrop(d, a1);
      spinePivot.position.set(k.p1[0], 0, k.p1[1]);
      spinePivot.rotation.y = a1;
      spineBody.position.z = -sink;
      frontPivot.position.set(k.p3[0], 0, k.p3[1]);
      frontPivot.rotation.y = a1 + a2;
      creaseR.update(k.p0, Math.PI, a1, 0, -sink);
      creaseL.update(k.p2, k.t1, a2, -sink, 0);
      lastPose.c = c;
      lastPose.r = { ring: k.ring, front: k.t2, hinge: k.p3, boards: boardRects(d, k, sink) };
      return lastPose.r;
    },
    // sasshi: the two resting poses are asked for on every frame the camera is placed: made once (never change them)
    boards: (c) => (c === 0 ? (restBoards[0] ??= boardsAt(d, 0)) : c === 1 ? (restBoards[1] ??= boardsAt(d, 1)) : boardsAt(d, c)),
    setWindowImage(img) {
      if (!winMesh || !o.windowCard) return;
      const map = winMesh.material.map as THREE.CanvasTexture;
      const c = drawWindowPocket(img, o.windowCard.color, winW / MM, winH / MM);
      const ctx = (map.image as HTMLCanvasElement).getContext("2d")!;
      // the canvas still carries the scale from painting the pocket: reset it first
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(c, 0, 0);
      map.needsUpdate = true;
    },
    dispose() {
      for (const x of disposables) x.dispose();
    },
  };
}

/**
 * A crease: a narrow strip bent along an arc (inner and outer faces + top and bottom ends), its vertices rebuilt whenever the case opens
 * or shuts.
 * thick: thickness (against the outer face; cloth, leather and frost are all as thick as the boards);
 * inset: how far the top and bottom ends are each set in (frost: into the corners of the boards and the spine, so the outline breaks
 * here); ext: how far both ends reach along the tangent into the boards (hidden under the boards' bevel, so no gap shows; no more than
 * the bevel width, or it is coplanar with the board's outer face and the two layers fight for depth);
 * score: frost's living hinge, a score line at either end (aFrostGroove is the position along the hinge, 0–1; the shader darkens the
 * two lines at HINGE_SCORE); when the two ends sit at different heights (the spine sunk) the middle is a ramp, the bend gathered on the
 * two score lines
 */
function crease(d: BinderDims, o: { thick: number; inset: number; ext: number; score: boolean }) {
  const N = 16;
  // samples along the arc: 0 is the point reaching into the board before, 1 … N + 1 are on the arc, N + 2 is the point reaching into the
  // board after
  const M = N + 3;
  const ys = [-d.H / 2 + o.inset, d.H / 2 - o.inset];
  const pos = new Float32Array(M * 2 * 2 * 3 * 2);
  const nrm = new Float32Array(pos.length);
  const uv = new Float32Array((pos.length / 3) * 2);
  const idx: number[] = [];
  // inner and outer faces: vertices [face][s][y]
  const id = (f: number, s: number, y: number) => f * M * 2 + s * 2 + y;
  for (let f = 0; f < 2; f++)
    for (let s = 0; s + 1 < M; s++) {
      const a = id(f, s, 0);
      const b = id(f, s + 1, 0);
      const c = id(f, s + 1, 1);
      const e = id(f, s, 1);
      if (f === 0) idx.push(a, c, b, a, e, c);
      else idx.push(a, b, c, a, c, e);
    }
  // top and bottom ends: vertices [end][s][inner / outer]
  const base = 2 * M * 2;
  const id2 = (y: number, s: number, f: number) => base + y * M * 2 + s * 2 + f;
  for (let y = 0; y < 2; y++)
    for (let s = 0; s + 1 < M; s++) {
      const a = id2(y, s, 0);
      const b = id2(y, s + 1, 0);
      const c = id2(y, s + 1, 1);
      const e = id2(y, s, 1);
      idx.push(a, b, c, a, c, e);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  // frost: the top and bottom ends are the cut; the hinge does not tilt; the position along the hinge (for the score lines)
  const count = pos.length / 3;
  const edge = new Float32Array(count);
  edge.fill(1, base);
  geometry.setAttribute("aFrostEdge", new THREE.BufferAttribute(edge, 1));
  geometry.setAttribute("aFrostTilt", new THREE.BufferAttribute(new Float32Array(count), 1));
  const along = new Float32Array(count).fill(-1);
  if (o.score)
    for (let s = 0; s < M; s++) {
      const u = Math.min(N, Math.max(0, s - 1)) / N;
      for (let f = 0; f < 2; f++)
        for (let y = 0; y < 2; y++) {
          along[id(f, s, y)] = u;
          along[id2(y, s, f)] = u;
        }
    }
  geometry.setAttribute("aFrostGroove", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aFrostBow", new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  geometry.setIndex(idx);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const set = (i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    pos.set([x, y, z], i * 3);
    nrm.set([nx, ny, nz], i * 3);
    uv.set([u, v], i * 2);
  };
  // the two faces' distance from the mid-plane (positive along the inside normal): the outer face fixed at −CT/2, inner face = outer
  // face + thickness
  const off = [-d.CT / 2 + o.thick, -d.CT / 2];
  const [u0, u1] = HINGE_SCORE;
  return {
    geometry,
    /**
     * p, t: start point and starting direction; a: bend angle; d0, d1: the start's and the end's offset along the inside normal (one end
     * is −drop while the spine sinks)
     */
    update(p: [number, number], t: number, a: number, d0 = 0, d1 = 0) {
      for (let s = 0; s < M; s++) {
        const k = Math.min(N, Math.max(0, s - 1));
        const L = (d.h * k) / N;
        let [dx, dz] = arcCW(t, (a * k) / N, L);
        const ang = t - (a * k) / N;
        // both ends reach out along the tangent
        const x = s === 0 ? -o.ext : s === M - 1 ? o.ext : 0;
        dx += x * Math.cos(ang);
        dz += x * Math.sin(ang);
        // inside normal (sin, −cos)
        let nx = Math.sin(ang);
        let nz = -Math.cos(ang);
        // ramp: a cosine blend from d0 to d1 between the two score lines (slope 0 at the scores, steepest in the middle); the normal turns
        // by the slope (the tangent is (cos ang, sin ang))
        const q = Math.min(1, Math.max(0, (k / N - u0) / (u1 - u0)));
        const lift = d0 + (d1 - d0) * (1 - Math.cos(Math.PI * q)) * 0.5;
        dx += nx * lift;
        dz += nz * lift;
        if (d0 !== d1 && q > 0 && q < 1) {
          const slope = ((d1 - d0) * 0.5 * Math.PI * Math.sin(Math.PI * q)) / ((u1 - u0) * d.h);
          const tx = Math.cos(ang);
          const tz = Math.sin(ang);
          const l = Math.hypot(1, slope);
          nx = (nx - slope * tx) / l;
          nz = (nz - slope * tz) / l;
        }
        for (let f = 0; f < 2; f++) {
          const o2 = off[f]!;
          const sg = f === 0 ? 1 : -1;
          for (let y = 0; y < 2; y++) {
            set(id(f, s, y), p[0] + dx + nx * o2, ys[y]!, p[1] + dz + nz * o2, nx * sg, 0, nz * sg, (p[0] + dx) * -1, ys[y]!);
            set(id2(y, s, f), p[0] + dx + nx * o2, ys[y]!, p[1] + dz + nz * o2, 0, y === 0 ? -1 : 1, 0, (p[0] + dx) * -1, ys[y]!);
          }
        }
      }
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.normal!.needsUpdate = true;
      geometry.attributes.uv!.needsUpdate = true;
    },
  };
}

/**
 * A round-cornered board (centred on the origin, thickness along z): corners are the corner radii bottom left, bottom right, top right,
 * top left in turn (each measured at the board's widest, the middle of its thickness).
 * bevel: the cut edge's bevel (size outward, thick through the thickness, a rounded quarter-ellipse edge); without it, a very small
 * default bevel
 */
function slab(w: number, h: number, t: number, corners: [number, number, number, number], bevel?: { size: number; thick: number } | null) {
  const bt = bevel ? Math.min(bevel.thick, t * 0.45) : Math.min(t * 0.3, 0.8 * MM);
  const bs = bevel ? bevel.size : bt * 0.6;
  // the bevel grows bs outward: the outline is first inset by bs, so the widest part is exactly w × h
  const sh = bevel ? bs : 0;
  w -= 2 * sh;
  h -= 2 * sh;
  const [bl, br, tr, tl] = corners.map((c) => Math.max(0.2 * MM, c - sh)) as [number, number, number, number];
  const x0 = -w / 2;
  const y0 = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + bl, y0);
  s.lineTo(x0 + w - br, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + br);
  s.lineTo(x0 + w, y0 + h - tr);
  s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - tr, y0 + h);
  s.lineTo(x0 + tl, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - tl);
  s.lineTo(x0, y0 + bl);
  s.quadraticCurveTo(x0, y0, x0 + bl, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t - bt * 2, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: bevel ? 4 : 3, curveSegments: 6 });
  g.translate(0, 0, -(t - bt * 2) / 2);
  return g;
}

/** The metal base: a round-cornered rectangle in section (width w, height h), extruded along y */
function bar(w: number, h: number, len: number) {
  const r = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, 0);
  s.lineTo(w / 2 - r, 0);
  s.absarc(w / 2 - r, r, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, h);
  s.absarc(-w / 2 + r, r, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2);
  g.translate(0, len / 2, 0);
  return g;
}
