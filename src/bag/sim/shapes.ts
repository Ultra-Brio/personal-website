/*
 * Collision shapes for the three body kinds, and the clearance test used to re-admit ghosts.
 *
 * planck runs at 1 unit = 0.1 m (`S` = 10 units per metre), the scale all the pouch measurements were taken at: Box2D's
 * tolerances (5 mm slop, 10 mm polygon skin) are tuned for 0.1-10 m bodies, and at raw SI a 36 mm object would
 * carry a 20 mm skin. Polygons are shrunk by their skin so the rounded hull matches the nominal footprint exactly.
 */
import { Box, Circle, Distance, DistanceInput, DistanceOutput, SimplexCache, Settings, Vec2 } from "planck";
import type { Shape, TransformValue } from "planck";
import { shapeRadius } from "./friction";
import type { BodySpec } from "./types";

/** planck units per metre. */
export const S = 10;

/** Default areal density (kg/m^2) of a body without an explicit mass: thin card stock. */
const AREAL_DENSITY = 0.6;

/** Footprint area in m^2. */
export function footprintArea(spec: BodySpec): number {
  if (spec.shape === "circle") return Math.PI * shapeRadius(spec) ** 2;
  if (spec.shape === "rect") return spec.w * spec.h;
  const r = shapeRadius(spec);
  return Math.max(Math.max(spec.w, spec.h) - 2 * r, 0) * 2 * r + Math.PI * r * r;
}

export function massOf(spec: BodySpec): number {
  return spec.mass !== undefined && spec.mass > 0 ? spec.mass : AREAL_DENSITY * footprintArea(spec);
}

/** The shapes (planck units, body-local) that make up a spec: one box, one circle, or a box plus two end circles. */
export function makeShapes(spec: BodySpec): Shape[] {
  const skin = Settings.polygonRadius;
  const half = (m: number) => Math.max((m / 2) * S - skin, 1e-3);
  if (spec.shape === "circle") return [new Circle(shapeRadius(spec) * S)];
  if (spec.shape === "rect") return [new Box(half(spec.w), half(spec.h))];
  const r = shapeRadius(spec);
  const core = (Math.max(spec.w, spec.h) / 2 - r) * S;
  if (core <= 1e-4) return [new Circle(r * S)];
  const along = spec.w >= spec.h;
  const rs = r * S;
  return along
    ? [new Box(core, Math.max(rs - skin, 1e-3)), new Circle(new Vec2(-core, 0), rs), new Circle(new Vec2(core, 0), rs)]
    : [new Box(Math.max(rs - skin, 1e-3), core), new Circle(new Vec2(0, -core), rs), new Circle(new Vec2(0, core), rs)];
}

const input = new DistanceInput();
const output = new DistanceOutput();
const cache = new SimplexCache();

/**
 * Signed gap between two compound shapes in planck units, measured on the rounded hulls: positive is clear distance,
 * zero is touching, negative is penetration depth (exact while the cores stay apart, then bounded by the radii).
 */
export function gapBetween(a: readonly Shape[], xfA: TransformValue, b: readonly Shape[], xfB: TransformValue): number {
  let best = Infinity;
  for (const sa of a) {
    for (const sb of b) {
      input.recycle();
      input.proxyA.set(sa, 0);
      input.proxyB.set(sb, 0);
      input.transformA.set(xfA);
      input.transformB.set(xfB);
      input.useRadii = false;
      output.recycle();
      cache.recycle();
      Distance(output, cache, input);
      const g = output.distance - sa.getRadius() - sb.getRadius();
      if (g < best) best = g;
    }
  }
  return best;
}
