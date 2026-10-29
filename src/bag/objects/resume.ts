/*
 * Résumé: two A5 sheets (148 x 210 mm, the A4 pages printed at 71 %), stapled once at the top left corner. The top sheet shows the
 * real first page, set by the paper viewer's own typesetter (paper/typeset.ts: name, role, summary, the first jobs, in Shippori
 * Mincho and Zen Kaku on cool white stock); the second sheet carries page 2 and shows 1–2 mm past the first at the
 * foot and the free edge, so the stack reads as two sheets. Both remember the fold they were posted in: a soft ridge across the
 * middle, in the geometry and in the light. Layer 0 (the big paper at the back). Flexes a little along its long axis.
 */
import * as THREE from "three";
import type { FontRun } from "../../fonts";
import { canvasMeasure, layoutResume, layoutRuns, PAGE, paintOps, resumeLang, type Owner as PrintOwner } from "../../paper/typeset";
import { createFlexUniforms } from "./flex";
import { maskTexture, slabMesh } from "./parts";
import type { ObjectDef } from "./rig";
import { colorTexture, dataTexture, hashStr, inkTooth, makeCanvas, paintStock, paintStockNow, printWebOn, Tracker, type V2 } from "./shared";
import { roundedRectOutline } from "./slab";
import type { BodySpec, ObjectCtx } from "./types";
import type { ResumeItem } from "../../profile/schema";

export const RESUME_W = 0.148;
export const RESUME_H = 0.21;
/** one sheet of 100 gsm bond (0.11 mm), drawn a little thicker so its edge still catches the light at pouch scale */
const LEAF = 0.0002;
const GAP = 0.00005;
/** the second sheet shows past the first: to the right and at the foot (m), and turned a hair */
const PEEK_X = 0.0007;
const PEEK_Y = 0.0016;
const TWIST = (0.35 * Math.PI) / 180;
/** the fold the sheets were posted in: a ridge across the middle (m) */
const FOLD_RISE = 0.00055;
const PAPER = "#f6f7f4";
const EDGE = "#e9ecea";
/** px per mm of the top page, and of the page underneath (it only shows at its edges) */
const PPM = 8;
const PPM_UNDER = 3;
/** The body: both sheets (their bounding box), the bottom layer. */
export const RESUME_BODY: Omit<BodySpec, "id"> = { w: RESUME_W + PEEK_X + 0.0008, h: RESUME_H + PEEK_Y + 0.0008, layer: 0, shape: "rect", mass: 0.007 };
/** the A4 page printed on A5 */
const K = (RESUME_W * 1000) / PAGE.w;
/** the staple: a 12 mm crown of 0.6 mm wire, its middle 6 mm in from each edge at the top left corner, across it at 35 degrees */
const STAPLE = { crown: 0.012, wire: 0.0006, inset: 0.006, angle: (35 * Math.PI) / 180 };

/** Raise a sheet along its middle: the ridge of an old fold (a soft tent across x, peaking at y = 0). */
function foldMemory(geo: THREE.BufferGeometry, half: number, rise: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const u = Math.min(1, Math.abs(y) / half);
    const f = (1 - u) ** 2.2;
    pos.setZ(i, pos.getZ(i) + rise * f);
    const nz = nor.getZ(i);
    if (Math.abs(nz) > 0.9) {
      // dz/dy = -rise * 2.2 (1 - u)^1.2 * sign(y) / half
      const slope = (-rise * 2.2 * (1 - u) ** 1.2 * Math.sign(y)) / half;
      const n = new THREE.Vector3(0, -slope * nz, nz).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/** The crease of the old fold in the print: a fine shade line with a light edge above it (canvas px, the sheet's middle). */
function paintCrease(g: CanvasRenderingContext2D, w: number, h: number, ppm: number) {
  const y = h / 2;
  const sh = g.createLinearGradient(0, y - 1.2 * ppm, 0, y + 1.6 * ppm);
  sh.addColorStop(0, "rgba(255,255,255,0)");
  sh.addColorStop(0.42, "rgba(255,255,255,0.18)");
  sh.addColorStop(0.5, "rgba(40,52,66,0.035)");
  sh.addColorStop(1, "rgba(40,52,66,0)");
  g.fillStyle = sh;
  g.fillRect(0, y - 1.2 * ppm, w, 2.8 * ppm);
}

export function buildResume(item: ResumeItem, ctx: ObjectCtx): ObjectDef {
  const T = new Tracker();
  const seed = hashStr(item.id) ^ 0x7e57;
  // whose and in which language (relabel() sets them again for another one)
  let owner: PrintOwner | undefined;
  let lang: string | undefined;
  const words = () => {
    owner = ctx.owner ? { ...ctx.owner, ...(ctx.lang ? { lang: ctx.lang } : {}) } : undefined;
    lang = resumeLang(item, owner);
  };
  words();
  /** the two sheets' pages, typeset like the paper viewer's (print scale), and exactly the strings they print */
  const typeset = () => {
    const local = !printWebOn();
    const L = layoutResume(item, owner, 1, canvasMeasure(lang, local));
    const runs: FontRun[] = layoutRuns({ ...L, pages: L.pages.slice(0, 2) }, lang);
    return { L, local, runs };
  };

  const PW = Math.round(RESUME_W * 1000 * PPM);
  const PH = Math.round(RESUME_H * 1000 * PPM);
  const top = makeCanvas(PW, PH);
  const topBump = makeCanvas(PW, PH);
  const UW = Math.round(RESUME_W * 1000 * PPM_UNDER);
  const UH = Math.round(RESUME_H * 1000 * PPM_UNDER);
  const under = makeCanvas(UW, UH);
  const topTex = T.add(colorTexture(top.c, ctx));
  const topBumpTex = T.add(dataTexture(topBump.c, ctx));
  const underTex = T.add(colorTexture(under.c, ctx));
  /** the staple's two legs bite into the top sheet: positions on the page (mm from its top left) */
  const legs: V2[] = (() => {
    const c = STAPLE.inset * 1000;
    const hx = ((STAPLE.crown * 1000) / 2) * Math.cos(STAPLE.angle);
    const hy = ((STAPLE.crown * 1000) / 2) * Math.sin(STAPLE.angle);
    return [
      [c - hx, c + hy],
      [c + hx, c - hy],
    ];
  })();

  let runs: FontRun[] = [];
  const paint = () => {
    // the pages are typeset like the paper viewer's (print scale), then printed on A5
    const t = typeset();
    const { L, local } = t;
    paintStock(top.g, PW, PH, { color: PAPER, seed, mottle: 1.4, grain: 1.8, bump: topBump.g, tooth: 10 });
    paintOps(top.g, L.pages[0] ?? [], PPM * K, lang, local);
    inkTooth(top.g, PW, PH, PAPER, seed ^ 0x3, 0.16, 0.04);
    paintCrease(top.g, PW, PH, PPM);
    // the staple's shadow on the sheet (the window light is top right: it falls down and to the left)
    {
      const [a, b] = legs as [V2, V2];
      top.g.save();
      top.g.strokeStyle = "rgba(21,35,58,0.22)";
      top.g.lineCap = "round";
      top.g.lineWidth = 0.7 * PPM;
      top.g.filter = `blur(${(0.3 * PPM).toFixed(1)}px)`;
      top.g.beginPath();
      top.g.moveTo((a[0] - 0.35) * PPM, (a[1] + 0.55) * PPM);
      top.g.lineTo((b[0] - 0.35) * PPM, (b[1] + 0.55) * PPM);
      top.g.stroke();
      top.g.restore();
    }
    // the staple's crown, painted on the sheet with its relief in the bump map (a 0.6 mm wire is two or three pixels at pouch scale:
    // a mesh of it aliased into a dashed line). Steel grey, a 0.2 mm highlight on the side towards the window (top right), the other
    // edge in shade.
    {
      const [a, b] = legs as [V2, V2];
      const nx = -Math.sin(STAPLE.angle), ny = -Math.cos(STAPLE.angle); // the crown's normal towards the light (page: y down)
      const seg = (g: CanvasRenderingContext2D, w: number, color: string, off: number) => {
        g.strokeStyle = color;
        g.lineWidth = w * PPM;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo((a[0] + nx * off) * PPM, (a[1] + ny * off) * PPM);
        g.lineTo((b[0] + nx * off) * PPM, (b[1] + ny * off) * PPM);
        g.stroke();
      };
      const wire = STAPLE.wire * 1000;
      seg(top.g, wire, "#8d979f", 0);
      seg(top.g, wire * 0.4, "#5b6670", -wire * 0.28);
      seg(top.g, 0.2, "#f1f4f6", wire * 0.22);
      seg(topBump.g, wire, "rgb(190,190,190)", 0);
    }
    // where the staple's legs bent through: a 0.8 mm dark point at each end (the leg going into the paper) in a 0.4 mm pressed dent
    for (const [x, y] of legs) {
      const r = top.g.createRadialGradient(x * PPM, y * PPM, 0, x * PPM, y * PPM, 0.4 * PPM);
      r.addColorStop(0, "rgba(28,35,43,0.7)");
      r.addColorStop(0.6, "rgba(28,35,43,0.35)");
      r.addColorStop(1, "rgba(28,35,43,0)");
      top.g.fillStyle = r;
      top.g.fillRect((x - 0.5) * PPM, (y - 0.5) * PPM, 1 * PPM, 1 * PPM);
      topBump.g.fillStyle = "rgb(70,70,70)";
      topBump.g.beginPath();
      topBump.g.arc(x * PPM, y * PPM, 0.4 * PPM, 0, Math.PI * 2);
      topBump.g.fill();
    }
    paintStock(under.g, UW, UH, { color: PAPER, seed: seed ^ 0x2, mottle: 1.4, grain: 1.6, fibres: 120 });
    paintOps(under.g, L.pages[1] ?? L.pages[0] ?? [], PPM_UNDER * K, lang, local);
    paintCrease(under.g, UW, UH, PPM_UNDER);
    topTex.needsUpdate = topBumpTex.needsUpdate = underTex.needsUpdate = true;
    // exactly the strings the two sheets print, each in its own face and weight (not every string in every face)
    runs = t.runs;
  };
  paint();

  const plain = makeCanvas(256, 362);
  const plainBump = makeCanvas(256, 362);
  paintStockNow(plain.g, 256, 362, { color: PAPER, seed: seed ^ 0x99, mottle: 1.4, grain: 2, fibres: 80, bump: plainBump.g, tooth: 10 });
  paintCrease(plain.g, 256, 362, 256 / 148);
  const plainTex = T.add(colorTexture(plain.c, ctx));
  const plainBumpTex = T.add(dataTexture(plainBump.c, ctx));

  const paper = { roughness: 0.9, sheen: 0.3, sheenRoughness: 0.9, sheenColor: new THREE.Color("#f6faff") };
  const outline1 = roundedRectOutline(RESUME_W, RESUME_H, 0.0004, 3);
  const mask = maskTexture(T, ctx, outline1, RESUME_W, RESUME_H, 3000);
  const front = T.material(new THREE.MeshPhysicalMaterial({ ...paper, map: topTex, bumpMap: topBumpTex, bumpScale: 0.7, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const underFront = T.material(new THREE.MeshPhysicalMaterial({ ...paper, map: underTex, bumpMap: plainBumpTex, bumpScale: 0.6, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const back = T.material(new THREE.MeshPhysicalMaterial({ ...paper, map: plainTex, bumpMap: plainBumpTex, bumpScale: 0.6, alphaMap: mask, alphaTest: 0.5, alphaToCoverage: true }));
  const edge = T.material(new THREE.MeshPhysicalMaterial({ ...paper, color: EDGE }));

  const flexU = createFlexUniforms("y", RESUME_H / 2, 0.0016);
  // the second sheet, flat on the film: a hair right and lower, turned a little
  const lower = slabMesh(T, { outline: outline1, w: RESUME_W, h: RESUME_H, thickness: LEAF, bevel: 0.00005, nx: 4, ny: 36, front: underFront, back, edge, flex: flexU, name: "resume-under" });
  foldMemory(lower.mesh.geometry, RESUME_H / 2, FOLD_RISE);
  lower.mesh.position.set(PEEK_X / 2, -PEEK_Y / 2, 0);
  lower.mesh.rotation.z = -TWIST;
  // the first page, on it
  const upper = slabMesh(T, { outline: outline1, w: RESUME_W, h: RESUME_H, thickness: LEAF, bevel: 0.00005, z0: LEAF + GAP, nx: 4, ny: 36, front, back, edge, flex: flexU, name: "resume-top" });
  foldMemory(upper.mesh.geometry, RESUME_H / 2, FOLD_RISE);
  upper.mesh.position.set(-PEEK_X / 2, PEEK_Y / 2, 0);

  // footprint: both sheets (the body is their bounding box)
  const lowerOutline: V2[] = outline1.map(([x, y]) => {
    const c = Math.cos(-TWIST), s = Math.sin(-TWIST);
    return [x * c - y * s + PEEK_X / 2, x * s + y * c - PEEK_Y / 2];
  });
  const upperOutline: V2[] = outline1.map(([x, y]) => [x - PEEK_X / 2, y + PEEK_Y / 2]);
  const BW = RESUME_BODY.w;
  const BH = RESUME_BODY.h;
  return {
    spec: { id: item.id, ...RESUME_BODY },
    thickness: 2 * LEAF + GAP + FOLD_RISE + STAPLE.wire,
    outline: roundedRectOutline(BW, BH, 0.0006, 3),
    shadowPolys: [upperOutline, lowerOutline],
    parts: [lower.mesh, upper.mesh],
    flex: { uniforms: flexU, axis: "y" },
    tracker: T,
    repaint: paint,
    runs,
    relabel(next, nctx) {
      if (next.kind !== "resume") return null;
      item = next;
      ctx = nctx;
      words();
      return typeset().runs;
    },
  };
}
