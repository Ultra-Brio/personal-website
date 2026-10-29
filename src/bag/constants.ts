/*
 * Shared numbers for the pouch. SI units: metres, kilograms, seconds (planck is tuned for 0.1–10 m bodies).
 * Pouch-plane coordinates: origin at the pouch centre, +x right, +y up (portrait: taller than wide).
 */

/** Inner usable size of the clear pouch (an A4 zip pouch, a little generous). */
export const POUCH_W = 0.23;
export const POUCH_H = 0.32;

/** Physics step: fixed, 120 Hz, clamped to 0.1 s of catch-up per frame. */
export const SIM_HZ = 120;
export const SIM_MAX_DT = 0.1;

/** Gravity and friction used everywhere. */
export const G = 9.81;
export const MU = 0.35;
/** Fraction of g that the film still presses objects with when the pouch is vertical or upside down. */
export const PRELOAD = 0.15;

/**
 * Depth layers inside the pouch. Same layer collides, different layers pass through each other.
 * `z` is the layer's resting height above the back film (metres); a body is lifted a hair per stacking rank on top of this.
 */
export const LAYERS = [
  { id: 0, name: "paper", z: 0.0006 },
  { id: 1, name: "mid", z: 0.0022 },
  { id: 2, name: "small", z: 0.0042 },
] as const;
export type LayerId = 0 | 1 | 2;

/** Gap between the two films (metres). Objects live inside it; the grabbed object may rise to this. */
export const POUCH_DEPTH = 0.012;
