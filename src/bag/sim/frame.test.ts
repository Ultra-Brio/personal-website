import { describe, expect, test } from "bun:test";
import { G } from "../constants";
import { apparentAccelInto, createFrameTracker, frameFromMatrices, pocketAccel, restFrame, type Matrix4Like, type Vec3 } from "./frame";

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const mat = (ex: Vec3, ey: Vec3, ez: Vec3, p: Vec3 = [0, 0, 0]): number[] => [...ex, 0, ...ey, 0, ...ez, 0, ...p, 1];

// the six poses of the research (proof/frame.ts)
const FLAT = { ex: [1, 0, 0], ey: [0, 0, -1], ez: [0, 1, 0] } as const; // lying on a desk, front film up
const UPRIGHT = { ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] } as const; // standing, facing the viewer
const tiltX = (b: number) => ({ ex: [1, 0, 0], ey: [0, Math.cos(b), Math.sin(b)], ez: [0, -Math.sin(b), Math.cos(b)] }) as const;
const UPSIDE = { ex: [1, 0, 0], ey: [0, 0, 1], ez: [0, -1, 0] } as const; // film held by its front
const still = (a: { ex: Vec3; ey: Vec3; ez: Vec3 }, n = 3) => Array.from({ length: n }, () => mat(a.ex, a.ey, a.ez));

describe("pocketAccel: the six research cases", () => {
  const Z: Vec3 = [0, 0, 0];
  test("flat on a desk: no in-plane push, full normal load", () => {
    const r = pocketAccel(FLAT, Z, Z, Z, Z);
    close(r.ax, 0);
    close(r.ay, 0);
    close(r.gn, 9.81);
  });
  test("standing upright: gravity along -y, no normal load", () => {
    const r = pocketAccel(UPRIGHT, Z, Z, Z, Z);
    close(r.ax, 0);
    close(r.ay, -9.81);
    close(r.gn, 0);
  });
  test("45 degree tilt: 6.94 / 6.94", () => {
    const r = pocketAccel(tiltX(Math.PI / 4), Z, Z, Z, Z);
    close(r.ay, -6.94, 0.01);
    close(r.gn, 6.94, 0.01);
  });
  test("upright with a +3 g lateral shake: ax = -29.43", () => {
    close(pocketAccel(UPRIGHT, [29.43, 0, 0], Z, Z, Z).ax, -29.43);
  });
  test("centrifugal: omega 10 rad/s about the normal at r = 0.1 m pushes outward by 10 m/s^2", () => {
    const r = pocketAccel(UPRIGHT, Z, [0, 0, 10], Z, [0.1, 0, 0]);
    close(r.ax, 10, 1e-9);
    close(r.ay, -9.81);
  });
  test("upside down: the front film holds, gn = 9.81", () => {
    const r = pocketAccel(UPSIDE, Z, Z, Z, Z);
    close(r.ax, 0);
    close(r.ay, 0);
    close(r.gn, 9.81);
  });
});

describe("apparentAccelInto: per-body terms of the 2D sim", () => {
  const out = { ax: 0, ay: 0 };
  test("centrifugal matches the 3D derivation", () => {
    apparentAccelInto(out, { ax: 0, ay: -9.81, gn: 0, omega: 10, alpha: 0 }, 0.1, 0, 0, 0);
    close(out.ax, 10, 1e-9);
    close(out.ay, -9.81, 1e-9);
  });
  test("agrees with pocketAccel for omega and alpha about the normal at any r", () => {
    const f = { ax: 0, ay: 0, gn: 0, omega: 7, alpha: -30 };
    apparentAccelInto(out, f, 0.06, -0.09);
    const ref = pocketAccel(UPRIGHT, [0, 0, 0], [0, 0, 7], [0, 0, -30], [0.06, -0.09, 0], [0, 0, 0]);
    close(out.ax, ref.ax, 1e-9);
    close(out.ay, ref.ay, 1e-9);
  });
  test("Euler term: angular acceleration pushes a body at +x towards -y", () => {
    apparentAccelInto(out, { ax: 0, ay: 0, gn: 0, omega: 0, alpha: 50 }, 0.1, 0);
    close(out.ax, 0, 1e-12);
    close(out.ay, -5, 1e-9);
  });
  test("Coriolis: a body moving +x in a frame spinning counter-clockwise is deflected towards -y", () => {
    apparentAccelInto(out, { ax: 0, ay: 0, gn: 0, omega: 5, alpha: 0 }, 0, 0, 1, 0);
    close(out.ay, -10, 1e-9);
  });
});

describe("frameFromMatrices", () => {
  const dt = 1 / 120;
  test("flat: gn = 9.81, nothing in the plane", () => {
    const f = frameFromMatrices(still(FLAT), dt);
    close(f.ax, 0);
    close(f.ay, 0);
    close(f.gn, 9.81);
    close(f.omega, 0);
    close(f.alpha, 0);
  });
  test("vertical: ay = -9.81, gn = 0", () => {
    const f = frameFromMatrices(still(UPRIGHT), dt);
    close(f.ax, 0);
    close(f.ay, -9.81);
    close(f.gn, 0);
  });
  test("upside down: the front film holds, gn = 9.81, nothing in the plane", () => {
    const f = frameFromMatrices(still(UPSIDE), dt);
    close(f.ax, 0);
    close(f.ay, 0);
    close(f.gn, 9.81);
  });
  test("45 degree tilt: 6.94 / 6.94", () => {
    const f = frameFromMatrices(still(tiltX(Math.PI / 4)), dt);
    close(f.ay, -6.94, 0.01);
    close(f.gn, 6.94, 0.01);
  });
  test("vertical with a 3 g lateral shake: ax = -29.43 (second difference of the position)", () => {
    const a = 3 * G;
    const hist = Array.from({ length: 6 }, (_, k) => mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez, [0.5 * a * (k * dt) ** 2, 0, 0]));
    const f = frameFromMatrices(hist, dt);
    close(f.ax, -29.43, 1e-6);
    close(f.ay, -9.81, 1e-6);
    // the minimum history of three matrices gives the same number
    close(frameFromMatrices(hist.slice(0, 3), dt).ax, -29.43, 1e-6);
  });
  test("scene units: a matrix unit of 0.1 m scales the translation", () => {
    const a = 3 * G;
    const hist = Array.from({ length: 4 }, (_, k) => mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez, [(0.5 * a * (k * dt) ** 2) / 0.1, 0, 0]));
    close(frameFromMatrices(hist, dt, { unit: 0.1 }).ax, -29.43, 1e-6);
  });
  test("rotation about the normal gives omega, and a spinning ramp gives alpha", () => {
    const spin = (th: number) => mat([Math.cos(th), Math.sin(th), 0], [-Math.sin(th), Math.cos(th), 0], [0, 0, 1]);
    const w = frameFromMatrices(Array.from({ length: 5 }, (_, k) => spin(10 * k * dt)), dt);
    close(w.omega, 10, 1e-6);
    close(w.alpha, 0, 1e-6);
    const al = frameFromMatrices(Array.from({ length: 6 }, (_, k) => spin(0.5 * 40 * (k * dt) ** 2)), dt);
    close(al.alpha, 40, 1e-6);
    // counter-clockwise (seen from the front) is positive; clockwise is negative
    expect(frameFromMatrices([spin(0), spin(-0.1)], dt).omega).toBeLessThan(0);
  });
  test("a pouch flipped about a vertical in-plane axis shows the swing in the plane as a frame acceleration", () => {
    // pouch centre moves on a circle of radius 0.2 m around a vertical axis at 6 rad/s: a = w^2 R = 7.2 m/s^2, towards the axis
    const R = 0.2, w = 6;
    const hist = Array.from({ length: 6 }, (_, k) => {
      const th = w * k * dt;
      return mat([Math.cos(th), 0, -Math.sin(th)], [0, 1, 0], [Math.sin(th), 0, Math.cos(th)], [R * Math.sin(th), 0, R * Math.cos(th)]);
    });
    const f = frameFromMatrices(hist, dt);
    // omega is about the pouch's own y axis, so it does not enter the scalar omega about the normal
    close(f.omega, 0, 1e-6);
    // g_app = g - a_frame: the centripetal acceleration points along the pouch normal (7.2 m/s^2 of extra load), not into the plane
    close(f.gn, 7.2, 0.4);
    close(f.ay, -9.81, 0.01);
    expect(Math.abs(f.ax)).toBeLessThan(1);
  });
  test("a single matrix gives orientation only; two add omega", () => {
    const t = tiltX(0.3);
    const f1 = frameFromMatrices([mat(t.ex, t.ey, t.ez)], dt);
    close(f1.omega, 0);
    close(f1.gn, G * Math.sin(0.3), 1e-9);
    expect(frameFromMatrices([], dt)).toEqual(restFrame());
  });
  test("bad dt falls back to the static split", () => {
    const f = frameFromMatrices(still(UPRIGHT), 0);
    close(f.ay, -9.81);
    close(f.alpha, 0);
  });
  test("low-pass: the boxcar window averages a jittering acceleration away; smoothMs 0 keeps the raw second difference", () => {
    // acceleration alternating +-30 m/s^2 sample by sample (a 60 Hz buzz): position = integral of a sawtooth velocity
    const accel = (k: number) => (k % 2 === 0 ? 30 : -30);
    let v = 0, x = 0;
    const hist: number[][] = [];
    for (let k = 0; k < 10; k++) {
      hist.push(mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez, [x, 0, 0]));
      v += accel(k) * dt;
      x += v * dt;
    }
    const raw = Math.abs(frameFromMatrices(hist, dt, { smoothMs: 0 }).ax);
    const smooth = Math.abs(frameFromMatrices(hist, dt, { smoothMs: 25 }).ax);
    expect(raw).toBeGreaterThan(20);
    expect(smooth).toBeLessThan(raw / 2);
  });
  test("spikes are clamped: a 1 m teleport in one frame stays within 5 g, alpha and omega within their limits", () => {
    const hist = [mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez), mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez), mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez, [1, 0, 0])];
    const f = frameFromMatrices(hist, dt, { smoothMs: 0 });
    close(f.ax, -5 * G, 1e-9);
    const spin = (th: number) => mat([Math.cos(th), Math.sin(th), 0], [-Math.sin(th), Math.cos(th), 0], [0, 0, 1]);
    const g = frameFromMatrices([spin(0), spin(0), spin(1)], dt, { smoothMs: 0 });
    expect(Math.abs(g.omega)).toBeLessThanOrEqual(60);
    expect(Math.abs(g.alpha)).toBeLessThanOrEqual(200);
  });
});

describe("createFrameTracker", () => {
  test("copies the matrices (three.js mutates matrixWorld in place) and settles on the shake acceleration", () => {
    const dt = 1 / 120, a = 3 * G;
    const t = createFrameTracker();
    const live = new Float64Array(mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez));
    let last = restFrame();
    for (let k = 0; k < 12; k++) {
      live[12] = 0.5 * a * (k * dt) ** 2;
      last = t.push(live as Matrix4Like, dt);
    }
    close(last.ax, -29.43, 1e-6);
    t.reset();
    close(t.push(new Float64Array(mat(UPRIGHT.ex, UPRIGHT.ey, UPRIGHT.ez)), dt).ax, 0);
  });
});
