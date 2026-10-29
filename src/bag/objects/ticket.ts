/*
 * Admission ticket: 150 x 58 mm of 350 gsm cool white board, landscape. The main body carries the event in Shippori Mincho, the talk
 * under it, the big date numeral, and the fields (date, time, seat) in small tracked Zen Kaku labels over Zen Kaku values, with the
 * venue and city at the foot; a round punch went through it at the door (checked in). A 34 mm 藍 stub on the right behind a
 * perforation (half-round notches top and bottom, a row of real holes, a short tear started at the top) says ADMIT ONE down its
 * length, and its outer edge is torn where it came off the book. The back is printed too: a few lines of terms and a small 藍 ○.
 * Layer 1 (over the résumé, under the polaroid and the card). Flexes along its long axis.
 */
import * as THREE from "three";
import type { FontRun } from "../../fonts";
import { createFlexUniforms } from "./flex";
import { maskTexture, slabMesh } from "./parts";
import type { ObjectDef } from "./rig";
import { caps, colorTexture, dataTexture, disc, drawText, hashStr, inkTooth, luminance, makeCanvas, measure, mixHex, paintStock, PRINT, printScaleOf, rng, runsOf, Tracker, wrapText, type V2 } from "./shared";
import { roundedRectOutline } from "./slab";
import type { BodySpec, ObjectCtx } from "./types";
import type { TicketItem } from "../../profile/schema";

export const TICKET_W = 0.15;
export const TICKET_H = 0.058;
/** The body: on the middle layer. */
export const TICKET_BODY: Omit<BodySpec, "id"> = { w: TICKET_W, h: TICKET_H, layer: 1, shape: "rect", mass: 0.0026 };
const T_TICKET = 0.00045;
/** the perforation, mm from the left edge */
const PERF_X = 116;
const NOTCH_R = 0.0024;
const BOARD = "#eef0ed";
const BOARD_EDGE = "#e3e6e3";
/** the round punch (checked in): centre and radius, mm */
const PUNCH = { x: 103, y: 47.5, r: 2.3 };
const PPM_BASE = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

type Words = { date: string; time: string; seat: string; admit: string; terms: string[] };
const WORDS: Record<"en" | "zh", Words> = {
  en: {
    date: "Date",
    time: "Doors",
    seat: "Seat",
    admit: "ADMIT ONE",
    terms: ["Admits one person on the date shown.", "Keep this ticket until you leave; it is checked at the door.", "Not valid once punched for another day.", "No re-entry once the stub is torn off."],
  },
  zh: { date: "日期", time: "入场", seat: "座位", admit: "凭票入场", terms: ["凭本票入场一人，仅限当日有效。", "请保留至离场，入口处验票。", "打孔后不再用于他日。", "票根撕下后不可再次入场。"] },
};

/** The ticket's own words follow the profile's language (zh → Chinese), else the language of its event name. */
function wordsFor(item: TicketItem, lang?: string): { w: Words; zh: boolean } {
  const zh = /^zh/i.test(lang ?? "") || (!lang && /\p{Script=Han}/u.test(item.event));
  return { w: zh ? WORDS.zh : WORDS.en, zh };
}

/** Samples along the torn edge (bottom to top) and the edge's x (mm from the left) at each: see tornProfile. */
const TORN_N = 116;
/**
 * The stub's outer edge where it came off the book: a slow, irregular wander of about ±0.5 mm with a 3–6 mm wavelength (two
 * incommensurate waves and a little smoothed noise), never a high-frequency fuzz. x in mm from the ticket's left edge, sample i at
 * y = 0.5 + (H − 1) · i / TORN_N mm from the bottom. Deterministic from the seed; the outline and the paint share it.
 */
function tornProfile(seed: number): number[] {
  const r = rng(seed);
  const l1 = 4.2 + r() * 1.8;
  const l2 = 2.9 + r() * 0.7;
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const H = TICKET_H * 1000;
  const xs: number[] = [];
  let n = 0;
  for (let i = 0; i <= TORN_N; i++) {
    const y = 0.5 + ((H - 1) * i) / TORN_N;
    n = n * 0.7 + (r() - 0.5) * 0.12;
    xs.push(TICKET_W * 1000 - 0.62 + 0.28 * Math.sin((2 * Math.PI * y) / l1 + p1) + 0.16 * Math.sin((2 * Math.PI * y) / l2 + p2) + n);
  }
  return xs;
}

/** The torn edge as outline points (metres, centred, bottom to top: CCW). */
function tornEdge(seed: number): V2[] {
  const H = TICKET_H * 1000;
  return tornProfile(seed).map((x, i) => [(x - TICKET_W * 1000 / 2) / 1000, (0.5 + ((H - 1) * i) / TORN_N - H / 2) / 1000]);
}

function ticketOutline(seed: number): V2[] {
  const base = roundedRectOutline(TICKET_W, TICKET_H, 0.0006, 4);
  const per = 5; // points per corner (seg + 1)
  const xn = PERF_X / 1000 - TICKET_W / 2;
  const top: V2[] = [];
  const bottom: V2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // top edge runs right to left (CCW): a notch dipping into the ticket
    const a = -t * Math.PI;
    top.push([xn + Math.cos(a) * NOTCH_R, TICKET_H / 2 + Math.sin(a) * NOTCH_R]);
    // bottom edge runs left to right
    const b = Math.PI - t * Math.PI;
    bottom.push([xn + Math.cos(b) * NOTCH_R, -TICKET_H / 2 + Math.sin(b) * NOTCH_R]);
  }
  // corners in roundedRectOutline order: bottom-right, top-right, top-left, bottom-left; the right edge is torn (square corners)
  return [...tornEdge(seed), ...top, ...base.slice(per * 2, per * 3), ...base.slice(per * 3), ...bottom];
}

function parseDate(s: string): { d: string; m: string; mo: number; y: string; wd: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return { d: String(d), m: MONTHS[mo - 1] ?? "", mo, y: String(y), wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** The back's head: the event and its year (once). */
function backTitle(item: TicketItem, pd: { y: string } | null): string {
  return pd && !item.event.includes(pd.y) ? `${item.event} ${pd.y}` : item.event;
}

/** Every string the ticket prints. */
function ticketRuns(item: TicketItem, lang?: string): FontRun[] {
  const { w, zh } = wordsFor(item, lang);
  const pd = parseDate(item.date);
  const talk = item.talk ? (zh ? `「${item.talk}」` : `“${item.talk}”`) : undefined;
  const dateText = pd ? (zh ? `${pd.y} 年 ${pd.mo} 月 ${pd.d} 日 ${DAYS_ZH[pd.wd]}` : `${DAYS[pd.wd]?.slice(0, 3)} ${pd.d} ${pd.m} ${pd.y}`) : item.date;
  const micro = [item.label, w.date, w.time, w.seat, item.serial, pd ? (zh ? `${pd.y} 年 ${pd.mo} 月` : `${pd.m} ${pd.y}`) : undefined, pd ? (zh ? DAYS_ZH[pd.wd] : DAYS[pd.wd]) : undefined].map((t) => (t ? caps(t) : undefined));
  return [
    ...runsOf("serif", 500, [item.event, pd?.d, backTitle(item, pd)], lang),
    ...runsOf("serif", 400, [talk], lang),
    ...runsOf("sans", 500, [...micro, w.admit], lang),
    ...runsOf("sans", 400, [dateText, item.time, item.seat, [item.venue, item.city].filter(Boolean).join(" · "), ...w.terms, item.serial], lang),
    ...runsOf("sans", 500, ["1. 2. 3. 4."], lang),
  ];
}

export function buildTicket(item: TicketItem, ctx: ObjectCtx): ObjectDef {
  const T = new Tracker();
  const PPM = PPM_BASE * printScaleOf(ctx);
  const PW = Math.round(TICKET_W * 1000 * PPM);
  const PH = Math.round(TICKET_H * 1000 * PPM);
  const seed = hashStr(item.id + item.event);
  // its words, in the item's language (relabel() sets them again for another one); the paper, the edge and the outline stay
  let lang = ctx.lang;
  let { w: words, zh } = wordsFor(item, lang);
  const { c, g } = makeCanvas(PW, PH);
  const bump = makeCanvas(PW, PH);
  const colorTex = T.add(colorTexture(c, ctx));
  const bumpTex = T.add(dataTexture(bump.c, ctx));
  // the back is seen up close too (the detail view turns the ticket over): full resolution
  const back = makeCanvas(PW, PH);
  const backTex = T.add(colorTexture(back.c, ctx));
  let spot = item.color ?? PRINT.ai;
  let onSpot = luminance(spot) > 0.62 ? PRINT.ink : "#f4f6f7";
  let serial = item.serial ?? `No. ${String(Math.floor(rng(seed)() * 9999)).padStart(4, "0")}`;
  let pd = parseDate(item.date);
  const W = TICKET_W * 1000;
  const H = TICKET_H * 1000;

  const paint = () => {
    const mm = (v: number) => v * PPM;
    paintStock(g, PW, PH, { color: BOARD, seed, mottle: 2.4, grain: 2.4, bump: bump.g, tooth: 16 });
    const micro = (s: string, x: number, y: number, align: CanvasTextAlign = "left", color: string = PRINT.muted) => {
      const han = /\p{Script=Han}/u.test(s);
      const px = mm(han ? 2.05 : 1.6);
      drawText(g, caps(s), mm(x), mm(y), { role: "sans", px, weight: 500, color, align, ls: px * (han ? 0.1 : 0.18), lang });
    };
    const x0 = 8;
    const right = PERF_X - 8;

    // the head: what it is, and the month of the day it is for
    micro(item.label || "Ticket", x0, 10.6);
    if (pd) micro(zh ? `${pd.y} 年 ${pd.mo} 月` : `${pd.m} ${pd.y}`, right, 10.6, "right");
    // the big numeral, top right of the body, the weekday under it
    const numW = 30;
    if (pd) {
      const px = mm(21);
      const dw = measure(g, pd.d, { role: "serif", weight: 500, ls: -mm(0.3), lang }, px);
      drawText(g, pd.d, mm(right) - dw, mm(31.2), { role: "serif", px, weight: 500, color: PRINT.ink, ls: -mm(0.3), lang });
      micro(zh ? (DAYS_ZH[pd.wd] ?? "") : (DAYS[pd.wd] ?? ""), right, 35.4, "right");
    }
    // the event and the talk
    const evW = right - x0 - (pd ? numW : 0);
    // one line if it fits at 70 % of the size, else two smaller lines
    const evFont = { role: "serif" as const, weight: 500, ls: -mm(0.05), lang };
    const full = measure(g, item.event, evFont, mm(8.6));
    const one = full <= mm(evW) / 0.7;
    const ev = one ? { lines: [item.event], px: Math.min(mm(8.6), (mm(8.6) * mm(evW)) / full) } : wrapText(g, item.event, evFont, mm(6.4), mm(evW), 2);
    const evBase = one ? 23 : 18;
    ev.lines.forEach((ln, i) => drawText(g, ln, mm(x0 - 0.4), mm(evBase) + i * ev.px * 1.1, { ...evFont, px: ev.px, color: PRINT.ink }));
    if (item.talk) drawText(g, zh ? `「${item.talk}」` : `“${item.talk}”`, mm(zh ? x0 - 1.6 : x0 - 0.6), mm(one ? 30.4 : 31.6), { role: "serif", px: mm(3.6), weight: 400, color: PRINT.ink2, maxW: mm(evW), lang });
    // a hairline, then the fields
    g.fillStyle = PRINT.rule;
    g.fillRect(mm(x0), mm(37.6), mm(right - x0), mm(0.16));
    const value = (s: string, x: number, maxW: number) => drawText(g, s, mm(x), mm(47.4), { role: "sans", px: mm(3), weight: 400, color: PRINT.ink, maxW: mm(maxW), lang });
    const fx = [x0, x0 + 44, x0 + 66];
    micro(words.date, fx[0]!, 42.2);
    value(pd ? (zh ? `${pd.y} 年 ${pd.mo} 月 ${pd.d} 日` : `${DAYS[pd.wd]?.slice(0, 3)} ${pd.d} ${pd.m} ${pd.y}`) : item.date, fx[0]!, 41);
    if (item.time) {
      micro(words.time, fx[1]!, 42.2);
      value(item.time, fx[1]!, 20);
    }
    if (item.seat) {
      micro(words.seat, fx[2]!, 42.2);
      value(item.seat, fx[2]!, right - fx[2]! - 8);
    }
    // where: at the foot
    const where = [item.venue, item.city].filter(Boolean).join(" · ");
    if (where) drawText(g, where, mm(x0), mm(53.4), { role: "sans", px: mm(2.5), weight: 400, color: PRINT.muted, ls: mm(0.04), maxW: mm(PUNCH.x - PUNCH.r - x0 - 4), lang });
    // the punch's cut fibres: a faint ring round the hole
    g.strokeStyle = "rgba(40,52,66,0.18)";
    g.lineWidth = mm(0.18);
    g.beginPath();
    g.arc(mm(PUNCH.x), mm(PUNCH.y), mm(PUNCH.r + 0.08), 0, Math.PI * 2);
    g.stroke();
    // a faint guide printed along the perforation
    g.fillStyle = "rgba(28,35,43,0.14)";
    for (let y = 4; y < H - 4; y += 2.2) g.fillRect(mm(PERF_X) - mm(0.07), mm(y), mm(0.14), mm(1.1));
    inkTooth(g, PW, PH, BOARD, seed ^ 0x77, 0.2, 0.05);

    // the stub: the spot colour, a hair out of register with the ink (offset printing), ADMIT ONE down its length
    const sx = PERF_X + 0.35;
    g.fillStyle = spot;
    g.fillRect(mm(sx), 0, PW - mm(sx), PH);
    const sheen = g.createLinearGradient(mm(sx), 0, PW, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0.04)");
    sheen.addColorStop(1, "rgba(21,35,58,0.06)");
    g.fillStyle = sheen;
    g.fillRect(mm(sx), 0, PW - mm(sx), PH);
    g.save();
    g.translate(mm(sx), 0);
    inkTooth(g, PW - mm(sx), PH, mixHex(spot, "#ffffff", 0.16), seed ^ 0x78, 0.25, 0.04);
    g.restore();
    const ax = PERF_X + 9.6;
    if (zh) {
      // Chinese stands upright, one character under the other
      const chars = Array.from(words.admit);
      const px = mm(2.8);
      const step = px * 1.5;
      const y0 = mm(H / 2) - (step * (chars.length - 1)) / 2 + px * 0.36;
      chars.forEach((ch, i) => drawText(g, ch, mm(ax), y0 + i * step, { role: "sans", px, weight: 500, color: onSpot, align: "center", lang }));
    } else {
      g.save();
      g.translate(mm(ax + 0.9), mm(H / 2));
      g.rotate(-Math.PI / 2);
      drawText(g, words.admit, 0, 0, { role: "sans", px: mm(2.7), weight: 500, color: onSpot, align: "center", ls: mm(2.7 * 0.18), lang });
      g.restore();
    }
    // the number, small, down the stub's outer side
    g.save();
    g.translate(mm(W - 6.4), mm(H / 2));
    g.rotate(-Math.PI / 2);
    drawText(g, serial, 0, 0, { role: "sans", px: mm(1.8), weight: 400, color: onSpot, align: "center", ls: mm(0.2), alpha: 0.72, lang });
    g.restore();
    // the torn edge: the board's white core shows where the ink broke off, a fringe about 0.3 mm wide that follows the tear (a
    // little wider and narrower along it), with a few short fibres standing out of it into the ink
    const edge = tornProfile(seed);
    const r = rng(seed ^ 0x7e);
    const yAt = (i: number) => mm(H - 0.5 - ((H - 1) * i) / TORN_N);
    g.fillStyle = "#f4f5f2";
    g.beginPath();
    g.moveTo(PW, yAt(0) + mm(1));
    let wob = 0;
    for (let i = 0; i <= TORN_N; i++) {
      wob = wob * 0.6 + (r() - 0.5) * 0.14;
      g.lineTo(mm(edge[i]! - 0.3 - wob), yAt(i));
    }
    g.lineTo(PW, yAt(TORN_N) - mm(1));
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(244,245,242,0.7)";
    g.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      const k = Math.floor(r() * TORN_N);
      const x = mm(edge[k]! - 0.3);
      const y = yAt(k);
      const l = mm(0.25 + r() * 0.35);
      g.lineWidth = mm(0.05 + r() * 0.04);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - l, y + (r() - 0.5) * l * 0.8);
      g.stroke();
    }
    // the punch's wall: a thin crescent of shade inside its upper-left rim (the light is from the top right)
    g.save();
    g.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = `rgba(21,35,58,${(0.18 * (3 - k)) / 3})`;
      g.lineWidth = mm(0.3 - k * 0.06);
      g.beginPath();
      g.arc(mm(PUNCH.x), mm(PUNCH.y), mm(PUNCH.r + 0.15), Math.PI * (0.92 + k * 0.08), Math.PI * (1.62 - k * 0.08));
      g.stroke();
    }
    g.restore();

    // the back, as seen from behind (stub on the left), then mirrored onto the canvas the back cap shares with the front
    const bg = back.g;
    const bk = (v: number) => v * PPM;
    paintStock(bg, back.c.width, back.c.height, { color: BOARD, seed: seed ^ 0x31, mottle: 2.2, grain: 2.2, fibres: 60 });
    bg.save();
    // draw un-mirrored into a scratch canvas, then flip it in
    const tmp = makeCanvas(back.c.width, back.c.height);
    const tg = tmp.g;
    const bx0 = W - PERF_X + 10;
    // a 3.2 mm baseline grid down from the event: the event, four numbered terms in a 70 mm column, the venue; the number and a 藍 ○
    // on the foot's baseline at the right. The foot is the last row clear of the punch (seen from behind it is at the lower left,
    // under the venue's line): the hole stays a hole in the empty board below the print, never through a word.
    const pitch = 3.2;
    const top = 12.4;
    const foot = top + pitch * Math.min(12, Math.floor((PUNCH.y - PUNCH.r - 3.6 - top) / pitch));
    const title = backTitle(item, pd);
    const termFont = { role: "sans" as const, weight: 400, ls: bk(0.02), lang };
    const termLines: string[][] = words.terms.map((t) => wrapText(tg, t, termFont, bk(1.9), bk(64), 3).lines);
    const nLines = termLines.reduce((a, l) => a + l.length, 0);
    const place = [item.venue, item.city].filter(Boolean).join(" · ");
    // the title on the grid's top row (upper left), the terms three rows under it (or higher up when there are many), the venue on
    // the foot line under a hairline
    drawText(tg, title, bk(bx0), bk(top), { role: "serif", px: bk(3.2), weight: 500, color: PRINT.ink, ls: -bk(0.02), maxW: bk(W - bx0 - 26), lang });
    let row = Math.min(top + pitch * 3, foot - pitch * (nLines + 2));
    termLines.forEach((lines, i) => {
      drawText(tg, `${i + 1}.`, bk(bx0), bk(row), { role: "sans", px: bk(1.9), weight: 500, color: PRINT.muted, lang });
      for (const l of lines) {
        drawText(tg, l, bk(bx0 + 4.2), bk(row), { role: "sans", px: bk(1.9), weight: 400, color: PRINT.body, ls: bk(0.02), lang });
        row += pitch;
      }
    });
    tg.fillStyle = PRINT.rule;
    tg.fillRect(bk(bx0), bk(foot - pitch * 1.1), bk(70), Math.max(1, bk(0.14)));
    if (place) drawText(tg, place, bk(bx0), bk(foot), { role: "sans", px: bk(1.9), weight: 400, color: PRINT.muted, ls: bk(0.04), maxW: bk(60), lang });
    const sw = measure(tg, serial, { role: "sans", weight: 400, ls: bk(0.15), lang }, bk(1.9));
    drawText(tg, serial, bk(W - 8), bk(foot), { role: "sans", px: bk(1.9), weight: 400, color: PRINT.muted, ls: bk(0.15), align: "right", lang });
    // the ○ set like a glyph of the line: on the baseline, a little taller than the figures
    tg.fillStyle = PRINT.ai;
    disc(tg, bk(W - 8) - sw - bk(2.2), bk(foot - 0.78), bk(0.82));
    bg.translate(back.c.width, 0);
    bg.scale(-1, 1);
    bg.drawImage(tmp.c, 0, 0);
    bg.restore();
    colorTex.needsUpdate = bumpTex.needsUpdate = backTex.needsUpdate = true;
  };
  paint();

  const outline0 = ticketOutline(seed);
  const xn = PERF_X / 1000 - TICKET_W / 2;
  const tear = rng(seed ^ 0x7ea);
  const mask = maskTexture(T, ctx, outline0, TICKET_W, TICKET_H, 7400, (gg, px, scale) => {
    // the perforation's holes
    for (let ymm = -H / 2 + 4.2; ymm < H / 2 - 4; ymm += 2.2) {
      const [hx, hy] = px([xn, ymm / 1000]);
      gg.beginPath();
      gg.arc(hx, hy, 0.00042 * scale, 0, Math.PI * 2);
      gg.fill();
    }
    // a tear started at the top notch: a ragged slit down the perforation, through the first two holes
    gg.beginPath();
    const top = H / 2 - NOTCH_R * 1000 + 0.4;
    const pts: V2[] = [];
    for (let k = 0; k <= 8; k++) pts.push([xn + (0.00012 + tear() * 0.00012) * (k % 2 ? 1 : -1), (top - (k * 5.4) / 8) / 1000]);
    const [p0x, p0y] = px([xn - 0.0005, top / 1000 + 0.0006]);
    gg.moveTo(p0x, p0y);
    for (const p of pts) {
      const [x, y] = px([p[0] - 0.00008, p[1]]);
      gg.lineTo(x, y);
    }
    for (const p of pts.slice().reverse()) {
      const [x, y] = px([p[0] + 0.00009, p[1]]);
      gg.lineTo(x, y);
    }
    const [p1x, p1y] = px([xn + 0.0005, top / 1000 + 0.0006]);
    gg.lineTo(p1x, p1y);
    gg.closePath();
    gg.fill();
    // the punch
    const [cx, cy] = px([PUNCH.x / 1000 - TICKET_W / 2, TICKET_H / 2 - PUNCH.y / 1000]);
    gg.beginPath();
    gg.arc(cx, cy, (PUNCH.r / 1000) * scale, 0, Math.PI * 2);
    gg.fill();
  });
  const board = { roughness: 0.86, sheen: 0.3, sheenRoughness: 0.85, sheenColor: new THREE.Color("#f6faff") };
  const front = T.material(new THREE.MeshPhysicalMaterial({ ...board, map: colorTex, bumpMap: bumpTex, bumpScale: 0.9, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const backMat = T.material(new THREE.MeshPhysicalMaterial({ ...board, map: backTex, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const edge = T.material(new THREE.MeshPhysicalMaterial({ ...board, color: BOARD_EDGE }));

  const flexU = createFlexUniforms("x", TICKET_W / 2, 0.0022);
  const { mesh, outline } = slabMesh(T, { outline: outline0, w: TICKET_W, h: TICKET_H, thickness: T_TICKET, bevel: 0.00011, nx: 40, ny: 3, front, back: backMat, edge, flex: flexU, name: "ticket" });

  // the punch lets the light through: no shadow under the hole
  const punch: V2[] = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return [PUNCH.x / 1000 - TICKET_W / 2 + Math.cos(a) * (PUNCH.r / 1000) * 0.92, TICKET_H / 2 - PUNCH.y / 1000 + Math.sin(a) * (PUNCH.r / 1000) * 0.92];
  });
  return {
    spec: { id: item.id, ...TICKET_BODY },
    thickness: T_TICKET,
    outline,
    shadowHoles: [punch],
    parts: [mesh],
    flex: { uniforms: flexU, axis: "x" },
    tracker: T,
    repaint: paint,
    runs: ticketRuns(item, lang),
    relabel(next, nctx) {
      if (next.kind !== "ticket") return null;
      item = next;
      ctx = nctx;
      lang = ctx.lang;
      ({ w: words, zh } = wordsFor(item, lang));
      spot = item.color ?? PRINT.ai;
      onSpot = luminance(spot) > 0.62 ? PRINT.ink : "#f4f6f7";
      serial = item.serial ?? `No. ${String(Math.floor(rng(seed)() * 9999)).padStart(4, "0")}`;
      pd = parseDate(item.date);
      return ticketRuns(item, lang);
    },
  };
}
