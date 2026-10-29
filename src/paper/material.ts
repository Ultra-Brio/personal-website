/*
 * Paper surfaces for the viewer: a sheet whose shape only varies along its length (it bends about lines parallel to the binding /
 * the crease), so the mesh is two rows of vertices and the vertex shader places them on a path of circular arcs (the knots from
 * presets.ts: arc length + tangent angle, the tangent varies linearly between knots). Normals are analytic; there is no seam.
 * Adapted from the album's sheet.ts idea, but generic: any knot list, paper material, separate meshes per face.
 *
 * Frame ("chain frame"): x along the sheet from its root, y across it, z up off the desk. Everything a viewer shows (sheets, desk)
 * lives in one group in this frame, so the shadow maths can compare heights directly.
 *
 * Fragment extras:
 *  - analytic soft shadow: the one sheet in the air (the caster, sampled into uCast) is projected along the key light onto each
 *    receiving point's own height; penumbra grows with the gap, the shadow lightens as the sheet rises. Desk, stack and the sheet
 *    itself receive it (only where they lie flat).
 *  - translucency: a face turned away from the key light glows with light coming through the sheet, minus the print on the other
 *    side; and the other side's print always shows through faintly (real paper show-through, mirrored).
 */
import * as THREE from "three";
import { MAX_KNOTS, type Knots } from "./presets";

export const CAST_N = 16;

export type ChainUniforms = {
  uKs: { value: Float32Array };
  uKa: { value: Float32Array };
  uKn: { value: number };
  /** root of the sheet in the chain frame (x, y of the sheet's centre line, z) */
  uRoot: { value: THREE.Vector3 };
  uLen: { value: number };
  uSpan: { value: number };
  uHalfT: { value: number };
};

export type ShadowUniforms = {
  uCast: { value: THREE.Vector4[] };
  uCastN: { value: number };
  /** y extent of the caster (chain frame) */
  uCastY: { value: THREE.Vector2 };
  /** key light direction (towards the light) in the chain frame */
  uLightL: { value: THREE.Vector3 };
  /** key light direction in world space */
  uLightW: { value: THREE.Vector3 };
  uShadowK: { value: number };
  uTrans: { value: number };
  /** id of the casting sheet: a sheet never shadows itself (its sampled chords would stripe it) */
  uCastId: { value: number };
};

export function chainUniforms(len: number, span: number, thickness: number): ChainUniforms {
  return {
    uKs: { value: new Float32Array(MAX_KNOTS) },
    uKa: { value: new Float32Array(MAX_KNOTS) },
    uKn: { value: 0 },
    uRoot: { value: new THREE.Vector3() },
    uLen: { value: len },
    uSpan: { value: span },
    uHalfT: { value: thickness / 2 },
  };
}

export function shadowUniforms(): ShadowUniforms {
  return {
    uCast: { value: Array.from({ length: CAST_N }, () => new THREE.Vector4()) },
    uCastN: { value: 0 },
    uCastY: { value: new THREE.Vector2(-1, 1) },
    uLightL: { value: new THREE.Vector3(0, 0, 1) },
    uLightW: { value: new THREE.Vector3(0, 0, 1) },
    uShadowK: { value: 0.5 },
    uTrans: { value: 0.3 },
    uCastId: { value: -1 },
  };
}

/** Copy knots into a sheet's uniforms */
export function setKnots(u: ChainUniforms, k: Knots) {
  u.uKs.value.set(k.s.subarray(0, MAX_KNOTS));
  u.uKa.value.set(k.a.subarray(0, MAX_KNOTS));
  u.uKn.value = k.count;
}

/* ── geometry: per-face strips (two rows) and the rim ── */

/** Column positions along the sheet, 0…1 */
export function columns(n: number, extra: number[] = []): number[] {
  const us = new Set<number>();
  for (let i = 0; i <= n; i++) us.add(i / n);
  for (const e of extra) if (e > 0 && e < 1) us.add(e);
  return [...us].sort((a, b) => a - b);
}

/**
 * One face of the sheet. front: the +n side, texture uv = (s, v); back: the −n side, uv = (1 − s, v) — the back's texture is painted
 * as seen when the sheet has turned over about the y axis.
 */
export function faceGeometry(us: number[], side: "front" | "back"): THREE.BufferGeometry {
  const uv: number[] = [];
  const s: number[] = [];
  const idx: number[] = [];
  for (const v of [0, 1])
    for (const u of us) {
      uv.push(side === "front" ? u : 1 - u, v);
      s.push(u);
    }
  const n = us.length;
  for (let i = 0; i + 1 < n; i++) {
    const a = i;
    const b = i + 1;
    const c = n + i + 1;
    const d = n + i;
    if (side === "front") idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  const count = s.length;
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1));
  const f = side === "front" ? 1 : -1;
  g.setAttribute("aFace", new THREE.Float32BufferAttribute(new Float32Array(count).fill(f), 1));
  g.setAttribute("aOff", new THREE.Float32BufferAttribute(new Float32Array(count).fill(f), 1));
  g.setAttribute("aRim", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  g.setIndex(idx);
  // positions are computed in the shader: a generous bound so the sheet is never culled
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
  return g;
}

/** The four cut edges of the sheet (its thickness). uv.x = across the thickness (0 back … 1 front) for an edge colour ramp. */
export function rimGeometry(us: number[]): THREE.BufferGeometry {
  const uv: number[] = [];
  const s: number[] = [];
  const off: number[] = [];
  const rim: number[] = [];
  const idx: number[] = [];
  const vert = (u: number, v: number, o: number, rx: number, ry: number) => {
    uv.push((o + 1) / 2, v);
    s.push(u);
    off.push(o);
    rim.push(rx, ry);
    return s.length - 1;
  };
  for (const [v, ry] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const top = us.map((u) => vert(u, v, 1, 0, ry));
    const bot = us.map((u) => vert(u, v, -1, 0, ry));
    for (let i = 0; i + 1 < us.length; i++) {
      if (ry > 0) idx.push(top[i]!, bot[i]!, bot[i + 1]!, top[i]!, bot[i + 1]!, top[i + 1]!);
      else idx.push(top[i]!, bot[i + 1]!, bot[i]!, top[i]!, top[i + 1]!, bot[i + 1]!);
    }
  }
  for (const [u, rx] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const a = vert(u, 0, 1, rx, 0);
    const b = vert(u, 1, 1, rx, 0);
    const c = vert(u, 1, -1, rx, 0);
    const d = vert(u, 0, -1, rx, 0);
    if (rx > 0) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  const count = s.length;
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1));
  g.setAttribute("aFace", new THREE.Float32BufferAttribute(new Float32Array(count), 1));
  g.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 1));
  g.setAttribute("aRim", new THREE.Float32BufferAttribute(rim, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
  return g;
}

/* ── shaders ── */

const PATH = /* glsl */ `
uniform float uKs[${MAX_KNOTS}];
uniform float uKa[${MAX_KNOTS}];
uniform int uKn;
uniform vec3 uRoot;
uniform float uLen;
uniform float uSpan;
uniform float uHalfT;
attribute float aS;
attribute float aFace;
attribute float aOff;
attribute vec2 aRim;
varying vec3 vLocal;
varying float vFace;
varying float vNz;
varying vec2 vPaperUv;
varying float vOff;

vec2 kDir(float a) { return vec2(cos(a), sin(a)); }
vec2 kArc(float a0, float b, float L) {
  if (abs(b) < 1e-5) return L * kDir(a0);
  return (L / b) * vec2(sin(a0 + b) - sin(a0), cos(a0) - cos(a0 + b));
}
// arc length s → point on the sheet's mid-surface (chain plane: x along, y up); ang = tangent angle there
vec2 kPath(float s, out float ang) {
  ang = uKa[0];
  if (s <= 0.0) return s * kDir(uKa[0]);
  vec2 p = vec2(0.0);
  for (int i = 0; i < ${MAX_KNOTS - 1}; i++) {
    if (i + 1 >= uKn) break;
    float s0 = uKs[i];
    float s1 = uKs[i + 1];
    float a0 = uKa[i];
    float a1 = uKa[i + 1];
    float len = max(s1 - s0, 1e-6);
    if (s <= s1 || i + 2 >= uKn) {
      float d = min(s - s0, len);
      float bend = (a1 - a0) * d / len;
      p += kArc(a0, bend, d);
      ang = a0 + bend;
      if (s > s1) {
        p += (s - s1) * kDir(a1);
        ang = a1;
      }
      return p;
    }
    p += kArc(a0, a1 - a0, len);
  }
  return p;
}
`;

const VERT_MAIN = /* glsl */ `
float kAng;
vec2 kP = kPath(aS * uLen, kAng);
vec2 kT = kDir(kAng);
vec2 kN = vec2(-kT.y, kT.x);
vec2 kQ = kP + kN * (aOff * uHalfT);
vec3 paperPos = vec3(uRoot.x + kQ.x, uRoot.y + (uv.y - 0.5) * uSpan, uRoot.z + kQ.y);
vec3 objectNormal = aFace > 0.5 ? vec3(kN.x, 0.0, kN.y) : aFace < -0.5 ? -vec3(kN.x, 0.0, kN.y) : (abs(aRim.x) > 0.5 ? vec3(kT.x, 0.0, kT.y) * aRim.x : vec3(0.0, aRim.y, 0.0));
vLocal = paperPos;
vFace = aFace;
vNz = aFace > 0.5 ? kN.y : aFace < -0.5 ? -kN.y : 0.0;
vPaperUv = vec2(aS, uv.y);
vOff = aOff;
`;

export const SHADOW_FN = /* glsl */ `
uniform vec4 uCast[${CAST_N}];
uniform int uCastN;
uniform vec2 uCastY;
uniform vec3 uLightL;
// Soft shadow of the sheet in the air on a point p lying flat (nz = how flat it lies). Each caster segment is projected along the
// light onto p's height and box-filtered with a penumbra that grows with the gap; adjacent segments tile, so the sum is seamless.
float paperShadow(vec3 p, float nz) {
  if (uCastN < 2 || nz < 0.5) return 0.0;
  vec2 lxy = uLightL.xy / max(uLightL.z, 0.2);
  float sum = 0.0;
  for (int i = 0; i < ${CAST_N - 1}; i++) {
    if (i + 1 >= uCastN) break;
    vec3 a = uCast[i].xyz;
    vec3 b = uCast[i + 1].xyz;
    float ha = a.z - p.z;
    float hb = b.z - p.z;
    if (max(ha, hb) < 0.0008) continue;
    float xa = a.x - ha * lxy.x;
    float xb = b.x - hb * lxy.x;
    // soft step at each end of the projected segment, its width set by the height at that end: neighbours share an end, so
    // their coverages tile exactly (no seams), and a curl that folds back over itself simply adds up
    float pa = 0.01 + 0.3 * max(ha, 0.0);
    float pb = 0.01 + 0.3 * max(hb, 0.0);
    float cx = abs(clamp((p.x - xa) / pa + 0.5, 0.0, 1.0) - clamp((p.x - xb) / pb + 0.5, 0.0, 1.0));
    // along the binding the shadow's ends follow the sheet's height where p sits under the segment
    float t = clamp((p.x - xa) / (abs(xb - xa) > 1e-5 ? xb - xa : 1e-5), 0.0, 1.0);
    float hh = max(0.0, mix(ha, hb, t));
    float dy = -hh * lxy.y;
    float penY = 0.01 + 0.3 * hh;
    float cy = clamp((min(uCastY.y + dy, p.y + 0.5 * penY) - max(uCastY.x + dy, p.y - 0.5 * penY)) / penY, 0.0, 1.0);
    // lightens as the sheet rises (sky light gets under it); fades in over the last half millimetre (lying on it = no shadow)
    float k = smoothstep(0.0008, 0.006, hh) / (1.0 + 0.9 * hh);
    sum += cx * cy * k;
  }
  return clamp(sum, 0.0, 1.0) * smoothstep(0.55, 0.9, nz);
}
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uLightW;
uniform float uShadowK;
uniform float uTrans;
uniform sampler2D uOther;
uniform float uOtherOn;
uniform vec3 uEdge;
uniform vec3 uCore;
uniform float uSheetId;
uniform float uCastId;
uniform float uGutter;
uniform float uThrough;
varying vec3 vLocal;
varying float vFace;
varying float vNz;
varying vec2 vPaperUv;
varying float vOff;
${SHADOW_FN}
`;

export type PaperMaterialOpts = {
  chain: ChainUniforms;
  shadow: ShadowUniforms;
  side: "front" | "back" | "rim";
  map?: THREE.Texture | null;
  /** the print on the other face (show-through); null = blank */
  other?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: number;
  bumpMap?: THREE.Texture | null;
  bumpScale?: number;
  roughnessMap?: THREE.Texture | null;
  roughness?: number;
  color?: THREE.ColorRepresentation;
  /** rim: paper colour at the faces and an optional core colour (duplex card) */
  edge?: THREE.ColorRepresentation;
  core?: THREE.ColorRepresentation | null;
  sheen?: number;
  /** sheet id for the self-shadow test (see ShadowUniforms.uCastId) */
  id?: number;
  /** shade the paper near the binding (s = 0), 0 … 1 */
  gutter?: number;
  /** how much the other side's print shows through (darkening at full ink): a whisper on a blank face, less under a printed one */
  through?: number;
};

export function paperMaterial(o: PaperMaterialOpts): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    roughness: o.roughness ?? 0.88,
    roughnessMap: o.roughnessMap ?? null,
    metalness: 0,
    normalMap: o.normalMap ?? null,
    normalScale: new THREE.Vector2(o.normalScale ?? 0.3, o.normalScale ?? 0.3),
    bumpMap: o.bumpMap ?? null,
    bumpScale: o.bumpScale ?? 1,
    sheen: o.sheen ?? 0.25,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color("#f6faff"),
    specularIntensity: 0.35,
    side: THREE.FrontSide,
  });
  const extra = {
    // a null sampler is bound to three's empty texture
    uOther: { value: o.other ?? null },
    uOtherOn: { value: o.other ? 1 : 0 },
    uEdge: { value: new THREE.Color(o.edge ?? "#e9ecea") },
    uCore: { value: new THREE.Color(o.core ?? o.edge ?? "#e9ecea") },
    uSheetId: { value: o.id ?? 0 },
    uGutter: { value: o.gutter ?? 0 },
    uThrough: { value: o.through ?? 0.03 },
  };
  const rim = o.side === "rim";
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, o.chain, o.shadow, extra);
    sh.vertexShader = PATH + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace("#include <beginnormal_vertex>", VERT_MAIN).replace("#include <begin_vertex>", "vec3 transformed = paperPos;");
    sh.fragmentShader = FRAG_PARS + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        #include <map_fragment>
        ${rim ? "diffuseColor.rgb = mix(uCore, uEdge, smoothstep(0.22, 0.42, abs(vOff)));" : ""}
        // the other side's print shows through, faintly and mirrored (same point of the sheet): a whisper, never a second page
        float pInk = 0.0;
        if (uOtherOn > 0.5) {
          vec2 oUv = vFace > 0.0 ? vec2(1.0 - vPaperUv.x, vPaperUv.y) : vPaperUv;
          vec3 oc = texture2D(uOther, oUv).rgb;
          pInk = clamp(1.0 - dot(oc, vec3(0.299, 0.587, 0.114)) / 0.86, 0.0, 1.0);
          diffuseColor.rgb *= 1.0 - uThrough * pInk;
        }
        // the gutter: where the sheets meet at the binding the paper sits in its own shade (the shadow ink, rgb(21 35 58)), the art direction's
        // inner-edge ramp (§7.9: .16 at the fold, .07 at 70 % of the way in) over 9 % of the left page and 7 % of the right
        if (uGutter > 0.0) {
          float gw = vFace < 0.0 ? 0.09 : 0.07;
          float gk = pow(clamp(1.0 - vPaperUv.x / gw, 0.0, 1.0), 1.8) * (vFace < 0.0 ? 0.18 : 0.15) * uGutter;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.082, 0.137, 0.227), gk);
        }`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        /* glsl */ `
        #include <lights_physical_fragment>
        // ink is a dark matte film: the paper's cool sheen and most of its specular lie on the paper only (otherwise the print reads
        // grey, like faded inkjet, under the key light)
        float pPaper = smoothstep(0.06, 0.55, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
        #ifdef USE_SHEEN
        material.sheenColor *= pPaper;
        #endif
        material.specularColor *= mix(0.3, 1.0, pPaper);
        material.specularF90 *= mix(0.3, 1.0, pPaper);`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        float pSh = abs(uSheetId - uCastId) < 0.5 ? 0.0 : paperShadow(vLocal, vNz) * uShadowK;
        vec3 pL = normalize((viewMatrix * vec4(uLightW, 0.0)).xyz);
        // light coming through the sheet when this face is turned away from the key light; the other side's ink blocks some of it
        float pBack = max(0.0, -dot(normalize(vNormal), pL));
        outgoingLight = outgoingLight * (1.0 - pSh) + diffuseColor.rgb * uTrans * pBack * (1.0 - 0.22 * pInk);
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `paper-${o.side}`;
  return mat;
}

/* ── desk: a transparent shadow catcher (the dialog's own background shows through) ── */

export type DeskUniforms = ShadowUniforms & {
  /** footprints lying on the desk (chain frame): x0, y0, x1, y1 */
  uRects: { value: THREE.Vector4[] };
  uRectN: { value: number };
  uOpacity: { value: number };
  /** the ambient skirt round the footprints: its width (scene units, ~ the object's size) and darkness */
  uAmbient: { value: THREE.Vector2 };
};

export function deskMaterial(shadow: ShadowUniforms): { mat: THREE.ShaderMaterial; uniforms: DeskUniforms } {
  const uniforms: DeskUniforms = {
    ...shadow,
    uRects: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uRectN: { value: 0 },
    uOpacity: { value: 1 },
    uAmbient: { value: new THREE.Vector2(0.4, 0.12) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec4 uRects[4];
      uniform int uRectN;
      uniform float uOpacity;
      uniform vec2 uAmbient;
      varying vec3 vLocal;
      ${SHADOW_FN}
      // box-filtered rectangle: fraction of a pen-wide window around p covered by the rect
      float softRect(vec2 p, vec4 r, float pen) {
        float cx = clamp((min(r.z, p.x + 0.5 * pen) - max(r.x, p.x - 0.5 * pen)) / pen, 0.0, 1.0);
        float cy = clamp((min(r.w, p.y + 0.5 * pen) - max(r.y, p.y - 0.5 * pen)) / pen, 0.0, 1.0);
        return cx * cy;
      }
      void main() {
        vec2 p = vLocal.xy;
        float a = 0.0;
        for (int i = 0; i < 4; i++) {
          if (i >= uRectN) break;
          vec4 r = uRects[i];
          // contact: tight and dark at the edge; ambient: a wide, faint skirt
          float contact = softRect(p, r + vec4(-0.004, -0.004, 0.004, 0.004), 0.05);
          float ambient = softRect(p, r, uAmbient.x);
          a = max(a, 0.30 * contact + uAmbient.y * ambient);
        }
        float s = paperShadow(vec3(p, 0.0), 1.0) * 0.55;
        a = 1.0 - (1.0 - a) * (1.0 - s);
        gl_FragColor = vec4(0.082, 0.137, 0.227, a * uOpacity);
      }`,
  });
  return { mat, uniforms };
}

/* ── paper grain: a tileable normal map from fibres and noise (procedural, no assets) ── */

export function grainTexture(size = 512, seed = 11): THREE.DataTexture {
  const h = new Float32Array(size * size);
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // value noise at two scales (tileable: wrap the lattice)
  const octave = (cells: number, amp: number) => {
    const g = new Float32Array(cells * cells).map(() => rnd());
    const at = (x: number, y: number) => g[((y + cells) % cells) * cells + ((x + cells) % cells)]!;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const v = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy) + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
        h[y * size + x]! += v * amp;
      }
  };
  octave(64, 0.5);
  octave(160, 0.35);
  // fibres: short raised strokes
  for (let i = 0; i < 2600; i++) {
    const x0 = rnd() * size;
    const y0 = rnd() * size;
    const ang = rnd() * Math.PI;
    const len = 4 + rnd() * 14;
    const amp = 0.25 + rnd() * 0.35;
    for (let t = 0; t < len; t += 0.5) {
      const x = Math.round(x0 + Math.cos(ang) * t);
      const y = Math.round(y0 + Math.sin(ang) * t);
      const k = ((y % size) + size) % size;
      const j = ((x % size) + size) % size;
      h[k * size + j]! += amp * Math.sin((t / len) * Math.PI);
    }
  }
  const data = new Uint8Array(size * size * 4);
  const s = 2.2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const hx = h[y * size + ((x + 1) % size)]! - h[y * size + ((x - 1 + size) % size)]!;
      const hy = h[((y + 1) % size) * size + x]! - h[((y - 1 + size) % size) * size + x]!;
      let nx = -hx * s;
      let ny = -hy * s;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
