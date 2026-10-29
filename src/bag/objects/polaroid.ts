/*
 * Polaroid: 88 x 107 mm, 1 mm thick, the classic frame (4.5 mm sides, 5 mm top, a 23 mm chin), a 79 x 79 mm glossy print sitting a
 * hair below the matte frame (an inner shadow along its top and left edges, the emulsion's uneven edge at the foot), and a caption
 * written on the chin by hand: Klee One (LXGW WenKai for Chinese), a fineliner's blue-black ink, a baseline that wanders, letters that
 * lean and press a little differently, the ink pooling where a stroke starts.
 * The picture is the profile's `image`, decoded once through the shared image cache (so the lightbox snapshot shows the same pixels);
 * without one it is a procedural photograph (photo.ts). The back is the film's own: a matte dark grey base with a little fine grey
 * print (a hairline frame and the four-digit film number; no names, no logos), and the `back` note and the `date` written on it in a
 * silver gel pen: small and close, the way one writes on the back of a photo, left-aligned in the upper middle with air round it.
 * Layer 2 (on top, beside the business card). Flexes (barely) along its long axis. Gloss and roughness come from one data map
 * (R = clearcoat, G = roughness).
 */
import * as THREE from "three";
import type { FontRun } from "../../fonts";
import { createFlexUniforms } from "./flex";
import { maskTexture, slabMesh } from "./parts";
import { paintDeskAtNight } from "./photo";
import type { ObjectDef } from "./rig";
import { colorTexture, dataTexture, decodedImage, drawText, hashStr, makeCanvas, measure, mixHex, paintStock, PRINT, printScaleOf, rng, runsOf, setFont, Tracker, wrapText, type TextOpts } from "./shared";
import { roundedRectOutline } from "./slab";
import type { BodySpec, ObjectCtx } from "./types";
import type { PolaroidItem } from "../../profile/schema";

export const POLAROID_W = 0.088;
export const POLAROID_H = 0.107;
/** The body: on the top layer. */
export const POLAROID_BODY: Omit<BodySpec, "id"> = { w: POLAROID_W, h: POLAROID_H, layer: 2, shape: "rect", mass: 0.006 };
const T_POLAROID = 0.001;
const FRAME = "#f1f2f0";
const FRAME_EDGE = "#e6e8e6";
/** the film's back: a matte dark grey base, its fine print, the silver-white pen written on it */
const BACK = "#33393f";
const BACK_PRINT = "#5a626b";
const SILVER = "#dfe4e8";
const SIDE = 4.5;
const TOP = 5;
const IMG = 79;
const PPM_BASE = 9;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The date as a hand writes it: "4 Nov 2025", or 2025.11.4 for a Chinese profile. */
function handDate(date: string | undefined, zh: boolean): string | undefined {
  const m = date && /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m) return date;
  return zh ? `${m[1]}.${Number(m[2])}.${Number(m[3])}` : `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

/** How a pen lays its ink: the felt tip's halo (alpha) and how much the press varies from letter to letter (0 … 1). */
type Pen = { halo: number; press: number };
const FELT: Pen = { halo: 0.18, press: 0.18 };
/** a gel pen on the film's dark back: no halo (a halo there reads as chalk), a little less variation in the press */
const GEL: Pen = { halo: 0, press: 0.14 };

/**
 * Write a line by hand at (0, 0) of the current transform: character by character, each its own lean, press and baseline drift; a felt
 * tip's halo, then the stroke, then a fine outline that evens the typeface's hairlines into one pen width.
 */
function handLine(g: CanvasRenderingContext2D, text: string, o: Pick<TextOpts, "lang">, px: number, seed: number, ink: string = PRINT.pen, pen: Pen = FELT) {
  const rc = rng(seed);
  let x = 0;
  let drift = 0;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  for (const ch of Array.from(text)) {
    setFont(g, { role: "hand", weight: 600, lang: o.lang }, px, ch);
    const cw = g.measureText(ch).width;
    drift += (rc() - 0.5) * px * 0.05;
    drift *= 0.78;
    g.save();
    g.translate(x, drift);
    g.rotate((rc() - 0.5) * 0.09 - 0.03);
    const press = 1 - pen.press + rc() * pen.press;
    g.fillStyle = ink;
    if (pen.halo) {
      g.globalAlpha = pen.halo * press;
      g.shadowColor = ink;
      g.shadowBlur = px * 0.04;
      g.fillText(ch, 0, 0);
      g.shadowBlur = 0;
    }
    g.globalAlpha = press;
    g.fillText(ch, 0, 0);
    g.lineWidth = px * 0.028;
    g.lineJoin = "round";
    g.strokeStyle = ink;
    g.globalAlpha = 0.8 * press;
    g.strokeText(ch, 0, 0);
    g.restore();
    x += cw * (0.97 + rc() * 0.06);
  }
}

export function buildPolaroid(item: PolaroidItem, ctx: ObjectCtx): ObjectDef {
  const T = new Tracker();
  const PPM = PPM_BASE * printScaleOf(ctx);
  const PW = Math.round(POLAROID_W * 1000 * PPM);
  const PH = Math.round(POLAROID_H * 1000 * PPM);
  const mm = (v: number) => v * PPM;
  const seed = hashStr(item.id);
  // the language of its words (relabel() sets it again for another one)
  let lang = ctx.lang;
  let zh = false;
  const words = (): FontRun[] => {
    lang = ctx.lang;
    zh = /^zh/i.test(lang ?? "") || /\p{Script=Han}/u.test(item.caption + (item.back ?? ""));
    return [...runsOf("hand", 600, [item.caption, item.back, handDate(item.date, zh)], lang), ...runsOf("sans", 500, [filmNo], lang)];
  };
  const { c, g } = makeCanvas(PW, PH);
  const colorTex = T.add(colorTexture(c, ctx));
  // the back is seen up close too (the detail view turns the polaroid over): full resolution
  const BW = PW;
  const BH = PH;
  const backC = makeCanvas(BW, BH);
  const backTex = T.add(colorTexture(backC.c, ctx));
  const ix = mm(SIDE), iy = mm(TOP), isz = mm(IMG);
  const tint = item.tint ?? "#c9d3da";
  const filmNo = String(1000 + Math.floor(rng(seed ^ 0xf11)() * 9000));
  const runs = words();

  // the photograph is the expensive part: render it once, keep it, and only re-composite the frame and caption on a repaint. With a
  // picture on its way the print is a quiet grey of the tint until it is decoded (it always is before the cover opens, and every
  // still waits for it): the procedural one (≈ 0.5 s of pixel work) is painted only when there is no picture, or it fails to load.
  const photo = makeCanvas(isz, isz);
  let photoReady = false;
  let picture = !!item.image;
  const renderPhoto = (img?: HTMLImageElement | "placeholder") => {
    if (img === "placeholder") {
      photo.g.fillStyle = mixHex(tint, "#56626d", 0.35);
      photo.g.fillRect(0, 0, isz, isz);
      return;
    }
    if (img && img.naturalWidth > 0) {
      const k = Math.max(isz / img.naturalWidth, isz / img.naturalHeight);
      photo.g.drawImage(img, (isz - img.naturalWidth * k) / 2, (isz - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      // instant film: a touch of lift in the blacks and a faint cool cast, the same on every print
      photo.g.save();
      photo.g.globalCompositeOperation = "screen";
      photo.g.fillStyle = "rgba(30,40,52,0.10)";
      photo.g.fillRect(0, 0, isz, isz);
      photo.g.restore();
    } else paintDeskAtNight(photo.g, 0, 0, isz, tint, seed);
    photoReady = true;
  };

  const paint = () => {
    paintStock(g, PW, PH, { color: FRAME, seed: seed ^ 0x77, mottle: 1.2, grain: 2.2, fibres: 0 });
    if (!photoReady) renderPhoto(picture ? "placeholder" : undefined);
    g.drawImage(photo.c, ix, iy);
    // the emulsion's edge at the foot of the print: the developer spread a little unevenly before it set
    const r = rng(seed ^ 0xe7);
    g.save();
    g.fillStyle = "rgba(21,35,58,0.16)";
    g.beginPath();
    g.moveTo(ix, iy + isz);
    for (let k = 0; k <= 40; k++) g.lineTo(ix + (isz * k) / 40, iy + isz - mm(0.25 + r() * 0.55));
    g.lineTo(ix + isz, iy + isz);
    g.closePath();
    g.fill();
    g.restore();
    // the print sits under the frame's edge: a fine dark line and a soft shadow along the top and left
    g.save();
    g.strokeStyle = "rgba(28,35,43,0.42)";
    g.lineWidth = mm(0.12);
    g.strokeRect(ix + mm(0.06), iy + mm(0.06), isz - mm(0.12), isz - mm(0.12));
    const top = g.createLinearGradient(0, iy, 0, iy + mm(1.1));
    top.addColorStop(0, "rgba(21,35,58,0.32)");
    top.addColorStop(1, "rgba(21,35,58,0)");
    g.fillStyle = top;
    g.fillRect(ix, iy, isz, mm(1.1));
    const left = g.createLinearGradient(ix, 0, ix + mm(0.8), 0);
    left.addColorStop(0, "rgba(21,35,58,0.22)");
    left.addColorStop(1, "rgba(21,35,58,0)");
    g.fillStyle = left;
    g.fillRect(ix, iy, mm(0.8), isz);
    g.restore();

    // the caption, by hand: left of centre on the chin
    const cap = item.caption.trim();
    if (cap) {
      let capPx = mm(6.2);
      const maxW = mm(70);
      const w0 = measure(g, cap, { role: "hand", weight: 600, lang }, capPx);
      if (w0 > maxW) capPx *= maxW / w0;
      g.save();
      g.translate(mm(SIDE + 5.5), mm(TOP + IMG + 13.4));
      g.rotate(-0.026);
      handLine(g, cap, { lang }, capPx, seed ^ 0x33);
      g.restore();
    }

    // the back: written as seen from behind, then mirrored onto the canvas the back cap shares with the front
    const b = (v: number) => v * PPM;
    const tmp = makeCanvas(BW, BH);
    paintStock(tmp.g, BW, BH, { color: BACK, seed: seed ^ 0xbac, mottle: 1.6, grain: 2.6, fibres: 0 });
    // the fine print: a hairline frame round the image area and the film's number in the chin, grey on the grey
    tmp.g.strokeStyle = BACK_PRINT;
    tmp.g.globalAlpha = 0.55;
    tmp.g.lineWidth = b(0.16);
    tmp.g.strokeRect(b(SIDE), b(TOP), b(IMG), b(IMG));
    tmp.g.globalAlpha = 1;
    drawText(tmp.g, filmNo, b(SIDE), BH - b(5.2), { role: "sans", px: b(1.7), weight: 500, color: BACK_PRINT, ls: b(0.3), lang });
    // a small printed arrow (this way into the camera): a path, not a glyph
    tmp.g.fillStyle = BACK_PRINT;
    tmp.g.beginPath();
    tmp.g.moveTo(BW - b(SIDE), BH - b(5.2));
    tmp.g.lineTo(BW - b(SIDE) - b(1.6), BH - b(5.2));
    tmp.g.lineTo(BW - b(SIDE) - b(0.8), BH - b(6.6));
    tmp.g.closePath();
    tmp.g.fill();
    // the note, small, in a short column of even lines (a Chinese line breaks after a pause) at the left of the image area, its block
    // centred a little above the middle; the date under it, smaller, after a line's air. The rest of the back stays empty.
    const note = item.back?.trim();
    const date = handDate(item.date, zh);
    const wr = note ? wrapText(tmp.g, note, { role: "hand", weight: 600, lang }, b(zh ? 3.2 : 3.3), b(zh ? 60 : 54), 8, { balance: true }) : null;
    const lh = (wr?.px ?? b(3.3)) * 1.78;
    const datePx = b(2.5);
    const gap = wr && date ? lh * 1.25 : 0;
    const blockH = (wr ? (wr.lines.length - 1) * lh : 0) + gap;
    let y = b(TOP) + b(IMG) * 0.42 - blockH / 2;
    const hand = (text: string, px: number, k: number, lean: number) => {
      tmp.g.save();
      tmp.g.translate(b(SIDE + 7.5), y);
      tmp.g.rotate(lean);
      handLine(tmp.g, text, { lang }, px, seed ^ k, SILVER, GEL);
      tmp.g.restore();
    };
    wr?.lines.forEach((l, i) => {
      hand(l, wr.px, 0x51 + i, -0.01);
      if (i < wr.lines.length - 1) y += lh;
    });
    y += gap;
    if (date) hand(date, datePx, 0xda7e, -0.014);
    backC.g.save();
    backC.g.translate(BW, 0);
    backC.g.scale(-1, 1);
    backC.g.drawImage(tmp.c, 0, 0);
    backC.g.restore();
    colorTex.needsUpdate = backTex.needsUpdate = true;
  };
  paint();

  // R = clearcoat, G = roughness: a glossy print in a satin frame
  const gm = makeCanvas(256, Math.round((256 * POLAROID_H) / POLAROID_W));
  gm.g.fillStyle = "rgb(20,205,0)";
  gm.g.fillRect(0, 0, 256, gm.c.height);
  const k = 256 / PW;
  gm.g.fillStyle = "rgb(255,60,0)";
  gm.g.fillRect(ix * k, iy * k, isz * k, isz * k);
  const glossTex = T.add(dataTexture(gm.c, ctx));

  let disposed = false;
  T.onFree(() => {
    disposed = true;
  });
  // the picture: decoded once for every user of the URL; the object is complete (and `ready`) once it is in the print
  const ready: Promise<void> = item.image
    ? decodedImage(item.image).then(
        (img) => {
          if (disposed) return;
          renderPhoto(img);
          paint();
          ctx.onChange?.();
        },
        () => {
          // no picture after all: the procedural one
          if (disposed) return;
          picture = false;
          paint();
          ctx.onChange?.();
        },
      )
    : Promise.resolve();

  const outline0 = roundedRectOutline(POLAROID_W, POLAROID_H, 0.0009, 5);
  const mask = maskTexture(T, ctx, outline0, POLAROID_W, POLAROID_H, 5200);
  const front = T.material(new THREE.MeshPhysicalMaterial({ map: colorTex, roughness: 1, roughnessMap: glossTex, clearcoat: 1, clearcoatMap: glossTex, clearcoatRoughness: 0.12, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  // the back: the film's matte dark base
  const back = T.material(new THREE.MeshPhysicalMaterial({ map: backTex, roughness: 0.86, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const edge = T.material(new THREE.MeshPhysicalMaterial({ color: FRAME_EDGE, roughness: 0.7 }));

  const flexU = createFlexUniforms("y", POLAROID_H / 2, 0.0011);
  const { mesh, outline } = slabMesh(T, { outline: outline0, w: POLAROID_W, h: POLAROID_H, thickness: T_POLAROID, bevel: 0.00025, nx: 3, ny: 26, front, back, edge, flex: flexU, name: "polaroid" });

  return {
    spec: { id: item.id, ...POLAROID_BODY },
    thickness: T_POLAROID,
    outline,
    parts: [mesh],
    flex: { uniforms: flexU, axis: "y" },
    tracker: T,
    repaint: paint,
    runs,
    ready,
    relabel(next, nctx) {
      // the photograph is rendered once: another picture is another object
      if (next.kind !== "polaroid" || next.image !== item.image) return null;
      item = next;
      ctx = nctx;
      return words();
    },
  };
}
