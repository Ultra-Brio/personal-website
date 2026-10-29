/*
 * The rig every object shares: places it from a BodyState, fakes lift / tumble with a small eased tilt, raises it toward the
 * front film while held, drives the card flex spring, and owns the soft contact-shadow quad.
 *
 * Frame: object.position = (state.x, state.y, 0) in the pouch plane. The tilt/spin group sits at the object's resting height:
 * its local z = 0 is the REAR face of the object, so `LAYERS[i].z` is literally the height of the rear face above the back film
 * and thickness grows toward the viewer (hence no two layers intersect as long as thickness < the layer gap).
 */
import * as THREE from "three";
import type { FontRun } from "../../fonts";
import { LAYERS, POUCH_DEPTH } from "../constants";
import { FlexSpring, type FlexUniforms } from "./flex";
import { clamp, hashStr, receiveSun, silhouetteShadow, Tracker, type V2 } from "./shared";
import type { PocketItem } from "../../profile/schema";
import type { BodySpec, BodyState, BuiltObject, ObjectCtx } from "./types";

export type FlexRig = { uniforms: FlexUniforms; axis: "x" | "y" };

export type ObjectDef = {
  spec: BodySpec;
  /** z extent from the rear face (m), including the tallest part */
  thickness: number;
  /** footprint polygon in the body frame (m, CCW): hit-testing, area budget, and the contact shadow unless `shadowPolys` is given */
  outline: V2[];
  /** several polygons whose union is the silhouette (when one outline is not enough) */
  shadowPolys?: V2[][];
  /** holes through the object (a punch): cut out of the contact shadow, so the light under them stays */
  shadowHoles?: V2[][];
  /** meshes in the body frame (z = 0 is the rear face) */
  parts: THREE.Object3D[];
  flex?: FlexRig;
  tracker: Tracker;
  /** extra per-frame work (e.g. a decal fade) */
  tick?: (state: BodyState, t: number, heldE: number) => void;
  /** paint the print again into the same canvases and flag the textures (late web fonts) */
  repaint?: () => void;
  /** the strings it prints (for ensureFonts) */
  runs?: FontRun[];
  /**
   * the same object in another language: print `item` (same kind) with `ctx`'s owner and language from the next repaint() on, and
   * return the strings it will print; null when it cannot (another kind, another picture)
   */
  relabel?: (item: PocketItem, ctx: ObjectCtx) => FontRun[] | null;
  /** resolves when its pictures are painted in */
  ready?: Promise<void>;
};

const D2R = Math.PI / 180;
const TILT_MAX = 6 * D2R;
const KV = 0.09; // rad per m/s of in-plane speed
const KW = 0.008; // rad per rad/s of spin
/**
 * Largest rise of a tilted object's high edge over its low edge (m). The pouch is only POUCH_DEPTH deep: a 15 cm sheet tilted
 * 6 degrees about its centre would sink 8 mm of itself through the layers below and its own contact shadow, so the tilt
 * pivots on the low edge and is scaled down until the high edge rises at most this much (and never into the front film).
 */
const MAX_RISE = 0.003;
const Z0 = LAYERS[0].z;
const Z1 = LAYERS[1].z;
const Z2 = LAYERS[2].z;
const LIGHT_DIR: V2 = [-0.55, -0.83]; // the window is top right: shadows fall to the lower left

/** Rear-face height of a (possibly fractional) layer. */
export function layerZ(layer: number): number {
  const l = clamp(layer, 0, 2);
  return l <= 1 ? Z0 + (Z1 - Z0) * l : Z1 + (Z2 - Z1) * (l - 1);
}

const shadowVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const shadowFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uLod;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float a = textureLod( uMap, vUv, uLod ).a * uOpacity;
  gl_FragColor = vec4( uColor, a );
}`;

export function assemble(def: ObjectDef): BuiltObject {
  const { spec, tracker: T } = def;
  const object = new THREE.Group();
  object.name = `bag-object:${spec.id}`;
  object.userData.bodyId = spec.id; // for picking: walk up from a hit mesh to the group carrying `bodyId`

  const body = new THREE.Group();
  body.rotation.order = "XYZ";
  for (const p of def.parts) body.add(p);
  // lit by the window: the leaves and the bars fall on it (it casts nothing; its contact shadow is the quad below)
  receiveSun(body);
  object.add(body);

  // ---- contact shadow ----
  const sh = silhouetteShadow(def.shadowPolys ?? def.outline, undefined, undefined, def.shadowHoles);
  T.add(sh.tex);
  const shMat = T.add(
    new THREE.ShaderMaterial({
      uniforms: { uMap: { value: sh.tex }, uOpacity: { value: 0.4 }, uLod: { value: 0.6 }, uColor: { value: new THREE.Color(0x15233a) } },
      vertexShader: shadowVert,
      fragmentShader: shadowFrag,
      transparent: true,
      depthWrite: false,
    }),
  );
  const shGeo = T.add(new THREE.PlaneGeometry(sh.w, sh.h));
  const shadow = new THREE.Mesh(shGeo, shMat);
  shadow.renderOrder = 2;
  shadow.frustumCulled = false;
  shadow.name = "contact-shadow";
  shadow.raycast = () => {}; // never pickable
  object.add(shadow);

  // ---- per-object state ----
  const rank = (hashStr(spec.id) % 5) * 1.2e-5; // tiny stacking epsilon, deterministic
  const flex = def.flex ? new FlexSpring() : null;
  let lastT = Number.NaN;
  let pvx = 0;
  let pvy = 0;
  let pw = 0;
  let ax = 0;
  let ay = 0;
  let aw = 0;
  let tx = 0;
  let ty = 0;
  let heldE = 0;
  let layerE = Number.NaN; // the layer actually drawn: eased, so a ghost hopping to the top layer (or dropping back) glides instead of popping
  let dark = false;

  function update(st: BodyState, t: number) {
    const first = !Number.isFinite(lastT);
    let dt = first ? 0 : t - lastT;
    lastT = t;
    if (dt < 0 || dt > 0.25) dt = 0; // time went backwards or a long stall: re-seed instead of integrating
    dt = Math.min(dt, 0.1);

    if (dt > 1e-4) {
      // apparent acceleration by finite difference, low-passed so single-substep jumps do not spike the spring
      const k = 1 - Math.exp(-dt * 40);
      ax += ((st.vx - pvx) / dt - ax) * k;
      ay += ((st.vy - pvy) / dt - ay) * k;
      aw += ((st.w - pw) / dt - aw) * k;
    } else if (dt === 0) {
      ax = ay = aw = 0;
    }
    pvx = st.vx;
    pvy = st.vy;
    pw = st.w;

    const e = 1 - Math.exp(-dt * 14);
    heldE += ((st.held ? 1 : 0) - heldE) * (first ? 1 : e);

    // tilt: leading edge lifts a touch, spinning things wobble; eased and clamped to +-6 degrees
    const spin = st.w;
    const ttx = clamp(KV * st.vy + KW * spin * Math.cos(st.angle) + (st.held ? 0.02 : 0), -TILT_MAX, TILT_MAX);
    const tty = clamp(-KV * st.vx + KW * spin * Math.sin(st.angle), -TILT_MAX, TILT_MAX);
    const k = first ? 1 : 1 - Math.exp(-dt * 12);
    tx += (ttx - tx) * k;
    ty += (tty - ty) * k;

    // height: layer rear-face height + stacking epsilon + held lift (never into the front film)
    layerE = first || Number.isNaN(layerE) ? st.layer : layerE + (st.layer - layerE) * (1 - Math.exp(-dt * 18));
    const base = layerZ(layerE);
    const room = POUCH_DEPTH - 0.0009 - def.thickness - base;
    // the tilt pivots on the low edge: z of the footprint under rotation (tx, ty, angle) in XYZ order is v sin tx - u sin ty cos tx
    const ca0 = Math.cos(st.angle);
    const sa0 = Math.sin(st.angle);
    const kx = Math.sin(tx);
    const ky = Math.sin(ty) * Math.cos(tx);
    let zLo = 0;
    let zHi = 0;
    for (const [px, py] of def.outline) {
      const z = (px * sa0 + py * ca0) * kx - (px * ca0 - py * sa0) * ky;
      if (z < zLo) zLo = z;
      if (z > zHi) zHi = z;
    }
    const limit = Math.max(0, Math.min(MAX_RISE, room));
    if (zHi - zLo > limit) {
      const k = limit / (zHi - zLo);
      tx *= k;
      ty *= k;
      zLo *= k;
      zHi *= k;
    }
    const lift = heldE * clamp(room - (zHi - zLo), 0, 0.0045);
    body.position.set(0, 0, base + rank + lift - zLo);
    body.rotation.set(tx, ty, st.angle);
    object.position.set(st.x, st.y, 0);

    // flex: acceleration (mostly across the long axis, some along it) plus a little angular acceleration bows the card
    if (flex && def.flex) {
      const sa = Math.sin(st.angle);
      const ca = Math.cos(st.angle);
      // unit vectors of the long and short axes in the pouch plane
      const [lx, ly] = def.flex.axis === "x" ? [ca, sa] : [-sa, ca];
      const aLong = ax * lx + ay * ly;
      const aShort = -ax * ly + ay * lx;
      const drive = clamp(aShort * 0.1 + aLong * 0.05 + aw * 0.015 + (st.held ? 0.18 : 0), -2.5, 2.5);
      flex.step(dt, drive);
      def.flex.uniforms.uFlex.value = flex.value;
    }

    // shadow: sits just under the rear face at the resting layer, slides along the light direction with height
    const h = base + lift;
    const sz = Math.max(0.0001, base - 0.00006);
    const off = 0.0005 + h * 0.62 + heldE * 0.003;
    const grow = 1 + heldE * 0.1;
    // the silhouette texture is in the body frame (it spins with the object), the light offset is in the pouch frame
    const ca = Math.cos(st.angle);
    const sa = Math.sin(st.angle);
    shadow.position.set((sh.cx * ca - sh.cy * sa) * grow + LIGHT_DIR[0] * off, (sh.cx * sa + sh.cy * ca) * grow + LIGHT_DIR[1] * off, sz + rank * 0.1);
    shadow.rotation.z = st.angle;
    shadow.scale.setScalar(grow);
    const rest = 0.5 * Math.exp(-h / 0.0075);
    shMat.uniforms.uOpacity!.value = (rest + 0.12) * (1 - 0.35 * heldE) * (dark ? 1.15 : 1);
    shMat.uniforms.uLod!.value = 0.5 + h * 160 + heldE * 1.2;
    def.tick?.(st, t, heldE);
  }

  /** Objects stay physically coloured in dark mode; only the contact shadows read a little stronger. The room (scene.environmentIntensity) is the host's. */
  function setDark(d: boolean) {
    dark = d;
  }

  const built: BuiltObject = {
    object,
    body: spec,
    outline: def.outline,
    update,
    setDark,
    repaint: () => def.repaint?.(),
    relabel(item, ctx) {
      const runs = def.relabel?.(item, ctx);
      if (!runs) return false;
      built.fonts = runs;
      return true;
    },
    fonts: def.runs ?? [],
    ready: def.ready ?? Promise.resolve(),
    flex: () => flex?.value ?? 0,
    holes: (def.shadowHoles?.length ?? 0) > 0,
    still() {
      const model = body.clone();
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      const u = def.flex?.uniforms.uFlex;
      return {
        model,
        flat<R>(fn: () => R): R {
          if (!u) return fn();
          const was = u.value;
          u.value = 0;
          try {
            return fn();
          } finally {
            u.value = was;
          }
        },
      };
    },
    dispose() {
      object.removeFromParent();
      T.dispose();
    },
  };
  return built;
}
