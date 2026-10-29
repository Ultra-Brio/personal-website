import * as THREE from "three";

/*
 * The translucency of the frosted PP case: a screen-space "frosted glass".
 *
 * Every frame, everything other than the case (pages, rings, desk and shadows) is first drawn into a half-resolution target (a quarter
 * on phones), then blurred level by level with a fixed Gaussian kernel into 5 levels (each level half the resolution, with roughly
 * double the blur radius). The case's fragments sample these levels at their own screen coordinates — with no refraction offset; only
 * "how far the case surface is from the layer behind it" decides which level: where it touches, things are only slightly soft, the
 * further away the blurrier. This distance is computed analytically (the fragment's height above the top of the page block, converted
 * along the view direction) and varies smoothly across the whole board; the depth map is not read — in the depth map the depths of
 * the rings, base and page edges interleave, the chosen level would jump cell by cell, and the highlights on the metal would be
 * smeared into a row of bright spots sliding along the spine.
 * Every kernel is fixed and pixel-aligned, with no mipmap level selection and no jitter: while the cover moves, what shows through
 * does not flicker, swim or jump.
 *
 * Things in front of the case (pages lying on the board once it is open, the rings and base on the spine) must not be seen a second
 * time through the case: first only the case's depth is drawn, and in the first blur pass pixels nearer than the case get weight 0
 * (premultiplied: rgb·w is blurred together with w, and divided back as rgb / w when sampled), so they do not bleed into a halo on
 * the board beside them.
 * Fully open, the boards lie flat on the desk with only the desk behind them: the background draws only the desk and the shadows on
 * it, saving a whole pass of the scene.
 *
 * Light let through = blurred background × tint² (light passes through the tinted board, reaches what is behind it and passes back
 * through, absorbed twice) × transmittance (smaller at grazing angles, by Fresnel);
 * the rest is the board's own milky diffuse, and the side facing away from the light gets a little light through it (wrapped, so it
 * is not a dead grey even side-on to the light);
 * a very faint gloss stays only where little shows through, not covering what does. The boards' cut edges let no light through,
 * guide light and glow, and are a deeper colour (the light has run sideways through the board for a while), so each board (front
 * board, spine, back board) gets an outline of its own; the living hinges between the boards are thinner, let more through and are
 * tinted more lightly.
 * The case, and the foil stamp and display pocket on its outside, are on layer 1: they are not drawn into the background.
 */

export const FROST_LAYER = 1;
/** The desk, the contact shadows on it and the lights also sit on layer 2: fully open, the background draws only this layer */
export const DESK_LAYER = 2;

/**
 * The frost's parameters: the blur where it touches (scene units), how much the blur grows per unit of distance, the transmittance,
 * how much tint is mixed in, the share of back light let through, the milkiness and light-guide brightness of the cut edges (the cut
 * faces; no brighter than a light desk, carried mostly by the deeper colour and the bevel's light and shade), how much the cut edges
 * are darkened (on a light desk this is what outlines each board), how far the board face's slight bow turns the normal, how far the
 * whole board's tilt turns the normal, the darkness of the living hinge's two score lines, the milky light scattered back inside the
 * board (more where little shows through: a frosted board over something dark is whitish too, but what shows through is not washed
 * out);
 * with the cover closed, how much is left of the ambient light reaching inside, of the key light (the key light is darkened by
 * FROST_SHADOW's analytic shadow, not again here), of the pockets' gloss and of the desk inside the box (the border of it seen through
 * two boards) (used by scene.ts when drawing the background). sasshi: the light theme's values only (there is no dark room any more).
 */
export const FROST = {
  r0: 0.005,
  spread: 0.12,
  transmit: 0.78,
  tint: 0.55,
  back: 0.5,
  edge: 0.1,
  glow: 0.16,
  edgeDark: 0.22,
  bow: 0.18,
  tilt: 0.05,
  groove: 0.45,
  milk: 0.035,
  shadeEnv: 0.6,
  shadeKey: 1,
  shadeGloss: 0.02,
  shadeDesk: 0.65,
  /**
   * sasshi (round 3): the desk the board lies on, as the page paints it around the book — the morning patch (a static gradient
   * under the canvas) lifts it above its base colour (the theme's background; sRGB factor, tuned so the open board reads as in round
   * 2, ≈ rgb(176 191 191) on the default 青磁 case: through the tone curve's shoulder a little lift goes a long way)
   */
  lit: 1.06,
};

/** Where the living hinge's two score lines lie across its width (0–1; the hinge's slope is between them), and their width (same unit) */
export const HINGE_SCORE: readonly [number, number] = [0.14, 0.86];
const HINGE_LINES = [HINGE_SCORE[0], HINGE_SCORE[1], 0.045] as const;

/**
 * The frosted boards' shadow: the share of key light blocked, the multiplier on the desk, the boards' corner radius (scene units),
 * the penumbra: its width where it touches + how much it widens per unit of distance (light through frost is scattered, so the shadow
 * is very soft),
 * how near to a board does not count (fading in between near0 … near1: the board itself, and the desk touching it, are not shadowed)
 */
export const FROST_SHADOW = { strength: 0.3, ground: 2.5, corner: 0.04, pen0: 0.01, spread: 0.22, near0: 0.004, near1: 0.03 };

const LEVELS = 5;
/** Gaussian σ of level 0 (half resolution), in target pixels */
const SIGMA = 1.6;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * A 9-tap Gaussian in one direction, premultiplied (rgb·w, w).
 * FIRST: samples the scene's colour (times uScale, brought under 1 for 8-bit targets); pixels nearer than the case (things in front
 * of the case) get weight 0
 */
const BLUR = /* glsl */ `
#include <packing>
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform sampler2D tCase;
uniform vec2 uStep;
uniform float uNear;
uniform float uFar;
uniform float uScale;
uniform float uMask;
varying vec2 vUv;
vec4 tap(vec2 uv) {
  #ifdef FIRST
    vec3 c = texture2D(tSrc, uv).rgb * uScale;
    float dc = texture2D(tCase, uv).x;
    float w = 1.0;
    if (uMask > 0.5 && dc < 1.0) {
      float zs = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
      float zc = -perspectiveDepthToViewZ(dc, uNear, uFar);
      w = step(zc - 0.002, zs);
    }
    return vec4(c * w, w);
  #else
    return texture2D(tSrc, uv);
  #endif
}
void main() {
  vec4 sum = vec4(0.0);
  float ws = 0.0;
  for (int k = -4; k <= 4; k++) {
    float x = float(k);
    float w = exp(-x * x / ${(2 * SIGMA * SIGMA).toFixed(4)});
    sum += tap(vUv + uStep * x) * w;
    ws += w;
  }
  gl_FragColor = sum / ws;
}`;

export type FrostUniforms = {
  uFrost0: { value: THREE.Texture | null };
  uFrost1: { value: THREE.Texture | null };
  uFrost2: { value: THREE.Texture | null };
  uFrost3: { value: THREE.Texture | null };
  uFrost4: { value: THREE.Texture | null };
  uFrostInvRes: { value: THREE.Vector2 };
  uFrostProj: { value: number };
  uFrostSigma0: { value: number };
  uFrostR0: { value: number };
  uFrostSpread: { value: number };
  uFrostFloor: { value: number };
  uFrostT: { value: number };
  uFrostTint: { value: THREE.Color };
  uFrostBg: { value: THREE.Color };
  uFrostScale: { value: number };
  uFrostBack: { value: number };
  uFrostEdge: { value: number };
  uFrostGlow: { value: number };
  uFrostEdgeDark: { value: number };
  uFrostGroove: { value: number };
  uFrostMilk: { value: number };
  uFrostBowK: { value: number };
  uFrostTiltK: { value: number };
  /** sasshi: world → book-local matrix (identity unless the whole book is tilted) */
  uFrostInv: { value: THREE.Matrix4 };
};

export type FrostPass = {
  uniforms: FrostUniforms;
  /** Hooks up the frosted case's material: the light let through replaces part of the diffuse */
  patch(mat: THREE.MeshPhysicalMaterial): void;
  /** The canvas's pixel size changed */
  setSize(w: number, h: number): void;
  /**
   * sasshi (round 3, D4): the canvas is drawn at another pixel ratio for a while (a moving book): only where the case's
   * fragments find the background (gl_FragCoord → uv) follows; the targets keep the size setSize gave them.
   */
  setScreen(w: number, h: number): void;
  /**
   * Draws the background and blurs it level by level (call before every main render); clear: the background target's base colour
   * (linear).
   * deskOnly: fully open, the boards flat on the desk, the background draws only the desk layer (DESK_LAYER), and nothing in front of
   * the case needs masking out either
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, clear: THREE.Color, deskOnly: boolean): void;
  /** The tint (the frosted board's colour; the other frost parameters are fixed in FROST) */
  setLook(tint: THREE.Color): void;
  /**
   * sasshi: compile ahead (compileAsync) the blur passes' programs and, given the scene and its camera (and `extra`, objects
   * about to join it), the variants its background pass renders the scene with — so a frosted case swapped in, or opened and closed
   * for the first time, does not stall a frame compiling
   */
  compile(renderer: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera, extra?: THREE.Object3D): Promise<unknown>;
  dispose(): void;
};

/**
 * scale: the background target's resolution relative to the canvas (1/2 on desktop, 1/4 on phones — a small, dense screen, where even
 * the finest level is enough); floor: the height of the page block's top (the further from it, the blurrier)
 */
export function createFrost(renderer: THREE.WebGLRenderer, scale: number, floor: number): FrostPass {
  const ext = renderer.extensions;
  const float = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
  const type = float ? THREE.HalfFloatType : THREE.UnsignedByteType;
  // an 8-bit target cannot hold colours above 1: halve them first, divide back when sampling
  const colorScale = float ? 1 : 0.5;
  const opts = { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
  const depthTex = new THREE.DepthTexture(1, 1);
  const scene = new THREE.WebGLRenderTarget(1, 1, { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthTexture: depthTex });
  // the case's depth (depth only: no colour written)
  const caseDepth = new THREE.DepthTexture(1, 1);
  // only the depth is needed: the colour buffer uses the smallest single-channel format
  const caseTarget = new THREE.WebGLRenderTarget(1, 1, { format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthTexture: caseDepth });
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const levels = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, opts));
  const temps = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, opts));
  const mk = (first: boolean) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR,
      defines: first ? { FIRST: "" } : {},
      uniforms: {
        tSrc: { value: null },
        tDepth: { value: depthTex },
        tCase: { value: caseDepth },
        uStep: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 10 },
        uScale: { value: colorScale },
        uMask: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
  const firstMat = mk(true);
  const blurMat = mk(false);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(tri, blurMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms: FrostUniforms = {
    uFrost0: { value: levels[0]!.texture },
    uFrost1: { value: levels[1]!.texture },
    uFrost2: { value: levels[2]!.texture },
    uFrost3: { value: levels[3]!.texture },
    uFrost4: { value: levels[4]!.texture },
    uFrostInvRes: { value: new THREE.Vector2(1, 1) },
    uFrostProj: { value: 1 },
    uFrostSigma0: { value: SIGMA * 2 },
    uFrostR0: { value: FROST.r0 },
    uFrostSpread: { value: FROST.spread },
    uFrostFloor: { value: floor },
    uFrostT: { value: FROST.transmit },
    uFrostTint: { value: new THREE.Color(1, 1, 1) },
    uFrostBg: { value: new THREE.Color(1, 1, 1) },
    uFrostScale: { value: colorScale },
    uFrostBack: { value: FROST.back },
    uFrostEdge: { value: FROST.edge },
    uFrostGlow: { value: FROST.glow },
    uFrostEdgeDark: { value: FROST.edgeDark },
    uFrostGroove: { value: FROST.groove },
    uFrostMilk: { value: FROST.milk },
    uFrostBowK: { value: FROST.bow },
    uFrostTiltK: { value: FROST.tilt },
    uFrostInv: { value: new THREE.Matrix4() },
  };

  let W = 1;
  let H = 1;
  const savedClear = new THREE.Color();

  function pass(mat: THREE.ShaderMaterial, src: THREE.Texture, dst: THREE.WebGLRenderTarget, sx: number, sy: number) {
    quad.material = mat;
    mat.uniforms.tSrc!.value = src;
    (mat.uniforms.uStep!.value as THREE.Vector2).set(sx, sy);
    renderer.setRenderTarget(dst);
    renderer.render(quadScene, quadCam);
  }

  return {
    uniforms,
    patch(mat) {
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        prev.call(mat, sh, r);
        Object.assign(sh.uniforms, uniforms);
        // the fragment's world position (for its height above the page block), whether it is on a board's side (the cut: aFrostEdge = 1),
        // the whole board's tilt, the position along the hinge (score lines), the board face's bow
        sh.vertexShader =
          "attribute float aFrostEdge;\nattribute float aFrostTilt;\nattribute float aFrostGroove;\nattribute vec3 aFrostBow;\nvarying vec3 vFrostWorld;\nvarying float vFrostEdge;\nvarying float vFrostTilt;\nvarying float vFrostGroove;\nvarying vec3 vFrostBow;\nvarying vec3 vFrostTx;\nvarying vec3 vFrostTy;\n" +
          sh.vertexShader.replace(
            "#include <project_vertex>",
            "#include <project_vertex>\nvFrostWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFrostEdge = aFrostEdge;\nvFrostTilt = aFrostTilt;\nvFrostGroove = aFrostGroove;\nvFrostBow = aFrostBow;\nvFrostTx = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));\nvFrostTy = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));",
          );
        sh.fragmentShader =
          /* glsl */ `
uniform sampler2D uFrost0;
uniform sampler2D uFrost1;
uniform sampler2D uFrost2;
uniform sampler2D uFrost3;
uniform sampler2D uFrost4;
uniform vec2 uFrostInvRes;
uniform float uFrostProj;
uniform float uFrostSigma0;
uniform float uFrostR0;
uniform float uFrostSpread;
uniform float uFrostFloor;
uniform float uFrostT;
uniform vec3 uFrostTint;
uniform vec3 uFrostBg;
uniform float uFrostScale;
uniform float uFrostBack;
uniform float uFrostEdge;
uniform float uFrostGlow;
uniform float uFrostEdgeDark;
uniform float uFrostGroove;
uniform float uFrostMilk;
uniform float uFrostBowK;
uniform float uFrostTiltK;
uniform mat4 uFrostInv;
varying vec3 vFrostWorld;
varying float vFrostEdge;
varying float vFrostTilt;
varying float vFrostGroove;
varying vec3 vFrostBow;
varying vec3 vFrostTx;
varying vec3 vFrostTy;
` + sh.fragmentShader;
        // the board face's slight bow: the normal leans towards the board's centre (the more, the nearer the board's edge); the whole
        // board also leans a little towards the hinge by aFrostTilt (front and back boards in opposite directions).
        // lighting only, the geometry is untouched (the pages still lie flat on the board)
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          normal = normalize(normal - vFrostBow.z * (uFrostBowK * (vFrostBow.x * abs(vFrostBow.x) * vFrostTx + vFrostBow.y * abs(vFrostBow.y) * vFrostTy) + uFrostTiltK * vFrostTilt * vFrostTx));`,
        );
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <transmission_fragment>",
          /* glsl */ `
          {
            // screen coordinates, no refraction offset: what lies behind does not move on screen, so what shows through does not move
            vec2 fuv = gl_FragCoord.xy * uFrostInvRes;
            float zf = vViewPosition.z;
            // how far the layer behind is: the fragment's height above the top of the page block, along the view ray (analytic, smooth, no depth read)
            // sasshi: measured in the book's own frame (the whole book may be tilted)
            vec3 fLocal = (uFrostInv * vec4(vFrostWorld, 1.0)).xyz;
            vec3 vdir = normalize(fLocal - (uFrostInv * vec4(cameraPosition, 1.0)).xyz);
            float dist = max(fLocal.z - uFrostFloor, 0.0) / max(abs(vdir.z), 0.35);
            // the farther, the blurrier: blur radius (scene units) → screen px → which level (each level roughly doubles)
            float rPx = (uFrostR0 + dist * uFrostSpread) * uFrostProj / max(zf, 1e-4);
            float lv = clamp(log2(max(rPx, uFrostSigma0) / uFrostSigma0), 0.0, 4.0);
            vec4 acc = texture2D(uFrost0, fuv) * max(0.0, 1.0 - abs(lv))
              + texture2D(uFrost1, fuv) * max(0.0, 1.0 - abs(lv - 1.0))
              + texture2D(uFrost2, fuv) * max(0.0, 1.0 - abs(lv - 2.0))
              + texture2D(uFrost3, fuv) * max(0.0, 1.0 - abs(lv - 3.0))
              + texture2D(uFrost4, fuv) * max(0.0, 1.0 - abs(lv - 4.0));
            // premultiplied: rgb / coverage; where everything around is covered (the board could not be seen there anyway) fade smoothly to the background
            vec3 see = (acc.rgb / uFrostScale + uFrostBg * 0.02) / (acc.a + 0.02);
            // transmission: highest face-on, smaller at grazing angles by Fresnel (the edges reflect and whiten)
            float cv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
            // a wide-lobed Fresnel: a slanted board (standing, half open) starts whitening at its edges, not only right at grazing
            float fr = 0.04 + 0.5 * (1.0 - cv) * (1.0 - cv);
            // the cut edge: where on the rounded bevel (0 facing the board's face … 1 the side wall, from the angle between the unperturbed
            // geometric normal and the face). The upward ring of the bevel is the light-guide rim (light entering the board travels sideways
            // and leaves at the cut); the outermost ring, the side wall, is opaque and darkened, outlining every board
            float edge = clamp(vFrostEdge, 0.0, 1.0);
            float rimc = 1.0 - abs(dot(nonPerturbedNormal, normalize(cross(vFrostTx, vFrostTy))));
            float lip = edge * (1.0 - smoothstep(0.6, 0.9, rimc));
            float wall = edge * smoothstep(0.75, 0.97, rimc);
            float tr = uFrostT * (1.0 - fr) * smoothstep(0.0, 0.3, cv) * (1.0 - wall);
            vec3 deep = uFrostTint * uFrostTint;
            totalDiffuse = mix(totalDiffuse, see * deep, tr);
            // the base layer's specular stays only where little shows through (grazing angles, the sides), never over what shows through;
            // the very diffuse satin sheen of the surface (the clearcoat) is not damped: when the cover swings the softbox's reflection slides
            // across the board, which reads as a PP board with a surface
            totalSpecular *= 1.0 - 0.6 * tr;
            // back light: part of the light on the other face comes through; wrapped (still half with the light side-on), so a standing,
            // side-lit board is not a dead grey
            #if NUM_DIR_LIGHTS > 0
              for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
                float back = clamp(0.5 - 0.5 * dot(normal, directionalLights[i].direction), 0.0, 1.0);
                totalDiffuse += BRDF_Lambert(diffuseColor.rgb) * directionalLights[i].color * back * uFrostBack * (1.0 - 0.5 * tr);
              }
            #endif
            // the light-guide rim: brighter than the face and more saturated (the light picks up the tint travelling through the board);
            // the side-wall ring more saturated still, and darkened
            totalDiffuse += deep * (diffuseColor.rgb * uFrostEdge + uFrostGlow * mix(vec3(0.6), see, 0.5)) * lip;
            totalDiffuse = mix(totalDiffuse, totalDiffuse * deep * uFrostTint, wall * 0.55);
            totalDiffuse *= 1.0 - uFrostEdgeDark * wall;
            // the milky white scattered back inside the board: only where little shows through (grazing angles, slanted boards), never on top
            // of the transmitted light, which would wash the covered cards out to a grey-white
            totalDiffuse += uFrostTint * uFrostMilk * (1.0 - wall) * (1.0 - tr);
            // the two creases of the binder's hinge (aFrostGroove is the position across the hinge, −1 on the boards): the pressed grooves catch
            // less light, each a thin dark line
            if (vFrostGroove >= 0.0) {
              float g0 = (vFrostGroove - ${HINGE_LINES[0].toFixed(3)}) / ${HINGE_LINES[2].toFixed(3)};
              float g1 = (vFrostGroove - ${HINGE_LINES[1].toFixed(3)}) / ${HINGE_LINES[2].toFixed(3)};
              totalDiffuse *= 1.0 - uFrostGroove * clamp(exp(-g0 * g0) + exp(-g1 * g1), 0.0, 1.0);
            }
          }`,
        );
      };
      const key = mat.customProgramCacheKey?.bind(mat);
      mat.customProgramCacheKey = () => (key ? key() : "") + "|album-frost";
    },
    setSize(w, h) {
      W = Math.max(1, w);
      H = Math.max(1, h);
      const w0 = Math.max(1, Math.round(W * scale));
      const h0 = Math.max(1, Math.round(H * scale));
      scene.setSize(w0, h0);
      caseTarget.setSize(w0, h0);
      for (let k = 0; k < LEVELS; k++) {
        const lw = Math.max(1, Math.round(w0 / 2 ** k));
        const lh = Math.max(1, Math.round(h0 / 2 ** k));
        levels[k]!.setSize(lw, lh);
        temps[k]!.setSize(lw, lh);
      }
      uniforms.uFrostInvRes.value.set(1 / W, 1 / H);
    },
    setScreen(w, h) {
      uniforms.uFrostInvRes.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    },
    render(r, sc, camera, clear, deskOnly) {
      const mask = camera.layers.mask;
      const override = sc.overrideMaterial;
      r.getClearColor(savedClear);
      const alpha = r.getClearAlpha();
      if (!deskOnly) {
        // the case's depth: the first blur pass masks out whatever is nearer than it
        camera.layers.set(FROST_LAYER);
        sc.overrideMaterial = depthOnly;
        r.setRenderTarget(caseTarget);
        r.clear(true, true, false);
        r.render(sc, camera);
        sc.overrideMaterial = override;
      }
      // everything but the case (layer 0 + the desk); fully open, only the desk layer
      camera.layers.set(DESK_LAYER);
      if (!deskOnly) camera.layers.enable(0);
      r.setClearColor(clear, 1);
      r.setRenderTarget(scene);
      r.render(sc, camera);
      r.setClearColor(savedClear, alpha);
      camera.layers.mask = mask;
      // level by level: horizontal first (downsampling from the larger level on the way), then vertical
      firstMat.uniforms.uNear!.value = camera.near;
      firstMat.uniforms.uFar!.value = camera.far;
      firstMat.uniforms.uMask!.value = deskOnly ? 0 : 1;
      for (let k = 0; k < LEVELS; k++) {
        const dst = levels[k]!;
        const tmp = temps[k]!;
        const src = k === 0 ? scene.texture : levels[k - 1]!.texture;
        pass(k === 0 ? firstMat : blurMat, src, tmp, 1 / dst.width, 0);
        pass(blurMat, tmp.texture, dst, 0, 1 / dst.height);
      }
      r.setRenderTarget(null);
      // how many canvas pixels 1 scene unit is at depth 1; level 0's σ converted to canvas pixels
      uniforms.uFrostProj.value = (camera.projectionMatrix.elements[5]! * H) / 2;
      uniforms.uFrostSigma0.value = SIGMA * (W / levels[0]!.width);
      uniforms.uFrostBg.value.copy(clear);
    },
    setLook(tint) {
      uniforms.uFrostTint.value.copy(tint);
    },
    compile(r, sc, camera, extra) {
      // compile() runs synchronously inside compileAsync, so the quad can wear each blur material in turn
      quad.material = firstMat;
      const out: Promise<unknown>[] = [r.compileAsync(quadScene, quadCam)];
      quad.material = blurMat;
      out.push(r.compileAsync(quadScene, quadCam));
      if (sc && camera) {
        // the background pass draws the scene into a render target: linear output, no tone mapping — other program variants than
        // the screen's, otherwise compiled in the first frame the cover moves
        const prev = r.getRenderTarget();
        r.setRenderTarget(scene);
        out.push(r.compileAsync(sc, camera));
        if (extra) out.push(r.compileAsync(extra, camera, sc));
        r.setRenderTarget(prev);
      }
      return Promise.all(out);
    },
    dispose() {
      scene.dispose();
      depthTex.dispose();
      caseTarget.dispose();
      caseDepth.dispose();
      depthOnly.dispose();
      for (const t of [...levels, ...temps]) t.dispose();
      firstMat.dispose();
      blurMat.dispose();
      tri.dispose();
    },
  };
}

/**
 * The frosted boards' shadow: a translucent board blocks part of the key light (not all of it); the shadow is very soft and spreads
 * the further away it falls — light through frost is diffuse.
 * Not through the shadow map (VSM cannot express "blocks a part", and jittered depth would flicker in the blur) but computed
 * analytically in the receiving material:
 * a ray from the fragment along the key light's direction is intersected with three rectangles, the front board, spine and back
 * board (the boards' mid-planes); landing inside the rounded rectangle darkens the key light by strength,
 * and the penumbra widens with the intersection's distance from the fragment; anything touching a board (a very small distance) does
 * not count, so a board does not shadow itself either.
 * The desk, the sheets, the thickness of the two stacks and the case itself are all hooked up: a raised front board casts a faint
 * soft shadow on the desk, pages and back board, the desk layer has it too when the background is drawn, and it shows through the
 * frost; lying flat, the boards are a little higher than the spine resting on the desk, so the desk under a board gets a soft shadow
 * too, showing as a narrow strip beyond the board's other edge — seen through the board, the board reads as a layer floating above the desk.
 * The frosted boards themselves stay out of the VSM shadow map (frostCaster: its depth material writes nothing), so whichever pass
 * draws the shadow map, with whichever set of camera layers, its content is the same.
 */
export type FrostShadow = {
  /** Hooks up a material (wrapping its original onBeforeCompile); on a ShadowMaterial it only multiplies the shadow mask */
  patch(mat: THREE.Material): void;
  /**
   * Every frame: the three boards (centre, unit vector along the width, normal, half width, half height), the key light's direction
   * (pointing at the light), the strength, the multiplier on the desk.
   * sasshi: boards and light are in the book's own frame; bookInv maps world → book (omit for identity)
   */
  update(boards: { o: [number, number, number]; x: [number, number, number]; n: [number, number, number]; hw: number; hh: number }[], light: THREE.Vector3, strength: number, ground: number, bookInv?: THREE.Matrix4): void;
};

const SHADOW_GLSL = /* glsl */ `
uniform vec4 uFsO[3];
uniform vec4 uFsX[3];
uniform vec3 uFsN[3];
uniform vec3 uFsL;
uniform float uFsA;
uniform float uFsG;
uniform mat4 uFsInv;
varying vec3 vFsW;
float frostShadow(vec3 p, float strength) {
  float lit = 1.0;
  for (int i = 0; i < 3; i++) {
    vec3 n = uFsN[i];
    float ln = dot(uFsL, n);
    if (strength <= 0.0 || abs(ln) < 1e-3) continue;
    float t = dot(uFsO[i].xyz - p, n) / ln;
    vec3 q = p + uFsL * t - uFsO[i].xyz;
    // signed distance to a rounded rectangle (the board stands vertical in y: centre at y = 0)
    vec2 d = abs(vec2(dot(q, uFsX[i].xyz), q.y)) - vec2(uFsO[i].w, uFsX[i].w) + ${FROST_SHADOW.corner.toFixed(4)};
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - ${FROST_SHADOW.corner.toFixed(4)};
    float pen = ${FROST_SHADOW.pen0.toFixed(4)} + ${FROST_SHADOW.spread.toFixed(4)} * max(t, 0.0);
    float cov = (1.0 - smoothstep(-pen, pen, sd)) * smoothstep(${FROST_SHADOW.near0.toFixed(4)}, ${FROST_SHADOW.near1.toFixed(4)}, t);
    lit *= 1.0 - strength * cov;
  }
  return lit;
}
`;

export function createFrostShadow(): FrostShadow {
  const uniforms = {
    uFsO: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uFsX: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uFsN: { value: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)] },
    uFsL: { value: new THREE.Vector3(0, 0, 1) },
    uFsA: { value: 0 },
    uFsG: { value: 1 },
    uFsInv: { value: new THREE.Matrix4() },
  };
  return {
    patch(mat) {
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        prev.call(mat, sh, r);
        Object.assign(sh.uniforms, uniforms);
        // sasshi: positions in the book's own frame (identity unless the whole book is tilted); boards and light are given in it too
        sh.vertexShader = "uniform mat4 uFsInv;\nvarying vec3 vFsW;\n" + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\nvFsW = (uFsInv * (modelMatrix * vec4(transformed, 1.0))).xyz;");
        sh.fragmentShader = SHADOW_GLSL + sh.fragmentShader;
        // the desk's (ShadowMaterial) shadows are faint overall (only 16% in the light theme): on the desk the frost's shadow is scaled
        // by ground, so the soft shadow under a board shows through the board too
        if ((mat as THREE.ShadowMaterial).isShadowMaterial) sh.fragmentShader = sh.fragmentShader.replace(/getShadowMask\(\)/g, "(getShadowMask() * frostShadow(vFsW, uFsA * uFsG))");
        else
          sh.fragmentShader = sh.fragmentShader.replace(
            "#include <lights_fragment_begin>",
            THREE.ShaderChunk.lights_fragment_begin.replace(
              "getDirectionalLightInfo( directionalLight, directLight );",
              "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= frostShadow( vFsW, uFsA );",
            ),
          );
      };
      const key = mat.customProgramCacheKey.bind(mat);
      mat.customProgramCacheKey = () => key() + "|frost-shadow";
    },
    update(boards, light, strength, ground, bookInv) {
      if (bookInv) uniforms.uFsInv.value.copy(bookInv);
      else uniforms.uFsInv.value.identity();
      uniforms.uFsA.value = strength;
      uniforms.uFsG.value = ground;
      uniforms.uFsL.value.copy(light).normalize();
      for (let i = 0; i < 3; i++) {
        const b = boards[i];
        if (!b) {
          uniforms.uFsO.value[i]!.set(0, 0, -100, 0);
          continue;
        }
        uniforms.uFsO.value[i]!.set(b.o[0], b.o[1], b.o[2], b.hw);
        uniforms.uFsX.value[i]!.set(b.x[0], b.x[1], b.x[2], b.hh);
        uniforms.uFsN.value[i]!.set(b.n[0], b.n[1], b.n[2]);
      }
    },
  };
}

/**
 * The frosted boards' depth material for the VSM shadow map: writes nothing. three's VSM draws objects that "receive shadows" into
 * the shadow map too — once a frosted board is in it, the desk and pages under the board are blacked out wholesale (a solid shadow),
 * and only in the pass that uses layer 1: depending on which pass drew the shadow map, the desk seen through the frost comes out a
 * notch different.
 * The frosted boards' shadow is left to the analytic shadow above (blocking only a part, very soft)
 */
export function frostCaster(): THREE.Material {
  const m = new THREE.MeshDepthMaterial();
  m.colorWrite = false;
  m.depthWrite = false;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("void main() {", "void main() {\n\tdiscard;");
  };
  m.customProgramCacheKey = () => "album-frost-nocast";
  return m;
}
