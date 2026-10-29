/*
 * Stand-in host for the pouch addon (src/bag/addon.ts): a minimal three scene that implements the SceneAddon contract around
 * a flat board, with the book engine's exact lighting (renderer, tone mapping, exposure, studio environment, key + hemi
 * lights), camera (fov 24, 9 degree tilt) and render-on-demand loop, so the pouch looks here the way it will in the folio.
 *
 * Open /scripts/harness/pouch.html on the dev server.
 *   ?sample=zh  the Chinese sample     ?manual=1  no RAF loop: frames only through window.__host.advance(dt, n)
 *   ?ui=0       no buttons / legend   ?seed=7    layout seed
 *   ?sun=1      a stand-in for the engine's window sun (bars and leaves cast onto the board and the pouch)
 * Light only (朝の光): the engine's studio colours (pouch.studio.ts STUDIO), the key from the window at the top right, the résumé
 * folio's 藍鉄 leather board with its cool liner.
 * Mouse: press an object to pick it up, drag, fling; click (short press) logs a pick. Press the desk and drag to tilt the board.
 * Keys: arrows tilt, S shakes the board (frame acceleration), B is the Shake button (sim impulse), R re-deal, O close/open.
 * window.__host exposes the debug API used by pouch.check.ts / pouch.shot.ts (setLang("zh" | "en"): the language swap, in place).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createPouchAddon, type PouchAddon } from "../../src/bag/addon";
import type { SceneAddon as EngineAddon } from "../../src/book/addon";
import { G } from "../../src/bag/constants";
import { disableMotion } from "../../src/bag/motion";
import { profile as sampleEn } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";
import { studioScene, STUDIO } from "./pouch.studio";

const q = new URLSearchParams(location.search);
const sample = q.get("sample") === "zh" ? sampleZh : sampleEn;
// a Chinese page, as the app marks it (src/fonts registers the 500 sans file for Chinese pages only)
if (sample.lang) document.documentElement.lang = sample.lang;
const manual = q.get("manual") === "1";
const showUi = q.get("ui") !== "0";
const seed = Number(q.get("seed") ?? 7);

const MM = 0.01;
const D2R = Math.PI / 180;
/** The stand-in back board, as the résumé folio's: inner area 250 x 340 mm (what the pouch may cover) plus the engine's 7 mm pad all round, 3 mm thick. */
const INNER = { w: 250 * MM, h: 340 * MM };
const PAD = 7 * MM;
const BOARD = { w: INNER.w + 2 * PAD, h: INNER.h + 2 * PAD, t: 3 * MM };
/** The page's desk (朝霧), which the app hands the engine as its background. */
const BG = "#e3e8eb";

/* ── renderer: the book engine's settings (src/book/scene.ts createBook / applyTheme) ── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
/** The studio's prefiltered environment: a render target, so it is made again when a lost context comes back (as the engine does). */
function studioEnv() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = studioScene();
  const rt = pmrem.fromScene(studio, 0.02);
  studio.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
  pmrem.dispose();
  return rt;
}
let envRT = studioEnv();
scene.environment = envRT.texture;

const key = new THREE.DirectionalLight(STUDIO.key, 1.35);
key.position.set(2.9, 0.75, 4.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 1, far: 10 });
key.shadow.radius = 14;
key.shadow.blurSamples = 16;
key.shadow.bias = -0.0008;
key.shadow.normalBias = 0.015;
key.shadow.intensity = 0.7;
scene.add(key, key.target);
const hemi = new THREE.HemisphereLight(STUDIO.sky, STUDIO.ground, 0.18);
hemi.position.set(0, 0, 1);
scene.add(hemi);

/*
 * ?sun=1: a stand-in for the engine's window sun (D2, src/book/scene.ts): the window's light split in two from the same direction —
 * the key keeps 70 % with its tight map, a far "sun" takes 30 % with a soft one — and real occluders off camera between it and the
 * board: two window bars and a twig with leaves, alpha-tested planes that write depth in the shadow pass and nothing on screen. Only
 * the pouch's receiving is under test here, not the engine's tuning.
 */
const SUN = q.get("sun") === "1";
if (SUN) {
  const share = 0.3;
  const dir = new THREE.Vector3(2.9, 0.75, 4.2).normalize();
  // (the engine keeps the occluders out of the key's map with a layer and its own sun pass; here the key simply casts nothing)
  key.intensity = 1.35 * (1 - share);
  key.castShadow = false;
  const sun = new THREE.DirectionalLight(STUDIO.key, 1.35 * share);
  sun.name = "sun";
  sun.position.copy(dir).multiplyScalar(6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 1, far: 12 });
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 8;
  sun.shadow.normalBias = 0.02;
  sun.shadow.intensity = 1;
  scene.add(sun, sun.target);
  // the occluders: drawn into a canvas (white = solid), cut by alphaTest, invisible to the camera (no colour, no depth)
  const art = document.createElement("canvas");
  art.width = 1024;
  art.height = 1024;
  const g = art.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(640, 0, 34, 1024); // the window's upright bar
  g.fillRect(0, 300, 1024, 26); // its cross bar
  g.strokeStyle = "#fff";
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(1024, 560);
  g.bezierCurveTo(820, 600, 600, 700, 380, 900);
  g.stroke();
  const leaf = (x: number, y: number, a: number, s: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(s * 0.5, -s * 0.32, s, 0);
    g.quadraticCurveTo(s * 0.5, s * 0.32, 0, 0);
    g.fill();
    g.restore();
  };
  [[960, 575, -2.2, 90], [880, 600, 2.4, 110], [800, 625, -2.0, 120], [720, 660, 2.0, 105], [640, 705, -1.7, 125], [560, 760, 2.3, 100], [480, 820, -1.6, 110], [420, 870, 2.5, 90]].forEach(([x, y, a, s]) => leaf(x!, y!, a!, s!));
  const mask = new THREE.CanvasTexture(art);
  const occ = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ alphaMap: mask, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  // 2.6 units (260 mm) up the light from the board's centre, square to the light: the pattern lands on the board undistorted
  occ.position.copy(dir).multiplyScalar(2.6);
  occ.lookAt(0, 0, 0);
  occ.castShadow = true;
  occ.frustumCulled = false;
  scene.add(occ);
}

const groundMat = new THREE.ShadowMaterial({ opacity: 0.16, color: STUDIO.shadow });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), groundMat);
ground.position.z = -BOARD.t - 0.02 * MM;
ground.receiveShadow = true;
scene.add(ground);

/* ── the board: a cloth-covered back board with a paper liner, on a group that tilts / shakes about its centre ── */
const book = new THREE.Group();
scene.add(book);
const v3 = new THREE.Vector3();
const clothMat = new THREE.MeshPhysicalMaterial({ color: "#34485c", roughness: 0.62, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color("#8d99a6") });
const board = new THREE.Mesh(new RoundedBoxGeometry(BOARD.w, BOARD.h, BOARD.t, 3, 1.2 * MM), clothMat);
board.position.z = -BOARD.t / 2;
board.castShadow = true;
book.add(board);
const linerMat = new THREE.MeshPhysicalMaterial({ map: linerTexture(), roughness: 0.92 });
const liner = new THREE.Mesh(new THREE.PlaneGeometry(INNER.w + 2 * MM, INNER.h + 2 * MM), linerMat);
liner.position.z = 0.03 * MM;
liner.receiveShadow = true;
book.add(liner);
/** The anchor frame: board centre, on the liner, z = the inside normal (scene units). */
const anchor = new THREE.Object3D();
anchor.position.z = 0.03 * MM;
book.add(anchor);

/* ── camera: the engine's (fov 24, 9 degree tilt, looking from the viewer's side) ── */
const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 40);
const TILT = 9 * D2R;
function placeCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const tan = Math.tan((camera.fov / 2) * D2R);
  const fw = BOARD.w + 0.24, fh = BOARD.h + 0.3;
  const dist = Math.max(fw / 2 / (tan * camera.aspect), fh / 2 / tan);
  camera.position.set(0, -Math.sin(TILT) * dist, Math.cos(TILT) * dist + 0.04);
  camera.lookAt(0, 0, 0.04);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
placeCamera();

/* ── the studio (light only) ── */
renderer.setClearColor(new THREE.Color(BG), 1);
scene.environmentIntensity = 0.6;
renderer.toneMappingExposure = 1.2;

/* ── the addon ── */
type Log = { picks: string[]; hovers: (string | null)[]; impacts: { speed: number; kind: string; pan: number; t: number }[]; sounds: { name: string; gain?: number; pan?: number; t: number }[] };
const log: Log = { picks: [], hovers: [], impacts: [], sounds: [] };
const tip = document.createElement("div");
tip.className = "tip";
document.body.appendChild(tip);
// GPU memory of the scene without the pouch, for the dispose check
renderer.render(scene, camera);
const baseline = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
const addon: PouchAddon = createPouchAddon({
  profile: sample,
  seed,
  anisotropy: renderer.capabilities.getMaxAnisotropy(),
  fit: { width: INNER.w, height: INNER.h },
  onPick(id) {
    log.picks.push(id);
    note(`picked ${id}`);
  },
  onHover(id) {
    log.hovers.push(id);
    tip.style.display = id ? "block" : "none";
    tip.textContent = id ? (sample.items.find((i) => i.id === id)?.label ?? id) : "";
  },
  // sound hooks: logged with the host clock (simT), for pouch.check.ts
  onImpact(speed, kind, pan) {
    log.impacts.push({ speed, kind, pan, t: simT });
  },
  onSound(name, o) {
    log.sounds.push({ name, ...o, t: simT });
  },
});
// the engine's contract, checked by tsc: a pouch addon is a SceneAddon of src/book/addon.ts
const engineView: EngineAddon = addon;
anchor.add(engineView.object);
// the engine casts nothing from an addon (it draws its own contact shadows); the pouch's meshes receive the window's sun with a
// depth material that writes nothing (src/bag/objects/shared.ts receiveSun), so VSM does not draw them into its map either
addon.object.traverse((o) => {
  o.castShadow = false;
});
engineView.attach?.({ renderer, scene, camera, invalidate });
engineView.setOpen?.(1);
// as the engine does (scene.ts restored): three sets up its fresh GL state, then the addons hear of it, then the next frame
canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
canvas.addEventListener("webglcontextrestored", () => {
  envRT.dispose();
  envRT = studioEnv();
  scene.environment = envRT.texture;
  engineView.restore?.();
  invalidate();
});

/* ── host animation: tilt spring + board shake ── */
const tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
const TILT_W = 11; // rad/s, critically damped: a hand tilting a folder
let shakeT = -1;
let shakeAmp = 0;
let shakeDir = 0;
let hostBusy = false;
function hostStep(dt: number) {
  for (const k of ["x", "y"] as const) {
    const v = k === "x" ? "vx" : "vy";
    const target = k === "x" ? tilt.tx : tilt.ty;
    const a = TILT_W * TILT_W * (target - tilt[k]) - 2 * TILT_W * tilt[v];
    tilt[v] += a * dt;
    tilt[k] += tilt[v] * dt;
  }
  book.rotation.set(tilt.x, tilt.y, 0, "XYZ");
  let shaking = false;
  // a hand lifts one edge: the low edge stays on the desk (rotating about the centre would sink half the board into it)
  book.position.set(0, 0, 0);
  book.updateMatrix();
  let low = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) low = Math.min(low, v3.set((sx * BOARD.w) / 2, (sy * BOARD.h) / 2, -BOARD.t).applyMatrix4(book.matrix).z + BOARD.t);
  book.position.set(0, 0, -low);
  if (shakeT >= 0) {
    shakeT += dt;
    const T = 0.75;
    if (shakeT < T) {
      shaking = true;
      // a hand shaking the folder: ~5 Hz, decaying, with a little hop that unloads the film
      const env = Math.sin((Math.PI * shakeT) / T) ** 0.6;
      const s = shakeAmp * env * Math.sin(2 * Math.PI * 5.2 * shakeT);
      book.position.set(Math.cos(shakeDir) * s, Math.sin(shakeDir) * s, book.position.z + Math.abs(shakeAmp * 0.35 * env * Math.sin(2 * Math.PI * 5.2 * shakeT)));
    } else shakeT = -1;
  }
  const settled = Math.abs(tilt.x - tilt.tx) < 1e-4 && Math.abs(tilt.y - tilt.ty) < 1e-4 && Math.abs(tilt.vx) < 1e-4 && Math.abs(tilt.vy) < 1e-4;
  hostBusy = shaking || !settled;
  book.updateMatrixWorld(true);
}

/* ── render-on-demand loop, as in the engine ── */
let raf = 0;
let lastMs = 0;
let needsFrame = true;
let simT = 0;
const stats = { frames: 0, updates: 0, lastActive: false, updateMs: 0, updateMaxMs: 0, drawCalls: 0 };
function invalidate() {
  needsFrame = true;
  schedule();
}
function schedule() {
  if (raf || manual) return;
  raf = requestAnimationFrame(tick);
}
function step(now: number, dt: number): boolean {
  hostStep(dt);
  const t0 = performance.now();
  const a = addon.update(dt, now, anchor.matrixWorld);
  const ms = performance.now() - t0;
  stats.updateMs += ms;
  stats.updateMaxMs = Math.max(stats.updateMaxMs, ms);
  stats.updates++;
  stats.lastActive = a;
  return a || hostBusy;
}
function render() {
  renderer.render(scene, camera);
  stats.frames++;
  stats.drawCalls = renderer.info.render.calls;
}
function tick(ms: number) {
  raf = 0;
  const now = ms / 1000;
  const dt = lastMs ? Math.min(0.05, now - lastMs) : 1 / 60;
  lastMs = now;
  const active = step(now, dt);
  if (active || needsFrame) {
    needsFrame = false;
    render();
  }
  if (active) schedule();
  else lastMs = 0;
}

/* ── pointer routing: addon first, otherwise the desk tilts the board ── */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function rayAt(e: PointerEvent): THREE.Ray {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}
let claimed: number | null = null;
let deskDrag: { id: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (claimed !== null || deskDrag) return;
  if (addon.pointer.down(rayAt(e), e)) {
    claimed = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    tip.style.display = "none";
  } else {
    deskDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  }
  invalidate();
});
canvas.addEventListener("pointermove", (e) => {
  if (claimed === e.pointerId) {
    addon.pointer.move(rayAt(e), e);
    invalidate();
  } else if (deskDrag && deskDrag.id === e.pointerId) {
    const k = 0.25 * D2R;
    tilt.tx = THREE.MathUtils.clamp((e.clientY - deskDrag.y) * k, -25 * D2R, 25 * D2R);
    tilt.ty = THREE.MathUtils.clamp((e.clientX - deskDrag.x) * k, -25 * D2R, 25 * D2R);
    invalidate();
  } else if (claimed === null && e.pointerType === "mouse") {
    const over = addon.pointer.hover?.(rayAt(e)) ?? false;
    canvas.style.cursor = over ? "grab" : "";
    tip.style.left = `${e.clientX}px`;
    tip.style.top = `${e.clientY}px`;
  }
});
const end = (e: PointerEvent) => {
  if (claimed === e.pointerId) {
    addon.pointer.up(rayAt(e), e);
    claimed = null;
    canvas.style.cursor = "";
    invalidate();
  } else if (deskDrag && deskDrag.id === e.pointerId) {
    deskDrag = null;
    tilt.tx = 0;
    tilt.ty = 0;
    invalidate();
  }
};
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", end);

/* ── keys and buttons ── */
const held = new Set<string>();
function keyTilt() {
  const T = 25 * D2R;
  tilt.tx = (held.has("ArrowDown") ? T : 0) - (held.has("ArrowUp") ? T : 0);
  tilt.ty = (held.has("ArrowRight") ? T : 0) - (held.has("ArrowLeft") ? T : 0);
  invalidate();
}
let open = 1;
const actions: Record<string, () => void> = {
  s: () => shakeBook(1),
  b: () => addon.shake(1),
  r: () => addon.resetLayout(),
  o: () => toggleOpen(),
};
window.addEventListener("keydown", (e) => {
  if (e.key.startsWith("Arrow")) {
    held.add(e.key);
    keyTilt();
    e.preventDefault();
  } else actions[e.key.toLowerCase()]?.();
});
window.addEventListener("keyup", (e) => {
  if (held.delete(e.key)) keyTilt();
});
window.addEventListener("resize", () => {
  placeCamera();
  invalidate();
});

function shakeBook(strength = 1) {
  shakeT = 0;
  shakeAmp = 0.11 * strength; // 11 mm at 5.2 Hz: about 1.2 g peak
  shakeDir = 0.35;
  invalidate();
}
/** The stand-in has no cover: "closing" just drives setOpen through a 0.5 s ramp, as the engine's cover tween would. */
function toggleOpen() {
  const from = open, to = open > 0.5 ? 0 : 1;
  const t0 = performance.now();
  const run = () => {
    const k = Math.min(1, (performance.now() - t0) / 500);
    open = from + (to - from) * k;
    addon.setOpen(open);
    invalidate();
    if (k < 1) requestAnimationFrame(run);
  };
  run();
}

let toast: ReturnType<typeof setTimeout> | undefined;
const logEl = document.createElement("span");
function note(s: string) {
  logEl.textContent = s;
  clearTimeout(toast);
  toast = setTimeout(() => (logEl.textContent = ""), 1800);
}
if (showUi) {
  const ui = document.createElement("div");
  ui.className = "ui";
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", fn);
    ui.appendChild(b);
  };
  btn("Shake", () => addon.shake(1));
  btn("Shake board", () => shakeBook(1));
  btn("Motion", () => addon.enableMotion().then((s) => note(`motion: ${s}`)));
  logEl.className = "log";
  ui.appendChild(logEl);
  document.body.appendChild(ui);
}

/* ── debug API ── */
const host = {
  ready: false,
  addon,
  log,
  stats,
  /** Advance the host by n frames of dt seconds (manual mode), render the last one. Returns whether the addon still wants frames. */
  advance(dt = 1 / 60, n = 1) {
    let a = false;
    for (let i = 0; i < n; i++) {
      simT += dt;
      a = step(simT, dt);
    }
    render();
    return a;
  },
  /** Target tilt of the board in degrees (x: the top edge rises for positive values; y: the right edge drops). The board follows with a spring. */
  setTilt(xDeg: number, yDeg = 0) {
    tilt.tx = xDeg * D2R;
    tilt.ty = yDeg * D2R;
    invalidate();
  },
  tilt: () => ({ x: tilt.x / D2R, y: tilt.y / D2R }),
  shakeBook,
  shake: (s = 1) => addon.shake(s),
  setOpen: (c: number) => {
    open = c;
    addon.setOpen(c);
    invalidate();
  },
  resetLayout: () => addon.resetLayout(),
  states: () => {
    const ghosts = new Set(addon.debug.sim.ghosts());
    return addon.debug.sim.state().map((s) => ({ ...s, ghost: ghosts.has(s.id) }));
  },
  specs: () => addon.debug.objects.map((o) => ({ ...o.body })),
  simStats: () => addon.debug.sim.stats(),
  /** The object the addon would pick under a CSS pixel (top layer first), or null. */
  hitAt(x: number, y: number) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return addon.debug.hit(raycaster.ray)?.id ?? null;
  },
  held: () => addon.debug.held(),
  baseline,
  disableMotion,
  idle: () => addon.debug.sim.idle(),
  frame: () => ({ ...addon.debug.frame() }),
  /** CSS pixel position of a pouch-plane point (metres, z = height above the back film). */
  screenOfLocal(x: number, y: number, z = 0.003) {
    addon.object.updateWorldMatrix(true, false);
    v3.set(x, y, z).applyMatrix4(addon.object.matrixWorld).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v3.x + 1) / 2) * r.width, y: r.top + ((1 - v3.y) / 2) * r.height };
  },
  screenOf(id: string, dx = 0, dy = 0) {
    const s = addon.debug.sim.state().find((b) => b.id === id)!;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    return host.screenOfLocal(s.x + dx * c - dy * sn, s.y + dx * sn + dy * c);
  },
  info: () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  /** Device motion without a phone: enable (no permission prompt in desktop Chrome) and feed synthetic samples. */
  enableMotion: () => addon.enableMotion(),
  feedMotion(x: number, y: number, z: number, interval = 16) {
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", { accelerationIncludingGravity: { x, y, z }, interval }));
  },
  dispose() {
    render();
    const before = host.info();
    addon.dispose();
    render();
    return { before, after: host.info(), children: anchor.children.length };
  },
  G,
  /** PouchAddon.snapshot, for the detail view check: resolves to a data URL (or null). */
  snapshot: (id: string, px: number, side?: "front" | "back") => addon.snapshot(id, px, side ? { side } : undefined),
  /** The same with the lift shadow baked in: { url, pad }. */
  snapshotShadow: (id: string, px: number, side?: "front" | "back") => addon.snapshot(id, px, { shadow: true, ...(side ? { side } : {}) }),
  /** The other sample's language, in place (PouchAddon.setProfile; <html lang> first, as the app does). Resolves when it is on view. */
  setLang(lang: "en" | "zh") {
    const p = lang === "zh" ? sampleZh : sampleEn;
    document.documentElement.lang = p.lang ?? "en";
    return addon.setProfile(p);
  },
};
(window as unknown as { __host: typeof host }).__host = host;

// first frames, once the film and the objects are built (one per task after the constructor): let the layout settle (the sim deals and
// relaxes synchronously; this only eases the rig)
void addon.debug.built.then(() => {
  if (manual) host.advance(1 / 60, 30);
  else invalidate();
  host.ready = true;
});

/** The folio's cool paper liner with a faint fibre texture. */
function linerTexture(): THREE.CanvasTexture {
  const w = 1024, h = Math.round((1024 * INNER.h) / INNER.w);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8edf0";
  g.fillRect(0, 0, w, h);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * w, y = rnd() * h, l = 2 + rnd() * 7, a = rnd() * Math.PI;
    g.strokeStyle = rnd() < 0.5 ? "rgba(84,96,108,0.06)" : "rgba(255,255,255,0.18)";
    g.lineWidth = 0.6 + rnd() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
