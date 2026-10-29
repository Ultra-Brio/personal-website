import type * as THREE from "three";

/*
 * Scene addons: the extension point that puts live things (the résumé pouch) inside a book. Type-only module (no three at runtime).
 *
 * World frame of the book scene: the desk is the xy plane and +z is up (towards the camera, which looks down at a 9° tilt from −y).
 * The book lies with its spine along y; open, the front board is on the left (−x) and the back board on the right (+x).
 * Scene units: 1 unit = 100 mm (1 mm = 0.01).
 */

export type AddonAnchor = "back-inside" | "front-inside";

/** What the book hands an addon when it is attached (before the first update). */
export type AddonContext = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ask for a frame (an image arrived, the visitor hovered …). Frames keep coming while any update() returns true. */
  invalidate(): void;
};

export interface SceneAddon {
  /**
   * Where the addon's object is parented. Frame: origin at the board's centre on its inside face (on top of the liner paper when
   * there is one), x along the board width (to the right when the book is open), y along its height (+y away from the camera),
   * z = the board's inside normal (up when open). Scene units (1 mm = 0.01). The frame follows the board through opening /
   * closing and the whole-book tilt, so anchorWorld carries both.
   */
  anchor: AddonAnchor;
  /**
   * Parented to the anchor frame. Rules: never use three layers 1 / 2 (FROST_LAYER / DESK_LAYER, owned by the frosted cover);
   * nothing casts into the book's shadow maps — the book forces castShadow off on every mesh under it — so draw contact shadows
   * yourself. Receiving is welcome (round 3): a lit mesh with receiveShadow takes the window light's shadows (the bars and leaves of
   * the sun, the book's own key shadow) like the book does; the lights and their maps are the scene's, nothing to wire. three's VSM
   * draws receivers into the shadow maps as if they cast, so a receiver must not write depth there: give it a customDepthMaterial
   * that writes nothing, or leave it unset and the book gives it one (at attach, and again before every shadow-map update for meshes
   * added later). Only lit materials show it (MeshBasic ignores light). Transparent meshes are left out of the frosted cover's
   * background pass (they would show twice through the back board) — only opaque parts show through a closing frosted board. That background pass renders linear, un-tonemapped colour: a material that bakes its own output encoding reads too
   * bright through frost.
   */
  object: THREE.Object3D;
  /** Optional: called once when the book adopts the addon, before the first update. */
  attach?(ctx: AddonContext): void;
  /**
   * Called every rendered frame while the book is alive, after the case and tilt are posed for that frame.
   * dt, t in seconds; anchorWorld = the anchor frame's world matrix this frame (do not keep the reference).
   * Return true to keep frames coming (physics not idle).
   */
  update(dt: number, t: number, anchorWorld: THREE.Matrix4): boolean;
  /**
   * Pointer routing, only while the book is fully open. Rays are in world space. down() returns true to claim the gesture:
   * move / up then go to the addon and the page / cover / tilt drag is skipped. hover() true shows a grab cursor.
   */
  pointer?: {
    down(ray: THREE.Ray, e: PointerEvent): boolean;
    move(ray: THREE.Ray, e: PointerEvent): void;
    up(ray: THREE.Ray, e: PointerEvent): void;
    hover?(ray: THREE.Ray): boolean;
  };
  /** Cover openness 0 (closed) … 1 (open): called at attach and whenever it changes. */
  setOpen?(c: number): void;
  /**
   * Optional: resolves once the print the addon shows is painted in its own faces (fetching them now if it has not yet). The book's
   * opening on arrival waits for it (a while at most), so the print is not first seen in stand-in glyphs and then repainted.
   */
  printed?(): Promise<void>;
  /**
   * Optional: the WebGL context was lost and has come back (webglcontextrestored). Called after three has set up its fresh GL state
   * and the book has made its own GPU-only resources again (scene.environment is a new texture by then), before the next frame. three
   * uploads geometry, textures (from their canvases / images) and programs again by itself; make again only what lived on the GPU
   * alone — the contents of your own render targets — and drop anything read back from the GPU while the context was lost
   * (readRenderTargetPixels on a lost context gives zeros: a still taken then is blank). update() calls stop while it is lost.
   */
  restore?(): void;
  /** Called by the book when it is disposed (after the object is detached). */
  dispose(): void;
}
