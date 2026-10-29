/*
 * Public types of the pouch objects. BodySpec / BodyState mirror docs/DESIGN.md ("Interfaces / src/bag") exactly;
 * they are redeclared here (structurally identical) so this folder has no import dependency on src/bag/sim.
 * Careful: BodySpec.w is a width in metres, BodyState.w is an angular velocity in rad/s.
 */
import type * as THREE from "three";
import type { FontRun } from "../../fonts";
import type { PocketItem } from "../../profile/schema";

export type BodySpec = { id: string; w: number; h: number; layer: 0 | 1 | 2; shape: "rect" | "circle" | "capsule"; mass?: number; radius?: number };
export type BodyState = { id: string; x: number; y: number; angle: number; vx: number; vy: number; w: number; layer: number; held: boolean };

/** @deprecated The print is set through src/fonts (Shippori Mincho / Zen Kaku Gothic New / Klee One, SC faces for Chinese); stacks given here are ignored. */
export type FontStacks = { sans: string; serif: string; mono: string };

/** Who the pouch belongs to. The résumé's first page is typeset from it (name, role, place, links); the card and the film print the names. */
export type Owner = { name: string; nameLocal?: string; role?: string; location?: string; handle?: string; links?: { label: string; href: string }[] };

export type ObjectCtx = {
  /** renderer.capabilities.getMaxAnisotropy() (or less). */
  anisotropy: number;
  /** @deprecated light theme only; ignored */
  dark?: boolean;
  /** @deprecated ignored (see FontStacks) */
  font?: FontStacks;
  /** The profile's language (Profile.lang): the printed labels follow it (zh → Chinese) and it picks the Han faces with the text. */
  lang?: string;
  /**
   * The print's resolution over its base, 1 … 1.6 (default 1): the objects the detail view shows as stills (ticket, polaroid, note)
   * print this much finer, so a still as large as a large screen's detail view asks for (brief r4 E3: the page scaled by k) comes
   * from texels, not from magnifying them.
   */
  printScale?: number;
  owner?: Owner;
  /** Something visible changed outside update() (an image finished loading): a host that renders on demand should draw a frame. */
  onChange?: () => void;
};

export type PouchCtx = ObjectCtx & {
  /** Name screen-printed on the film, top left (default: the owner's name, else nothing). */
  label?: string;
};

export interface BuiltObject {
  /** Add this to the pouch group. Origin = the pouch-plane point (state.x, state.y) at the back film; the object sits above it. */
  object: THREE.Group;
  body: BodySpec;
  /** `t` is a monotonic clock in SECONDS (the rig integrates its eased tilt / flex spring from successive t; a stall > 0.25 s re-seeds). */
  update(state: BodyState, t: number): void;
  setDark(d: boolean): void;
  /** Paint the print again (the web fonts arrived after the build, or relabel() gave it new words); the textures re-upload on the next frame. */
  repaint(): void;
  /**
   * The same object in another language (brief r4 E1): `item` (same id and kind) with `ctx`'s owner and language is what the next
   * repaint() prints, in the same canvases (nothing is built or allocated again); `fonts` becomes its strings. False when it cannot:
   * another kind, or (the polaroid) another picture.
   */
  relabel(item: PocketItem, ctx: ObjectCtx): boolean;
  /** Every string the object prints, by role and weight: what ensureFonts must load before a repaint. */
  fonts: FontRun[];
  /** Resolves when the object's pictures are in its print (at once when it has none). */
  ready: Promise<void>;
  /** Current flex amount (-1.4..1.4, 0 for rigid objects); for tests and debugging. */
  flex(): number;
  /** Footprint polygon in the body frame (metres, CCW), for hit-testing / debugging. */
  outline: readonly (readonly [number, number])[];
  /** It has holes through it (the ticket's punch and perforation): a baked shadow must leave them open. */
  holes: boolean;
  /**
   * For stills: a copy of the model lying flat at angle 0, its meshes sharing this object's geometry, materials and textures (nothing
   * is painted or uploaded again); `flat(fn)` runs a render of it with the shared bend released (a card the pouch is still flexing
   * comes out straight). Take the copy out of its scene when done; never dispose it.
   */
  still(): { model: THREE.Object3D; flat<R>(fn: () => R): R };
  dispose(): void;
}

export interface Pouch {
  group: THREE.Group;
  /** `t` in seconds; only drives a very faint highlight sweep on the film. */
  update(t: number): void;
  setDark(d: boolean): void;
  /** Paint the printed mark on the film again (the web fonts arrived after the build, or relabel() changed it). */
  repaint(): void;
  /** The strings the film's print uses (for ensureFonts). */
  fonts: FontRun[];
  /** Another language's mark (label, owner, lang of the ctx): sets `fonts` to its strings; repaint() prints it. */
  relabel(ctx: PouchCtx): void;
  dispose(): void;
  /** Outer extent of the sealed film (including seal, zip band and label tab), pouch-plane metres. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}
