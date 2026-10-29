import { describe, expect, test } from "bun:test";
import { G } from "./constants";
import { calibrateSign, createMotionFilter, deviceToScreen, GRAVITY_STEP, isResting, shapeShake, SHAKE_DEAD, type Vec3 } from "./motion";
import { inOutline, releaseVelocity } from "./addon";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe("deviceToScreen", () => {
  test("portrait is the identity, the other three angles rotate x / y and keep z", () => {
    expect(deviceToScreen(v(1, 2, 3), 0)).toEqual(v(1, 2, 3));
    // landscape, device top to the left (angle 90): the device's +x side points up the screen
    expect(deviceToScreen(v(1, 2, 3), 90)).toEqual(v(-2, 1, 3));
    expect(deviceToScreen(v(1, 2, 3), 180)).toEqual(v(-1, -2, 3));
    expect(deviceToScreen(v(1, 2, 3), 270)).toEqual(v(2, -1, 3));
    // window.orientation's -90 is 270
    expect(deviceToScreen(v(1, 2, 3), -90)).toEqual(v(2, -1, 3));
  });
});

describe("sign calibration", () => {
  test("W3C reports the reaction to gravity (+y upright, +z face up): sign -1; gravity-itself platforms: +1", () => {
    expect(calibrateSign(v(0, G, 0))).toBe(-1);
    expect(calibrateSign(v(0, 0, G))).toBe(-1);
    expect(calibrateSign(v(0.3, 6.9, 6.9))).toBe(-1);
    expect(calibrateSign(v(0, -G, 0))).toBe(1);
    expect(calibrateSign(v(0, 0, -G))).toBe(1);
  });
  test("resting means |a| close to g", () => {
    expect(isResting(v(0, G, 0))).toBe(true);
    expect(isResting(v(0, 6.9, 6.9))).toBe(true);
    expect(isResting(v(0, 2 * G, 0))).toBe(false);
    expect(isResting(v(0, 0.5, 0))).toBe(false);
  });
});

describe("shake shaping", () => {
  test("dead band, then a gain, continuous at the knee", () => {
    expect(shapeShake(v(0.5, 0, 0))).toEqual(v(0, 0, 0));
    expect(Math.hypot(...Object.values(shapeShake(v(SHAKE_DEAD + 1e-9, 0, 0))))).toBeLessThan(1e-6);
    const s = shapeShake(v(0, 0, 5));
    expect(s.x).toBe(0);
    expect(s.z).toBeGreaterThan(5 - SHAKE_DEAD);
  });
});

describe("motion filter", () => {
  /** Samples until calibrated: the first one, then three steady ones in a row. */
  const CAL = 4;
  const feed = (f: ReturnType<typeof createMotionFilter>, raw: Vec3, n: number, angle = 0, t0 = 0) => {
    let changed = 0;
    for (let i = 0; i < n; i++) if (f.push(raw, angle, 1 / 60, t0 + i / 60)) changed++;
    return changed;
  };

  test("calibrates once three samples in a row were resting and steady, W3C phone held upright: things fall to the screen's bottom", () => {
    const f = createMotionFilter();
    expect(f.push(v(0, G, 0.2), 0, 1 / 60, 0)).toBe(false);
    expect(f.push(v(0, G, 0.2), 0, 1 / 60, 0.016)).toBe(false);
    expect(f.push(v(0, G, 0.2), 0, 1 / 60, 0.033)).toBe(false);
    expect(f.reading()).toBeNull();
    expect(f.push(v(0, G, 0.2), 0, 1 / 60, 0.05)).toBe(true);
    const r = f.reading()!;
    expect(r.gravity.y).toBeCloseTo(-G, 6);
    expect(r.gravity.z).toBeCloseTo(-0.2, 6);
    expect(f.sign()).toBe(-1);
  });

  test("a platform that reports gravity itself gets the same apparent gravity", () => {
    const f = createMotionFilter();
    feed(f, v(0, -G, -0.2), CAL);
    expect(f.sign()).toBe(1);
    expect(f.reading()!.gravity.y).toBeCloseTo(-G, 6);
  });

  test("moving samples do not calibrate", () => {
    const f = createMotionFilter();
    for (let i = 0; i < 20; i++) f.push(v(0, G + (i % 2 ? 3 : -3), 0), 0, 1 / 60, i / 60);
    expect(f.reading()).toBeNull();
  });

  test("landscape: the screen angle is applied per sample", () => {
    const f = createMotionFilter();
    // device top to the left (angle 90): the reaction to gravity shows on the device's +x axis
    feed(f, v(G, 0, 0), CAL, 90);
    const g = f.reading()!.gravity;
    expect(g.x).toBeCloseTo(0, 6);
    expect(g.y).toBeCloseTo(-G, 6);
  });

  test("gravity follows a slow tilt through the low-pass, with a small hysteresis; tremor does not wake anything", () => {
    const f = createMotionFilter();
    feed(f, v(0, 0, G), CAL);
    expect(f.reading()!.gravity.z).toBeCloseTo(-G, 6);
    // tremor of 0.05 m/s^2: below the hysteresis step and the shake dead band
    let wakes = 0;
    for (let i = 0; i < 120; i++) if (f.push(v(0.05 * Math.sin(i), 0, G), 0, 1 / 60, 1 + i / 60)) wakes++;
    expect(wakes).toBe(0);
    // tilt to 30 degrees (top up) and hold: the published gravity converges within a step
    const s = Math.sin(Math.PI / 6), c = Math.cos(Math.PI / 6);
    expect(feed(f, v(0, G * s, G * c), 90, 0, 3)).toBeGreaterThan(0);
    const g = f.reading()!.gravity;
    expect(Math.hypot(g.x, g.y + G * s, g.z + G * c)).toBeLessThanOrEqual(GRAVITY_STEP + 1e-9);
  });

  test("a jolt shows up as shake (residual), then decays", () => {
    const f = createMotionFilter();
    feed(f, v(0, 0, G), CAL);
    expect(f.push(v(8, 0, G), 0, 1 / 60, 1)).toBe(true);
    // apparent acceleration = -(reading): a jolt of the phone to the right (+x reaction) throws things to the left
    expect(f.reading()!.shake.x).toBeLessThan(-5);
    feed(f, v(0, 0, G), 60, 0, 1.1);
    const sh = f.reading()!.shake;
    expect(Math.hypot(sh.x, sh.y, sh.z)).toBe(0);
  });

  test("garbage samples are ignored", () => {
    const f = createMotionFilter();
    expect(f.push(v(Number.NaN, 0, 0), 0, 1 / 60, 0)).toBe(false);
    feed(f, v(0, 0, G), CAL);
    expect(f.push(v(Number.POSITIVE_INFINITY, 0, 0), 0, 1 / 60, 1)).toBe(false);
    expect(f.reading()!.gravity.z).toBeCloseTo(-G, 6);
  });
});

describe("pointer helpers (addon.ts)", () => {
  const square: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  test("inOutline: inside, outside, and within the margin of an edge", () => {
    expect(inOutline(square, 0, 0, 0)).toBe(true);
    expect(inOutline(square, 0.99, -0.99, 0)).toBe(true);
    expect(inOutline(square, 1.05, 0, 0)).toBe(false);
    expect(inOutline(square, 1.05, 0, 0.1)).toBe(true);
    expect(inOutline(square, 1.2, 1.2, 0.1)).toBe(false);
  });
  test("releaseVelocity: travel over the last window; a pointer that stopped gives no throw", () => {
    const s = [
      { t: 0, x: 0, y: 0 },
      { t: 40, x: 0.04, y: 0 },
      { t: 80, x: 0.08, y: -0.04 },
    ];
    const v1 = releaseVelocity(s, 80, 80);
    expect(v1.vx).toBeCloseTo(1, 6);
    expect(v1.vy).toBeCloseTo(-0.5, 6);
    // released 200 ms after the last move: nothing within the window
    expect(releaseVelocity(s, 280, 80)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([], 0, 80)).toEqual({ vx: 0, vy: 0 });
  });
});
