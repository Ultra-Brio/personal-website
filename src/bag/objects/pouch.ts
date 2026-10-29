/*
 * The clear zip pouch. Back film flat at z = 0, front film at z = POUCH_DEPTH over the usable area, easing down to the back film
 * across the heat-sealed border (so it reads as a puffy sealed bag). The film itself is a shader: premultiplied alpha, near-black
 * diffuse, so what you see is a faint tint plus real environment reflections off a crinkled normal map, a fine knurled seal band
 * with a crisp weld line, a rim along the rounded outline, and a clear window around the zipper. No `transmission` (no extra pass).
 * The zipper is a frosted press-seal track with a frosted polypropylene slider and pull tab; the owner's name is screen-printed on the film in the
 * page's type (a 藍 ○, the name in Zen Kaku, the local name in Shippori Mincho; sentence case), not stuck on as a label.
 *
 * Layout (pouch plane, origin = centre of the usable area):
 *   usable area      POUCH_W x POUCH_H
 *   seal band        8 mm left / right, 7 mm bottom
 *   top zone         13 mm: ramp, zip track (centre 6.8 mm above the usable area), a narrow sealed lip
 *   outline          246 x 340 mm: fits the folio's back board (inner area 250 x 340 mm)
 *   print            top left of the window, just under the zip
 */
import * as THREE from "three";
import { POUCH_DEPTH, POUCH_H, POUCH_W } from "../constants";
import { colorTexture, disc, drawText, heightToNormalCanvas, makeCanvas, measure, PRINT, receiveSun, rng, runsOf, smoothstep, Tracker, valueNoise } from "./shared";
import type { Pouch, PouchCtx } from "./types";

// The sealed outline must fit the folio's back board (inner area 250 x 340 mm): 246 x 340 mm.
const SEAL = 0.008;
const SEAL_BOTTOM = 0.007;
const TOP_ZONE = 0.013;
const OUT_R = 0.012;
const SEP0 = 0.0005; // film separation inside the seal
const ZIP_SEP = 0.0036; // film separation over the zip track
const ZIP_Y = POUCH_H / 2 + 0.0068;
const ZIP_HALF = 0.0032;
/** The clear window ends this far above the zip track; the rest of the top zone is the sealed lip. */
const ZIP_CLEAR = 0.0012;

export const POUCH_BOUNDS = { minX: -POUCH_W / 2 - SEAL, maxX: POUCH_W / 2 + SEAL, minY: -POUCH_H / 2 - SEAL_BOTTOM, maxY: POUCH_H / 2 + TOP_ZONE };
const OW = POUCH_BOUNDS.maxX - POUCH_BOUNDS.minX;
const OH = POUCH_BOUNDS.maxY - POUCH_BOUNDS.minY;
const OCX = (POUCH_BOUNDS.maxX + POUCH_BOUNDS.minX) / 2;
const OCY = (POUCH_BOUNDS.maxY + POUCH_BOUNDS.minY) / 2;

/* signed distance to a rounded box, negative inside */
function sdRB(px: number, py: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** the puffed "pillow" region: the usable area plus 3 mm */
const PILLOW = { cx: 0, cy: 0, hx: POUCH_W / 2 + 0.003, hy: POUCH_H / 2 + 0.003, r: 0.006 };
/** the clear window (no frost): pillow plus the zip band */
const CLEAR = {
  cx: 0,
  cy: (-POUCH_H / 2 - 0.003 + (ZIP_Y + ZIP_HALF + ZIP_CLEAR)) / 2,
  hx: POUCH_W / 2 + 0.003,
  hy: (ZIP_Y + ZIP_HALF + ZIP_CLEAR - (-POUCH_H / 2 - 0.003)) / 2,
  r: 0.006,
};

function frontZ(x: number, y: number): number {
  const dP = sdRB(x - PILLOW.cx, y - PILLOW.cy, PILLOW.hx, PILLOW.hy, PILLOW.r);
  const zP = SEP0 + (POUCH_DEPTH - SEP0) * smoothstep(0, 0.004, -dP);
  const dZ = sdRB(x, y - ZIP_Y, POUCH_W / 2 + 0.003, ZIP_HALF, 0.0012);
  const zZ = SEP0 + (ZIP_SEP - SEP0) * (1 - smoothstep(-0.0012, 0.0016, dZ));
  // a slow undulation of the bag (kept well inside the clearance left to a lifted object)
  const und = 0.00022 * Math.sin(x * 36 + 1.3) * Math.sin(y * 27 + 0.4) * smoothstep(0.006, 0.02, -dP);
  return Math.max(zP + und, zZ);
}

function lines(min: number, max: number, coarse: number, fine: [number, number, number][]): number[] {
  const set: number[] = [];
  const n = Math.ceil((max - min) / coarse);
  for (let i = 0; i <= n; i++) set.push(min + ((max - min) * i) / n);
  for (const [a, b, step] of fine) for (let v = a; v <= b + 1e-9; v += step) if (v > min && v < max) set.push(v);
  set.sort((p, q) => p - q);
  const out: number[] = [];
  for (const v of set) if (out.length === 0 || v - out[out.length - 1]! > 0.00025) out.push(v);
  return out;
}

function frontFilmGeometry(): THREE.BufferGeometry {
  const xs = lines(POUCH_BOUNDS.minX, POUCH_BOUNDS.maxX, 0.012, [
    [-PILLOW.hx - 0.0006, -PILLOW.hx + 0.0046, 0.0008],
    [PILLOW.hx - 0.0046, PILLOW.hx + 0.0006, 0.0008],
  ]);
  const ys = lines(POUCH_BOUNDS.minY, POUCH_BOUNDS.maxY, 0.012, [
    [-PILLOW.hy - 0.0006, -PILLOW.hy + 0.0046, 0.0008],
    [PILLOW.hy - 0.0046, PILLOW.hy + 0.0006, 0.0008],
    [ZIP_Y - ZIP_HALF - 0.003, ZIP_Y + ZIP_HALF + 0.003, 0.0008],
  ]);
  const pos: number[] = [];
  const uv: number[] = [];
  for (const y of ys) {
    for (const x of xs) {
      pos.push(x, y, frontZ(x, y));
      uv.push((x - POUCH_BOUNDS.minX) / OW, (y - POUCH_BOUNDS.minY) / OH);
    }
  }
  const idx: number[] = [];
  const nx = xs.length;
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function backFilmGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(OW, OH);
  g.translate(OCX, OCY, 0);
  return g;
}

/**
 * The film's surface: broad waviness and a finer ripple, baked to a tangent-space normal map. No fold creases: any line in the
 * normal map traces a thin bright line where it mirrors the studio's light, which reads as a scratch.
 */
function crinkleNormal(T: Tracker, anisotropy: number): THREE.Texture {
  const w = 512;
  const h = Math.round((w * OH) / OW);
  const rand = rng(0xf11a);
  const hf = new Float32Array(w * h);
  const n1 = valueNoise(w, h, 6, 8, rand);
  const n2 = valueNoise(w, h, 14, 20, rand);
  const n3 = valueNoise(w, h, 40, 56, rand);
  for (let i = 0; i < hf.length; i++) hf[i] = n1[i]! * 0.6 + n2[i]! * 0.14 + n3[i]! * 0.025;
  const t = new THREE.CanvasTexture(heightToNormalCanvas(hf, w, h, 3.2));
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return T.add(t);
}

type FilmU = Record<string, THREE.IUniform>;

function makeFilmUniforms(): FilmU {
  return {
    uOC: { value: new THREE.Vector2(OCX, OCY) },
    uOH: { value: new THREE.Vector2(OW / 2, OH / 2) },
    uOR: { value: OUT_R },
    uCC: { value: new THREE.Vector2(CLEAR.cx, CLEAR.cy) },
    uCH: { value: new THREE.Vector2(CLEAR.hx, CLEAR.hy) },
    uCR: { value: CLEAR.r },
    uTint: { value: new THREE.Color() },
    uBaseA: { value: 0.1 },
    uSealCol: { value: new THREE.Color() },
    uSealA: { value: 0.5 },
    uLineCol: { value: new THREE.Color() },
    uRimA: { value: 0.4 },
    uTime: { value: 0 },
    uSpec: { value: 0.6 },
    // the sun on the film: a milky sheen (+3–5 levels in the sun at 1440) and a broad gloss that peaks near the pouch's sunward edge
    // (about +10–20 there), both cut by the bars and leaves; the print under it stays as legible
    uHaze: { value: 0.12 },
    uGloss: { value: 2 },
    uGuess: { value: 0.5 },
  };
}

function filmMaterial(T: Tracker, u: FilmU, normal: THREE.Texture): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    // the shader outputs premultiplied colour itself (reflections must not be scaled by the film's alpha), so blend ONE / ONE_MINUS_SRC_ALPHA by hand
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFp = position.xy;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vFp;
uniform vec2 uOC; uniform vec2 uOH; uniform float uOR;
uniform vec2 uCC; uniform vec2 uCH; uniform float uCR;
uniform vec3 uTint; uniform float uBaseA;
uniform vec3 uSealCol; uniform float uSealA; uniform vec3 uLineCol;
uniform float uRimA; uniform float uTime; uniform float uSpec; uniform float uHaze; uniform float uGloss; uniform float uGuess;
float sdRB( vec2 p, vec2 h, float r ) { vec2 q = abs( p ) - h + r; return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r; }`,
      )
      .replace(
        "#include <map_fragment>",
        `float dO = sdRB( vFp - uOC, uOH, uOR );
float pxw = max( fwidth( dO ), 1e-5 );
float inO = 1.0 - smoothstep( -pxw, pxw, dO );
float dC = sdRB( vFp - uCC, uCH, uCR );
float sealM = smoothstep( -pxw, pxw * 1.5, dC );
vec2 hq = vFp / 0.0013;
float h1 = abs( fract( hq.x + hq.y ) - 0.5 );
float h2 = abs( fract( hq.x - hq.y ) - 0.5 );
float hatch = smoothstep( 0.30, 0.50, max( h1, h2 ) ) * ( 1.0 - smoothstep( 0.4, 0.9, fwidth( hq.x + hq.y ) ) );
// the weld bead: a fine raised line where the two films were fused; just inside it the films part (a faint grey shadow line)
float weld = 1.0 - smoothstep( 0.0, max( 0.00045, pxw ), abs( dC - 0.0007 ) );
float lip = ( 1.0 - smoothstep( 0.0, max( 0.0009, pxw * 1.5 ), abs( dC + 0.0006 ) ) ) * ( 1.0 - sealM );
// the cut edge: the film's thickness catches the light in one crisp line
float rim = 1.0 - smoothstep( 0.0, max( 0.0005, pxw * 1.2 ), -dO );
float sweepPos = fract( uTime * 0.03 ) * 0.9 - 0.45;
float sweep = exp( -pow( ( dot( vFp, vec2( 0.876, 0.482 ) ) - sweepPos ) / 0.045, 2.0 ) );
float fa = uBaseA + sealM * uSealA * ( 1.0 - 0.42 * hatch ) + weld * 0.2 + lip * 0.08 + rim * uRimA + sweep * 0.035 * ( 1.0 - sealM );
fa = clamp( fa, 0.0, 0.92 ) * inO;
vec3 fc = mix( uTint, uSealCol, sealM );
fc = mix( fc, uLineCol, clamp( lip * 0.9 + weld * 0.35, 0.0, 1.0 ) );
diffuseColor = vec4( fc, fa );`,
      )
      // the film's broad gloss: each direct light's specular once more, in a wide soft lobe (roughness 0.35) that moves with the view,
      // through the same shadow as the crisp one — where the window's sun reaches the film it shines, the bars and leaves cut it
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>
vec3 bfGloss = vec3( 0.0 );
void RE_Direct_Film( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  PhysicalMaterial broad = material;
  broad.roughness = 0.35;
  bfGloss += saturate( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, broad );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Film`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.55, sealM );")
      // the key light keeps its crisp glint, but the environment is looked up rougher: the studio's narrow light strip would
      // otherwise trace thin bright lines along every ripple of the film, which read as scratches
      .replace(
        "#include <lights_fragment_maps>",
        "float bfRough = material.roughness;\nmaterial.roughness = max( material.roughness, 0.46 );\n#include <lights_fragment_maps>\nmaterial.roughness = bfRough;",
      )
      .replace(
        "#include <opaque_fragment>",
        `vec3 filmSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
vec3 fs = filmSpec * uSpec * mix( 1.0, 1.6, sealM );
// the film scatters a little of the direct light it is in: a faint milky sheen where the window's sun reaches it and none in the
// shade of the bars and leaves (the film lies above the paper, so its pattern sits a hair off the one on the things inside)
fs += reflectedLight.directDiffuse * uHaze * mix( 1.0, 1.5, sealM );
fs += bfGloss * uGloss * mix( 1.0, 0.6, sealM );
fs = 0.22 * ( 1.0 - exp( -fs / 0.22 ) ); // soft-saturate: a bright environment panel must not white the film out
// blending happens on encoded values, so encode here: the body as colour * alpha, the reflection as the encoded step it adds on a mid-tone backdrop
vec3 g0 = vec3( uGuess );
vec3 specEnc = linearToOutputTexel( vec4( g0 + fs, 1.0 ) ).rgb - linearToOutputTexel( vec4( g0, 1.0 ) ).rgb;
vec3 bodyEnc = linearToOutputTexel( vec4( diffuseColor.rgb, 1.0 ) ).rgb * diffuseColor.a;
gl_FragColor = vec4( specEnc * inO + bodyEnc, diffuseColor.a );`,
      )
      .replace("#include <tonemapping_fragment>", "")
      .replace("#include <colorspace_fragment>", "");
  };
  m.customProgramCacheKey = () => "bf-film-2";
  // (the uniforms, for harnesses tuning the film)
  m.userData.film = u;
  return T.material(m);
}

/** Extrude a (y, z) profile along +x, centred. */
function extrudeAlongX(shape: THREE.Shape, length: number, steps = 1): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps, curveSegments: 10 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
  g.translate(-length / 2, 0, 0);
  return g;
}

function rrShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function createPouch(ctx: PouchCtx): Pouch {
  const T = new Tracker();
  const group = new THREE.Group();
  group.name = "bag-pouch";

  // ---- films ----
  const normal = crinkleNormal(T, ctx.anisotropy);
  const fu = makeFilmUniforms();
  const filmMat = filmMaterial(T, fu, normal);
  const back = new THREE.Mesh(T.add(backFilmGeometry()), filmMat);
  back.renderOrder = 0;
  back.name = "film-back";
  back.frustumCulled = false;
  const front = new THREE.Mesh(T.add(frontFilmGeometry()), filmMat);
  front.renderOrder = 10;
  front.name = "film-front";
  front.frustumCulled = false;
  // the films must never swallow a pick meant for an object behind them
  front.raycast = () => {};
  back.raycast = () => {};
  group.add(back, front);

  // ---- zip track: profile extruded along x, between the films ----
  const zipL = POUCH_W + 0.006;
  const zipPlastic = T.material(new THREE.MeshPhysicalMaterial({ color: "#e8ecee", roughness: 0.52, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.3, sheenRoughness: 0.7, sheenColor: new THREE.Color("#ffffff") }));
  // back half: base strip + a bulb on a neck
  const bs = new THREE.Shape();
  bs.moveTo(-ZIP_HALF, 0.00005);
  bs.lineTo(ZIP_HALF, 0.00005);
  bs.lineTo(ZIP_HALF, 0.00075);
  bs.lineTo(0.0007, 0.00075);
  bs.lineTo(0.0007, 0.0012);
  bs.absarc(0, 0.00175, 0.0018, -0.35, Math.PI + 0.35, false);
  bs.lineTo(-0.0007, 0.00075);
  bs.lineTo(-ZIP_HALF, 0.00075);
  bs.closePath();
  const backZip = new THREE.Mesh(T.add(extrudeAlongX(bs, zipL)), zipPlastic);
  backZip.position.set(0, ZIP_Y, 0);
  // front half: base strip + two hooked arms
  const fs = new THREE.Shape();
  const zt = ZIP_SEP - 0.00005;
  fs.moveTo(-ZIP_HALF, zt);
  fs.lineTo(ZIP_HALF, zt);
  fs.lineTo(ZIP_HALF, zt - 0.0007);
  fs.lineTo(0.0027, zt - 0.0007);
  fs.lineTo(0.0027, 0.0012);
  fs.lineTo(0.0017, 0.0012);
  fs.lineTo(0.0017, 0.00155);
  fs.lineTo(0.0034, 0.00155);
  fs.lineTo(0.0034, zt - 0.0007);
  fs.lineTo(-0.0034, zt - 0.0007);
  fs.lineTo(-0.0034, 0.00155);
  fs.lineTo(-0.0017, 0.00155);
  fs.lineTo(-0.0017, 0.0012);
  fs.lineTo(-0.0027, 0.0012);
  fs.lineTo(-0.0027, zt - 0.0007);
  fs.lineTo(-ZIP_HALF, zt - 0.0007);
  fs.closePath();
  const frontZip = new THREE.Mesh(T.add(extrudeAlongX(fs, zipL)), zipPlastic);
  frontZip.position.set(0, ZIP_Y, 0);
  // fine ribs printed on the front strip
  const ribs = makeCanvas(1024, 64);
  ribs.g.fillStyle = "rgba(255,255,255,0)";
  ribs.g.clearRect(0, 0, 1024, 64);
  for (let x = 0; x < 1024; x += 8) {
    ribs.g.fillStyle = "rgba(60,66,64,0.075)";
    ribs.g.fillRect(x, 6, 3, 52);
    ribs.g.fillStyle = "rgba(255,255,255,0.24)";
    ribs.g.fillRect(x + 3, 6, 1.5, 52);
  }
  const ribTex = T.add(colorTexture(ribs.c, ctx));
  // lit like the strip it is printed on, so the window's shade falls on the ribs too
  const ribMat = T.add(new THREE.MeshStandardMaterial({ map: ribTex, transparent: true, depthWrite: false, roughness: 0.52, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const ribMesh = new THREE.Mesh(T.add(new THREE.PlaneGeometry(zipL, ZIP_HALF * 2 - 0.0006)), ribMat);
  ribMesh.position.set(0, ZIP_Y, ZIP_SEP - 0.00004);
  ribMesh.renderOrder = 4;
  group.add(backZip, frontZip, ribMesh);

  // ---- slider with a pull tab, parked at the right end of the track ----
  // frosted polypropylene, the colour of the film's seal: stationery, not a gadget. A low body with a tapered nose, a small bridge
  // on its back, and a flat pull tab hinged in the bridge, lying on the film toward the opening side.
  const plastic = T.material(
    new THREE.MeshPhysicalMaterial({ color: "#eaedef", roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.42, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color("#ffffff") }),
  );
  const SX = POUCH_W / 2 - 0.0118;
  const SL = 0.0128; // body length along the track
  const bodyShape = new THREE.Shape();
  {
    // top view: x along the track (nose at +x, toward the seal), y across; wide at the back, narrower at the nose, rounded corners
    const hb = 0.0049, hn = 0.0037, rc = 0.0016;
    const x0 = -SL / 2, x1 = SL / 2;
    bodyShape.moveTo(x0 + rc, -hb);
    bodyShape.lineTo(x1 - rc, -hn);
    bodyShape.quadraticCurveTo(x1, -hn, x1, -hn + rc);
    bodyShape.lineTo(x1, hn - rc);
    bodyShape.quadraticCurveTo(x1, hn, x1 - rc, hn);
    bodyShape.lineTo(x0 + rc, hb);
    bodyShape.quadraticCurveTo(x0, hb, x0, hb - rc);
    bodyShape.lineTo(x0, -hb + rc);
    bodyShape.quadraticCurveTo(x0, -hb, x0 + rc, -hb);
  }
  const BODY_H = 0.0034;
  const BEVEL = 0.0009;
  const bodyGeo = T.add(new THREE.ExtrudeGeometry(bodyShape, { depth: BODY_H, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL * 0.8, bevelSegments: 5, curveSegments: 10 }));
  bodyGeo.translate(0, 0, BEVEL);
  const body = new THREE.Mesh(bodyGeo, plastic);
  body.position.set(SX, ZIP_Y, 0.0002);
  const bodyTop = 0.0002 + BODY_H + 2 * BEVEL;
  // the bridge the tab hangs from: a short rounded bar across the back of the body
  const bridgeGeo = T.add(new THREE.CapsuleGeometry(0.00085, 0.0042, 6, 12));
  bridgeGeo.rotateX(Math.PI / 2); // axis across the track (y)
  const bridge = new THREE.Mesh(bridgeGeo, plastic);
  bridge.position.set(SX - SL / 2 + 0.0026, ZIP_Y, bodyTop + 0.0002);
  // the pull tab: a flat stadium with a slot, its hinge end in the bridge, its free end resting on the film
  const TL = 0.0172, TW = 0.0064;
  const tabShape = rrShape(TL, TW, TW / 2);
  const slot = new THREE.Path();
  {
    const sx0 = -TL / 2 + 0.0034, sx1 = -TL / 2 + 0.0082, sr = 0.0011;
    slot.moveTo(sx0, -sr);
    slot.absarc(sx0, 0, sr, -Math.PI / 2, Math.PI / 2, true);
    slot.lineTo(sx1, sr);
    slot.absarc(sx1, 0, sr, Math.PI / 2, -Math.PI / 2, true);
    slot.lineTo(sx0, -sr);
  }
  tabShape.holes.push(slot);
  const TAB_T = 0.0009;
  const tabGeo = T.add(new THREE.ExtrudeGeometry(tabShape, { depth: TAB_T, bevelEnabled: true, bevelThickness: 0.00022, bevelSize: 0.00022, bevelSegments: 3, curveSegments: 20 }));
  const tab = new THREE.Mesh(tabGeo, plastic);
  const hingeX = SX - SL / 2 + 0.0026;
  const restZ = ZIP_SEP + 0.0003;
  const drop = bodyTop - restZ;
  const tilt = Math.atan2(drop, TL - 0.002);
  tab.position.set(hingeX - (TL / 2 - 0.002) * Math.cos(tilt), ZIP_Y, restZ + drop / 2 - TAB_T / 2);
  tab.rotation.y = -tilt; // the hinge end (+x) up in the bridge, the free end (-x) down on the film
  group.add(body, bridge, tab);

  // ---- the owner's mark, screen-printed on the outside of the front film, top left of the window ----
  // (relabel() sets them again for another language: the film itself stays)
  let label = "";
  let local = "";
  let lang: string | undefined;
  const mark = (c: PouchCtx) => {
    label = (c.label ?? c.owner?.name ?? "").trim();
    local = c.owner?.nameLocal && (!c.owner.name || c.owner.name === label) ? c.owner.nameLocal : "";
    lang = c.lang;
    return [...runsOf("sans", 500, [label], lang), ...runsOf("serif", 500, [local], lang)];
  };
  const runs = mark(ctx);
  const PPM = 16; // px per mm
  const LW = 0.06;
  const LH = 0.006;
  const lc = makeCanvas(LW * 1000 * PPM, LH * 1000 * PPM);
  const printTex = T.add(colorTexture(lc.c, ctx));
  const paintPrint = () => {
    const mm = (v: number) => v * PPM;
    lc.g.clearRect(0, 0, lc.c.width, lc.c.height);
    if (!label) return;
    const base = mm(4.1);
    // ● Lin Wen 林文: the disc's centre on the name's x-height
    lc.g.fillStyle = PRINT.ai;
    disc(lc.g, mm(1.1), base - mm(0.85), mm(0.9));
    const px = mm(2.4);
    const x = mm(3.2);
    drawText(lc.g, label, x, base, { role: "sans", px, weight: 500, color: PRINT.muted, ls: mm(0.05), lang });
    if (local) drawText(lc.g, local, x + measure(lc.g, label, { role: "sans", weight: 500, ls: mm(0.05), lang }, px) + mm(1.4), base, { role: "serif", px: mm(2.4), weight: 500, color: PRINT.muted, ls: mm(0.12), lang });
    printTex.needsUpdate = true;
  };
  paintPrint();
  // conform to the film under it (a hair above it), so it never floats off a crinkle or sinks into one
  const lx = -POUCH_W / 2 + 0.0085 + LW / 2;
  const ly = POUCH_H / 2 - 0.0065 - LH / 2;
  const printGeo = T.add(new THREE.PlaneGeometry(LW, LH, 24, 3));
  {
    const p = printGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, frontZ(lx + p.getX(i), ly + p.getY(i)) + 0.00004);
    p.needsUpdate = true;
    printGeo.computeVertexNormals();
  }
  const printMat = T.material(new THREE.MeshStandardMaterial({ map: printTex, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const printMesh = new THREE.Mesh(printGeo, printMat);
  printMesh.position.set(lx, ly, 0);
  printMesh.renderOrder = 11;
  printMesh.name = "film-print";
  printMesh.raycast = () => {};
  group.add(printMesh);
  // the window's sun: the bars and leaves fall across the films (whose glint is only where the sun reaches), the zip and the print
  receiveSun(group);

  // ---- theme ----
  const tint = new THREE.Color();
  const seal = new THREE.Color();
  function setDark(d: boolean) {
    tint.set(d ? "#9fb2c7" : "#eef5f8");
    seal.set(d ? "#c5d0dc" : "#f7fafb");
    (fu.uTint!.value as THREE.Color).copy(tint);
    (fu.uSealCol!.value as THREE.Color).copy(seal);
    (fu.uLineCol!.value as THREE.Color).set(d ? "#5d6670" : "#7d8790");
    fu.uBaseA!.value = d ? 0.03 : 0.04;
    fu.uSealA!.value = d ? 0.2 : 0.3;
    fu.uRimA!.value = d ? 0.24 : 0.3;
    fu.uSpec!.value = d ? 0.5 : 0.6;
    fu.uGuess!.value = d ? 0.08 : 0.5;
  }
  setDark(false);

  const film: Pouch = {
    group,
    bounds: POUCH_BOUNDS,
    fonts: runs,
    update(t: number) {
      fu.uTime!.value = t;
    },
    setDark,
    repaint: paintPrint,
    relabel(c) {
      film.fonts = mark(c);
    },
    dispose() {
      group.removeFromParent();
      T.dispose();
    },
  };
  return film;
}
