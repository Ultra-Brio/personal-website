/*
 * 一筆箋 (ippitsusen): a narrow letter sheet, 82 x 182 mm, for a few lines to whoever opens the folio — too short for a letter, too
 * kind for a text. Thin cool white paper with long fibres, faint 藍 ruling across it, and at the foot the only print: a tiny 藍 ○ and
 * 一筆箋 in Shippori Mincho. The note is written on the lines by hand (Klee One; LXGW WenKai for Chinese), signed "— {from}" and dated.
 * Layer 1 (over the résumé, beside the ticket). Flexes a little along its long axis.
 */
import * as THREE from "three";
import type { FontRun } from "../../fonts";
import { createFlexUniforms } from "./flex";
import { maskTexture, slabMesh } from "./parts";
import type { ObjectDef } from "./rig";
import { colorTexture, dataTexture, disc, drawText, hashStr, makeCanvas, measure, paintStock, paintStockNow, PRINT, printScaleOf, rng, runsOf, setFont, Tracker, wrapText } from "./shared";
import { roundedRectOutline } from "./slab";
import type { BodySpec, ObjectCtx } from "./types";
import type { NoteItem } from "../../profile/schema";

export const NOTE_W = 0.082;
export const NOTE_H = 0.182;
/** The body: on the middle layer. */
export const NOTE_BODY: Omit<BodySpec, "id"> = { w: NOTE_W, h: NOTE_H, layer: 1, shape: "rect", mass: 0.0018 };
const T_NOTE = 0.00016;
const SHEET = "#f5f7f6";
const SHEET_EDGE = "#e8ebea";
const PPM_BASE = 9;
/** the ruling: first line, pitch and last line (mm from the top), and the side margins */
const RULE = { top: 30, pitch: 10, bottom: 152, x0: 9, x1: 73 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function noteDate(date: string | undefined, zh: boolean): string | undefined {
  const m = date && /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m) return date;
  return zh ? `${m[1]}.${Number(m[2])}.${Number(m[3])}` : `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

/** Written by hand from (x, y): per character lean, press and baseline drift, a pen of one width. */
function write(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, lang: string | undefined, seed: number) {
  const r = rng(seed);
  let cx = x;
  let drift = 0;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  for (const ch of Array.from(text)) {
    setFont(g, { role: "hand", weight: 600, lang }, px, ch);
    const cw = g.measureText(ch).width;
    drift = drift * 0.75 + (r() - 0.5) * px * 0.045;
    g.save();
    g.translate(cx, y + drift);
    g.rotate((r() - 0.5) * 0.07 - 0.02);
    const press = 0.84 + r() * 0.16;
    g.fillStyle = PRINT.pen;
    g.globalAlpha = 0.16 * press;
    g.shadowColor = PRINT.pen;
    g.shadowBlur = px * 0.05;
    g.fillText(ch, 0, 0);
    g.shadowBlur = 0;
    g.globalAlpha = press;
    g.fillText(ch, 0, 0);
    g.lineWidth = px * 0.026;
    g.lineJoin = "round";
    g.strokeStyle = PRINT.pen;
    g.globalAlpha = 0.75 * press;
    g.strokeText(ch, 0, 0);
    g.restore();
    cx += cw * (0.98 + r() * 0.05);
  }
}

export function buildNote(item: NoteItem, ctx: ObjectCtx): ObjectDef {
  const T = new Tracker();
  const PPM = PPM_BASE * printScaleOf(ctx);
  const PW = Math.round(NOTE_W * 1000 * PPM);
  const PH = Math.round(NOTE_H * 1000 * PPM);
  const mm = (v: number) => v * PPM;
  const seed = hashStr(item.id) ^ 0x1b5;
  // the words, in the item's language (relabel() sets them again for another one)
  let lang: string | undefined;
  let zh = false;
  let sign = "";
  let date: string | undefined;
  const words = (): FontRun[] => {
    lang = ctx.lang;
    zh = /^zh/i.test(lang ?? "") || (!lang && /\p{Script=Han}/u.test(item.text) && !/[ぁ-ヿ]/.test(item.text));
    sign = item.from ? (zh ? `—— ${item.from}` : `— ${item.from}`) : "";
    date = noteDate(item.date, zh);
    return [...runsOf("hand", 600, [item.text, sign, date], lang), ...runsOf("serif", 500, ["一筆箋"], lang, "ja")];
  };
  const runs = words();
  const { c, g } = makeCanvas(PW, PH);
  const bump = makeCanvas(PW, PH);
  const colorTex = T.add(colorTexture(c, ctx));
  const bumpTex = T.add(dataTexture(bump.c, ctx));

  const paint = () => {
    // thin paper with long fibres (more and longer than a card's)
    paintStock(g, PW, PH, { color: SHEET, seed, mottle: 1.8, grain: 1.8, fibres: Math.round((PW * PH) / 500), bump: bump.g, tooth: 9 });
    const fr = rng(seed ^ 0xf1b);
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = fr() * PW, y = fr() * PH, l = mm(4 + fr() * 9), a = fr() * Math.PI;
      g.strokeStyle = fr() < 0.6 ? "rgba(255,255,255,0.45)" : "rgba(84,96,108,0.05)";
      g.lineWidth = mm(0.06 + fr() * 0.05);
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + Math.cos(a) * l * 0.3, y + Math.sin(a) * l * 0.3 + mm(0.6), x + Math.cos(a) * l * 0.7, y + Math.sin(a) * l * 0.7 - mm(0.6), x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    g.restore();
    // the ruling: faint 藍 lines across
    g.fillStyle = "rgba(47,79,115,0.2)";
    for (let y = RULE.top; y <= RULE.bottom + 0.01; y += RULE.pitch) g.fillRect(mm(RULE.x0), mm(y), mm(RULE.x1 - RULE.x0), Math.max(1, mm(0.14)));
    // the foot: a tiny ○ and the sheet's name
    g.fillStyle = PRINT.ai;
    disc(g, mm(41), mm(163.2), mm(0.75));
    drawText(g, "一筆箋", mm(41) + mm(0.45), mm(171.6), { role: "serif", px: mm(2.4), weight: 500, color: PRINT.muted, align: "center", ls: mm(0.9), han: "ja" });

    // the note, by hand, on the lines
    const px = mm(zh ? 5 : 5.3);
    const width = mm(RULE.x1 - RULE.x0 - 4);
    const lines = Math.floor((RULE.bottom - RULE.top) / RULE.pitch) + 1;
    const wr = wrapText(g, item.text.trim(), { role: "hand", weight: 600, lang }, px, width, lines - 2);
    const base = (i: number) => mm(RULE.top + i * RULE.pitch - 1.7);
    wr.lines.forEach((l, i) => write(g, l, mm(RULE.x0 + 1.5), base(i), wr.px, lang, seed ^ (i * 977)));
    // signed on the next line, right; dated under it, smaller
    const after = wr.lines.length;
    if (sign) {
      const w = measure(g, sign, { role: "hand", weight: 600, lang }, wr.px);
      write(g, sign, mm(RULE.x1 - 1) - w, base(after), wr.px, lang, seed ^ 0x5197);
    }
    if (date) {
      const dpx = wr.px * 0.78;
      const w = measure(g, date, { role: "hand", weight: 600, lang }, dpx);
      write(g, date, mm(RULE.x1 - 1) - w, base(after + (sign ? 1 : 0)), dpx, lang, seed ^ 0xda7);
    }
    colorTex.needsUpdate = bumpTex.needsUpdate = true;
  };
  paint();

  const plain = makeCanvas(160, 356);
  paintStockNow(plain.g, 160, 356, { color: SHEET, seed: seed ^ 0x9, mottle: 1.6, grain: 1.6, fibres: 160 });
  const plainTex = T.add(colorTexture(plain.c, ctx));

  const outline0 = roundedRectOutline(NOTE_W, NOTE_H, 0.0003, 3);
  const mask = maskTexture(T, ctx, outline0, NOTE_W, NOTE_H, 3000);
  const paper = { roughness: 0.92, sheen: 0.35, sheenRoughness: 0.9, sheenColor: new THREE.Color("#f6faff") };
  const front = T.material(new THREE.MeshPhysicalMaterial({ ...paper, map: colorTex, bumpMap: bumpTex, bumpScale: 0.5, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const back = T.material(new THREE.MeshPhysicalMaterial({ ...paper, map: plainTex, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const edge = T.material(new THREE.MeshPhysicalMaterial({ ...paper, color: SHEET_EDGE }));

  const flexU = createFlexUniforms("y", NOTE_H / 2, 0.0014);
  const { mesh, outline } = slabMesh(T, { outline: outline0, w: NOTE_W, h: NOTE_H, thickness: T_NOTE, bevel: 0.00004, nx: 3, ny: 36, front, back, edge, flex: flexU, name: "note" });

  return {
    spec: { id: item.id, ...NOTE_BODY },
    thickness: T_NOTE,
    outline,
    parts: [mesh],
    flex: { uniforms: flexU, axis: "y" },
    tracker: T,
    repaint: paint,
    runs,
    relabel(next, nctx) {
      if (next.kind !== "note") return null;
      item = next;
      ctx = nctx;
      return words();
    },
  };
}
