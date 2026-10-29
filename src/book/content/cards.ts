import { hanLangOf, type FontRun } from "../../fonts";
import type { AlbumCard } from "../../profile/schema";
import type { LayoutPreset, LayoutSpec } from "../layout";
import { createPocketGrid, type ContentSource, type PaintEnv, type SlotCell } from "./grid";
import { BLACK, WHITE, css, grainPattern, luma, mix, printFont, rgbOf, roundRectPath, track } from "./paint";

/*
 * The card album's faces. A card with a picture (src) shows the picture; one without is a colour card (色見本): a soft field of its
 * colour with a sheen, its name printed at the bottom left — the romaji and the kanji (nameLocal) in Shippori Mincho, 1.2 mm apart,
 * in sumi (or a cool white on a dark colour) — and a tiny index top right in Zen Kaku. No logos, no invented marks, no bold.
 * 和色 names are Japanese: their kanji are set in the Japanese faces whatever the profile's language.
 */

const LABEL_MM = 4;
const INDEX_MM = 1.6;

/** The strings the faces print. */
function cardRuns(cards: readonly AlbumCard[]): FontRun[] {
  const latin = cards.map((c) => c.label || c.id).join(" ");
  const local = cards.map((c) => c.nameLocal ?? "").join("");
  const runs: FontRun[] = [{ role: "serif", weight: 400, text: latin, han: hanLangOf(latin) }, { role: "sans", weight: 500, text: "0123456789", han: "ja" }];
  if (local) runs.push({ role: "serif", weight: 400, text: local, han: "ja" });
  return runs;
}

/** `layout`: any pocket grid of CR80 cards (the faces are painted per pocket, whatever the rows); default the tall album's 2 × 4. */
export function createCardContent(cards: readonly AlbumCard[], layout: LayoutPreset | LayoutSpec = "idCard2x4"): ContentSource {
  return createPocketGrid({ items: cards, paint: paintAlbumCard, layout, fonts: cardRuns(cards) });
}

export function paintAlbumCard(ctx: CanvasRenderingContext2D, card: AlbumCard, cell: SlotCell, env: PaintEnv) {
  const { place: r } = cell;
  const k = env.pxPerMm;
  const img = card.src ? env.image(card.src) : null;
  const base = rgbOf(card.color);
  const w = r.w;
  const h = r.h;
  ctx.save();
  ctx.translate(r.x + w / 2, r.y + h / 2);
  ctx.rotate(r.tilt);
  ctx.translate(-w / 2, -h / 2);
  // the card's own soft shadow in the pocket (it has a thickness)
  ctx.save();
  ctx.shadowColor = "rgba(21,35,58,0.28)";
  ctx.shadowBlur = 1.2 * k;
  ctx.shadowOffsetY = 0.25 * k;
  roundRectPath(ctx, 0, 0, w, h, r.r);
  ctx.fillStyle = css(base);
  ctx.fill();
  ctx.restore();
  roundRectPath(ctx, 0, 0, w, h, r.r);
  ctx.save();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    // soft gradient from the colour: lighter up-left, a touch deeper down-right
    const g = ctx.createLinearGradient(0, 0, w * 0.7, h * 1.2);
    g.addColorStop(0, css(mix(base, WHITE, 0.34)));
    g.addColorStop(0.55, css(base));
    g.addColorStop(1, css(mix(base, BLACK, 0.1)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // a broad sheen across the upper half
    const s = ctx.createRadialGradient(w * 0.22, -h * 0.25, 0, w * 0.22, -h * 0.25, w * 0.9);
    s.addColorStop(0, "rgba(255,255,255,0.32)");
    s.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    const dark = luma(base) < 0.3;
    const ink = dark ? "rgba(244,246,247,0.9)" : "rgba(28,35,43,0.6)";
    // the index, top right: Zen Kaku, small, tracked
    ctx.font = printFont("sans", 500, INDEX_MM, "ja");
    track(ctx, INDEX_MM * 0.14);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ink;
    ctx.fillText(String(cell.index + 1).padStart(2, "0"), w - 4.6, 6.6);
    ctx.textAlign = "left";
    track(ctx, 0);
    // the name, bottom left: the romaji, then the kanji 1.2 mm after it (both Mincho 400, 4 mm)
    const label = card.label || card.id;
    const x = 5;
    const y = h - 5.4;
    ctx.font = printFont("serif", 400, LABEL_MM, hanLangOf(label));
    track(ctx, LABEL_MM * 0.01);
    ctx.fillText(label, x, y);
    const lw = ctx.measureText(label).width;
    if (card.nameLocal && card.nameLocal !== label) {
      ctx.font = printFont("serif", 400, LABEL_MM, "ja");
      track(ctx, LABEL_MM * 0.06);
      ctx.fillText(card.nameLocal, x + lw + 1.2, y);
    }
    track(ctx, 0);
  }
  ctx.restore();
  // the cut edge: a hairline of light
  ctx.lineWidth = 0.18;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  roundRectPath(ctx, 0.09, 0.09, w - 0.18, h - 0.18, r.r - 0.09);
  ctx.stroke();
  ctx.restore();
}
