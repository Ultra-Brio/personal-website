import { hanLangOf, type FontRun, type HanLang, type Role } from "../../fonts";
import { wrapUnits } from "../../print/kinsoku";
import type { Postcard } from "../../profile/schema";
import type { LayoutPreset, LayoutSpec } from "../layout";
import { createPocketGrid, type ContentSource, type PaintEnv, type SlotCell } from "./grid";
import { BLACK, WHITE, css, drawCover, grainPattern, hueShift, mix, printFont, rand, rgbOf, roundRectPath, tone, track, type RGB } from "./paint";

/*
 * The postcard album's faces (layout postcard2x3 by default, double-sided): one postcard per pocket, its picture through the front film and its
 * message side through the back film of the same sheet.
 * Picture side: the photo (src) on a 4 mm border of the card's cool white stock, or a procedural landscape tinted by the card's
 * colour (sky, sun, three ranges of hills in aerial perspective). No lettering on the picture.
 * Message side, a Japanese 郵便はがき (148 × 105 mm, sizes below in mm of that card): the header in Shippori Mincho 600 藍, tracked
 * wide; the message by hand (Klee One; LXGW WenKai for Chinese) at 5.6 mm on a 10 mm leading, signed; a faint 藍 divider at 55 % of
 * the width; a stamp cut from the same photo with a perforated edge; a round postmark (the place and the date, double ring, sumi)
 * across the stamp's corner; four 藍 address lines; and the photo credit, small, at the foot.
 */

export type PostcardItem = Postcard & { date?: string };

/** The postcard's printed header (the format's own name, so it is Japanese in every language). */
const HEADER = "郵便はがき";

/** The strings the faces print. */
function postcardRuns(cards: readonly PostcardItem[]): FontRun[] {
  const runs: FontRun[] = [{ role: "serif", weight: 600, text: HEADER, han: "ja" }];
  const by = new Map<string, FontRun>();
  const add = (role: Role, weight: number, text: string | undefined) => {
    if (!text?.trim()) return;
    const han = hanLangOf(text);
    const k = `${role}${weight}${han}`;
    const r = by.get(k);
    if (r) r.text += text;
    else by.set(k, { role, weight, text, han });
  };
  for (const c of cards) {
    add("hand", 600, `${c.message}${signature(c)}`);
    add("sans", 500, `${postmarkPlace(c)}${postmarkDate(c.date) ?? ""}`);
    add("sans", 400, c.credit);
  }
  return [...runs, ...by.values()];
}

/** `layout`: any double-sided grid of A6 landscape pockets (the faces are painted per pocket, whatever the rows); default 2 × 3. */
export function createPostcardContent(postcards: readonly PostcardItem[], layout: LayoutPreset | LayoutSpec = "postcard2x3"): ContentSource {
  return createPocketGrid({
    items: postcards,
    layout,
    paint: paintPostcard,
    sources: (p, face) => (p.src ? [p.src] : []),
    fonts: postcardRuns(postcards),
  });
}

const STOCK: RGB = [242, 244, 242];
const INK: RGB = [28, 35, 43];
const AI: RGB = [47, 79, 115];
const PEN = "#24324a";

export function paintPostcard(ctx: CanvasRenderingContext2D, card: PostcardItem, cell: SlotCell, env: PaintEnv) {
  const { place: r } = cell;
  const k = env.pxPerMm;
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(r.tilt);
  ctx.translate(-r.w / 2, -r.h / 2);
  // the board's shadow in the pocket
  ctx.save();
  ctx.shadowColor = "rgba(21,35,58,0.26)";
  ctx.shadowBlur = 1.3 * k;
  ctx.shadowOffsetY = 0.28 * k;
  roundRectPath(ctx, 0, 0, r.w, r.h, r.r);
  ctx.fillStyle = css(STOCK);
  ctx.fill();
  ctx.restore();
  roundRectPath(ctx, 0, 0, r.w, r.h, r.r);
  ctx.save();
  ctx.clip();
  if (cell.face === "front") pictureSide(ctx, card, cell, env, r.w, r.h);
  else messageSide(ctx, card, cell, env, r.w, r.h);
  // paper grain over everything printed
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = grainPattern(ctx);
  ctx.fillRect(0, 0, r.w, r.h);
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.lineWidth = 0.16;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  roundRectPath(ctx, 0.08, 0.08, r.w - 0.16, r.h - 0.16, Math.max(0, r.r - 0.08));
  ctx.stroke();
  ctx.restore();
}

/* ── picture side ───────────────────────────────────────────────── */

function pictureSide(ctx: CanvasRenderingContext2D, card: PostcardItem, cell: SlotCell, env: PaintEnv, w: number, h: number) {
  ctx.fillStyle = css(STOCK);
  ctx.fillRect(0, 0, w, h);
  const b = 4 * (w / 148);
  const pw = w - 2 * b;
  const ph = h - 2 * b;
  const img = card.src ? env.image(card.src) : null;
  ctx.save();
  ctx.translate(b, b);
  ctx.beginPath();
  ctx.rect(0, 0, pw, ph);
  ctx.clip();
  if (img) drawCover(ctx, img, 0, 0, pw, ph);
  else landscape(ctx, rgbOf(card.color), cell.seed, pw, ph);
  ctx.restore();
  // a hairline where the print meets the border
  ctx.strokeStyle = "rgba(21,35,58,0.12)";
  ctx.lineWidth = 0.12;
  ctx.strokeRect(b, b, pw, ph);
}

/** A tinted landscape in the picture area (pw × ph mm): sky, sun, three ranges of hills fading with distance */
export function landscape(ctx: CanvasRenderingContext2D, tint: RGB, seed: number, pw: number, ph: number) {
  // the album palette is pale: print it like a view card — richer, a little warmer at the horizon
  const base = tone(tint, 1.5, 0.64);
  const sky0 = tone(hueShift(base, -28), 1, 0.74);
  const sky1 = mix(tone(hueShift(base, 14), 1.2, 0.86), WHITE, 0.3);
  const horizon = ph * (0.5 + rand(seed * 3.3) * 0.12);
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, css(sky0));
  sky.addColorStop(1, css(sky1));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, pw, ph);
  // sun with a soft glow
  const sx = pw * (0.55 + rand(seed * 5.1) * 0.3);
  const sy = horizon * (0.42 + rand(seed * 1.9) * 0.2);
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, pw * 0.32);
  glow.addColorStop(0, "rgba(250,252,255,0.75)");
  glow.addColorStop(1, "rgba(250,252,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, pw, ph);
  ctx.fillStyle = "rgba(252,253,255,0.92)";
  ctx.beginPath();
  ctx.arc(sx, sy, ph * 0.085, 0, Math.PI * 2);
  ctx.fill();
  // a few thin cloud bands
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 3; i++) {
    const cy = horizon * (0.18 + 0.2 * i + rand(seed + i * 9.7) * 0.08);
    const cx = pw * rand(seed * 2.7 + i);
    ctx.beginPath();
    ctx.ellipse(cx, cy, pw * (0.12 + rand(seed + i) * 0.1), 0.9 + rand(seed * 7 + i) * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // three ranges: far (pale, hazy) → near (deep)
  const deep = mix(hueShift(base, 22), BLACK, 0.5);
  for (let layer = 0; layer < 3; layer++) {
    const t = layer / 2;
    const col = mix(mix(base, sky1, 0.5 - 0.45 * t), deep, 0.08 + 0.55 * t);
    const top = horizon - ph * (0.2 - 0.08 * layer) + layer * ph * 0.1;
    const amp = ph * (0.11 - 0.025 * layer);
    const f1 = 1.4 + rand(seed * 11 + layer) * 1.6;
    const f2 = 3.1 + rand(seed * 13 + layer) * 3;
    const p1 = rand(seed * 17 + layer) * 6.28;
    const p2 = rand(seed * 19 + layer) * 6.28;
    ctx.beginPath();
    ctx.moveTo(0, ph);
    for (let x = 0; x <= pw + 0.5; x += 0.8) {
      const u = x / pw;
      const y = top - amp * (0.6 * Math.sin(u * f1 * Math.PI + p1) + 0.3 * Math.sin(u * f2 * Math.PI + p2) + 0.1 * Math.sin(u * 23 + p1 * 3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pw, ph);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top - amp, 0, ph);
    g.addColorStop(0, css(col));
    g.addColorStop(1, css(mix(col, deep, 0.35)));
    ctx.fillStyle = g;
    ctx.fill();
  }
  // a morning haze low over the valley, and a gentle vignette
  const haze = ctx.createLinearGradient(0, horizon - ph * 0.1, 0, horizon + ph * 0.2);
  haze.addColorStop(0, "rgba(240,245,250,0)");
  haze.addColorStop(0.5, "rgba(240,245,250,0.18)");
  haze.addColorStop(1, "rgba(240,245,250,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, pw, ph);
  // printed with a limited set of inks: one cool wash ties every card together
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(226,232,238,0.5)";
  ctx.fillRect(0, 0, pw, ph);
  ctx.globalCompositeOperation = "source-over";
  const v = ctx.createRadialGradient(pw / 2, ph / 2, ph * 0.3, pw / 2, ph / 2, pw * 0.7);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(21,35,58,0.16)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, pw, ph);
}

/* ── message side: 郵便はがき ─────────────────────────────────────── */

/** The postmark's place: the card's own name for the place (romanised for Latin text; places are never set in capitals). */
function postmarkPlace(card: PostcardItem): string {
  return (card.label || card.place.split(/[,，]/)[0] || "").trim();
}
/** "— Lin", or "—— 林" under a Chinese message. */
function signature(card: PostcardItem): string {
  return /\p{Script=Han}/u.test(card.message) && hanLangOf(card.message) !== "ja" ? `—— ${card.from}` : `— ${card.from}`;
}
/** YY.MM.DD */
function postmarkDate(date: string | undefined): string | undefined {
  const m = date && /^(\d{2})(\d{2})-(\d{1,2})-(\d{1,2})/.exec(date);
  return m ? `${m[2]}.${m[3]!.padStart(2, "0")}.${m[4]!.padStart(2, "0")}` : undefined;
}

function font(ctx: CanvasRenderingContext2D, role: Role, weight: number, size: number, text: string, han?: HanLang) {
  ctx.font = printFont(role, weight, size, han ?? hanLangOf(text));
}

function messageSide(ctx: CanvasRenderingContext2D, card: PostcardItem, cell: SlotCell, env: PaintEnv, w: number, h: number) {
  ctx.fillStyle = css(STOCK);
  ctx.fillRect(0, 0, w, h);
  // every size below is in mm of a 148 × 105 card
  const u = w / 148;
  ctx.save();
  ctx.scale(u, u);
  const W = 148;
  const H = h / u;
  // the header: 郵便はがき, Mincho 600 in 藍, tracked .5 em, at (10, 8)
  const hs = 4.2;
  font(ctx, "serif", 600, hs, HEADER, "ja");
  track(ctx, hs * 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = css(AI);
  ctx.fillText(HEADER, 10, 8 + hs * 0.88);
  track(ctx, 0);
  // the divider at 55 %
  const dx = W * 0.55;
  ctx.fillStyle = css(AI, 0.35);
  ctx.fillRect(dx - 0.1, 20, 0.2, H - 30);

  // the message, by hand, signed
  const size = 5.6;
  const lead = 10;
  const left = 10;
  const maxW = dx - left - 6;
  const measure = (s: string) => {
    font(ctx, "hand", 600, size, s);
    return ctx.measureText(s).width;
  };
  let lines = wrapUnits(card.message.trim(), maxW, measure);
  const maxLines = Math.floor((H - 30) / lead);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/\s*\S{0,2}$/u, "")}…`;
  }
  let y = 30;
  ctx.fillStyle = PEN;
  lines.forEach((line, i) => {
    ctx.save();
    ctx.translate(left + (rand(cell.seed + i * 1.7) - 0.5) * 0.7, y + (rand(cell.seed * 3 + i) - 0.5) * 0.6);
    ctx.rotate((rand(cell.seed * 5 + i) - 0.6) * 0.018);
    font(ctx, "hand", 600, size, line);
    ctx.globalAlpha = 0.92;
    ctx.fillText(line, 0, 0);
    ctx.restore();
    y += lead;
  });
  if (card.from) {
    const sig = signature(card);
    font(ctx, "hand", 600, size, sig);
    const sw = ctx.measureText(sig).width;
    ctx.save();
    ctx.translate(Math.max(left, dx - 6 - sw), Math.min(H - 9, y + 0.6));
    ctx.rotate(-0.025);
    ctx.globalAlpha = 0.92;
    ctx.fillText(sig, 0, 0);
    ctx.restore();
  }

  // four address lines
  ctx.fillStyle = css(AI, 0.28);
  for (let i = 0; i < 4; i++) ctx.fillRect(dx + 7, 52 + i * 10.5, W - dx - 17, 0.2);

  // the stamp, top right, and the postmark over its lower left corner
  const sw = 22;
  const sh = 26;
  const sx = W - 10 - sw;
  const sy = 8;
  stamp(ctx, card, cell, env, sx, sy, sw, sh, u);
  postmark(ctx, card, sx + 1, sy + sh - 2, 11.5, cell.seed);

  // the photo credit, small, at the foot of the message half
  if (card.credit) {
    font(ctx, "sans", 400, 1.7, card.credit);
    track(ctx, 0.12);
    ctx.fillStyle = css(INK, 0.5);
    ctx.fillText(card.credit, 10, H - 5.5);
    track(ctx, 0);
  }
  ctx.restore();
}

/** A stamp with a perforated edge (bites of the card's stock at a 2.1 mm pitch), its field a crop of the same photograph. */
function stamp(ctx: CanvasRenderingContext2D, card: PostcardItem, cell: SlotCell, env: PaintEnv, x: number, y: number, w: number, h: number, u: number) {
  const k = env.pxPerMm * u;
  ctx.save();
  ctx.shadowColor = "rgba(21,35,58,0.16)";
  ctx.shadowBlur = 0.5 * k;
  ctx.shadowOffsetY = 0.12 * k;
  ctx.fillStyle = "#fafbf9";
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = css(STOCK);
  const pr = 0.62;
  const step = 2.1;
  for (let t = step / 2; t < w; t += step) {
    for (const yy of [y, y + h]) {
      ctx.beginPath();
      ctx.arc(x + t, yy, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let t = step / 2; t < h; t += step) {
    for (const xx of [x, x + w]) {
      ctx.beginPath();
      ctx.arc(xx, y + t, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // the printed field: a crop of the picture (its middle, at the stamp's own proportions)
  const m = 2;
  ctx.save();
  ctx.translate(x + m, y + m);
  ctx.beginPath();
  ctx.rect(0, 0, w - 2 * m, h - 2 * m);
  ctx.clip();
  const img = card.src ? env.image(card.src) : null;
  if (img) drawCover(ctx, img, -(w - 2 * m) * 0.35, 0, (w - 2 * m) * 1.7, h - 2 * m);
  else landscape(ctx, rgbOf(card.color), cell.seed, w - 2 * m, h - 2 * m);
  ctx.restore();
  ctx.strokeStyle = "rgba(21,35,58,0.12)";
  ctx.lineWidth = 0.12;
  ctx.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
}

/** A round postmark (23 mm): a double ring in sumi at .55 and .40, the place on the upper arc, YY.MM.DD across, turned −12°. */
function postmark(ctx: CanvasRenderingContext2D, card: PostcardItem, cx: number, cy: number, r: number, seed: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-12 * Math.PI) / 180 + (rand(seed * 7.7) - 0.5) * 0.06);
  ctx.strokeStyle = css(INK, 0.55);
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = css(INK, 0.4);
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = css(INK, 0.55);
  // the place along the upper arc
  const name = postmarkPlace(card);
  font(ctx, "sans", 500, 2, name);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rr = r * 0.83;
  const chars = Array.from(name).slice(0, 18);
  const span = Math.min(Math.PI * 1.15, chars.length * 0.21);
  chars.forEach((ch, i) => {
    const a = -Math.PI / 2 - span / 2 + (span * (i + 0.5)) / chars.length;
    ctx.save();
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, -rr);
    ctx.restore();
  });
  // the date across the middle, between two short bars
  const date = postmarkDate(card.date);
  if (date) {
    font(ctx, "sans", 500, 2, date);
    track(ctx, 0.2);
    ctx.fillText(date, 0, 0.3);
    track(ctx, 0);
    ctx.fillRect(-r * 0.5, -2.3, r, 0.18);
    ctx.fillRect(-r * 0.5, 2.7, r, 0.18);
  }
  ctx.textAlign = "left";
  ctx.restore();
}
