/*
 * Business card: a folded card of 600 gsm cotton, 90 x 54 mm closed, scored along the long top edge (the same top-fold card the
 * paper viewer unfolds). Two leaves of 0.6 mm with a rounded crease on top; the cover springs a hair open at its free edge and
 * stops 0.35 mm short of the inner panel, so the bottom edge reads as two sheets. Letterpress on the cover, every element bitten
 * into the cotton (bump) with ink that catches the light a little differently from the paper (roughness): the ○ in 藍 top left,
 * the local name (林文) in Mincho top right, the name and role in Mincho, the tagline in small tracked Zen Kaku capitals. The
 * outer back carries a small centred ○ and the web address. Layer 2. Flexes along its long axis.
 */
import * as THREE from "three";
import type { FontRun } from "../../fonts";
import { createFlexUniforms, patchFlex } from "./flex";
import { maskTexture, slabMesh } from "./parts";
import type { ObjectDef } from "./rig";
import { caps, colorTexture, dataTexture, disc, drawText, hashStr, inkTooth, makeCanvas, measure, paintStock, paintStockNow, PRINT, runsOf, Tracker } from "./shared";
import { roundedRectOutline } from "./slab";
import type { BodySpec, ObjectCtx, Owner } from "./types";
import type { BusinessCardItem } from "../../profile/schema";

export const CARD_W = 0.09;
export const CARD_H = 0.054;
/** The body: on the top layer. */
export const CARD_BODY: Omit<BodySpec, "id"> = { w: CARD_W, h: CARD_H, layer: 2, shape: "rect", mass: 0.0045 };
/** one leaf of 600 gsm cotton */
const LEAF = 0.0006;
const GAP = 0.00012;
/** crease radius: the fold wraps both leaves */
const CREASE_R = (2 * LEAF + GAP) / 2;
/** the cover's free edge stands this far off the inner panel */
const SPRING = 0.00028;
/** ...and stops this far short of it */
const SHORT = 0.00035;
const CORNER = 0.0005;
export const COTTON = "#f2f3f0";
export const COTTON_EDGE = "#e7e9e6";
/** px per mm of the printed cover */
const PPM = 14;

type Layers = { color: CanvasRenderingContext2D; bump: CanvasRenderingContext2D; rough: CanvasRenderingContext2D };

/** The local name printed beside the name: the owner's native-script name, unless the card's name already is it. */
export function cardLocal(item: BusinessCardItem, owner: Owner | undefined): string | undefined {
  const local = owner?.nameLocal;
  if (!local || local === item.front.name) return undefined;
  return !owner?.name || owner.name === item.front.name ? local : undefined;
}

/** The web address the outer back carries: the inside row that looks like one. */
export function cardWeb(item: BusinessCardItem): string | undefined {
  const row = item.inside.find((r) => /^(web|site|url|网站|网址|ウェブ)/i.test(r.k)) ?? item.inside.find((r) => /\.[a-z]{2,}(\/|$)/i.test(r.v) && !r.v.includes("@"));
  return row?.v;
}

/** Every string the card prints (cover, outer back), for ensureFonts. */
export function cardRuns(item: BusinessCardItem, owner: Owner | undefined, lang?: string): FontRun[] {
  return [
    ...runsOf("serif", 500, [item.front.name, cardLocal(item, owner)], lang),
    ...runsOf("serif", 400, [item.front.role], lang),
    ...runsOf("sans", 500, [item.front.tagline && caps(item.front.tagline)], lang),
    ...runsOf("sans", 400, [cardWeb(item)], lang),
  ];
}

/** Letterpress: one element on all three canvases — ink colour, a bitten impression with a soft shoulder, a satin ink film. */
function presser(cv: Layers, ppm: number) {
  return (draw: (g: CanvasRenderingContext2D, col: string) => void, ink: string, depth = 62) => {
    draw(cv.color, ink);
    cv.bump.save();
    const v = 128 - depth;
    cv.bump.shadowColor = `rgb(${v},${v},${v})`;
    cv.bump.shadowBlur = 0.22 * ppm;
    draw(cv.bump, `rgb(${v},${v},${v})`);
    cv.bump.restore();
    draw(cv.rough, "rgb(0,170,0)");
  };
}

/** The cotton under the print: stock colour, its relief, a matte roughness. */
function cotton(cv: Layers, w: number, h: number, seed: number, mottle = 2.2) {
  paintStock(cv.color, w, h, { color: COTTON, seed, mottle, grain: 2.4, bump: cv.bump, tooth: 22 });
  cv.rough.fillStyle = "rgb(0,235,0)";
  cv.rough.fillRect(0, 0, w, h);
}

/**
 * The cover's front, painted at `ppm` px per mm into colour / bump (bitten = dark) / roughness canvases. Exported so other views
 * of the same card (the paper viewer) print exactly this face.
 */
export function paintCardFront(item: BusinessCardItem, owner: Owner | undefined, lang: string | undefined, ppm: number, cv: Layers, w: number, h: number, seed: number) {
  const mm = (v: number) => v * ppm;
  const W = w / ppm;
  cotton(cv, w, h, seed);
  const press = presser(cv, ppm);
  const local = cardLocal(item, owner);
  const M = 7;
  const maxW = mm(W - 2 * M);
  // the mark, top left: the one colour that is not black, pressed as ink (not foil)
  press((g, c) => {
    g.fillStyle = c;
    disc(g, mm(M + 1), mm(M + 1), mm(1));
  }, PRINT.ai, 62);
  // the local name, top right, its centre on the disc's
  if (local)
    press((g, c) => {
      drawText(g, local, mm(W - M), mm(M + 2.15), { role: "serif", px: mm(3.2), weight: 500, color: c, align: "right", ls: mm(0.3), lang });
    }, PRINT.ink2, 50);
  // name, role, tagline: a block on the lower left
  press((g, c) => {
    drawText(g, item.front.name, mm(M - 0.3), mm(35.6), { role: "serif", px: mm(7), weight: 500, color: c, ls: -mm(0.05), maxW, lang });
  }, PRINT.ink);
  press((g, c) => {
    drawText(g, item.front.role, mm(M), mm(41.6), { role: "serif", px: mm(3.4), weight: 400, color: c, maxW, lang });
  }, PRINT.ink2, 50);
  if (item.front.tagline) {
    const tag = caps(item.front.tagline);
    const han = /\p{Script=Han}/u.test(tag);
    // capitals for Latin (1.6 mm, tracked .14 em); Han is set a little larger, so it reads at the card's size
    const px = mm(han ? 2.1 : 1.6);
    const ls = px * (han ? 0.1 : 0.14);
    const tw = measure(cv.color, tag, { role: "sans", weight: 500, ls, lang }, px);
    const k = tw > maxW ? maxW / tw : 1;
    press((g, c) => {
      drawText(g, tag, mm(M), mm(48.2), { role: "sans", px: px * k, weight: 500, color: c, ls: ls * k, lang });
    }, PRINT.muted, 40);
  }
  inkTooth(cv.color, w, h, COTTON, seed ^ 0x1ee7, 0.28, 0.06);
}

/**
 * The outer back (the inner panel's outside), as the card lies face down and is seen from behind: a small centred ○ and the web
 * address. `mirror` paints it as seen through the panel from the front (the pouch's back cap shares the front's UV grid).
 */
export function paintCardBack(item: BusinessCardItem, lang: string | undefined, ppm: number, cv: Layers, w: number, h: number, seed: number, mirror = false) {
  const mm = (v: number) => v * ppm;
  cotton(cv, w, h, seed, 1.6);
  if (mirror)
    for (const g of [cv.color, cv.bump, cv.rough]) {
      g.save();
      g.translate(w, 0);
      g.scale(-1, 1);
    }
  const press = presser(cv, ppm);
  const W = w / ppm;
  const H = h / ppm;
  const web = cardWeb(item);
  press((g, c) => {
    g.fillStyle = c;
    disc(g, mm(W / 2), mm(H / 2 - (web ? 2.6 : 0)), mm(0.9));
  }, PRINT.ai, 58);
  if (web)
    press((g, c) => {
      drawText(g, web, mm(W / 2), mm(H / 2 + 4.2), { role: "sans", px: mm(2.2), weight: 400, color: c, align: "center", ls: mm(0.09), maxW: mm(W - 20), lang });
    }, PRINT.muted, 40);
  if (mirror) for (const g of [cv.color, cv.bump, cv.rough]) g.restore();
  inkTooth(cv.color, w, h, COTTON, seed ^ 0x2ee7, 0.24, 0.05);
}

export function buildCard(item: BusinessCardItem, ctx: ObjectCtx): ObjectDef {
  const T = new Tracker();
  const PW = Math.round(CARD_W * 1000 * PPM);
  const PH = Math.round(CARD_H * 1000 * PPM);
  const seed = hashStr(item.id) ^ 0x51ed;

  const color = makeCanvas(PW, PH);
  const bump = makeCanvas(PW, PH);
  const rough = makeCanvas(PW / 2, PH / 2);
  rough.g.scale(0.5, 0.5);
  const colorTex = T.add(colorTexture(color.c, ctx));
  const bumpTex = T.add(dataTexture(bump.c, ctx));
  const roughTex = T.add(dataTexture(rough.c, ctx));
  // the outer back: the inner panel's underside, at half the cover's resolution
  const BPW = Math.round(PW / 2);
  const BPH = Math.round((CARD_H - CREASE_R) * 1000 * (PPM / 2));
  const backC = makeCanvas(BPW, BPH);
  const backB = makeCanvas(BPW, BPH);
  const backR = makeCanvas(BPW, BPH);
  const backTex = T.add(colorTexture(backC.c, ctx));
  const backBumpTex = T.add(dataTexture(backB.c, ctx));
  const backRoughTex = T.add(dataTexture(backR.c, ctx));
  const paint = () => {
    paintCardFront(item, ctx.owner, ctx.lang, PPM, { color: color.g, bump: bump.g, rough: rough.g }, PW, PH, seed);
    paintCardBack(item, ctx.lang, PPM / 2, { color: backC.g, bump: backB.g, rough: backR.g }, BPW, BPH, seed ^ 0xbac, true);
    colorTex.needsUpdate = bumpTex.needsUpdate = roughTex.needsUpdate = true;
    backTex.needsUpdate = backBumpTex.needsUpdate = backRoughTex.needsUpdate = true;
  };
  paint();

  // ---- the plain cotton of every other face ----
  const plainCanvas = makeCanvas(256, 154);
  const plainBump = makeCanvas(256, 154);
  paintStockNow(plainCanvas.g, 256, 154, { color: COTTON, seed: seed ^ 0x77, mottle: 2, grain: 2, fibres: 60, bump: plainBump.g, tooth: 20 });
  const plainTex = T.add(colorTexture(plainCanvas.c, ctx));
  const plainBumpTex = T.add(dataTexture(plainBump.c, ctx));

  const coverH = CARD_H - CREASE_R - SHORT;
  const panelH = CARD_H - CREASE_R;
  const coverOutline = roundedRectOutline(CARD_W, coverH, CORNER, 4);
  const panelOutline = roundedRectOutline(CARD_W, panelH, CORNER, 4);
  const coverMask = maskTexture(T, ctx, coverOutline, CARD_W, coverH, 7000);
  const panelMask = maskTexture(T, ctx, panelOutline, CARD_W, panelH, 7000);
  const cotton = { roughness: 0.93, sheen: 0.45, sheenRoughness: 0.85, sheenColor: new THREE.Color("#f6faff") };
  const front = T.material(new THREE.MeshPhysicalMaterial({ ...cotton, map: colorTex, bumpMap: bumpTex, bumpScale: 1.5, roughness: 1, roughnessMap: roughTex, alphaMap: coverMask, alphaTest: 0.5, alphaToCoverage: true }));
  const plainCover = T.material(new THREE.MeshPhysicalMaterial({ map: plainTex, bumpMap: plainBumpTex, bumpScale: 0.8, alphaMap: coverMask, alphaTest: 0.5, alphaToCoverage: true, ...cotton }));
  const plainPanel = T.material(new THREE.MeshPhysicalMaterial({ map: plainTex, bumpMap: plainBumpTex, bumpScale: 0.8, alphaMap: panelMask, alphaTest: 0.5, alphaToCoverage: true, ...cotton }));
  const outerBack = T.material(new THREE.MeshPhysicalMaterial({ ...cotton, map: backTex, bumpMap: backBumpTex, bumpScale: 1.2, roughness: 1, roughnessMap: backRoughTex, alphaMap: panelMask, alphaTest: 0.5, alphaToCoverage: true }));
  const edge = T.material(new THREE.MeshPhysicalMaterial({ color: COTTON_EDGE, ...cotton }));

  const flexU = createFlexUniforms("x", CARD_W / 2, 0.0024);
  // inner panel: flat on the film, from the free edge to the crease
  const panel = slabMesh(T, { outline: panelOutline, w: CARD_W, h: panelH, thickness: LEAF, bevel: 0.00018, nx: 30, ny: 6, front: plainPanel, back: outerBack, edge, flex: flexU, name: "card-panel" });
  panel.mesh.position.y = -CREASE_R / 2;
  // cover: on top, springing open toward its free (bottom) edge
  const cover = slabMesh(T, { outline: coverOutline, w: CARD_W, h: coverH, thickness: LEAF, bevel: 0.00018, z0: LEAF + GAP, nx: 30, ny: 8, front, back: plainCover, edge, flex: flexU, name: "card-cover" });
  const coverY = CARD_H / 2 - CREASE_R - coverH / 2;
  cover.mesh.position.y = coverY;
  bowAlong(cover.mesh.geometry, "y", coverH / 2, SPRING);
  // the crease: half a tube wrapping both leaves along the top edge
  const creaseGeo = T.add(new THREE.CylinderGeometry(CREASE_R, CREASE_R, CARD_W - 2 * CORNER * 0.3, 16, 30, true, 0, Math.PI));
  creaseGeo.rotateZ(Math.PI / 2); // axis along x; the round half faces +y (out of the card's top edge), z from -R to R
  creaseGeo.translate(0, CARD_H / 2 - CREASE_R, CREASE_R);
  const creaseMat = T.material(new THREE.MeshPhysicalMaterial({ map: plainTex, ...cotton }));
  patchFlex(creaseMat, flexU);
  const crease = new THREE.Mesh(creaseGeo, creaseMat);
  crease.frustumCulled = false;
  crease.name = "card-crease";

  const outline = roundedRectOutline(CARD_W, CARD_H, CORNER, 4);
  return {
    spec: { id: item.id, ...CARD_BODY },
    thickness: 2 * LEAF + GAP + SPRING,
    outline,
    parts: [panel.mesh, cover.mesh, crease],
    flex: { uniforms: flexU, axis: "x" },
    tracker: T,
    repaint: paint,
    runs: cardRuns(item, ctx.owner, ctx.lang),
    relabel(next, nctx) {
      if (next.kind !== "card") return null;
      item = next;
      ctx = nctx;
      return cardRuns(item, ctx.owner, ctx.lang);
    },
  };
}

/**
 * Lift a slab's vertices toward its free edge: z += rise * s^2, s = 0 at the hinge side (+half along `axis`) and 1 at the free side
 * (-half), with the cap normals tilted to match. A sheet that was folded never lies quite flat again.
 */
export function bowAlong(geo: THREE.BufferGeometry, axis: "x" | "y", half: number, rise: number, hingeAtPlus = true) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const k = axis === "x" ? 0 : 1;
  for (let i = 0; i < pos.count; i++) {
    const c = k === 0 ? pos.getX(i) : pos.getY(i);
    const s = THREE.MathUtils.clamp(hingeAtPlus ? (half - c) / (2 * half) : (c + half) / (2 * half), 0, 1);
    pos.setZ(i, pos.getZ(i) + rise * s * s);
    const nz = nor.getZ(i);
    if (Math.abs(nz) > 0.9) {
      // d z / d c = rise * 2 s * ds/dc, ds/dc = -1/(2 half) (hinge at +) or +1/(2 half)
      const slope = (rise * 2 * s * (hingeAtPlus ? -1 : 1)) / (2 * half);
      const n = new THREE.Vector3(k === 0 ? -slope * nz : 0, k === 1 ? -slope * nz : 0, nz).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}
