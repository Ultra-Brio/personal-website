/*
 * Visual harness for src/bag/objects. Open /scripts/harness/bag-objects.html (vite dev server).
 * The light is the book engine's studio (pouch.studio.ts environment, the window key from the top right, cool sky and ground,
 * exposure 1.2, Neutral tone mapping), the page under the pouch is the résumé folio's liner (#e8edf0), the print is set through
 * src/fonts (the exact glyphs are loaded first), and the objects lie where the composed deal puts them.
 *   (no params)          the pouch with its five objects at rest, portrait camera
 *   ?sample=zh           the Simplified Chinese sample profile
 *   ?view=angled         3/4 camera, shows the film bulge, thickness and the soft shadows
 *   ?kind=<k>            close-up of one object inside the pouch (card|resume|ticket|polaroid|note)
 *   &back=1              ... turned over (about its vertical axis): its printed back
 *   &bare=1              ... without the pouch, to inspect the object's own materials
 *   &solo=1              ... and only that object (no neighbours in the frame)
 *   &zoom=1.5            framing multiplier for close-ups
 *   &held=<k>            render that object in the "held" state (lifted, bigger softer shadow)
 *   &shake=<k>           run a scripted shake of that object for 0.5 s and render at the peak of the flex
 *   &az=1.3&el=0.1       camera azimuth / elevation (radians) for close-ups, e.g. a grazing side view of the flex
 *   &deal=1              the n-th re-deal of the composition (0: the first deal)
 *   &leak=1              dispose everything after the first frame and report GPU resource counts before / after in __stats.leak
 *   &flipdark=1          build in the opposite theme, then call setDark(dark): must look identical to a direct build
 *   &dpr=2               device pixel ratio
 *   ?photo=1             only the polaroid's procedural photograph, flat (zoom = print size multiplier, seed varies it)
 * window.__ready is set once fonts are loaded and the first frame is drawn; window.__stats holds renderer.info numbers.
 */
import * as THREE from "three";
import { composeDeal } from "../../src/bag/compose";
import { POUCH_H, POUCH_W } from "../../src/bag/constants";
import { buildObject, createPouch, POUCH_BOUNDS, type BodyState, type BuiltObject } from "../../src/bag/objects";
import { sharedCount } from "../../src/bag/objects/shared";
import { ensureFonts } from "../../src/fonts";
import { profile as sampleEn } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";
import { studioScene, STUDIO } from "./pouch.studio";

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: Record<string, unknown>;
    __error?: string;
  }
}

const q = new URLSearchParams(location.search);
const sample = q.get("sample") === "zh" ? sampleZh : sampleEn;
// a Chinese page, as the app marks it (src/fonts registers the 500 sans file for Chinese pages only)
if (sample.lang) document.documentElement.lang = sample.lang;
const back = q.get("back") === "1";
const kind = q.get("kind");
const bare = q.get("bare") === "1";
const solo = q.get("solo") === "1";
const view = q.get("view") ?? "front";
const zoom = Number(q.get("zoom") ?? 1);
const heldKind = q.get("held");
const shakeKind = q.get("shake");
const dpr = Number(q.get("dpr") ?? window.devicePixelRatio ?? 1);
const leak = q.get("leak") === "1";
const az = Number(q.get("az") ?? 0);
const el = Number(q.get("el") ?? 0);
const dealN = Number(q.get("deal") ?? 0);


// ?photo=1: only the polaroid's procedural photograph, flat at print size x `zoom` (to judge it as a picture)
if (q.get("photo") === "1") {
  const { paintDeskAtNight } = await import("../../src/bag/objects/photo");
  const item = sample.items.find((i) => i.kind === "polaroid");
  const size = Math.round(79 * 9 * zoom);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.style.cssText = `width:${size / dpr}px;height:${size / dpr}px;display:block;margin:24px auto`;
  const t0 = performance.now();
  paintDeskAtNight(c.getContext("2d")!, 0, 0, size, item && item.kind === "polaroid" ? (item.tint ?? "#c9d3da") : "#c9d3da", 0x5eed ^ Number(q.get("seed") ?? 0));
  window.__stats = { photoMs: Math.round(performance.now() - t0) };
  document.body.appendChild(c);
  window.__ready = true;
  await new Promise(() => {});
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#e3e8eb");
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = studioScene();
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
}
scene.environmentIntensity = 0.6;
const key = new THREE.DirectionalLight(STUDIO.key, 1.35);
key.position.set(2.9, 0.75, 4.2);
scene.add(key, key.target);
const hemi = new THREE.HemisphereLight(STUDIO.sky, STUDIO.ground, 0.18);
hemi.position.set(0, 0, 1);
scene.add(hemi);

// the folio's liner under the pouch, so the clear film has something to be clear against
const page = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.8), new THREE.MeshStandardMaterial({ color: "#e8edf0", roughness: 0.95 }));
page.position.set(0, 0.01, -0.0015);
if (!(bare && solo)) scene.add(page);

const ctx = {
  anisotropy: renderer.capabilities.getMaxAnisotropy(),
  ...(sample.lang ? { lang: sample.lang } : {}),
  owner: { name: sample.name, ...(sample.nameLocal ? { nameLocal: sample.nameLocal } : {}), role: sample.role, ...(sample.location ? { location: sample.location } : {}), ...(sample.handle ? { handle: sample.handle } : {}), links: sample.links },
};

const pouch = createPouch({ ...ctx, label: sample.name });
if (!bare) scene.add(pouch.group);

const built: Record<string, BuiltObject> = {};
const states: Record<string, BodyState> = {};
const items = sample.items;
const all = items.map((item) => {
  try {
    return buildObject(item, ctx);
  } catch (e) {
    console.error(`build ${item.kind}:`, e);
    window.__error = `${item.kind}: ${String(e)}`;
    return null;
  }
});
const poses = composeDeal(
  items.map((i) => i.kind),
  all.map((o) => o?.body ?? { id: "x", w: 0.01, h: 0.01, layer: 0, shape: "rect" as const }),
  7,
)(dealN);
items.forEach((item, i) => {
  const o = all[i];
  if (!o) return;
  if (solo && kind && item.kind !== kind) {
    o.dispose();
    return;
  }
  built[item.kind] = o;
  const p = poses[i] ?? { x: 0, y: 0, angle: 0 };
  states[item.kind] = { id: item.id, x: p.x, y: p.y, angle: p.angle, vx: 0, vy: 0, w: 0, layer: o.body.layer, held: item.kind === heldKind };
  scene.add(o.object);
});
// the exact glyphs the print uses, and the pictures, before the first frame; then paint again
const t0 = performance.now();
await ensureFonts([...pouch.fonts, ...Object.values(built).flatMap((o) => o.fonts)]);
await Promise.all(Object.values(built).map((o) => o.ready));
pouch.repaint();
for (const o of Object.values(built)) o.repaint();
const fontsMs = Math.round(performance.now() - t0);

// ---- camera ----
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(26, aspect, 0.01, 5);
const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

function frame(cx: number, cy: number, w: number, h: number, azimuth = 0, elevation = 0) {
  const dist = Math.max(h / 2 / tanH, w / 2 / tanH / aspect);
  const dir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
  camera.position.set(cx, cy, 0).addScaledVector(dir, dist);
  camera.lookAt(cx, cy, 0.004);
  camera.updateProjectionMatrix();
}

const ow = POUCH_BOUNDS.maxX - POUCH_BOUNDS.minX;
const oh = POUCH_BOUNDS.maxY - POUCH_BOUNDS.minY;
const ocx = (POUCH_BOUNDS.maxX + POUCH_BOUNDS.minX) / 2;
const ocy = (POUCH_BOUNDS.maxY + POUCH_BOUNDS.minY) / 2;
if (kind && built[kind]) {
  const s = states[kind]!;
  const b = built[kind]!.body;
  // frame the object as it lies (its rotated box)
  const c = Math.abs(Math.cos(s.angle)), sn = Math.abs(Math.sin(s.angle));
  const w = (b.w * c + b.h * sn) * 1.18, h = (b.w * sn + b.h * c) * 1.18;
  frame(s.x, s.y, w / zoom, h / zoom, az, el);
} else if (view === "angled") {
  frame(ocx, ocy, ow * 1.12, oh * 1.1, 0.5, 0.2);
} else {
  frame(ocx, ocy, ow * 1.06, oh * 1.04);
}

// ---- state + render ----
let t = 0;
function updateAll() {
  for (const [k, o] of Object.entries(built)) o.update(states[k]!, t);
  pouch.update(t);
}

// settle the held / tilt easing at rest
for (let i = 0; i < 40; i++) {
  t += 1 / 60;
  updateAll();
}
// turned over: the object's body group about its vertical axis (as the lightbox's back still does)
if (back && kind && built[kind]) {
  const body = built[kind]!.object.children[0];
  if (body) body.rotation.y += Math.PI;
  // turned over, a sheet's bulge (the résumé's fold memory) points down through the contact-shadow quad: hide it, as the lightbox
  // snapshot does
  for (const ch of built[kind]!.object.children) if (ch.name === "contact-shadow") ch.visible = false;
}

if (shakeKind && built[shakeKind] && states[shakeKind]) {
  // sustained push: 15 m/s^2 for 0.5 s drives the flex spring to its limit, so the bend is clearly visible
  const s = states[shakeKind]!;
  for (let i = 0; i < 30; i++) {
    t += 1 / 60;
    s.vy += 15 / 60;
    updateAll();
  }
}

function render() {
  renderer.info.reset();
  renderer.render(scene, camera);
}

render();
const info = renderer.info.render;
/** triangles and draw calls (one per mesh, or per material group) under a node */
function count(root: THREE.Object3D) {
  let tris = 0;
  let calls = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const total = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    if (Array.isArray(m.material)) {
      for (const grp of g.groups) tris += grp.count / 3;
      calls += g.groups.length;
    } else {
      tris += total / 3;
      calls += 1;
    }
  });
  return { tris: Math.round(tris), calls };
}
const perObject: Record<string, string> = {};
let sceneTris = 0;
for (const [k, o] of Object.entries(built)) {
  const c = count(o.object);
  perObject[k] = `${c.tris} tris / ${c.calls} draws`; // includes the shadow quad
  sceneTris += c.tris;
}
{
  const c = count(pouch.group);
  perObject.pouch = `${c.tris} tris / ${c.calls} draws (films draw twice: DoubleSide)`;
  sceneTris += c.tris;
}

// area budget: sum of footprint polygon areas vs the pouch's usable area
function polyArea(p: readonly (readonly [number, number])[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
let area = 0;
const perKind: Record<string, number> = {};
for (const [k, o] of Object.entries(built)) {
  const a = polyArea(o.outline);
  perKind[k] = Math.round(a * 1e6);
  area += a;
}

const flexNow: Record<string, number> = {};
for (const [k, o] of Object.entries(built)) flexNow[k] = Number(o.flex().toFixed(3));
window.__stats = {
  fontsMs,
  flex: JSON.stringify(flexNow),
  calls: info.calls,
  triangles: info.triangles,
  sceneTriangles: Math.round(sceneTris),
  perObject: JSON.stringify(perObject),
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
  areaMm2: Math.round(area * 1e6),
  areaRatio: Number((area / (POUCH_W * POUCH_H)).toFixed(3)),
  perKindMm2: JSON.stringify(perKind),
};
if (leak) {
  const before = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, shared: sharedCount() };
  for (const o of Object.values(built)) o.dispose();
  pouch.dispose();
  render();
  const after = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, shared: sharedCount(), sceneChildren: scene.children.length };
  window.__stats = { ...window.__stats, leak: JSON.stringify({ before, after }) };
}
window.__ready = true;
