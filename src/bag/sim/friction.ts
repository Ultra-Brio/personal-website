/*
 * Surface friction between the objects and the pouch film: Coulomb deceleration, applied to velocities.
 *
 * planck's FrictionJoint creeps (12-33 mm/s forever, measured), so the film is modelled here instead:
 *   v <- v * max(0, |v| - MU * (gn + PRELOAD * G) * dt) / |v|
 * where gn is the normal load from the frame (flat pouch: g; vertical: 0) and PRELOAD*G is what the film still presses
 * with when the pouch stands upright. Spin uses the disk form  dw = 4/3 * MU * N * dt / r.
 *
 * The world applies it to (v + a*dt) *before* planck integrates positions. Applied after the step, a resting body
 * would still move a*dt^2 per substep (about 0.12 mm, i.e. 14 mm/s of creep at a 10 degree tilt) even though its velocity
 * reads zero afterwards.
 */
import { G, MU, PRELOAD } from "../constants";
import type { BodySpec } from "./types";

/** Deceleration (m/s^2) the film exerts on a sliding body for a normal acceleration `gn` from the frame (friction coefficient `mu`, default MU). */
export function surfaceDecel(gn: number, mu: number = MU): number {
  return mu * (Math.max(0, gn) + PRELOAD * G);
}

/** Factor to multiply a velocity of magnitude `speed` with after losing `dv` to friction: max(0, speed - dv) / speed. */
export function coulombScale(speed: number, dv: number): number {
  return speed > dv ? (speed - dv) / speed : 0;
}

/** Angular velocity after friction on a spinning body of effective radius `r` (m) for one step of `dt`. */
export function coulombSpin(w: number, decel: number, dt: number, r: number): number {
  const dw = ((4 / 3) * decel * dt) / r;
  return w > dw ? w - dw : w < -dw ? w + dw : 0;
}

/** End radius of a circle or capsule: the given `radius` (a capsule's is capped at half its short side), else half the short side. */
export function shapeRadius(spec: Pick<BodySpec, "w" | "h" | "radius" | "shape">): number {
  const half = Math.min(spec.w, spec.h) / 2;
  const r = spec.radius !== undefined && spec.radius > 0 ? spec.radius : half;
  return spec.shape === "capsule" ? Math.min(r, half) : r;
}

/** Radius of the disk with the same moment of inertia per unit mass as the footprint: sqrt(2 I / m). */
export function spinRadius(spec: Pick<BodySpec, "w" | "h" | "radius" | "shape">): number {
  const r = spec.shape === "circle" ? shapeRadius(spec) : Math.sqrt((spec.w * spec.w + spec.h * spec.h) / 6);
  return Math.max(r, 1e-3);
}
