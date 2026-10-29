/*
 * Public types of the pouch simulation. Pure data: no planck, no three, no DOM.
 * Pouch-plane coordinates: origin at the pouch centre, +x right, +y up, SI units (metres, seconds, kilograms, radians).
 */
import type { LayerId } from "../constants";
import type { Frame } from "./frame";

export type { LayerId };

export type BodyShape = "rect" | "circle" | "capsule";

/**
 * One physical object in the pouch. `w` x `h` is the footprint in metres.
 *  - rect: a w x h rectangle (corners are sharp, the view may round them).
 *  - circle: radius `radius`, or min(w, h) / 2 when absent.
 *  - capsule: a stadium whose long axis follows the longer of w / h; end radius `radius`, or min(w, h) / 2 when absent.
 * `mass` is in kilograms; absent -> a light card-stock density of the footprint. `id` must be unique within a sim.
 */
export type BodySpec = { id: string; w: number; h: number; layer: LayerId; shape: BodyShape; mass?: number; radius?: number };

/**
 * Per-body output. `layer` is the layer the view should draw the body on: the home layer, or the top layer
 * (2) while the body is a ghost (held, or released and waiting for a free spot in its home layer).
 * A released ghost with nothing free around it keeps layer 2 until the scene is disturbed (shake, tilt, grab, ...);
 * from the outside it can only be told apart from a real layer-2 body by `layer !== its spec's layer`.
 * `angle` is unwrapped (it can leave [-pi, pi]); `w` is the angular velocity in rad/s.
 */
export type BodyState = { id: string; x: number; y: number; angle: number; vx: number; vy: number; w: number; layer: number; held: boolean };

export type BagSimOptions = {
  /** Inner usable size of the pouch in metres. */
  width: number;
  height: number;
  bodies: readonly BodySpec[];
  /** Layout seed. Equal seeds give bit-identical simulations for the same call sequence. */
  seed?: number;
  /**
   * Largest distance a body may travel in one 120 Hz substep after release / shake, in metres. Default 0.02 (20 mm,
   * i.e. 2.4 m/s): the value the pop-free release was measured with. Raise it only to test continuous collision.
   */
  maxTravel?: number;
  /**
   * Film friction. Default: one coefficient MU for both (the behaviour the sim tests pin down).
   *  - kinetic: coefficient of a sliding body;
   *  - static: coefficient of a body at rest (>= kinetic): it has to be pushed harder to break away than to keep sliding;
   *  - spread: per-body variation, +-spread as a fraction (deterministic from the body id), so a tilted pouch does not
   *    release everything at the same angle.
   */
  friction?: { kinetic?: number; static?: number; spread?: number };
  /**
   * Contact reports for impact sounds. Called after a substep for each contact that struck: `speed` is the normal relative speed
   * at the contact point just before the solver resolved it (m/s, >= CONTACT_MIN_SPEED), (x, y) the contact point in pouch metres.
   * `a` is a body id; `b` is the other body's id or "wall" (so body ids should not be "wall"). For two bodies, `a` is the one that
   * brought more momentum into the hit (mass x speed). Only same-layer bodies and walls ever touch, so bodies on different
   * layers passing over each other never report, nor do ghosts passing over bodies.
   * A report is a new touch (the pair was apart for at least two substeps) or a persistent contact struck again (its approach
   * speed rose by CONTACT_RISE within one substep); a held body reports only new touches with the walls. Each pair (a body and
   * one of the four walls counts as a pair) reports at most once per 50 ms. Nothing is reported while dealing the layout, and an
   * idle sim does not step, so a resting pouch never reports. Ids are passed as given; the callback must not throw.
   */
  onContact?: (a: string, b: string | "wall", speed: number, x: number, y: number) => void;
  /**
   * A composed deal instead of the random scatter: where each body starts, in spec order (pouch metres, radians).
   * Called with 0 for the first deal and 1, 2, … for each resetLayout(). An entry left null is scattered around the others.
   * A placement is nudged inside the walls, and the usual overlap relaxation still runs, so keep same-layer bodies at least
   * 1 mm apart or the solver will shove them.
   */
  deal?: (n: number) => readonly (Placement | null | undefined)[];
};

/** A starting pose: centre (metres) and angle (radians). */
export type Placement = { x: number; y: number; angle: number };

/** Counters of the last-resort guards. In a healthy simulation both stay 0. */
export type SimStats = { substeps: number; wallClamps: number; nanResets: number };

export interface BagSim {
  /** Advance by `dt` seconds (clamped to SIM_MAX_DT) in fixed 120 Hz substeps, under the given apparent-gravity frame. */
  step(dt: number, frame: Frame): void;
  /** Live array, one entry per body in spec order. It is mutated in place by `step`; copy what you need to keep. */
  state(): readonly BodyState[];
  /** Pick up a body at pouch point (x, y). The body becomes a ghost (collides with walls only) shown on the top layer. */
  grab(id: string, x: number, y: number): void;
  /** Move the pointer while holding. */
  drag(x: number, y: number): void;
  /** Let go with pointer velocity (vx, vy) in m/s. The body re-joins its layer only once it overlaps nothing in it. */
  release(vx?: number, vy?: number): void;
  /** True when everything is at rest and the input frame has not changed: the host may stop stepping. */
  idle(): boolean;
  /**
   * One random impulse for the "Shake" button; `strength` 1 is about 1.6 m/s. Every body gets its own direction within
   * `spread` radians (default 1.2) around one shared random direction: 2 pi throws each body its own way.
   */
  shake(strength?: number, spread?: number): void;
  /** Re-deal the objects (deterministic: every call uses the next layout from the seed). */
  resetLayout(): void;
  /** Change a body's home layer at runtime. It re-joins the new layer when free of overlap (see `release`). */
  setLayer(id: string, layer: LayerId): void;
  /** Add (vx, vy) m/s (and `w` rad/s of spin) to a resting or moving body, capped like a shake; a held body is left alone. */
  push(id: string, vx: number, vy: number, w?: number): void;
  stats(): SimStats;
  /** Ids of the ghosts now (held, or released over another body of their layer and waiting on top): for harnesses and tests. */
  ghosts(): string[];
}
