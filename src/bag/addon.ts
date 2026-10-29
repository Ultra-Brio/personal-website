/*
 * The clear pouch as a book scene addon (anchor "back-inside": it lies on the inside of the folio's back board).
 *
 *   const pouch = createPouchAddon({ profile, dark, onPick, onHover });
 *   createBook(host, { ..., addons: [pouch] });     // the host parents pouch.object to the anchor and drives the contract below
 *   pouch.shake(); pouch.enableMotion();             // the app's Shake button; DeviceMotion from a tap handler
 *   await pouch.snapshot("ticket", 1040);            // that object alone, as a transparent PNG (the lightbox)
 *   await pouch.snapshot("ticket", 1040, { side: "back" });  // its printed back (ticket, polaroid, note)
 *   await pouch.snapshot("ticket", 1040, { shadow: true });  // { url, pad }: with its lift shadow baked in, on a transparent margin
 *
 * Units: the sim and the objects work in pouch-plane metres (x right, y up toward the zip, z toward the viewer); the anchor
 * frame is in scene units (1 mm = 0.01), so `object` is scaled by 10 (or less, see `fit`).
 * Every rendered frame the anchor's world matrix goes into a short history; frameFromMatrices turns it into the apparent
 * acceleration of the pouch (world gravity is -z: the desk is the xy plane), the sim steps with the real dt and the
 * objects copy its state. update() returns false once everything rests, so the host can stop rendering.
 * The first deal is composed (compose.ts), not random; the print is set through src/fonts in the profile's language and painted
 * again once the exact glyphs it uses have arrived.
 * Nothing costly happens in the constructor (it runs inside the host's own build): the sim is made from the bodies' specs, and the
 * film and the objects are built afterwards, one per task, each compiled in parallel and uploaded before it is drawn (the pouch lies
 * under the closed cover meanwhile). Their paper stocks are painted flat at first and made in idle moments (shared.ts makeStocks),
 * then each object is painted again, one per task: no long task at load (it was about a second, all in the host's first one).
 */
import * as THREE from "three";
import type { ItemKind, Profile } from "../profile/schema";
import { G, LAYERS, POUCH_H, POUCH_W } from "./constants";
import { enableMotion as enableDeviceMotion, motionReading, subscribeMotion, type MotionStatus } from "./motion";
import { composeDeal, easiestDeal, GUIDE, guidePushes, rescueLayers, type LayerNo } from "./compose";
import { bodySpec, buildObject, createPouch, POUCH_BOUNDS, type BuiltObject, type FontStacks, type ObjectCtx, type Pouch } from "./objects";
import { ensureFonts } from "../fonts";
import { printFontsPending } from "./objects/fonts";
import { deferStocks, makeStocks, printWebOn, releaseStocks, remakeStocks, usePrintWeb, type StockJob, type StockRecipe } from "./objects/shared";
import { prewarmStills, renderSnapshot, type SnapshotImage, type SnapshotOptions } from "./snapshot";
import { createBagSim, frameFromMatrices, type BagSim, type Frame, type FrameOptions, type Placement } from "./sim";

/**
 * The scene-addon contract of docs/DESIGN.md ("Scene addon"), restated here so src/bag does not import src/book.
 * It mirrors src/book/addon.ts; scripts/harness/pouch.tsx assigns a pouch addon to the engine's type, so tsc catches drift.
 */
export type AddonContext = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ask the host for a frame (an image arrived, a sensor sample came in). */
  invalidate(): void;
  /** @deprecated light only */
  dark?: boolean;
};

export interface SceneAddon {
  /** Where the addon's object is parented. Frame: origin at the board's centre, x along the board width (to the right when open), y along its height (up), z = the board's inside normal; scene units (1 mm = 0.01). */
  anchor: "back-inside" | "front-inside";
  object: THREE.Object3D;
  /** Called once when the host adopts the addon, before the first update. */
  attach?(ctx: AddonContext): void;
  /** Called every rendered frame while the book is alive. anchorWorld = the anchor frame's world matrix this frame. Return true to keep frames coming (physics not idle). */
  update(dt: number, t: number, anchorWorld: THREE.Matrix4): boolean;
  /** Pointer routing: down() returns true to claim the gesture (then move/up go to the addon and the page/cover drag is skipped). */
  pointer?: { down(ray: THREE.Ray, e: PointerEvent): boolean; move(ray: THREE.Ray, e: PointerEvent): void; up(ray: THREE.Ray, e: PointerEvent): void; hover?(ray: THREE.Ray): boolean };
  /** Cover openness 0 (closed) … 1 (open), called when it changes. */
  setOpen?(c: number): void;
  setDark?(dark: boolean): void;
  /** Resolves once the print is painted in its own faces; the book's opening on arrival waits for it (see src/book/addon.ts). */
  printed?(): Promise<void>;
  /** The WebGL context was lost and has come back (see src/book/addon.ts). */
  restore?(): void;
  dispose(): void;
}

export type PouchAddonOptions = {
  profile: Profile;
  /** @deprecated light only; ignored */
  dark?: boolean;
  /** A click (press shorter than 250 ms that moved less than 6 px) on an object. */
  onPick(id: string): void;
  /** The object under the pointer changed (null: none), for a tooltip. */
  onHover?(id: string | null): void;
  /** `pouch`: text on the pouch's label tab (default: the profile's name). */
  labels?: { pouch?: string };
  /** Scene units per metre. Default 10 (1 mm = 0.01). */
  scale?: number;
  /**
   * Inner area of the board in scene units. When the sealed pouch (246 x 340 mm with its seal and zip band) is bigger,
   * the whole addon is scaled down to fit inside it; without `fit` the pouch is life size and centred on the anchor.
   */
  fit?: { width: number; height: number };
  /**
   * @deprecated The print is set through src/fonts (Shippori Mincho, Zen Kaku Gothic New, Klee One; the SC faces for Chinese text) in
   * the profile's language; stacks given here are ignored. The addon loads exactly the glyphs it prints, paints at once with what is
   * loaded and paints again when the rest arrives.
   */
  font?: Partial<FontStacks>;
  /** Texture anisotropy (three clamps it to the device's maximum). Default 8. */
  anisotropy?: number;
  /**
   * The print's resolution over its base for the objects shown as stills (ObjectCtx.printScale, 1 … 1.6). Default: the page's scale on
   * a large screen when the pouch is made, k = min(window width / 1440, height / 900) within 1 … 1.6 (brief r4 E3/E7), so the detail
   * view's larger stills there are as sharp as at 1440 × 900.
   */
  printScale?: number;
  /** Layout seed: equal seeds deal the objects identically. */
  seed?: number;
  /**
   * An object struck something (a wall of the pouch, or another object on its layer): `speed` is the normal relative speed of the
   * hit (m/s, from 0.1 up; the sound kit gates and debounces further), `kind` the striking object's kind (of two objects, the one
   * that brought more momentum), `pan` -1 … 1 from where along the pouch's width it happened. Called from inside update().
   */
  onImpact?: (speed: number, kind: ItemKind, pan: number) => void;
  /**
   * Handling sounds: "pickUp" when the pointer lifts an object, "drop" when it lets go (gain follows the release speed; a click is a
   * soft set-down), "shake" for each shake(). `pan` -1 … 1 from the object's place across the pouch.
   */
  onSound?: (name: "pickUp" | "drop" | "shake", o?: { gain?: number; pan?: number }) => void;
};

export interface PouchAddon extends SceneAddon {
  pointer: NonNullable<SceneAddon["pointer"]>;
  setOpen(c: number): void;
  setDark(dark: boolean): void;
  /** The app's Shake button (strength 1: two kicks of about 0.9 and 0.7 m/s, each object its own way), forwarded to sim.shake. */
  shake(strength?: number): void;
  /** Device motion (call from a tap handler): the phone's real gravity and shake drive the pouch from then on. */
  enableMotion(): Promise<MotionStatus>;
  /**
   * The host's wake-up hook (the book calls it with its AddonContext; a minimal host may pass just `{ invalidate }`):
   * device motion samples arrive between frames, and `invalidate` is how the addon asks for the next one. Without it the
   * addon keeps returning true from update() while device motion is on.
   */
  attach(ctx: Pick<AddonContext, "invalidate"> & { dark?: boolean }): void;
  /** Deal the objects again (deterministic per seed and call count): the same composition, varied, mirrored every other time. */
  resetLayout(): void;
  /**
   * The same things in another language (brief r4 E1): every object's print and the film's mark are set in `profile`'s words, in
   * place — in their own canvases: the objects keep where they lie, nothing is built or allocated again, the sim, the cover and the
   * pointer are untouched. Their paper is made again in idle moments and the new strings' fonts are loaded first (no print ever shows
   * a fallback glyph); then the prints are painted and uploaded one per task, back to back (2–15 ms each): the pouch turns over a
   * handful of frames. Takes about half a second (the first switch to a language a little more: its faces download). The stills
   * (snapshot) follow: none is kept from the old language, and one asked for during the swap is of the new one. `labels.pouch`: the
   * film's mark (default: the profile's name). Resolves true once the new language is on view (or a later call overtook this one),
   * false when it cannot be done in place: the profile's items differ from the pouch's (ids and kinds in order, the polaroid's
   * picture) — the host then builds a new pouch.
   */
  setProfile(profile: Profile, labels?: { pouch?: string }): Promise<boolean>;
  /**
   * The WebGL context came back after a loss (the book calls it before its next frame): the stills whose render the loss overlapped
   * are dropped (they read back zeros), so the next ask renders them again. Textures and programs re-upload by themselves.
   */
  restore(): void;
  /**
   * One object alone, for the lightbox: a copy of the very model in the pouch (its meshes share the print, the materials and the
   * decoded picture: nothing is painted again) lying flat at angle 0, seen square on under the host's own environment, key and window
   * light (copies that cast nothing: no bars or leaves on a thing held up to look at), on a transparent background; the host renderer
   * draws it into an offscreen target (the visible canvas is not touched), tone-mapped and encoded like the page. Resolves to a PNG
   * data URL `px` pixels wide — the width of the object as it lies (the ticket is landscape, the résumé, the polaroid and the note
   * portrait); the height follows the object's aspect and the image is cropped to the object exactly. No contact shadow (the page
   * adds its own). Waits for the object's picture (the polaroid) and its fonts, so the still is the object in the pouch.
   * `side: "back"` turns the object over (about its vertical axis, like turning a card in the hand) and shows its printed back: the
   * ticket's terms, the polaroid's handwritten note, the note's plain back, the business card's outer back.
   * `shadow: true` resolves to { url, pad } instead: the same object, still `px` wide, on a transparent margin of `pad` × the image's
   * width on every side, with its lift shadow baked in (a soft cast and the contact line, from the object's own silhouette: the
   * desk shows through its punched holes). Show the image `1 / (1 − 2 pad)` times the object's width, pulled out by that margin, and
   * the object keeps its size and place; no CSS shadow on it.
   * Null without a renderer (attach() was not given one), for an unknown id, after dispose(), or while the WebGL context is lost (not
   * cached). Cached per id, size, side and shadow. It never holds the page up: the shaders compile in parallel, the GPU's readback is
   * asynchronous and the PNG is encoded off the page's frames (no long task, even for the largest still).
   */
  snapshot(id: string, px: number, opts?: SnapshotOptions & { shadow?: false }): Promise<string | null>;
  snapshot(id: string, px: number, opts: SnapshotOptions & { shadow: true }): Promise<SnapshotImage | null>;
  /** For harnesses and tests. */
  readonly debug: {
    sim: BagSim;
    /** Every object, in spec order, once `built` has settled (empty before). */
    objects: readonly BuiltObject[];
    /** Settles when the film and every object are built, compiled and in the pouch (their stocks may still be on their way). */
    built: Promise<void>;
    /** Id of the held object, or null. */
    held(): string | null;
    /** Hit test in pouch metres: the object under a world-space ray (top layer first), or null. */
    hit(ray: THREE.Ray, margin?: number): { id: string; x: number; y: number } | null;
    /** Last frame fed to the sim. */
    frame(): Frame;
    /** Scene units per metre actually used (after `fit`). */
    scale: number;
  };
}

/**
 * How the pouch feels. Film friction: things stay put up to about 20 degrees of tilt and break away a little earlier
 * or later each (spread), and once they slide they slide on (kinetic < static), like plastic on PVC film.
 */
export const POUCH_FEEL = {
  friction: { static: 0.31, kinetic: 0.24, spread: 0.08 },
  /** Click: a press that moves less than this (px) and is shorter than this (ms). */
  clickPx: 6,
  clickMs: 250,
  /** Release velocity: pointer travel over the last `flingMs`. */
  flingMs: 80,
  /** Pick margin around an object's outline (m): forgiving for fingers, tight for the mouse. */
  marginTouch: 0.006,
  marginMouse: 0.0015,
  /** Frames to keep asking for after the sim comes to rest (s): the eased lift / tilt / flex of the objects finish. */
  grace: 0.6,
  /** Cover openness below which the folio counts as closed (the front board lies on the pouch: nothing moves). */
  closed: 0.02,
  /** Pointer grabs are taken only once the cover is (nearly) open. */
  grabOpen: 0.97,
} as const;

/** Metres per scene unit of the anchor frame (1 mm = 0.01 units). */
const UNIT = 0.1;
/** The back film floats this far above the board (scene units, 0.2 mm) so it never z-fights the board's liner. */
const LIFT = 0.002;
/** Height of the drag plane (m): where a lifted object rides. */
const DRAG_Z = LAYERS[2].z + 0.0045;
/** Top face of an object above its layer's rear-face height (m), for picking. */
const PICK_TOP = 0.0008;
const HISTORY = 6;

/** Settle after the cover opens: the folder is "set down" (a short unloaded hop, a small twist, a landing). */
const SETTLE = { dur: 0.32, hop: 0.07, unload: 0.75, twist: 34, push: 1.6, land: 0.6 } as const;
/**
 * The Shake button: the hand lifts the folder (the film lets go: normal load down by `unload` over `dur`) and jerks it twice,
 * `second` s apart, the second kick `secondK` as strong. Each kick throws every object its own way (within `spread` rad of a
 * shared direction), at `gain` x the sim's strength-1 speed: things tumble, scatter and stay in the pouch's middle
 * instead of all slamming into one wall, and a pile resting against a wall comes loose too.
 */
const SHAKE = { dur: 0.36, unload: 0.6, second: 0.13, secondK: 0.75, gain: 0.55, spread: 4.5 } as const;

/** The pouch's print faces are requested this long after it is made at the latest (a host that never reports the cover). */
const FONTS_LATEST = 2500;

export function createPouchAddon(opts: PouchAddonOptions): PouchAddon {
  const { profile } = opts;
  /** The film's mark (setProfile changes it with the language). */
  let filmLabel = opts.labels?.pouch;
  /** The host's wake-up hook (attach). */
  let host: { invalidate(): void } | null = null;
  /** The host's renderer, scene and camera when attach() got them (for snapshot, and to compile and upload the objects ahead). */
  let studio: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera | null } | null = null;
  /** What the objects print besides their own item: the owner and the language. */
  const printScale = opts.printScale ?? (typeof window === "undefined" ? 1 : Math.min(1.6, Math.max(1, Math.min(window.innerWidth / 1440, window.innerHeight / 900))));
  const ctxFor = (p: Profile): ObjectCtx => ({
    anisotropy: opts.anisotropy ?? 8,
    printScale,
    ...(p.lang ? { lang: p.lang } : {}),
    owner: {
      name: p.name,
      ...(p.nameLocal ? { nameLocal: p.nameLocal } : {}),
      role: p.role,
      ...(p.location ? { location: p.location } : {}),
      ...(p.handle ? { handle: p.handle } : {}),
      links: p.links,
    },
    // a polaroid photo arriving after the loop went idle needs one more frame
    onChange: () => host?.invalidate(),
  });
  const ctx = ctxFor(profile);

  // ── scene graph: root is in pouch metres, scaled into scene units and centred on the anchor (the sealed outline, not just the usable area)
  const OW = POUCH_BOUNDS.maxX - POUCH_BOUNDS.minX;
  const OH = POUCH_BOUNDS.maxY - POUCH_BOUNDS.minY;
  const OCX = (POUCH_BOUNDS.maxX + POUCH_BOUNDS.minX) / 2;
  const OCY = (POUCH_BOUNDS.maxY + POUCH_BOUNDS.minY) / 2;
  let scale = opts.scale ?? 10;
  if (opts.fit) scale = Math.min(scale, opts.fit.width / OW, opts.fit.height / OH);
  const root = new THREE.Group();
  root.name = "bag-pouch-addon";
  root.scale.setScalar(scale);
  root.position.set(-OCX * scale, -OCY * scale, LIFT);

  /** The print was set in the web faces from the start (a pouch made again later in the visit): no repaint when they are all in. */
  const webAtBuild = printWebOn();
  const items = profile.items;
  /** The film and the objects (spec order), once built (see `built`). */
  let pouch: Pouch | null = null;
  const slots: (BuiltObject | null)[] = items.map(() => null);
  /** Every object, in spec order, once all are built (debug). */
  const objects: BuiltObject[] = [];
  /** The stocks their first paints asked for (painted flat until makeStocks has made them). */
  const stockJobs: StockJob[] = [];
  /** How to make each object's stocks again (setProfile paints them again long after the kept ones are gone). */
  const recipes: StockRecipe[][] = items.map(() => []);
  // ── sounds: contacts from the sim, handling from the pointer; a throwing host callback must not break the sim's step
  const kindById = new Map<string, ItemKind>(profile.items.map((it) => [it.id, it.kind]));
  const panAt = (x: number) => Math.max(-1, Math.min(1, x / (POUCH_W / 2)));
  const safe = (f: () => void) => {
    try {
      f();
    } catch (e) {
      console.error("[sasshi] pouch sound callback failed", e);
    }
  };
  const sound = (name: "pickUp" | "drop" | "shake", o?: { gain?: number; pan?: number }) => {
    if (opts.onSound) safe(() => opts.onSound!(name, o));
  };
  const onImpact = opts.onImpact;
  const onContact = onImpact
    ? (a: string, _b: string, speed: number, x: number) => {
        const kind = kindById.get(a);
        if (kind) safe(() => onImpact(speed, kind, panAt(x)));
      }
    : undefined;
  const seed = opts.seed ?? 7;
  const bodies = items.map(bodySpec);
  const deal = composeDeal(
    items.map((it) => it.kind),
    bodies,
    seed,
  );
  const sim = createBagSim({ width: POUCH_W, height: POUCH_H, bodies, seed, friction: POUCH_FEEL.friction, deal, ...(onContact && { onContact }) });
  const states = sim.state(); // live array, spec order = objects order

  // ── frame from the anchor's history
  const ring: Float64Array[] = [];
  const grav: [number, number, number] = [0, 0, -G];
  const frameOpts: FrameOptions = { unit: UNIT, gravity: grav };
  let frame: Frame = { ax: 0, ay: 0, gn: G, omega: 0, alpha: 0 };
  let lastT = Number.NaN;
  let graceUntil = -Infinity;
  /** The objects have been posed once; the film's clock (s), which runs only while something in the pouch moves. */
  let posed = false;
  let filmT = 0;
  let open = 1;
  let openSeen = false;
  let settleStart = Number.NaN; // NaN: none; -Infinity: pending (starts at the next update)
  let settleDir = 0;
  let settleCount = 0;
  let shakeStart = Number.NaN; // as settleStart
  let shakeS = 0;
  let shakeSecond = false;
  /*
   * After a shake (compose.ts GUIDE): the settle is steered to the easiest of the next composed deals, then, at rest, the layers are
   * dealt again if something still lies mostly buried (rescueLayers; also after the phone's tilt moved things). homes: the layer each
   * body is on now (the spec's until a rescue moves it; a shake puts every body back on its own).
   */
  let guideAt = Number.NaN; // when the pull starts (NaN: none; -Infinity: pending, set at the next update)
  let guideTarget: readonly (Placement | null)[] | null = null;
  let guideDeal = 1;
  let relayer = false;
  const specLayers = bodies.map((b) => b.layer as LayerNo);
  const homes = specLayers.slice();
  let disposed = false;
  /** Stills by id, size, side and shadow; `done` once the render has finished (kept) or failed (dropped). */
  type Shot = { p: Promise<SnapshotImage | null>; done: boolean };
  const shots = new Map<string, Shot>();
  /** Context losses seen (webglcontextlost, restore()): a still whose render one overlapped is thrown away. */
  let losses = 0;
  const contextLost = () => studio?.renderer.getContext().isContextLost() ?? false;
  const onLost = () => {
    losses++;
  };

  // ── the build, after the constructor: one thing per task (a few tens of ms at most each), then the stocks in idle moments
  const nextTask = () => new Promise<void>((go) => setTimeout(go, 0));
  /** The textures under `o` (its materials' maps and shader uniforms). */
  function texturesOf(o: THREE.Object3D): Set<THREE.Texture> {
    const seen = new Set<THREE.Texture>();
    o.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const vals: unknown[] = Object.values(m);
        const u = (m as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) vals.push(u[k]?.value);
        for (const v of vals) if (v && (v as THREE.Texture).isTexture && !(v as THREE.Texture).isRenderTargetTexture) seen.add(v as THREE.Texture);
      }
    });
    return seen;
  }
  /** Every texture under `o` that changed since it was last on the GPU goes up now (in this task, not in the next frame's render). */
  function upload(o: THREE.Object3D) {
    const r = studio?.renderer;
    if (!r || contextLost()) return;
    for (const t of texturesOf(o)) if (t.version > 0 && t.image) r.initTexture(t);
  }
  /** The same, one texture per task (a big print takes a while to go up). */
  async function uploadSlowly(o: THREE.Object3D) {
    for (const t of texturesOf(o)) {
      await nextTask();
      const r = studio?.renderer;
      if (disposed || !r || contextLost()) return;
      if (t.version > 0 && t.image) r.initTexture(t);
    }
  }
  /** Its programs, compiled in parallel for the host's scene and camera (KHR_parallel_shader_compile): its first frame does not wait on them. */
  function compiled(o: THREE.Object3D): Promise<void> {
    const s = studio;
    if (!s?.camera || contextLost()) return Promise.resolve();
    return s.renderer.compileAsync(o, s.camera, s.scene).then(
      () => {},
      () => {},
    );
  }
  /** A built object into the pouch where the sim has it (its programs compiled, its textures on the GPU). */
  function place(i: number, o: BuiltObject) {
    slots[i] = o;
    root.add(o.object);
    o.update(states[i]!, Number.isFinite(lastT) ? lastT : 0);
    host?.invalidate();
  }
  const built: Promise<void> = (async () => {
    // out of the host's task (its scene build and first frame)
    await nextTask();
    if (disposed) return;
    const film = createPouch({ ...ctx, label: filmLabel ?? profile.name });
    const placed: Promise<void>[] = [
      Promise.all([compiled(film.group), uploadSlowly(film.group)]).then(() => {
        if (disposed) return film.dispose();
        pouch = film;
        root.add(film.group);
        film.update(filmT);
        host?.invalidate();
      }),
    ];
    for (let i = 0; i < items.length; i++) {
      await nextTask();
      if (disposed) return;
      try {
        const { value: o, jobs, recipes: r } = deferStocks(() => buildObject(items[i]!, ctx));
        stockJobs.push(...jobs);
        recipes[i] = r;
        placed.push(
          Promise.all([compiled(o.object), uploadSlowly(o.object)]).then(() => {
            if (disposed) o.dispose();
            else place(i, o);
          }),
        );
      } catch (e) {
        console.error(`[sasshi] pouch object ${items[i]!.id} failed to build`, e);
      }
    }
    await Promise.all(placed);
    for (const o of slots) if (o) objects.push(o);
  })();
  /** Every object painted again, one per task (with its real stocks now, or the web faces), its textures uploaded there and then. */
  async function repaintAll(film: boolean) {
    if (film && pouch) {
      pouch.repaint();
      upload(pouch.group);
      host?.invalidate();
    }
    for (const o of slots) {
      if (!o) continue;
      await nextTask();
      if (disposed) return;
      o.repaint();
      upload(o.object);
      host?.invalidate();
    }
  }
  /** Repaint passes run one after the other: never two at once, and the kept stocks are released only after the last. */
  let passes: Promise<void> = Promise.resolve();
  const serial = (f: () => Promise<void>) => (passes = passes.then(f, f));
  // the stocks, then the objects again with them (in the faces the print uses so far: the web faces' pass comes after this one)
  const stocked: Promise<void> = built
    .then(() => makeStocks(stockJobs, () => !disposed))
    .then(() =>
      serial(async () => {
        if (!disposed && stockJobs.length) await repaintAll(false);
      }),
    );

  // the stills' programs (the detail view's), compiled in parallel in an idle moment once everything is built: its first open only renders
  void stocked.then(() => {
    const go = () => {
      if (!disposed && studio && !contextLost()) void prewarmStills(studio, objects);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 500);
  });

  // the print's web fonts: painted already with what is loaded; if a face was still coming, paint once more when it is here. They are
  // fetched once the book is about to open (printed: its opening on arrival waits for this repaint, at most a while) or the cover
  // starts to open — nothing in the pouch is seen before: the folio's first paint does not wait on the handwriting, 一筆箋 or the
  // Org's 600 (spec §1.3, ≤ 250 KB of woff2 before it) — when a still is asked for, or FONTS_LATEST ms after the pouch is made,
  // whichever comes first.
  const printRuns = () => [...(pouch?.fonts ?? []), ...objects.flatMap((o) => o.fonts)];
  let kickFonts = () => {};
  const fontsGo = new Promise<void>((go) => {
    const timer = setTimeout(go, FONTS_LATEST);
    kickFonts = () => {
      kickFonts = () => {};
      clearTimeout(timer);
      go();
    };
  });
  const fontsSettled: Promise<void> = fontsGo.then(async () => {
    // painted so far with the faces already in (shared.ts printWeb): now the web faces are fetched (ensureFonts), and once they are here
    // the print switches to them and every object is painted again — never before, so no paint shows their fallback glyphs meanwhile
    await built;
    if (disposed) return;
    const pending = printFontsPending(printRuns());
    // (the stocks first: the paper of the stock pass is what this pass copies)
    await stocked;
    if (disposed) return;
    if (webAtBuild && !pending) return releaseStocks();
    await pending;
    if (disposed) return;
    usePrintWeb();
    // This lands before the cover opens (or, faces later than the book waits, while it is open): one thing per task (each a few ms,
    // its paper's noise kept from the first paint — shared.ts paintStock), never one long task that holds a frame.
    await serial(() => repaintAll(true));
    // (no still is ever taken before this: every snapshot waits for fontsSettled)
    releaseStocks();
  });

  /*
   * Another language (setProfile): every object prints the new words in its own canvases (relabel, then repaint: nothing is built,
   * allocated or uploaded anew but the print), so the sim, where everything lies, the geometry and the materials stay. The paper
   * under the print is what costs (its noise, tens of ms per object): the stocks of the first paint are made again first, a few
   * steps per idle moment, from the recipes recorded then; the print then copies them (a few ms per object). The fonts of the new
   * strings are loaded before anything is painted, then the film and the objects are painted and uploaded one per task: the pouch
   * turns to the new language within a few frames. Swaps run one after the other; a later call makes an earlier one stop where it is.
   */
  let swapGen = 0;
  let swaps: Promise<void> = Promise.resolve();
  const sameItems = (p: Profile) =>
    p.items.length === items.length &&
    p.items.every((it, i) => {
      const was = items[i]!;
      // the polaroid's photograph is rendered once: another picture is another object
      return it.id === was.id && it.kind === was.kind && (it.kind !== "polaroid" || was.kind !== "polaroid" || it.image === was.image);
    });
  async function swapTo(next: Profile, label: string | undefined, gen: number): Promise<void> {
    await built;
    // the first late repaint (the web faces) must be done: it paints whatever the objects hold
    kickFonts();
    await fontsSettled;
    const alive = () => !disposed && gen === swapGen;
    if (!alive()) return;
    await makeStocks(remakeStocks(recipes.flat()), alive);
    if (!alive()) return;
    const nctx = ctxFor(next);
    slots.forEach((o, i) => o?.relabel(next.items[i]!, nctx));
    pouch?.relabel({ ...nctx, label: label ?? next.name });
    await ensureFonts([...(pouch?.fonts ?? []), ...slots.flatMap((o) => o?.fonts ?? [])]);
    // one thing per task, back to back (a print and its upload take 2–15 ms; all of them in one task would be a long one): the
    // pouch turns to the new language over a few frames. (Overtaken: the objects hold the new words, some still show the old print;
    // the next swap paints them all.)
    if (pouch) {
      if (!alive()) return;
      pouch.repaint();
      upload(pouch.group);
    }
    for (const o of slots) {
      if (!o) continue;
      await nextTask();
      if (!alive()) return;
      o.repaint();
      upload(o.object);
      host?.invalidate();
    }
    filmLabel = label;
    // the stills of the old language (and any made from it meanwhile) go
    shots.clear();
    releaseStocks();
    host?.invalidate();
  }

  function pushMatrix(m: ArrayLike<number>) {
    const slot = ring.length < HISTORY ? new Float64Array(16) : ring.shift()!;
    for (let i = 0; i < 16; i++) slot[i] = m[i] ?? 0;
    ring.push(slot);
  }

  /** Apparent gravity: the desk's (-z), or the phone's real one rotated with the anchor so it reads the same in pouch axes. */
  function gravityFor(m: ArrayLike<number>) {
    const r = motionReading();
    if (!r) {
      grav[0] = 0;
      grav[1] = 0;
      grav[2] = -G;
      return false;
    }
    const gx = r.gravity.x + r.shake.x, gy = r.gravity.y + r.shake.y, gz = r.gravity.z + r.shake.z;
    for (let k = 0; k < 3; k++) {
      const ex = (m[k] ?? 0) / (Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0) || 1);
      const ey = (m[4 + k] ?? 0) / (Math.hypot(m[4] ?? 0, m[5] ?? 0, m[6] ?? 0) || 1);
      const ez = (m[8 + k] ?? 0) / (Math.hypot(m[8] ?? 0, m[9] ?? 0, m[10] ?? 0) || 1);
      grav[k] = ex * gx + ey * gy + ez * gz;
    }
    return true;
  }

  /** The "set down" pulse after the cover opens, added onto the frame. τ in seconds since it started. */
  function settle(f: Frame, tau: number): boolean {
    if (tau < 0 || tau > SETTLE.dur) return false;
    // hop: the film unloads (friction lets go) while the folder is lifted a hair, a small twist and a push toward the viewer
    const hop = tau < SETTLE.hop ? Math.sin((Math.PI * tau) / SETTLE.hop) : 0;
    const after = tau - SETTLE.hop;
    const land = after > 0 ? Math.exp(-after / 0.04) * Math.sin(after * 2 * Math.PI * 11) : 0;
    f.gn = Math.max(0, f.gn * (1 - SETTLE.unload * hop + SETTLE.land * land));
    const tw = tau < SETTLE.hop ? Math.sin((2 * Math.PI * tau) / SETTLE.hop) : 0;
    f.alpha += SETTLE.twist * settleDir * tw;
    f.ax += SETTLE.push * 0.35 * settleDir * hop;
    f.ay -= SETTLE.push * hop;
    return true;
  }

  // ── pointer
  const inv = new THREE.Matrix4();
  const lray = new THREE.Ray();
  const pt = new THREE.Vector3();
  type Hold = { id: string; pointerId: number; cx: number; cy: number; t0: number; moved: number; ox: number; oy: number; samples: { t: number; x: number; y: number }[] };
  let hold: Hold | null = null;
  let hoverId: string | null = null;

  function localRay(ray: THREE.Ray): THREE.Ray {
    root.updateWorldMatrix(true, false);
    inv.copy(root.matrixWorld).invert();
    return lray.copy(ray).applyMatrix4(inv);
  }
  function onPlane(r: THREE.Ray, z: number): THREE.Vector3 | null {
    const dz = r.direction.z;
    if (Math.abs(dz) < 1e-6) return null;
    const s = (z - r.origin.z) / dz;
    if (s < 0) return null;
    return pt.copy(r.origin).addScaledVector(r.direction, s);
  }
  function layerTop(layer: number) {
    const l = Math.max(0, Math.min(2, layer));
    const z = l <= 1 ? LAYERS[0].z + (LAYERS[1].z - LAYERS[0].z) * l : LAYERS[1].z + (LAYERS[2].z - LAYERS[1].z) * (l - 1);
    return z + PICK_TOP;
  }
  const order = items.map((_, i) => i);
  function hit(ray: THREE.Ray, margin: number = POUCH_FEEL.marginMouse) {
    const r = localRay(ray);
    // top first: the held object, then by drawn layer
    order.sort((a, b) => Number(states[b]!.held) - Number(states[a]!.held) || states[b]!.layer - states[a]!.layer);
    for (const i of order) {
      const s = states[i]!;
      const o = slots[i];
      if (!o) continue;
      const p = onPlane(r, layerTop(s.layer));
      if (!p) continue;
      const c = Math.cos(s.angle), sn = Math.sin(s.angle);
      const dx = p.x - s.x, dy = p.y - s.y;
      if (inOutline(o.outline, dx * c + dy * sn, -dx * sn + dy * c, margin)) return { id: s.id, x: p.x, y: p.y };
    }
    return null;
  }
  function marginFor(e: PointerEvent) {
    return e.pointerType === "touch" ? POUCH_FEEL.marginTouch : e.pointerType === "pen" ? POUCH_FEEL.marginMouse * 2 : POUCH_FEEL.marginMouse;
  }
  function stamp(e: PointerEvent) {
    return e.timeStamp > 0 ? e.timeStamp : performance.now();
  }
  function sample(h: Hold, t: number, x: number, y: number) {
    h.samples.push({ t, x, y });
    while (h.samples.length > 24) h.samples.shift();
  }
  function wake() {
    graceUntil = Number.isFinite(lastT) ? lastT + POUCH_FEEL.grace : Infinity;
    host?.invalidate();
  }
  function letGo(vx: number, vy: number) {
    if (!hold) return;
    hold = null;
    sim.release(vx, vy);
    // where the visitor puts a thing is where it lies (no re-layering after a drop)
    relayer = false;
    wake();
  }
  /** At rest after a shake or a tilt: if something lies mostly buried, deal the layers again (both passes: see BagSim.setLayer). */
  function rescue() {
    const fp = states.map((s, i) => ({ x: s.x, y: s.y, angle: s.angle, w: bodies[i]!.w, h: bodies[i]!.h }));
    const next = rescueLayers(fp, homes, specLayers);
    if (!next) return;
    for (let pass = 0; pass < 2; pass++) next.forEach((l, i) => sim.setLayer(bodies[i]!.id, l));
    next.forEach((l, i) => (homes[i] = l));
    wake();
  }

  const pointer: PouchAddon["pointer"] = {
    down(ray, e) {
      if (disposed || hold || open < POUCH_FEEL.grabOpen) return false;
      if (e.pointerType === "mouse" && e.button !== 0) return false;
      const h = hit(ray, marginFor(e));
      if (!h) return false;
      const r = localRay(ray);
      const p = onPlane(r, DRAG_Z);
      const t = stamp(e);
      // the grabbed point keeps its offset to the pointer on the (higher) drag plane, so the object does not jump by the parallax
      const ox = p ? h.x - p.x : 0, oy = p ? h.y - p.y : 0;
      hold = { id: h.id, pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, t0: t, moved: 0, ox, oy, samples: [] };
      sample(hold, t, h.x, h.y);
      sim.grab(h.id, h.x, h.y);
      sound("pickUp", { pan: panAt(h.x) });
      if (hoverId !== null) {
        hoverId = null;
        opts.onHover?.(null);
      }
      wake();
      return true;
    },
    move(ray, e) {
      if (!hold || e.pointerId !== hold.pointerId) return;
      hold.moved = Math.max(hold.moved, Math.hypot(e.clientX - hold.cx, e.clientY - hold.cy));
      const p = onPlane(localRay(ray), DRAG_Z);
      if (!p) return;
      const x = p.x + hold.ox, y = p.y + hold.oy;
      sim.drag(x, y);
      sample(hold, stamp(e), x, y);
      wake();
    },
    up(ray, e) {
      if (!hold || e.pointerId !== hold.pointerId) return;
      const h = hold;
      const t = stamp(e);
      h.moved = Math.max(h.moved, Math.hypot(e.clientX - h.cx, e.clientY - h.cy));
      const p = e.type === "pointercancel" ? null : onPlane(localRay(ray), DRAG_Z);
      if (p) sample(h, t, p.x + h.ox, p.y + h.oy);
      const click = e.type !== "pointercancel" && h.moved < POUCH_FEEL.clickPx && t - h.t0 < POUCH_FEEL.clickMs;
      const v = click ? { vx: 0, vy: 0 } : releaseVelocity(h.samples, t, POUCH_FEEL.flingMs);
      letGo(v.vx, v.vy);
      // set down softly, thrown harder (the throw's own hits follow as impacts)
      const last = h.samples[h.samples.length - 1];
      sound("drop", { gain: dropGain(Math.hypot(v.vx, v.vy)), pan: panAt(last ? last.x : 0) });
      if (click) opts.onPick(h.id);
    },
    hover(ray) {
      if (disposed || hold || open < POUCH_FEEL.grabOpen) return false;
      const h = hit(ray);
      const id = h?.id ?? null;
      if (id !== hoverId) {
        hoverId = id;
        opts.onHover?.(id);
      }
      return id !== null;
    },
  };

  const unsubscribe = subscribeMotion(() => {
    wake();
  });

  /** Light only (朝の光): the pouch and its objects always look as on the morning desk; kept for hosts that still pass a theme. */
  function setDark(_d: boolean) {
    // nothing to do
  }

  /** A still by id, size, side and shadow (see PouchAddon.snapshot), cached while it stays right. */
  function still(id: string, w: number, side: "front" | "back", shadow: boolean): Promise<SnapshotImage | null> {
    const key = `${id}:${w}:${side}:${shadow ? "s" : ""}`;
    const kept = shots.get(key);
    if (kept) return kept.p;
    kickFonts();
    const era = losses;
    const gen = swapGen;
    const entry: Shot = { p: Promise.resolve(null), done: false };
    // a still that failed, or whose render a context loss overlapped, is not kept: the next ask renders it again. One asked for while
    // a language swap is on its way waits for it; one whose render a later swap overtook is rendered again, in the new language.
    entry.p = Promise.all([fontsSettled, swaps])
      .then(() => {
        const live = slots.find((ob) => ob?.body.id === id);
        return disposed || !studio || !live ? null : renderSnapshot(studio, live, w, { side, shadow });
      })
      .then((s) => {
        entry.done = true;
        if (s && era === losses && gen === swapGen && !contextLost()) return s;
        if (shots.get(key) === entry) shots.delete(key);
        return s && gen !== swapGen && !disposed && studio && !contextLost() ? still(id, w, side, shadow) : null;
      });
    shots.set(key, entry);
    return entry.p;
  }

  const addon: PouchAddon = {
    anchor: "back-inside",
    object: root,
    pointer,
    update(dt, t, anchorWorld) {
      if (disposed) return false;
      if (!Number.isFinite(t)) t = (Number.isFinite(lastT) ? lastT : 0) + (dt > 0 ? dt : 0);
      // The host calls update() on every frame it renders, also while we return false (it renders for its own reasons: a tilt
      // starting, a page turn), so the history stays continuous. A gap (the loop stopped, a stall) leaves old matrices behind
      // that frameFromMatrices would difference as if they were one frame apart: start the history again instead.
      if (!(dt > 0) || !Number.isFinite(lastT) || t - lastT > Math.max(0.1, 3 * dt) || t < lastT) ring.length = 0;
      lastT = t;
      const m = anchorWorld.elements;
      pushMatrix(m);
      const phone = gravityFor(m);
      frame = frameFromMatrices(ring, dt > 0 ? dt : 1 / 60, frameOpts);
      if (settleStart === -Infinity) settleStart = t;
      const settling = Number.isFinite(settleStart) && settle(frame, t - settleStart);
      if (!settling) settleStart = Number.NaN;
      const closed = open <= POUCH_FEEL.closed;
      if (shakeStart === -Infinity) shakeStart = t;
      const shaking = Number.isFinite(shakeStart) && t - shakeStart <= SHAKE.dur;
      if (shaking) {
        const tau = t - shakeStart;
        frame.gn *= 1 - SHAKE.unload * Math.sin((Math.PI * tau) / SHAKE.dur);
        if (!shakeSecond && tau >= SHAKE.second) {
          shakeSecond = true;
          if (!closed) sim.shake(shakeS * SHAKE.gain * SHAKE.secondK, SHAKE.spread);
        }
      } else shakeStart = Number.NaN;
      // the shake's settle, steered to a composed deal
      if (guideAt === -Infinity) guideAt = t + GUIDE.after;
      const guiding = Number.isFinite(guideAt) && t >= guideAt && !closed;
      if (guiding) {
        guideTarget ??= easiestDeal(states, homes, [0, 1, 2, 3, 4, 5].map((k) => deal(guideDeal + k)));
        guidePushes(states, guideTarget, dt).forEach((p, i) => p && sim.push(bodies[i]!.id, p[0], p[1], p[2]));
        if (t - guideAt >= GUIDE.dur) {
          guideAt = Number.NaN;
          guideTarget = null;
          guideDeal += 6;
        }
      }
      if (!closed) sim.step(dt > 0 ? dt : 0, frame);
      if (phone && !sim.idle() && !hold) relayer = true;
      if (relayer && !closed && !hold && !Number.isFinite(guideAt) && sim.idle()) {
        relayer = false;
        rescue();
      }
      const busy = !closed && (!sim.idle() || hold !== null || settling || shaking || Number.isFinite(guideAt) || guideAt === -Infinity);
      if (busy) graceUntil = t + POUCH_FEEL.grace;
      // motion without a wake-up hook: nothing else would restart a stopped loop when the phone moves
      const active = busy || t < graceUntil || (phone && host === null && !closed);
      // At rest and untouched (the sim does not step then either), the pouch looks the same on every frame the host draws for its
      // own reasons — the window's sway, a page turn, the cover: nothing is posed again and the film's slow sweep keeps its place.
      if (active || !posed) {
        posed = true;
        for (let i = 0; i < slots.length; i++) slots[i]?.update(states[i]!, t);
        filmT += dt > 0 ? Math.min(dt, 0.1) : 0;
        pouch?.update(filmT);
      }
      return active;
    },
    setOpen(c) {
      const was = open;
      open = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 1));
      if (openSeen && was < 0.98 && open >= 0.999) {
        settleStart = -Infinity;
        // alternate the twist so two openings in a row do not shove things the same way
        settleDir = (settleCount++ & 1) === 0 ? 1 : -1;
        wake();
      }
      openSeen = true;
      // the cover starts to open: the booklet has painted, and the faces are in before the pouch is uncovered (see fontsGo)
      if (open > 0.02) kickFonts();
      if (open < POUCH_FEEL.grabOpen && hold) letGo(0, 0);
      if (open < POUCH_FEEL.grabOpen && hoverId !== null) {
        hoverId = null;
        opts.onHover?.(null);
      }
    },
    setDark,
    shake(strength = 1) {
      // closed, the front board presses everything flat: nothing to shake
      if (disposed || open <= POUCH_FEEL.closed) return;
      const s = Number.isFinite(strength) ? Math.max(0, strength) : 1;
      // every body back on its own layer (a rescue may have moved some), then the kicks; the settle is steered (GUIDE)
      for (let pass = 0; pass < 2; pass++) specLayers.forEach((l, i) => sim.setLayer(bodies[i]!.id, l));
      specLayers.forEach((l, i) => (homes[i] = l));
      sim.shake(s * SHAKE.gain, SHAKE.spread);
      guideAt = -Infinity;
      guideTarget = null;
      relayer = true;
      sound("shake", { gain: Math.max(0.2, Math.min(1, s)) });
      shakeS = s;
      shakeSecond = false;
      shakeStart = -Infinity;
      wake();
    },
    async printed() {
      kickFonts();
      await built;
      // set in the web faces from the start and all of them in: nothing will be painted again for its faces
      if (webAtBuild && !printFontsPending(printRuns())) return;
      await fontsSettled;
    },
    enableMotion() {
      return enableDeviceMotion().then((s) => {
        if (s === "granted") wake();
        return s;
      });
    },
    attach(ctx) {
      if (disposed) return;
      host = ctx;
      const full = ctx as Partial<AddonContext>;
      if (full.renderer && full.scene) {
        studio?.renderer.domElement.removeEventListener("webglcontextlost", onLost);
        studio = { renderer: full.renderer, scene: full.scene, camera: full.camera ?? null };
        full.renderer.domElement.addEventListener("webglcontextlost", onLost);
      }
      if (typeof ctx.dark === "boolean") setDark(ctx.dark);
    },
    snapshot: ((id: string, px: number, o?: SnapshotOptions): Promise<string | SnapshotImage | null> => {
      // while the context is lost a still would come out blank: none, and nothing cached
      if (disposed || !studio || contextLost()) return Promise.resolve(null);
      if (!items.some((it) => it.id === id)) return Promise.resolve(null);
      const w = Math.max(16, Math.min(2048, Math.round(Number.isFinite(px) ? px : 512)));
      const shadow = o?.shadow === true;
      const p = still(id, w, o?.side === "back" ? "back" : "front", shadow);
      // without a shadow, the plain data URL (as before)
      return shadow ? p : p.then((s) => s?.url ?? null);
    }) as PouchAddon["snapshot"],
    restore() {
      // the GPU is back: drop the stills still being made across the loss (they read back zeros, if anything); the finished ones are
      // plain data and stay
      losses++;
      for (const [k, s] of [...shots]) if (!s.done) shots.delete(k);
      host?.invalidate();
    },
    setProfile(next, labels) {
      if (disposed || !sameItems(next)) return Promise.resolve(false);
      const gen = ++swapGen;
      const label = labels?.pouch;
      // nothing of the old language is handed out from now on
      shots.clear();
      const run = swaps.then(() => swapTo(next, label, gen)).catch((e: unknown) => console.error("[sasshi] pouch language swap failed", e));
      swaps = run;
      return run.then(() => true);
    },
    resetLayout() {
      if (hold) letGo(0, 0);
      sim.resetLayout();
      wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      hold = null;
      host = null;
      studio?.renderer.domElement.removeEventListener("webglcontextlost", onLost);
      studio = null;
      shots.clear();
      for (const o of slots) o?.dispose();
      pouch?.dispose();
      root.removeFromParent();
    },
    debug: {
      sim,
      objects,
      built,
      held: () => hold?.id ?? null,
      hit: (ray, margin) => hit(ray, margin),
      frame: () => frame,
      scale,
    },
  };
  return addon;
}

/** "drop" gain from the release speed (m/s): 0.35 for a set-down, rising smoothly to 1 at a 1.5 m/s throw. */
export function dropGain(v: number): number {
  const k = Math.max(0, Math.min(1, (Number.isFinite(v) ? v : 0) / 1.5));
  return 0.35 + 0.65 * k * k * (3 - 2 * k);
}

/** Point (x, y) in the body frame inside the outline polygon, or within `margin` of its edge. */
export function inOutline(poly: readonly (readonly [number, number])[], x: number, y: number, margin: number): boolean {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    if (margin > 0) {
      const ex = xj - xi, ey = yj - yi;
      const l2 = ex * ex + ey * ey;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - xi - u * ex, y - yi - u * ey));
    }
  }
  return inside || best <= margin;
}

/**
 * Release velocity (units per second) from pointer samples {t: ms, x, y}: the travel over the last `windowMs` before `now`.
 * A pointer that stood still for most of the window gives (almost) zero, so a careful drop is not a throw.
 */
export function releaseVelocity(samples: readonly { t: number; x: number; y: number }[], now: number, windowMs: number): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!;
    if (now - s.t > windowMs) break;
    first = s;
  }
  const span = (last.t - first.t) / 1000;
  if (span < 0.008) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / span, vy: (last.y - first.y) / span };
}
