import { canvasFont, type HanLang } from "../fonts";
import { CARD_H, CARD_R, CARD_W, hash, resolveLayout, type BookLayout, type Rect } from "./layout";

/*
 * The album's flat textures (plain canvas, no three): every side of a sheet with its pockets and card faces, the normal map all sheets
 * share (the bump where a card pushes up the film, the groove of the heat-sealed seams), the grain normals of the cover leather, the
 * liner inside the cover and the foil-stamped album name.
 * The album's own palette is just a few greys (following the theme); the card faces are the only colour.
 */

export type Palette = {
  /** The liner (inside the cover; the backing seen through an empty pocket) */
  liner: string;
  /** Clear PVC over the liner: page margins, empty pockets */
  film: string;
  /** Heat-sealed seams: a little more opaque than the film */
  seam: string;
  /** Highlight of the fine lines: page edges, pocket mouths */
  edge: string;
  /** The dark side of the fine lines */
  shade: string;
  /** Text on the liner */
  ink: string;
};

/**
 * The pocket pages are a physical thing (clear PVC over a light liner): the same colour in the dark theme, only the room is a little
 * darker (the scene's exposure and ambient light)
 */
export const PALETTE: Palette = { liner: "#e5e8eb", film: "#eef1f3", seam: "#f5f6f8", edge: "rgba(255,255,255,0.9)", shade: "rgba(24,31,40,0.16)", ink: "#7d868f" };

/** The card layout: the default of every function below that takes a layout */
const CARD = resolveLayout("idCard2x3");

/** Texture width (px); the height follows the page's proportions */
export function texSize(width: number, L: BookLayout = CARD) {
  return { w: width, h: Math.round((width * L.pageH) / L.pageW) };
}

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A fine-grain noise tile (for tiling): the film and liner are not dead flat colours, and gradients do not band */
let grainTile: HTMLCanvasElement | null = null;
function grain() {
  if (grainTile) return grainTile;
  const n = 128;
  const c = canvas(n, n);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = hash(i * 0.731 + 0.17) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (grainTile = c);
}

export type SideCard = { img: HTMLImageElement | ImageBitmap | null; color: string | null; seed: number } | null;

/**
 * Paints whatever lies in pocket `slot` of a side. ctx is in mm (origin: the side's top-left as seen; x right, y down), k = px per mm.
 * Called between the pocket's film (under) and its haze and lip (over), so the film's sheen and the pocket mouth sit on top of the item.
 */
export type PocketPainter = (ctx: Ctx, slot: number, k: number) => void;

/**
 * One side of a sheet: mirrored is the back (seen on the left, the punched edge on the right). cards are in pocket order, null is an
 * empty pocket; a card whose picture has not arrived yet is painted in its main colour, and painted again once it has.
 * (The card binder's painter over drawPockets.)
 */
export function drawSide(target: HTMLCanvasElement, cards: SideCard[], mirrored: boolean, pal: Palette, L: BookLayout = CARD) {
  drawPockets(target, L, mirrored, pal, (ctx, s, k) => {
    const card = cards[s];
    if (card) paintFlatCard(ctx, L.itemRect(s, mirrored, card.seed), L.item, card.color, card.img, k);
  });
}

/**
 * The card binder's item: a rounded card in its colour, the picture clipped to it, a soft shadow under it (the card has a thickness)
 * and a hairline light edge. `r` is where it lies (mm, with its tilt), `item` its size and corner radius.
 */
export function paintFlatCard(ctx: Ctx, r: Rect & { tilt: number }, item: { w: number; h: number; r: number }, color: string | null, img: CanvasImageSource | null, k: number) {
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(r.tilt);
  // a soft shadow round the card in its pocket (the card has a thickness)
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 1.2 * k;
  ctx.shadowOffsetY = 0.25 * k;
  roundRect(ctx, -item.w / 2, -item.h / 2, item.w, item.h, item.r);
  ctx.fillStyle = color ?? "#888";
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (img) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(img, -item.w / 2, -item.h / 2, item.w, item.h);
    ctx.restore();
  }
  // the card's cut edge: a very fine light line all round
  ctx.lineWidth = 0.18;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  roundRect(ctx, -item.w / 2 + 0.09, -item.h / 2 + 0.09, item.w - 0.18, item.h - 0.18, item.r - 0.09);
  ctx.stroke();
  ctx.restore();
}

/**
 * One side of a sheet in a pocket-grid layout: the film over the liner, the sealed band and seams, the pockets (each: film → `paint` →
 * haze → mouth), the seam texture, the punched holes and the trimmed edge. mirrored: the sheet's back (seen on the left, holes on the right).
 */
export function drawPockets(target: HTMLCanvasElement, L: BookLayout, mirrored: boolean, pal: Palette, paint: PocketPainter | null) {
  for (const step of pocketSteps(target, L, mirrored, pal, paint)) step();
}

/**
 * sasshi (round 4, E1): drawPockets as steps — the chrome, then one step a pocket (its painter), then the seams, holes and edge —
 * to be run in order, all on `target` (nothing else may draw on it in between). A host that repaints a side in idle time runs one a
 * task: a painter that takes long (the postcards' handwriting) never holds a frame for a whole side.
 */
export function pocketSteps(target: HTMLCanvasElement, L: BookLayout, mirrored: boolean, pal: Palette, paint: PocketPainter | null): (() => void)[] {
  const { width: w, height: h } = target;
  const ctx = target.getContext("2d")!;
  const k = w / L.pageW;
  const gridX = mirrored ? L.margin.outer : L.margin.spine;
  const gridW = L.cols * L.pocket.w + (L.cols - 1) * L.seam;
  const gridH = L.rows * L.pocket.h + (L.rows - 1) * L.seam;
  const band = 1.6;
  /** Every step starts from the side's own state: mm units, nothing left over from a painter */
  const mm = () => {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
  const steps: (() => void)[] = [];
  steps.push(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // page margins: clear PVC over the liner
    ctx.fillStyle = pal.film;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
    ctx.fillRect(0, 0, w, h);
    mm();
    // seams: a heat-sealed band around and between the pockets, with fine ribbing
    ctx.fillStyle = pal.seam;
    ctx.fillRect(gridX - band, L.margin.top - band, gridW + band * 2, gridH + band * 2);
  });
  for (let s = 0; s < L.perSide; s++)
    steps.push(() => {
      mm();
      const p = L.pocketRect(s, mirrored);
      // empty pocket: the liner between the two films
      ctx.fillStyle = pal.film;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      paint?.(ctx, s, k);
      // the film's haze: a very faint white over the whole pocket
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // pocket mouth: the front film is a little shorter than the back one; its open edge is a light line + a faint shadow below it
      const lip = p.y + 2.2;
      ctx.fillStyle = pal.shade;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(p.x, lip + 0.18, p.w, 0.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.edge;
      ctx.fillRect(p.x, lip - 0.12, p.w, 0.3);
    });
  steps.push(() => {
    mm();
    finishPockets(ctx, L, mirrored, pal, gridX, gridW, gridH, band);
  });
  return steps;
}

function finishPockets(ctx: CanvasRenderingContext2D, L: BookLayout, mirrored: boolean, pal: Palette, gridX: number, gridW: number, gridH: number, band: number) {
  // the seams' ribbing (fine lines left by the embossing die): drawn only on the band between and around the pockets
  ctx.save();
  ctx.beginPath();
  ctx.rect(gridX - band, L.margin.top - band, gridW + band * 2, gridH + band * 2);
  for (let s = 0; s < L.perSide; s++) {
    const p = L.pocketRect(s, mirrored);
    ctx.rect(p.x, p.y, p.w, p.h);
  }
  ctx.clip("evenodd");
  ctx.fillStyle = pal.shade;
  ctx.globalAlpha = 0.22;
  for (let x = gridX - band; x < gridX + gridW + band; x += 0.75) ctx.fillRect(x, 0, 0.22, L.pageH);
  ctx.globalAlpha = 1;
  // the seams' borders: a fine dark line
  ctx.strokeStyle = pal.shade;
  ctx.lineWidth = 0.22;
  for (let s = 0; s < L.perSide; s++) {
    const p = L.pocketRect(s, mirrored);
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }
  ctx.strokeRect(gridX - band, L.margin.top - band, gridW + band * 2, gridH + band * 2);
  ctx.restore();

  // holes: the holes themselves are cut out in the shader; here, the punched light rim round each one
  const hx = mirrored ? L.pageW - L.hole.x : L.hole.x;
  for (const ry of L.rings) {
    const cy = L.pageH / 2 - ry;
    ctx.beginPath();
    ctx.arc(hx, cy, L.hole.r + 0.35, 0, Math.PI * 2);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = pal.edge;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, cy, L.hole.r + 1.2, 0, Math.PI * 2);
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = pal.shade;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // trimmed edge: a fine light line all round
  ctx.strokeStyle = pal.edge;
  ctx.lineWidth = 0.6;
  ctx.strokeRect(0.3, 0.3, L.pageW - 0.6, L.pageH - 0.6);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** A new canvas for a side (no cards on it yet) */
export function sideCanvas(width: number, L: BookLayout = CARD) {
  const { w, h } = texSize(width, L);
  return canvas(w, h);
}

/**
 * The normal map all sheets share (tangent space, RGB): a pocket holding a card bulges slightly, a step at the pocket mouth, a shallow
 * groove pressed in along the seams, a slight bevel at the page edge.
 * Heights first, then blurred and turned into gradients. The back's pockets are in the same place as the front's, so both sides share
 * it (sampled by the mesh's uv, not mirrored)
 */
export function drawSheetNormal(width: number, L: BookLayout = CARD): HTMLCanvasElement {
  const { w, h } = texSize(width, L);
  const k = w / L.pageW;
  const hc = canvas(w, h);
  const ctx = hc.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, w, h);
  ctx.scale(k, k);
  const gridW = L.cols * L.pocket.w + (L.cols - 1) * L.seam;
  const gridH = L.rows * L.pocket.h + (L.rows - 1) * L.seam;
  // the seams pressed down
  ctx.fillStyle = "rgb(96,96,96)";
  ctx.fillRect(L.margin.spine - 1.6, L.margin.top - 1.6, gridW + 3.2, gridH + 3.2);
  for (let s = 0; s < L.perSide; s++) {
    const p = L.pocketRect(s, false);
    ctx.fillStyle = "rgb(140,140,140)";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    // the card lifts the film: higher over the card (the layout's item; every pocket, filled or not — the map is shared by all sheets)
    ctx.fillStyle = "rgb(176,176,176)";
    roundRect(ctx, p.x + (p.w - L.item.w) / 2, p.y + (p.h - L.item.h) / 2, L.item.w, L.item.h, L.item.r);
    ctx.fill();
    // the step at the pocket mouth
    ctx.fillStyle = "rgb(150,150,150)";
    ctx.fillRect(p.x, p.y, p.w, 2.2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const src = ctx.getImageData(0, 0, w, h).data;
  let hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = src[i * 4]! / 255;
  // two box-blur passes, softening the edges a little (about 0.8 mm)
  const rad = Math.max(1, Math.round(0.8 * k));
  hf = boxBlur(boxBlur(hf, w, h, rad), w, h, rad);
  // page-edge bevel: pressed down within 1.2 mm of the edge
  const bevel = 1.2 * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (d < bevel) hf[y * w + x]! -= 0.12 * (1 - d / bevel) ** 2;
    }
  }
  const out = ctx.createImageData(w, h);
  const strength = 2.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hf[y * w + Math.max(0, x - 1)]!;
      const r = hf[y * w + Math.min(w - 1, x + 1)]!;
      const u = hf[Math.max(0, y - 1) * w + x]!;
      const d = hf[Math.min(h - 1, y + 1) * w + x]!;
      // canvas y runs down, texture v runs up: flip the normal's y
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const nz = 1 / len;
      const o = (y * w + x) * 4;
      out.data[o] = (nx * 0.5 + 0.5) * 255;
      out.data[o + 1] = (-ny * 0.5 + 0.5) * 255;
      out.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return hc;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const n = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return dst;
}

/** Normal map of the leather grain (tileable): a few octaves of value noise stacked into irregular fine creases */
export function drawLeatherNormal(n = 256): HTMLCanvasElement {
  const c = canvas(n, n);
  const ctx = c.getContext("2d")!;
  const hf = new Float32Array(n * n);
  const cell = (x: number, y: number, p: number) => hash(((x % p) + p) % p + (((y % p) + p) % p) * 57.3 + p * 13.1);
  const noise = (x: number, y: number, p: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = cell(xi, yi, p);
    const b = cell(xi + 1, yi, p);
    const c2 = cell(xi, yi + 1, p);
    const d = cell(xi + 1, yi + 1, p);
    return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      let amp = 0.5;
      for (const p of [16, 32, 64]) {
        // the grain is a lot of small bumps: take the noise's "ridges"
        const q = noise((x / n) * p, (y / n) * p, p);
        v += amp * (1 - Math.abs(q * 2 - 1));
        amp *= 0.5;
      }
      hf[y * n + x] = v;
    }
  }
  const out = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = hf[y * n + ((x - 1 + n) % n)]!;
      const r = hf[y * n + ((x + 1) % n)]!;
      const u = hf[((y - 1 + n) % n) * n + x]!;
      const d = hf[((y + 1) % n) * n + x]!;
      const nx = (l - r) * 3;
      const ny = (d - u) * 3;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * n + x) * 4;
      out.data[o] = (nx / len / 2 + 0.5) * 255;
      out.data[o + 1] = (-ny / len / 2 + 0.5) * 255;
      out.data[o + 2] = (1 / len / 2 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/**
 * The liner inside the cover (w × h in mm): fine grain. sasshi: with a `slip`, the album's 題簽 — a narrow vertical title slip
 * pasted at the top left (cloth and leather albums only; the binder decides): white stock with its grain, a hairline frame, the
 * booklet's local title set vertically in Mincho, a 藍 disc at its foot. Without one the liner is plain (no lower-left label any more).
 */
export function drawLiner(width: number, wMm: number, hMm: number, liner: string, slip: LinerSlip | null = null): HTMLCanvasElement {
  const k = width / wMm;
  const c = canvas(width, Math.round(hMm * k));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = liner;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
  if (slip?.title.trim()) daisen(ctx, k, slip);
  return c;
}

/** sasshi: the 題簽 slip's title and the Han faces it is set in (src/fonts) */
export type LinerSlip = { title: string; han: HanLang };

/** The slip (mm): 25 × 116 at (22, 22) from the board's top-left (as it lies open), the title from 11 mm, the disc 11 mm from the foot */
const SLIP = { x: 22, y: 22, w: 25, h: 116, size: 10, step: 1.34, head: 11, foot: 11, disc: 1.3 };

/** sasshi: the 題簽's place on the front board's liner (mm from its top-left as it lies open) and size */
export const SLIP_RECT = { x: SLIP.x, y: SLIP.y, w: SLIP.w, h: SLIP.h } as const;

/**
 * sasshi: the 題簽 alone, on a canvas of its own (k px per mm): a frosted album's slip, a card held on the inside of the front
 * board where the cloth and leather liners have it pasted.
 */
export function drawSlip(k: number, slip: LinerSlip): HTMLCanvasElement {
  const c = canvas(Math.round(SLIP.w * k), Math.round(SLIP.h * k));
  daisen(c.getContext("2d")!, k, slip, -SLIP.x, -SLIP.y);
  return c;
}

/** The 題簽: px canvas, mm in (ox, oy: where the liner's origin lies on this canvas, mm) */
function daisen(ctx: Ctx, k: number, slip: LinerSlip, ox = 0, oy = 0) {
  const { w, h } = SLIP;
  const x = SLIP.x + ox;
  const y = SLIP.y + oy;
  const mm = (v: number) => v * k;
  ctx.save();
  // pasted on: a hair of shade under it, down and to the right
  ctx.fillStyle = "rgba(21,35,58,0.10)";
  ctx.fillRect(mm(x + 0.4), mm(y + 0.7), mm(w), mm(h));
  ctx.fillStyle = "#f8f8f5";
  ctx.fillRect(mm(x), mm(y), mm(w), mm(h));
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
  ctx.fillRect(mm(x), mm(y), mm(w), mm(h));
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#1c232b";
  ctx.lineWidth = mm(0.2);
  ctx.strokeRect(mm(x + 2), mm(y + 2), mm(w - 4), mm(h - 4));
  ctx.globalAlpha = 1;
  // the title, one character under the other; a long one is set smaller so it ends above the disc
  const chars = Array.from(slip.title.trim().replace(/\s+/g, ""));
  const room = h - SLIP.head - SLIP.foot - SLIP.disc * 2 - 4;
  const size = Math.min(SLIP.size, room / Math.max(1, (chars.length - 1) * SLIP.step + 1));
  ctx.fillStyle = "#1c232b";
  ctx.font = canvasFont("serif", 500, mm(size), slip.han);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = mm(x + w / 2);
  chars.forEach((ch, i) => {
    const cy = mm(y + SLIP.head + size / 2 + i * size * SLIP.step);
    // the long-vowel mark (and dashes) turn with the column
    if (/[ー—–\-〜～]/.test(ch)) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    } else ctx.fillText(ch, cx, cy);
  });
  ctx.fillStyle = "#2f4f73";
  ctx.beginPath();
  ctx.arc(cx, mm(y + h - SLIP.foot), mm(SLIP.disc), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ── Cover ─────────────────────────────────────────────────────── */

/**
 * Tileable maps of the book cloth (fine linen): returns the colour variation (greyscale, multiplied onto the base colour) and the
 * normals. Two sets of threads, warp and weft, each a little random in thickness and brightness
 */
export function drawClothMaps(n = 256): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const hf = new Float32Array(n * n);
  const threads = 64;
  const cell = n / threads;
  const warp = Array.from({ length: threads }, (_, i) => 0.75 + hash(i * 3.1) * 0.5);
  const weft = Array.from({ length: threads }, (_, i) => 0.75 + hash(i * 7.7 + 1) * 0.5);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const fx = (x % cell) / cell;
      const fy = (y % cell) / cell;
      // plain weave: in neighbouring cells warp and weft take turns lying on top
      const over = (cx + cy) % 2 === 0;
      const vx = Math.sin(fx * Math.PI) * warp[cx]!;
      const vy = Math.sin(fy * Math.PI) * weft[cy]!;
      hf[y * n + x] = over ? 0.55 * vx + 0.25 * vy : 0.25 * vx + 0.55 * vy;
    }
  }
  const albedo = canvas(n, n);
  const actx = albedo.getContext("2d")!;
  const aimg = actx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    // small variation: an even cloth from afar, texture only up close; now and then a thicker yarn (a slub)
    const slub = hash(Math.floor(i / n) * 0.91 + 4.2) > 0.93 ? 8 : 0;
    const v = 226 + hf[i]! * 24 + slub + (hash(i * 0.37) - 0.5) * 8;
    aimg.data[i * 4] = aimg.data[i * 4 + 1] = aimg.data[i * 4 + 2] = Math.max(0, Math.min(255, v));
    aimg.data[i * 4 + 3] = 255;
  }
  actx.putImageData(aimg, 0, 0);
  return { albedo, normal: heightToNormal(hf, n, n, 2.2, true) };
}

/**
 * Height field → tangent-space normal map (wrap: at the edges the neighbours are taken as if tiled). sasshi (round 4, E7): the
 * neighbours by row and column index (no closure, no modulo per pixel) — the serif stamp's map (≈ 2000 × 300 px) took ≈ 40 ms on a
 * loaded machine in a language switch
 */
function heightToNormal(hf: Float32Array, w: number, h: number, strength: number, wrap: boolean) {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const out = ctx.createImageData(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = (y > 0 ? y - 1 : wrap ? h - 1 : 0) * w;
    const down = (y < h - 1 ? y + 1 : wrap ? 0 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : wrap ? w - 1 : 0;
      const xr = x < w - 1 ? x + 1 : wrap ? 0 : w - 1;
      const nx = (hf[row + xl]! - hf[row + xr]!) * strength;
      const ny = (hf[down + x]! - hf[up + x]!) * strength;
      const len = Math.hypot(nx, ny, 1);
      const o = (row + x) * 4;
      d[o] = (nx / len / 2 + 0.5) * 255;
      d[o + 1] = (-ny / len / 2 + 0.5) * 255;
      d[o + 2] = (1 / len / 2 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** sasshi (round 4, E1): runs a painter's steps (a generator that yields between its parts) to the end, in one go */
export function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Default font stack for the cover stamp and liner text (system fonts only); hosts override it through BookOptions.theme.font. */
export const DEFAULT_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", system-ui, sans-serif';

/**
 * The album name foil-stamped on the cover (a wMm × hMm block, aligned bottom left): white type on transparent (the alpha is the
 * mask), with the deboss's normal map.
 * A fine rule above, the name in at most two lines; what does not fit is cut with an ellipsis.
 * sasshi: style "serif" is the booklets' own stamp (serifStamp below: the title in the book serif, Mincho 500 roman, sized to
 * the board); "sans" (default) is the original stamp, unchanged.
 */
export function drawCoverStamp(title: string, wMm: number, hMm: number, pxPerMm = 9, font = DEFAULT_FONT, style: "sans" | "serif" = "sans"): { alpha: HTMLCanvasElement; normal: HTMLCanvasElement } {
  if (style === "serif") return finish(serifStamp(title, wMm, hMm, pxPerMm, font));
  const w = Math.round(wMm * pxPerMm);
  const h = Math.round(hMm * pxPerMm);
  const c = canvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.scale(pxPerMm, pxPerMm);
  const size = 7.2;
  ctx.font = `600 ${size}px ${font}`;
  ctx.textBaseline = "alphabetic";
  const max = wMm - 1;
  // break lines character by character, at most two lines
  const lines: string[] = [];
  let cur = "";
  for (const ch of [...title]) {
    if (ctx.measureText(cur + ch).width > max && cur) {
      lines.push(cur);
      cur = ch.trimStart();
      if (lines.length === 2) break;
    } else cur += ch;
  }
  if (lines.length < 2 && cur) lines.push(cur);
  else if (lines.length === 2 && cur) {
    let last = lines[1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > max) last = last.slice(0, -1);
    lines[1] = `${last}…`;
  }
  const lh = size * 1.3;
  const bottom = hMm - 1.5;
  lines.forEach((l, i) => ctx.fillText(l, 0.4, bottom - (lines.length - 1 - i) * lh));
  // a short rule above the name
  ctx.fillRect(0.4, bottom - (lines.length - 1) * lh - size - 4.2, 9, 0.7);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  // the deboss: the type sits low, its edges a little soft
  let hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = 1 - data[i * 4 + 3]! / 255;
  hf = boxBlur(hf, w, h, Math.max(1, Math.round(pxPerMm * 0.12)));
  return { alpha: c, normal: heightToNormal(hf, w, h, 3, false) };
}

/** sasshi: the size of the serif stamp's title (mm) for a stamp block `blockMm` wide: about 7 % of it, 12–17 mm */
const stampTitleMm = (blockMm: number) => Math.min(17, Math.max(12, blockMm * 0.072));

/**
 * sasshi: how many web-font faces have loaded so far — part of every cache key of baked print (the serif stamp here, the folio
 * liner), so print painted with fallback glyphs before the fonts arrived is never handed out again once they have.
 */
export function loadedFaces() {
  let n = 0;
  if (typeof document !== "undefined" && document.fonts) document.fonts.forEach((f) => void (f.status === "loaded" && n++));
  return n;
}

/**
 * sasshi (round 4, E1): drawCoverStamp in steps (the type and its blur, then the normal map), into the same cache: a host paints a
 * new title ahead in two tasks (binder.ts prepaintSteps) and the build then finds it painted
 */
export function* coverStampSteps(title: string, wMm: number, hMm: number, pxPerMm = 9, font = DEFAULT_FONT, style: "sans" | "serif" = "sans"): Generator<void, { alpha: HTMLCanvasElement; normal: HTMLCanvasElement }> {
  if (style === "serif") return yield* serifStamp(title, wMm, hMm, pxPerMm, font);
  return drawCoverStamp(title, wMm, hMm, pxPerMm, font, style);
}

/** Recent serif stamps (title, size, font, loaded faces → canvases); callers never draw into them */
const stamps: { key: string; out: { alpha: HTMLCanvasElement; normal: HTMLCanvasElement } }[] = [];

/**
 * sasshi: the booklets' stamped title (wMm × hMm, set from the lower-left corner): the title in the book serif (Mincho 500, roman) at
 * stampTitleMm of the block's width (the binder sizes the block to the board), set at its real pixel size; a fine rule above it,
 * a quarter of the title's size long. One line; a title too long for the block is
 * set smaller (never below 60 %), then cut with an ellipsis. White on transparent (the alpha is the foil's mask) and a deboss normal map.
 */
function* serifStamp(title: string, wMm: number, hMm: number, pxPerMm: number, font: string): Generator<void, { alpha: HTMLCanvasElement; normal: HTMLCanvasElement }> {
  const key = JSON.stringify([title, wMm, hMm, pxPerMm, font, loadedFaces()]);
  const hit = stamps.find((s) => s.key === key);
  if (hit) return hit.out;
  const k = pxPerMm;
  const w = Math.round(wMm * k);
  const h = Math.round(hMm * k);
  const c = canvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const base = stampTitleMm(wMm);
  let size = base;
  const setFont = () => {
    ctx.font = `500 ${size * k}px ${font}`;
    (ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${-0.01 * size * k}px`;
  };
  setFont();
  const max = (wMm - 1) * k;
  while (size > base * 0.6 && ctx.measureText(title).width > max) {
    size *= 0.96;
    setFont();
  }
  let line = title;
  while (line.length > 1 && ctx.measureText(line).width > max) line = line.slice(0, -2) + "…";
  const bottom = hMm - 1.2 - size * 0.24; // room for descenders
  ctx.fillText(line, 0.6 * k, bottom * k);
  // the rule: fine, a little above the cap height
  ctx.fillRect(1 * k, (bottom - size * 0.72 - Math.max(4.2, size * 0.36)) * k, Math.max(14, size * 1.3) * k, 0.42 * k);
  const data = ctx.getImageData(0, 0, w, h).data;
  // the deboss: the type sits low, its walls soft
  let hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = 1 - data[i * 4 + 3]! / 255;
  hf = boxBlur(hf, w, h, Math.max(1, Math.round(k * 0.14)));
  yield;
  const out = { alpha: c, normal: heightToNormal(hf, w, h, 3, false) };
  stamps.unshift({ key, out });
  stamps.length = Math.min(stamps.length, 3);
  return out;
}

/**
 * The clear display pocket on the cover (wMm × hMm, the card centred): a heat-sealed border, the film's haze, the card (rounded
 * corners). Transparent outside the pocket
 */
export function drawWindowPocket(img: HTMLImageElement | ImageBitmap | null, color: string | null, wMm: number, hMm: number, pxPerMm = 8): HTMLCanvasElement {
  const c = canvas(Math.round(wMm * pxPerMm), Math.round(hMm * pxPerMm));
  const ctx = c.getContext("2d")!;
  ctx.scale(pxPerMm, pxPerMm);
  // the pocket: a very faint white film + a pressed border
  roundRect(ctx, 0.3, 0.3, wMm - 0.6, hMm - 0.6, 3.2);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.stroke();
  roundRect(ctx, 1.4, 1.4, wMm - 2.8, hMm - 2.8, 2.4);
  ctx.lineWidth = 0.2;
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.stroke();
  const x = (wMm - CARD_W) / 2;
  const y = (hMm - CARD_H) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 1.2 * pxPerMm;
  ctx.shadowOffsetY = 0.3 * pxPerMm;
  roundRect(ctx, x, y, CARD_W, CARD_H, CARD_R);
  ctx.fillStyle = color ?? "#888";
  ctx.fill();
  ctx.restore();
  if (img) {
    ctx.save();
    roundRect(ctx, x, y, CARD_W, CARD_H, CARD_R);
    ctx.clip();
    ctx.drawImage(img, x, y, CARD_W, CARD_H);
    ctx.restore();
  }
  // the film's haze
  roundRect(ctx, 1.4, 1.4, wMm - 2.8, hMm - 2.8, 2.4);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  return c;
}
