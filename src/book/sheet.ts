import * as THREE from "three";
import { HOLE_R, HOLE_X, MARGIN, PAGE_H, PAGE_W, POCKET_W, SEAM, resolveLayout, type BookLayout } from "./layout";

/*
 * One sheet (two layers of PVC with the cards between them, a plate 0.9 mm thick): pockets holding cards are rigid; only two places
 * are soft — the edge with the holes (a narrow strip from the holes to the first column of pockets), and the heat-sealed seam between
 * the two columns, which holds no card (joined to the space beyond the cards in the pockets on either side, like a hinge).
 * So the whole sheet's shape varies only with u (distance from the spine), and along u it is a chain of circular arcs (a straight
 * segment where the bend is 0):
 *   page edge → hole (along φ) → punched strip start (along φ) → punched strip (turning from φ to θ) → inner column (turning a
 *   further βp1) → seam hinge (a further β2) → outer column (a further βp2)
 * φ: the hole's angle on the ring (hole centre = ring centre + R·(cos φ, sin φ); the hole is always on the ring); θ: the angle of the
 * inner column's pocket panel (0 lying flat on the right, π lying flat on the left).
 * A column holding cards has βp = 0 (rigid); only a column whose pockets are all empty is soft, with βp other than 0.
 * sasshi (round 4, E6): each column is drawn as three arcs whose tangents run through its links' angles (physics.ts
 * pageKnotsInto: never turning further than the links do), and a sheet lying on a stack is held on or above its resting plane (uStack).
 * So the mesh needs only two rows (no deformation along v): one layer each for the front and back faces and a rim all round, in one
 * draw call; the normals are solved analytically.
 * The colour and depth materials run the same deformation, so the shadow bends with the sheet.
 */

export const MM = 0.01;
/** Sheet thickness; spacing between two sheets */
export const SLAB = 0.9 * MM;
/** Roughness of the pockets' clearcoat (at rest; in a fast turn scene.ts raises it by angular speed, as motion blur of the highlight) */
export const GLOSS_ROUGHNESS = 0.14;
export const PITCH = 1.05 * MM;
/**
 * The rim all round is a little thicker than the plate (exactly one pitch): in a pile of sheets the rims meet with no gap between
 * them — otherwise, seen from above at an angle, the stack's side is a run of light edges and dark gaps finer than a pixel, aliasing
 * into a dashed line that flickers as the picture moves
 */
const RIM = PITCH / SLAB;

const A1 = HOLE_X + HOLE_R + 1.2;
const B1 = MARGIN.spine - 1.6;
/** Seam hinge: the seam itself + the space beyond the cards in the pockets on either side (about 1.5 mm each) */
const A2 = MARGIN.spine + POCKET_W - 1.5;
const B2 = MARGIN.spine + POCKET_W + SEAM + 1.5;
/** Segment boundaries (scene units) */
export const SEG = { hole: HOLE_X * MM, a1: A1 * MM, b1: B1 * MM, a2: A2 * MM, b2: B2 * MM, w: PAGE_W * MM, h: PAGE_H * MM };

/** The card layout (the default everywhere below) */
const CARD = resolveLayout("idCard2x3");

/** Segment boundaries in mm for a layout (the same expressions as A1 … B2 above) */
function segMm(L: BookLayout) {
  return { hole: L.hole.x, a1: L.hole.x + L.hole.r + 1.2, b1: L.margin.spine - 1.6, a2: L.margin.spine + L.pocket.w - 1.5, b2: L.margin.spine + L.pocket.w + L.seam + 1.5, w: L.pageW, h: L.pageH };
}

/** A layout's segment boundaries (scene units); segOf(card layout) equals SEG */
export function segOf(L: BookLayout): Seg {
  const m = segMm(L);
  return { hole: m.hole * MM, a1: m.a1 * MM, b1: m.b1 * MM, a2: m.a2 * MM, b2: m.b2 * MM, w: m.w * MM, h: m.h * MM };
}

const f = (n: number) => n.toFixed(5);

/* ── Shape (JS version, matching the shader) ── */
const dir = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];
/** Displacement along a circular arc starting at angle a0, turning through b, of length L (anticlockwise positive) */
function arc(a0: number, b: number, L: number): [number, number] {
  if (Math.abs(b) < 1e-5) return [L * Math.cos(a0), L * Math.sin(a0)];
  return [(L / b) * (Math.sin(a0 + b) - Math.sin(a0)), (L / b) * (Math.cos(a0) - Math.cos(a0 + b))];
}

/** Segment boundaries of one sheet along u (scene units): hole centre, strip start / end, seam hinge start / end, page width and height. */
export type Seg = { hole: number; a1: number; b1: number; a2: number; b2: number; w: number; h: number };

/**
 * Where the pocket panel starts (the punched strip's end, u = b1): the hole at (hx, hz), the strip turning from φ to θ. seg: the
 * sheet's layout (default: the card binder)
 */
export function panelRoot(hx: number, hz: number, phi: number, th: number, seg: Seg = SEG): [number, number] {
  const [dx, dz] = dir(phi);
  const a = seg.a1 - seg.hole;
  const [ax, az] = arc(phi, th - phi, seg.b1 - seg.a1);
  return [hx + dx * a + ax, hz + dz * a + az];
}

/**
 * For a sheet lying flat on the right with its pocket panel's mid-plane at height z: the hole's angle φ on the ring (by bisection).
 * Ring centre (cx, cz), radius r.
 * For one on the left use the mirror image: π − φ
 */
export function restPhi(cx: number, cz: number, r: number, z: number, seg: Seg = SEG): number {
  let lo = -Math.PI / 2 + 0.02;
  let hi = Math.PI / 2 - 0.02;
  const height = (phi: number) => panelRoot(cx + r * Math.cos(phi), cz + r * Math.sin(phi), phi, 0, seg)[1];
  if (z <= height(lo)) return lo;
  if (z >= height(hi)) return hi;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (height(mid) < z) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ── Mesh: two rows × a number of columns (denser where it bends), front and back faces + the rim all round ── */
export function sheetGeometry(L: BookLayout = CARD): THREE.BufferGeometry {
  const { hole: HX, a1: A1, b1: B1, a2: A2, b2: B2, w: PAGE_W } = segMm(L);
  const us: number[] = [0, HX, A1];
  for (let k = 1; k <= 8; k++) us.push(A1 + ((B1 - A1) * k) / 8);
  // pocket panel: an empty column bends, so it is split into segments too (sasshi round 4: nine a column, so its thirds —
  // where the shape's tangent knots are — are vertices)
  for (let k = 1; k <= 9; k++) us.push(B1 + ((A2 - B1) * k) / 9);
  for (let k = 1; k <= 6; k++) us.push(A2 + ((B2 - A2) * k) / 6);
  for (let k = 1; k <= 9; k++) us.push(B2 + ((PAGE_W - B2) * k) / 9);
  const uv: number[] = [];
  const face: number[] = [];
  const off: number[] = [];
  const rim: number[] = [];
  const idx: number[] = [];
  const vert = (u: number, v: number, fc: number, o: number, rx: number, ry: number) => {
    uv.push(u / PAGE_W, v);
    face.push(fc);
    off.push(o);
    rim.push(rx, ry);
    return face.length - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  // front and back faces
  for (const [fc, o] of [
    [1, 1],
    [-1, -1],
  ] as const) {
    const row0 = us.map((u) => vert(u, 0, fc, o, 0, 0));
    const row1 = us.map((u) => vert(u, 1, fc, o, 0, 0));
    for (let i = 0; i + 1 < us.length; i++) {
      if (fc === 1) quad(row0[i]!, row0[i + 1]!, row1[i + 1]!, row1[i]!);
      else quad(row0[i]!, row1[i]!, row1[i + 1]!, row0[i + 1]!);
    }
  }
  // top and bottom rims (v = 0, 1)
  for (const [v, ry] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const t = us.map((u) => vert(u, v, 0, 1, 0, ry));
    const b = us.map((u) => vert(u, v, 0, -1, 0, ry));
    for (let i = 0; i + 1 < us.length; i++) quad(t[i]!, b[i]!, b[i + 1]!, t[i + 1]!);
  }
  // left and right rims (u = 0, page width)
  for (const [u, rx] of [
    [0, -1],
    [PAGE_W, 1],
  ] as const) {
    quad(vert(u, 0, 0, 1, rx, 0), vert(u, 1, 0, 1, rx, 0), vert(u, 1, 0, -1, rx, 0), vert(u, 0, 0, -1, rx, 0));
  }
  const g = new THREE.BufferGeometry();
  const n = face.length;
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aFace", new THREE.Float32BufferAttribute(face, 1));
  g.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 1));
  g.setAttribute("aRim", new THREE.Float32BufferAttribute(rim, 2));
  g.setIndex(idx);
  // positions are computed in the shader: an enlarged bounding sphere, so it is not frustum-culled
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
  return g;
}

/* ── Shaders ── (sasshi: generated per layout; the program cache key carries the layout hash) */
const pathGlsl = (SEG: Seg) => /* glsl */ `
uniform vec2 uHole;
// φ: the hole's angle on the ring
uniform float uPhi;
// sasshi (round 4, E6): the inner / outer column's tangent at 0, 1/3, 2/3 and 1 of it (physics.ts pageKnotsInto); the strip
// turns from φ to uIn.x, the seam hinge from uIn.w to uOut.x
uniform vec4 uIn;
uniform vec4 uOut;
// the stacks when the sheet lies on one: x the left stack's resting mid-plane height for this sheet, y the right one's, z the ring
// axis (x), w 1 to keep the panel on or above them (the same planes the physics keeps its joints above)
uniform vec4 uStack;
attribute float aFace;
attribute float aOff;
attribute vec2 aRim;
varying vec2 vSheetUv;
varying float vFace;

vec2 sDir(float a) { return vec2(cos(a), sin(a)); }
vec2 sArc(float a0, float b, float L) {
  if (abs(b) < 1e-5) return L * sDir(a0);
  return (L / b) * vec2(sin(a0 + b) - sin(a0), cos(a0) - cos(a0 + b));
}
// u (scene units, from the sheet's spine-side edge) → the mid-surface's position in the xz plane; ang is the tangent angle there
// one circular arc: from p, start angle a0, length L, total bend b; when u falls in it (s from its start) returns the position and the
// tangent angle, otherwise moves p and a0 on to the arc's end
bool sSeg(float u, float u0, float L, float b, inout vec2 p, inout float a0, out vec2 q, out float ang) {
  float s = u - u0;
  if (s <= L) { float k = s / L; ang = a0 + b * k; q = p + sArc(a0, b * k, s); return true; }
  p += sArc(a0, b, L);
  a0 += b;
  return false;
}
vec2 sheetPath(float u, out float ang) {
  float phi = uPhi;
  if (u <= ${f(SEG.a1)}) { ang = phi; return uHole + (u - ${f(SEG.hole)}) * sDir(phi); }
  vec2 p = uHole + ${f(SEG.a1 - SEG.hole)} * sDir(phi);
  float a = phi;
  vec2 q;
  if (sSeg(u, ${f(SEG.a1)}, ${f(SEG.b1 - SEG.a1)}, uIn.x - phi, p, a, q, ang)) return q;
  // inner column: three arcs (tangents at the thirds: uIn)
  if (sSeg(u, ${f(SEG.b1)}, ${f((SEG.a2 - SEG.b1) / 3)}, uIn.y - uIn.x, p, a, q, ang)) return q;
  if (sSeg(u, ${f(SEG.b1 + (SEG.a2 - SEG.b1) / 3)}, ${f((SEG.a2 - SEG.b1) / 3)}, uIn.z - uIn.y, p, a, q, ang)) return q;
  if (sSeg(u, ${f(SEG.b1 + (2 * (SEG.a2 - SEG.b1)) / 3)}, ${f((SEG.a2 - SEG.b1) / 3)}, uIn.w - uIn.z, p, a, q, ang)) return q;
  if (sSeg(u, ${f(SEG.a2)}, ${f(SEG.b2 - SEG.a2)}, uOut.x - uIn.w, p, a, q, ang)) return q;
  if (sSeg(u, ${f(SEG.b2)}, ${f((SEG.w - SEG.b2) / 3)}, uOut.y - uOut.x, p, a, q, ang)) return q;
  if (sSeg(u, ${f(SEG.b2 + (SEG.w - SEG.b2) / 3)}, ${f((SEG.w - SEG.b2) / 3)}, uOut.z - uOut.y, p, a, q, ang)) return q;
  // the outer column's last arc, no bounds check (u ends at the sheet's edge)
  float s = u - ${f(SEG.b2 + (2 * (SEG.w - SEG.b2)) / 3)};
  float k = s / ${f((SEG.w - SEG.b2) / 3)};
  float b = uOut.w - uOut.z;
  ang = a + b * k;
  return p + sArc(a, b * k, s);
}
vec3 sheetPos(vec2 uv, float off, out vec3 nrm, out vec3 tng) {
  float a;
  float u = uv.x * ${f(SEG.w)};
  vec2 p = sheetPath(u, a);
  // sasshi (round 4, E6): lying open on a stack, the panel never dips below its resting plane — the sheet under it is only
  // PITCH − SLAB (0.15 mm) lower
  if (uStack.w > 0.5 && u >= ${f(SEG.b1)}) p.y = max(p.y, p.x > uStack.z ? uStack.y : uStack.x);
  vec2 t = sDir(a);
  vec2 n = vec2(-t.y, t.x);
  p += n * off * ${f(SLAB / 2)};
  nrm = vec3(n.x, 0.0, n.y);
  tng = vec3(t.x, 0.0, t.y);
  return vec3(p.x, (uv.y - 0.5) * ${f(SEG.h)}, p.y);
}
`;

/** Punching: fragments are discarded by their distance from the hole centres (on the front and back faces only) */
const holesGlsl = (L: BookLayout) => /* glsl */ `
if (abs(vFace) > 0.5) {
  vec2 mm = vec2(vSheetUv.x * ${f(L.pageW)}, (vSheetUv.y - 0.5) * ${f(L.pageH)});
  ${L.rings.map((y) => `if (distance(mm, vec2(${f(L.hole.x)}, ${f(y)})) < ${f(L.hole.r)}) discard;`).join("\n  ")}
}
`;

export type SheetUniforms = {
  uHole: { value: THREE.Vector2 };
  uPhi: { value: number };
  uIn: { value: THREE.Vector4 };
  uOut: { value: THREE.Vector4 };
  uStack: { value: THREE.Vector4 };
  uBackMap: { value: THREE.Texture };
  uEdge: { value: THREE.Color };
};

/**
 * sasshi (round 4, E6): sheetPath in JS (the tests check the drawn shape against the stacks): the mid-plane point (x, z) at u
 * (scene units from the spine-side edge) and its tangent angle, for the hole at (hx, hz), φ and the columns' tangent knots `k`
 * (pageKnotsInto's out[1 … 8]). Without the stack clamp.
 */
export function sheetPathAt(u: number, hx: number, hz: number, phi: number, k: ArrayLike<number>, seg: Seg = SEG): [x: number, z: number, ang: number] {
  if (u <= seg.a1) return [hx + (u - seg.hole) * Math.cos(phi), hz + (u - seg.hole) * Math.sin(phi), phi];
  let x = hx + (seg.a1 - seg.hole) * Math.cos(phi);
  let z = hz + (seg.a1 - seg.hole) * Math.sin(phi);
  let a = phi;
  const l1 = (seg.a2 - seg.b1) / 3;
  const l2 = (seg.w - seg.b2) / 3;
  const parts: [number, number][] = [
    [seg.b1 - seg.a1, k[0]! - phi],
    [l1, k[1]! - k[0]!],
    [l1, k[2]! - k[1]!],
    [l1, k[3]! - k[2]!],
    [seg.b2 - seg.a2, k[4]! - k[3]!],
    [l2, k[5]! - k[4]!],
    [l2, k[6]! - k[5]!],
    [l2, k[7]! - k[6]!],
  ];
  let s = u - seg.a1;
  for (let i = 0; i < parts.length; i++) {
    const [L, b] = parts[i]!;
    if (s <= L || i === parts.length - 1) {
      const [dx, dz] = arc(a, (b * s) / L, s);
      return [x + dx, z + dz, a + (b * s) / L];
    }
    const [dx, dz] = arc(a, b, L);
    x += dx;
    z += dz;
    a += b;
    s -= L;
  }
  return [x, z, a];
}

export function sheetMaterials(u: SheetUniforms, normal: THREE.Texture, front: THREE.Texture, L: BookLayout = CARD) {
  const PATH = pathGlsl(segOf(L));
  const HOLES = holesGlsl(L);
  const mat = new THREE.MeshPhysicalMaterial({
    map: front,
    side: THREE.DoubleSide,
    roughness: 0.48,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: GLOSS_ROUGHNESS,
    clearcoatNormalMap: normal,
    clearcoatNormalScale: new THREE.Vector2(0.9, 0.9),
    normalMap: normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    ior: 1.54,
    specularIntensity: 0.6,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = PATH + sh.vertexShader;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
        vec3 sheetN;
        vec3 sheetT;
        vec3 sheetP = sheetPos(uv, aOff * (abs(aFace) > 0.5 ? 1.0 : ${f(RIM)}), sheetN, sheetT);
        // the rim around the sheet is only 1 mm thick, thinner than a pixel seen from above at an angle: shaded by its true facing (away
        // from the light) it would be a dark line aliasing into dashes. The normal is bent upward, so it is about as bright as the panel beside it
        vec3 objectNormal = aFace > 0.5 ? sheetN : aFace < -0.5 ? -sheetN : normalize((abs(aRim.x) > 0.5 ? sheetT * aRim.x : vec3(0.0, aRim.y, 0.0)) + vec3(0.0, 0.0, 1.6));
        vSheetUv = uv;
        vFace = aFace;`,
      )
      .replace("#include <begin_vertex>", "vec3 transformed = sheetP;");
    sh.fragmentShader = "uniform sampler2D uBackMap;\nuniform vec3 uEdge;\nvarying vec2 vSheetUv;\nvarying float vFace;\n" + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader
      // the plate is closed and every face's normals already point outwards: no flipping by front / back facing
      .replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace("float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;", "float faceDirection = 1.0;"))
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + HOLES)
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        #ifdef USE_MAP
          vec4 sheetFace = vFace > 0.5 ? texture2D(map, vMapUv) : vFace < -0.5 ? texture2D(uBackMap, vec2(1.0 - vMapUv.x, vMapUv.y)) : vec4(uEdge, 1.0);
          diffuseColor *= sheetFace;
        #endif`,
      )
      // the rim all round is very narrow and the texture's tangent space degenerates there: no normal map
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nif (abs(vFace) < 0.5) normal = nonPerturbedNormal;")
      .replace("#include <clearcoat_normal_fragment_maps>", "#include <clearcoat_normal_fragment_maps>\nif (abs(vFace) < 0.5) clearcoatNormal = nonPerturbedNormal;");
  };
  mat.customProgramCacheKey = () => `album-sheet-plate|${L.hash}`;

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = PATH + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace(
      "#include <begin_vertex>",
      `vec3 sheetN;\nvec3 sheetT;\nvec3 transformed = sheetPos(uv, aOff * (abs(aFace) > 0.5 ? 1.0 : ${f(RIM)}), sheetN, sheetT);\nvSheetUv = uv;\nvFace = aFace;`,
    );
    sh.fragmentShader = "varying vec2 vSheetUv;\nvarying float vFace;\n" + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader.replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + HOLES);
  };
  depth.customProgramCacheKey = () => `album-sheet-plate-depth|${L.hash}`;
  return { mat, depth };
}
