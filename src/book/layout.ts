/*
 * The album's layout (in mm) and page arithmetic: shared by the 3D scene, the texture compositing and the flat fallback; no three.
 *
 * A sheet has pockets on both sides: each side holds 2 columns × 3 rows of cards lying landscape (ID-1, 85.6 × 54), with a punched
 * margin left on the spine side.
 * Sides are numbered in reading order: sheet i's front is 2i, its back 2i + 1; the cards fill each side's pockets in turn (each side
 * from the top left, row by row).
 * Desktop shows one spread at a time: spread k has sheet k − 1's back on the left (the inside of the front cover when k = 0) and
 * sheet k's front on the right (the inside of the back cover when k = S).
 * A narrow screen shows one side at a time: side m (even m on the right, odd on the left) lies in spread ⌈m / 2⌉.
 */

export const CARD_W = 85.6;
export const CARD_H = 54;
/** ID-1 card corner radius: 3.18 mm */
export const CARD_R = 3.18;
export const COLS = 2;
export const ROWS = 3;
export const PER_SIDE = COLS * ROWS;
export const PER_SHEET = PER_SIDE * 2;

/** Pocket inner size: a little larger than the card all round, so a small gap shows around the card inside */
export const POCKET_W = 89.4;
export const POCKET_H = 57.6;
/** Width of the heat-sealed seam between pockets */
export const SEAM = 3.4;
/** Page margins: spine is the punched side */
export const MARGIN = { spine: 22, outer: 5.6, top: 6.4, bottom: 6.4 } as const;
export const PAGE_W = MARGIN.spine + COLS * POCKET_W + (COLS - 1) * SEAM + MARGIN.outer;
export const PAGE_H = MARGIN.top + ROWS * POCKET_H + (ROWS - 1) * SEAM + MARGIN.bottom;

/** Hole centre's distance from the (spine-side) page edge, hole radius */
export const HOLE_X = 9.2;
export const HOLE_R = 3.1;
/**
 * Metal rings: radius from ring centre to wire centre, wire radius; the sheets' holes hang on the rings, so the page edge is
 * RING_R − HOLE_X from the axis
 */
export const RING_R = 14;
export const RING_WIRE = 1.55;
/** Vertical positions of the rings (and so of the holes): relative to the page's centre line, up positive */
export const RINGS = [-81, -27, 27, 81] as const;
/** Distance from the (spine-side) page edge to the axis */
export const HINGE = RING_R - HOLE_X;

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where pocket `slot` of a side lies (mm, in the side's "as seen" orientation: x left to right, y top to bottom).
 * mirrored: the side is on the left (a sheet's back), the punched edge on the right
 */
export function pocketRect(slot: number, mirrored: boolean): Rect {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  const left = mirrored ? MARGIN.outer : MARGIN.spine;
  return { x: left + col * (POCKET_W + SEAM), y: MARGIN.top + row * (POCKET_H + SEAM), w: POCKET_W, h: POCKET_H };
}

/**
 * Where the card lies in its pocket: centred, slightly off (in a real pocket a card never sits exactly centred), the offset fixed by
 * the card's index
 */
export function cardRect(slot: number, mirrored: boolean, seed: number): Rect & { tilt: number } {
  const p = pocketRect(slot, mirrored);
  const r = hash(seed);
  const dx = (r - 0.5) * 1.4;
  const dy = (hash(seed + 7.13) - 0.6) * 1.6;
  return { x: p.x + (p.w - CARD_W) / 2 + dx, y: p.y + (p.h - CARD_H) / 2 + dy, w: CARD_W, h: CARD_H, tilt: (hash(seed + 3.7) - 0.5) * 0.006 };
}

/** Which pocket a point on this side (mm, as seen) falls in; −1 when it is in none */
export function slotAt(x: number, y: number, mirrored: boolean): number {
  for (let s = 0; s < PER_SIDE; s++) {
    const r = pocketRect(s, mirrored);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return s;
  }
  return -1;
}

/** Number of sheets: at least one */
export function sheetCount(cards: number) {
  return Math.max(1, Math.ceil(cards / PER_SHEET));
}

/** Page count on a narrow screen: only the sides that hold cards, at least one */
export function pageCount(cards: number) {
  return Math.max(1, Math.ceil(cards / PER_SIDE));
}

/** The left and right sides of spread k (side indices; −1 is the inside of the front / back cover) */
export function spreadSides(k: number, sheets: number): [left: number, right: number] {
  return [k === 0 ? -1 : 2 * (k - 1) + 1, k >= sheets ? -1 : 2 * k];
}

/** The spread that holds side m on a narrow screen */
export function spreadOfPage(m: number) {
  return Math.ceil(m / 2);
}

/** The card (index) in a given pocket of a given side, −1 if there is none */
export function cardIndex(side: number, slot: number, cards: number) {
  if (side < 0 || slot < 0) return -1;
  const i = side * PER_SIDE + slot;
  return i < cards ? i : -1;
}

/** Deterministic pseudo-random number in 0–1 */
export function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ── sasshi: pocket-grid layouts ───────────────────────────────────────────────────────────────────────────────────────────
 * The engine's sheet keeps one topology: inner column → soft seam hinge → outer column (sheet.ts, physics.ts), two columns, any rows.
 * A LayoutSpec gives the sizes (mm); resolveLayout turns it into a BookLayout with the page maths as methods. The named constants and
 * functions above stay the card binder's (idCard2x3) and are what the original tests check; the preset is built from them, so the
 * two are value-for-value equal (layout.test.ts checks it).
 */

/** A pocket grid, mm. Two columns of `rows` pockets per side, punched along the spine side. */
export type LayoutSpec = {
  id: string;
  rows: number;
  /** The nominal item: size and corner radius (mm). Placement in the pocket and the bump in the shared normal map follow it. */
  item: { w: number; h: number; r: number };
  /** One item (kg): the physics load of a filled pocket. */
  itemMass: number;
  pocket: { w: number; h: number };
  /** Heat-sealed seam between pockets (mm). */
  seam: number;
  margin: { spine: number; outer: number; top: number; bottom: number };
  /** Hole centre from the spine-side edge, hole radius (mm). */
  hole: { x: number; r: number };
  /** Ring (and hole) centres along the page height, mm from the page's middle, up positive. */
  rings: readonly number[];
  /** Ring centre to wire centre, wire radius (mm). */
  ring: { r: number; wire: number };
  /**
   * One item per pocket, seen from both sides: its front through the front film, its back through the back film (postcards).
   * Otherwise each side has its own items back to back (cards).
   */
  doubleSided: boolean;
  /** Side texture width (px) on [desktop, phone], and how many spreads either side of the current one keep their textures. */
  texture: { width: readonly [number, number]; window: number };
};

/**
 * idCard2x3 / postcard2x2: the first albums (kept for compatibility). idCard2x4 / postcard2x3 (brief r3 D3): the tall pages — an open
 * spread of the old grids is so wide (aspect ≈ 2.25 and ≈ 2.95) that on a desk it is width-limited and small; a fourth card row and a
 * third postcard row bring the spread to ≈ 1.8 and ≈ 2.0, real A5-ish card and B4-ish postcard album pages.
 */
export type LayoutPreset = "idCard2x3" | "postcard2x2" | "idCard2x4" | "postcard2x3";

/** Postcards: A6 (148 × 105 mm) landscape pockets, with the card binder's clearances, seams and margins. */
const PC = { w: 148, h: 105 };
const PC_POCKET = { w: PC.w + (POCKET_W - CARD_W), h: PC.h + (POCKET_H - CARD_H) };
const PC_PAGE_H = MARGIN.top + 2 * PC_POCKET.h + SEAM + MARGIN.bottom;
/** Page height (mm) of `rows` pockets `h` tall with the card binder's seams and margins */
const pageHOf = (rows: number, h: number) => MARGIN.top + rows * h + (rows - 1) * SEAM + MARGIN.bottom;
/** Rings re-spaced for a page height: four, the outer ones as far in from the edges as on the card binder (15.2 mm), evenly between. */
function ringsFor(pageH: number): number[] {
  const out = pageH / 2 - (PAGE_H / 2 - RINGS[3]);
  return [-out, -out / 3, out / 3, out].map((y) => Math.round(y * 10) / 10);
}

export const LAYOUTS: Record<LayoutPreset, LayoutSpec> = {
  idCard2x3: {
    id: "idCard2x3",
    rows: ROWS,
    item: { w: CARD_W, h: CARD_H, r: CARD_R },
    itemMass: 0.00485,
    pocket: { w: POCKET_W, h: POCKET_H },
    seam: SEAM,
    margin: MARGIN,
    hole: { x: HOLE_X, r: HOLE_R },
    rings: RINGS,
    ring: { r: RING_R, wire: RING_WIRE },
    doubleSided: false,
    texture: { width: [1280, 1024], window: 2 },
  },
  postcard2x2: {
    id: "postcard2x2",
    rows: 2,
    item: { w: PC.w, h: PC.h, r: 0.8 },
    // 300 g/m² board, 148 × 105 mm
    itemMass: 0.00466,
    pocket: PC_POCKET,
    seam: SEAM,
    margin: MARGIN,
    hole: { x: HOLE_X, r: HOLE_R },
    rings: ringsFor(PC_PAGE_H),
    ring: { r: RING_R, wire: RING_WIRE },
    doubleSided: true,
    // 1920 px over 334.6 mm ≈ 5.7 px/mm (the card binder: 6.1); a narrower window (±1 spread) keeps the memory near the card binder's
    texture: { width: [1920, 1280], window: 1 },
  },
  /** The card binder with a fourth row: 209.8 × 253.4 mm pages, 8 cards a side, 16 a sheet */
  idCard2x4: {
    id: "idCard2x4",
    rows: 4,
    item: { w: CARD_W, h: CARD_H, r: CARD_R },
    itemMass: 0.00485,
    pocket: { w: POCKET_W, h: POCKET_H },
    seam: SEAM,
    margin: MARGIN,
    hole: { x: HOLE_X, r: HOLE_R },
    rings: ringsFor(pageHOf(4, POCKET_H)),
    ring: { r: RING_R, wire: RING_WIRE },
    doubleSided: false,
    // the card binder's px/mm across; the page is a third taller (1280 × 1546 on desks)
    texture: { width: [1280, 1024], window: 2 },
  },
  /** The postcard album with a third row: 334.6 × 345.4 mm pages, 6 postcards a sheet */
  postcard2x3: {
    id: "postcard2x3",
    rows: 3,
    item: { w: PC.w, h: PC.h, r: 0.8 },
    itemMass: 0.00466,
    pocket: PC_POCKET,
    seam: SEAM,
    margin: MARGIN,
    hole: { x: HOLE_X, r: HOLE_R },
    rings: ringsFor(pageHOf(3, PC_POCKET.h)),
    ring: { r: RING_R, wire: RING_WIRE },
    doubleSided: true,
    // postcard2x2's px/mm; ±1 spread (each side texture is 1920 × 1982 on desks)
    texture: { width: [1920, 1280], window: 1 },
  },
};

export type BookLayout = LayoutSpec & {
  /** Short hash of the geometry (shader program cache keys) */
  hash: string;
  cols: 2;
  perSide: number;
  /** Items per sheet: both sides' pockets, or the pockets of one side when double-sided */
  perSheet: number;
  pageW: number;
  pageH: number;
  /** Spine-side page edge to the ring axis (mm) */
  hinge: number;
  pocketRect(slot: number, mirrored: boolean): Rect;
  /** Where an item lies in its pocket (centred, a small fixed jitter by seed); `back`: the far face of a double-sided item, mirrored */
  itemRect(slot: number, mirrored: boolean, seed: number, back?: boolean): Rect & { tilt: number };
  slotAt(x: number, y: number, mirrored: boolean): number;
  sheetCount(items: number): number;
  /** Narrow mode: sides that hold something (at least one) */
  pageCount(items: number): number;
  /** The item (index) in pocket `slot` of `side`, or −1 */
  itemIndex(side: number, slot: number, items: number): number;
  /** Which face of its item a side shows: always "front" unless double-sided (odd sides show backs) */
  faceOf(side: number): "front" | "back";
  /** The same physical pocket seen from the other side of the sheet */
  mirrorSlot(slot: number): number;
  /** Items in the inner / outer column of a sheet, each physical item once (physics load) */
  columnLoad(sheet: number, items: number): [inner: number, outer: number];
};

/** FNV-1a, 32 bit, hex */
function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const resolved = new Map<string, BookLayout>();

export function resolveLayout(spec: LayoutSpec | LayoutPreset = "idCard2x3"): BookLayout {
  const s = typeof spec === "string" ? LAYOUTS[spec] : spec;
  if (!s) throw new Error(`unknown layout ${String(spec)}`);
  const key = JSON.stringify(s);
  const hit = resolved.get(key);
  if (hit) return hit;
  const COLS2 = 2;
  const perSide = COLS2 * s.rows;
  const perSheet = s.doubleSided ? perSide : perSide * 2;
  // same expression order as PAGE_W / PAGE_H above, so the card preset is bit-identical
  const pageW = s.margin.spine + COLS2 * s.pocket.w + (COLS2 - 1) * s.seam + s.margin.outer;
  const pageH = s.margin.top + s.rows * s.pocket.h + (s.rows - 1) * s.seam + s.margin.bottom;
  const pocketRect = (slot: number, mirrored: boolean): Rect => {
    const col = slot % COLS2;
    const row = Math.floor(slot / COLS2);
    const left = mirrored ? s.margin.outer : s.margin.spine;
    return { x: left + col * (s.pocket.w + s.seam), y: s.margin.top + row * (s.pocket.h + s.seam), w: s.pocket.w, h: s.pocket.h };
  };
  const mirrorSlot = (slot: number) => slot ^ 1;
  const itemIndex = (side: number, slot: number, items: number) => {
    if (side < 0 || slot < 0) return -1;
    const i = s.doubleSided ? (side >> 1) * perSide + (side % 2 === 1 ? mirrorSlot(slot) : slot) : side * perSide + slot;
    return i < items ? i : -1;
  };
  const L: BookLayout = {
    ...s,
    hash: fnv(key),
    cols: 2,
    perSide,
    perSheet,
    pageW,
    pageH,
    hinge: s.ring.r - s.hole.x,
    pocketRect,
    itemRect(slot, mirrored, seed, back = false) {
      const p = pocketRect(slot, mirrored);
      const r = hash(seed);
      const dx = (r - 0.5) * 1.4;
      const dy = (hash(seed + 7.13) - 0.6) * 1.6;
      const tilt = (hash(seed + 3.7) - 0.5) * 0.006;
      return { x: p.x + (p.w - s.item.w) / 2 + (back ? -dx : dx), y: p.y + (p.h - s.item.h) / 2 + dy, w: s.item.w, h: s.item.h, tilt: back ? -tilt : tilt };
    },
    slotAt(x, y, mirrored) {
      for (let k = 0; k < perSide; k++) {
        const r = pocketRect(k, mirrored);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return k;
      }
      return -1;
    },
    sheetCount: (items) => Math.max(1, Math.ceil(items / perSheet)),
    pageCount: (items) => (s.doubleSided ? Math.max(1, 2 * Math.ceil(items / perSide)) : Math.max(1, Math.ceil(items / perSide))),
    itemIndex,
    faceOf: (side) => (s.doubleSided && side % 2 === 1 ? "back" : "front"),
    mirrorSlot,
    columnLoad(sheet, items) {
      const has = (side: number, slot: number) => itemIndex(side, slot, items) >= 0;
      let inner = 0;
      let outer = 0;
      for (let row = 0; row < s.rows; row++) {
        if (s.doubleSided) {
          inner += Number(has(2 * sheet, row * 2));
          outer += Number(has(2 * sheet, row * 2 + 1));
        } else {
          inner += Number(has(2 * sheet, row * 2)) + Number(has(2 * sheet + 1, row * 2 + 1));
          outer += Number(has(2 * sheet, row * 2 + 1)) + Number(has(2 * sheet + 1, row * 2));
        }
      }
      return [inner, outer];
    },
  };
  resolved.set(key, L);
  return L;
}
