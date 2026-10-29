/*
 * The album faces flat, at print size × k, straight from src/book/content (no engine): every postcard's picture side and its
 * 郵便はがき message side, and every colour card. The content's fonts (`ready`) and pictures are awaited first.
 *   ?what=postcards|cards   (default postcards)   &sample=zh   &k=5 (px per mm)
 *   ?what=sides&album=cards|postcards&rows=4   every side of the album as the engine lays it out, with any number of rows
 *   ?what=sides&album=cards&preset=idCard2x4    the same on one of the engine's presets
 * window.__ready once painted; window.__stats.rb lists max(R − B) of each card's stock (cool stock: ≤ 4).
 */
import type { BookLayout } from "../../src/book/layout";
import { createCardContent, createPostcardContent, type PaintEnv, type SlotCell } from "../../src/book/content";
import { profile as sampleEn } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: Record<string, unknown>;
  }
}

const q = new URLSearchParams(location.search);
const sample = q.get("sample") === "zh" ? sampleZh : sampleEn;
// a Chinese page, as the app marks it (src/fonts registers the 500 sans file for Chinese pages only)
if (sample.lang) document.documentElement.lang = sample.lang;
const what = q.get("what") ?? "postcards";
const k = Number(q.get("k") ?? 5);
const dpr = window.devicePixelRatio || 1;

const images = new Map<string, HTMLImageElement>();
async function load(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode().catch(() => {});
  images.set(src, img);
}
const env: PaintEnv = { layout: {} as BookLayout, pxPerMm: k * dpr, font: "sans-serif", image: (src) => images.get(src) ?? null };

const gap = 8;
if (what === "sides") {
  // ?what=sides&album=cards|postcards&rows=4: every side of an album as the engine paints it (scene.ts paintSide: the layout's
  // pockets, the item's face each side shows, mirrored backs), on the album's preset with its rows set to `rows` — the painters
  // know no row count. Pocket outlines only, no film.
  const album = q.get("album") === "postcards" ? "postcards" : "cards";
  const L = await import("../../src/book/layout");
  // &preset=idCard2x4: the engine's preset as it is; otherwise the album's first preset with `rows` rows
  const preset = q.get("preset") as keyof typeof L.LAYOUTS | null;
  const base = L.LAYOUTS[preset && preset in L.LAYOUTS ? preset : album === "postcards" ? "postcard2x2" : "idCard2x3"];
  const rows = Number(q.get("rows") ?? base.rows);
  const layout = L.resolveLayout(rows === base.rows ? base : { ...base, id: `${base.id}-rows${rows}`, rows });
  const items = album === "postcards" ? sample.albums.postcards : sample.albums.cards;
  if (album === "postcards") await Promise.all(sample.albums.postcards.map((p) => (p.src ? load(p.src) : Promise.resolve())));
  const content = album === "postcards" ? createPostcardContent(sample.albums.postcards, layout) : createCardContent(sample.albums.cards, layout);
  await content.ready;
  const sides = layout.pageCount(items.length);
  const sk = Math.min(k, 3);
  const c = document.createElement("canvas");
  c.width = Math.round((sides * (layout.pageW + gap) + gap) * sk * dpr);
  c.height = Math.round((layout.pageH + 2 * gap) * sk * dpr);
  c.style.width = `${c.width / dpr}px`;
  document.body.appendChild(c);
  const g = c.getContext("2d")!;
  g.scale(sk * dpr, sk * dpr);
  const e: PaintEnv = { ...env, layout, pxPerMm: sk * dpr };
  const filled: number[] = [];
  for (let side = 0; side < sides; side++) {
    const mirrored = side % 2 === 1;
    const face = layout.faceOf(side);
    g.save();
    g.translate(gap + side * (layout.pageW + gap), gap);
    g.fillStyle = "#f3f6f7";
    g.fillRect(0, 0, layout.pageW, layout.pageH);
    let n = 0;
    for (let slot = 0; slot < layout.perSide; slot++) {
      const p = layout.pocketRect(slot, mirrored);
      g.strokeStyle = "rgba(28,35,43,0.25)";
      g.lineWidth = 0.3;
      g.strokeRect(p.x, p.y, p.w, p.h);
      const index = layout.itemIndex(side, slot, items.length);
      if (index < 0) continue;
      const at = layout.itemRect(slot, mirrored, index + 1, face === "back");
      g.save();
      content.paintSlot(g, { side, slot, index, face, mirrored, pocket: p, place: { ...at, r: layout.item.r }, seed: index + 1 }, e);
      g.restore();
      n++;
    }
    g.restore();
    filled.push(n);
  }
  window.__stats = { album, rows, sides, perSide: layout.perSide, filled, pageW: layout.pageW, pageH: layout.pageH };
} else if (what === "cards") {
  const cards = sample.albums.cards;
  const content = createCardContent(cards);
  await content.ready;
  const W = 85.6, H = 54, cols = 3;
  const rows = Math.ceil(cards.length / cols);
  const c = document.createElement("canvas");
  c.width = Math.round((cols * (W + gap) + gap) * k * dpr);
  c.height = Math.round((rows * (H + gap) + gap) * k * dpr);
  c.style.width = `${c.width / dpr}px`;
  document.body.appendChild(c);
  const g = c.getContext("2d")!;
  g.scale(k * dpr, k * dpr);
  cards.forEach((_, i) => {
    g.save();
    g.translate(gap + (i % cols) * (W + gap), gap + Math.floor(i / cols) * (H + gap));
    const cell: SlotCell = { side: 0, slot: i, index: i, face: "front", mirrored: false, pocket: { x: 0, y: 0, w: W, h: H }, place: { x: 0, y: 0, w: W, h: H, tilt: 0, r: 3 }, seed: i + 1 };
    content.paintSlot(g, cell, env);
    g.restore();
  });
  window.__stats = { cards: cards.length };
} else {
  const cards = sample.albums.postcards;
  await Promise.all(cards.map((p) => (p.src ? load(p.src) : Promise.resolve())));
  const content = createPostcardContent(cards);
  await content.ready;
  const W = 148, H = 105;
  const c = document.createElement("canvas");
  c.width = Math.round((2 * (W + gap) + gap) * k * dpr);
  c.height = Math.round((cards.length * (H + gap) + gap) * k * dpr);
  c.style.width = `${c.width / dpr}px`;
  document.body.appendChild(c);
  const g = c.getContext("2d")!;
  g.scale(k * dpr, k * dpr);
  const rb: number[] = [];
  cards.forEach((_, i) => {
    for (const [col, face] of [[0, "front"], [1, "back"]] as const) {
      g.save();
      g.translate(gap + col * (W + gap), gap + i * (H + gap));
      const cell: SlotCell = { side: col, slot: i, index: i, face, mirrored: false, pocket: { x: 0, y: 0, w: W, h: H }, place: { x: 0, y: 0, w: W, h: H, tilt: 0, r: 0.8 }, seed: i + 1 };
      content.paintSlot(g, cell, env);
      g.restore();
    }
    // the stock: a strip of the front's border
    const px = g.getImageData(Math.round((gap + 1) * k * dpr), Math.round((gap + i * (H + gap) + 50) * k * dpr), 1, 1).data;
    rb.push(px[0]! - px[2]!);
  });
  window.__stats = { postcards: cards.length, rb };
}
window.__ready = true;
