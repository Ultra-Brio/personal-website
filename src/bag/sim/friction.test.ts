import { describe, expect, test } from "bun:test";
import { Box, Vec2, World } from "planck";
import { G, MU, PRELOAD } from "../constants";
import { coulombScale, coulombSpin, shapeRadius, spinRadius, surfaceDecel } from "./friction";

describe("surface friction", () => {
  test("decel = MU * (gn + PRELOAD * G): flat and upright", () => {
    expect(surfaceDecel(G)).toBeCloseTo(MU * (G + PRELOAD * G), 12);
    expect(surfaceDecel(G)).toBeCloseTo(3.9485, 3);
    expect(surfaceDecel(0)).toBeCloseTo(0.515, 3); // upright: only the preload holds
    expect(surfaceDecel(-3)).toBeCloseTo(surfaceDecel(0), 12);
  });

  test("coulombScale removes exactly dv of speed and never reverses", () => {
    const k = coulombScale(5, 1);
    expect(k).toBeCloseTo(0.8, 12);
    expect(Math.hypot(3 * k, 4 * k)).toBeCloseTo(4, 12);
    expect(coulombScale(5, 5)).toBe(0);
    expect(coulombScale(5, 9)).toBe(0);
    expect(coulombScale(0, 1)).toBe(0);
  });

  test("a sliding body stops after v / decel, a resting one under the static limit never starts", () => {
    const dt = 1 / 120, decel = surfaceDecel(G);
    let v = 2, t = 0;
    while (v > 0) {
      v *= coulombScale(Math.abs(v), decel * dt);
      t += dt;
    }
    expect(Math.abs(t - 2 / decel)).toBeLessThan(2 * dt);
    // push of 10 degrees of tilt: g sin(10) < MU (g cos(10) + PRELOAD g) -> velocity stays 0 for ever
    const a = G * Math.sin((10 * Math.PI) / 180), dec = surfaceDecel(G * Math.cos((10 * Math.PI) / 180));
    let u = 0;
    for (let i = 0; i < 1000; i++) u = (u + a * dt) * coulombScale(Math.abs(u + a * dt), dec * dt);
    expect(u).toBe(0);
  });

  test("spin friction is symmetric, bounded and reaches exactly zero", () => {
    const dt = 1 / 120;
    expect(coulombSpin(5, 4, dt, 0.05)).toBeCloseTo(5 - ((4 / 3) * 4 * dt) / 0.05, 12);
    expect(coulombSpin(-5, 4, dt, 0.05)).toBeCloseTo(-(5 - ((4 / 3) * 4 * dt) / 0.05), 12);
    expect(coulombSpin(0.1, 4, dt, 0.05)).toBe(0);
    expect(coulombSpin(0, 4, dt, 0.05)).toBe(0);
  });

  test("radii", () => {
    expect(shapeRadius({ w: 0.04, h: 0.04, shape: "circle" })).toBeCloseTo(0.02, 12);
    expect(shapeRadius({ w: 0.04, h: 0.04, radius: 0.03, shape: "circle" })).toBeCloseTo(0.03, 12);
    expect(shapeRadius({ w: 0.07, h: 0.02, radius: 0.03, shape: "capsule" })).toBeCloseTo(0.01, 12); // capped at half the short side
    expect(spinRadius({ w: 0.06, h: 0.08, shape: "rect" })).toBeCloseTo(Math.sqrt((0.06 ** 2 + 0.08 ** 2) / 6), 12);
  });

  test("order matters: Coulomb after planck's integration still creeps ~14 mm/s at a 10 degree tilt; before it, nothing moves", () => {
    // one box in planck at 1 unit = 0.1 m, tilted pouch (a = g sin 10 = 1.70 m/s^2 < MU * (g cos 10 + PRELOAD g) = 3.9 m/s^2: static friction should hold)
    const S = 10, dt = 1 / 120, a = G * Math.sin((10 * Math.PI) / 180), dv = surfaceDecel(G * Math.cos((10 * Math.PI) / 180)) * S * dt;
    const drift = (preStep: boolean) => {
      const w = new World({ gravity: new Vec2(0, preStep ? 0 : -a * S) });
      const b = w.createBody({ type: "dynamic", bullet: true });
      b.createFixture({ shape: new Box(0.2, 0.2), density: 1 });
      for (let i = 0; i < 600; i++) {
        if (preStep) {
          const v = b.getLinearVelocity(), vy = v.y - a * S * dt, k = coulombScale(Math.hypot(v.x, vy), dv);
          b.setLinearVelocity(new Vec2(v.x * k, vy * k));
          w.step(dt, 8, 3);
        } else {
          w.step(dt, 8, 3);
          const v = b.getLinearVelocity(), k = coulombScale(Math.hypot(v.x, v.y), dv);
          b.setLinearVelocity(new Vec2(v.x * k, v.y * k));
        }
      }
      expect(Math.abs(b.getLinearVelocity().y)).toBe(0); // the velocity reads zero either way...
      return Math.abs(b.getPosition().y) / S; // ...but the position tells the truth
    };
    const post = drift(false), pre = drift(true);
    console.log(`5 s at 10 deg: Coulomb after the step drifts ${(post * 1000).toFixed(1)} mm, before it ${(pre * 1000).toFixed(3)} mm`);
    expect(post).toBeGreaterThan(0.05);
    expect(pre).toBe(0);
  });
});
