/*
 * The pouch is not an inertial frame: it is carried by a page that flips, a hand that tilts, a phone that shakes.
 * Seen from inside, a loose object feels the apparent acceleration
 *
 *     g_app = g - a_frame - alpha x r - omega x (omega x r)          (and -2 omega x v, the Coriolis term)
 *
 * split into an in-plane part (ax, ay) and the normal load gn that presses it against the film.
 * `frameFromMatrices` derives all of it from the pouch's world matrices; the world applies the uniform part to every
 * body and the omega / alpha parts per body (`apparentAccelInto`).
 *
 * Only the rotation about the pouch normal enters the per-body terms (Frame carries scalar omega / alpha); the
 * acceleration of the pouch origin already contains the swing of a page that hinges about an in-plane axis.
 */
import { G } from "../constants";

/**
 * Apparent acceleration of the pouch frame (m/s^2, pouch-plane axes at the pouch origin), the normal load, and the
 * angular velocity / acceleration about the pouch normal (rad/s, rad/s^2; counter-clockwise seen from the front is positive).
 */
export type Frame = { ax: number; ay: number; gn: number; omega: number; alpha: number };

/** Column-major 4x4 matrix as three.js stores it: columns 0..2 are the local axes in world space, 12..14 the origin. */
export type Matrix4Like = ArrayLike<number>;

export type Vec3 = readonly [number, number, number];

/** Pouch lying flat and still: no in-plane push, the film carries the full weight. */
export function restFrame(): Frame {
  return { ax: 0, ay: 0, gn: G, omega: 0, alpha: 0 };
}

export type FrameOptions = {
  /** World gravity. Default (0, -9.81, 0), y up as in three.js. */
  gravity?: Vec3;
  /** Metres per matrix unit (the book scene uses 0.1 m per unit). Default 1. */
  unit?: number;
  /** Low-pass window over the differenced quantities, in ms. Default 25. */
  smoothMs?: number;
  /** Spike clamps. Defaults: 5 g, 200 rad/s^2, 60 rad/s. */
  maxAccelG?: number;
  maxAlpha?: number;
  maxOmega?: number;
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ZERO: Vec3 = [0, 0, 0];

/**
 * Reference derivation in 3D: apparent acceleration of a point at offset `r` (world axes) of a frame whose local axes
 * are `axes`, moving with acceleration `aFrame` and rotating with `omega` / `alpha`.
 * `gn` is |g_app . ez|: an upside-down pouch is held by the front film, which presses just as hard.
 */
export function pocketAccel(axes: { ex: Vec3; ey: Vec3; ez: Vec3 }, aFrame: Vec3, omega: Vec3, alpha: Vec3, r: Vec3, g: Vec3 = [0, -G, 0]) {
  const app = sub(sub(sub(g, aFrame), cross(alpha, r)), cross(omega, cross(omega, r)));
  return { ax: dot(app, axes.ex), ay: dot(app, axes.ey), gn: Math.abs(dot(app, axes.ez)) };
}

/**
 * Extra in-plane acceleration of a body at pouch point (rx, ry) moving at (vx, vy), on top of the uniform (frame.ax, frame.ay):
 * Euler (-alpha x r), centrifugal (-omega x (omega x r)) and Coriolis (-2 omega x v) terms for rotation about the pouch normal.
 */
export function apparentAccelInto(out: { ax: number; ay: number }, f: Frame, rx: number, ry: number, vx = 0, vy = 0): void {
  const w2 = f.omega * f.omega;
  out.ax = f.ax + f.alpha * ry + w2 * rx + 2 * f.omega * vy;
  out.ay = f.ay - f.alpha * rx + w2 * ry - 2 * f.omega * vx;
}

type Pose = { r: number[]; p: [number, number, number] };

/** Rotation (row-major, r[i * 3 + j] = component i of local axis j, columns normalised so a scaled matrix still works) and translation in metres. */
function poseOf(m: Matrix4Like, unit: number): Pose {
  const r = new Array<number>(9);
  for (let c = 0; c < 3; c++) {
    const x = m[c * 4] ?? 0, y = m[c * 4 + 1] ?? 0, z = m[c * 4 + 2] ?? 0;
    const l = Math.hypot(x, y, z) || 1;
    r[c] = x / l;
    r[3 + c] = y / l;
    r[6 + c] = z / l;
  }
  return { r, p: [(m[12] ?? 0) * unit, (m[13] ?? 0) * unit, (m[14] ?? 0) * unit] };
}

/** World-frame angular velocity that rotates pose `a` into pose `b` over `dt` (exact log map, valid below 180 degrees per step). */
function angularVelocity(a: Pose, b: Pose, dt: number): Vec3 {
  // dR = Rb * Ra^T
  const d = (i: number, j: number) => b.r[i * 3]! * a.r[j * 3]! + b.r[i * 3 + 1]! * a.r[j * 3 + 1]! + b.r[i * 3 + 2]! * a.r[j * 3 + 2]!;
  const vx = (d(2, 1) - d(1, 2)) / 2, vy = (d(0, 2) - d(2, 0)) / 2, vz = (d(1, 0) - d(0, 1)) / 2;
  const s = Math.hypot(vx, vy, vz);
  const k = s > 1e-12 ? Math.atan2(s, (d(0, 0) + d(1, 1) + d(2, 2) - 1) / 2) / s : 1;
  return [(vx * k) / dt, (vy * k) / dt, (vz * k) / dt];
}

function clampLen(v: Vec3, max: number): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > max ? [(v[0] * max) / l, (v[1] * max) / l, (v[2] * max) / l] : v;
}

/**
 * Frame of the pouch from the history of its world matrices, oldest first, one per `dt` seconds (uniform spacing).
 *  - 1 matrix: orientation only (gravity split into plane and normal, no motion terms);
 *  - 2 matrices: adds the angular velocity;
 *  - 3 or more: adds the frame acceleration (second difference) and the angular acceleration.
 * The differenced quantities are averaged over the last `smoothMs` (25 ms) of the history, a boxcar low-pass that keeps
 * this function stateless, and spikes are clamped (5 g, 200 rad/s^2, 60 rad/s).
 */
export function frameFromMatrices(history: readonly Matrix4Like[], dt: number, opts: FrameOptions = {}): Frame {
  const n = history.length;
  if (n === 0) return restFrame();
  const unit = opts.unit ?? 1;
  const g = opts.gravity ?? ([0, -G, 0] as const);
  const poses = history.map((m) => poseOf(m, unit));
  const last = poses[n - 1]!;
  const axes = { ex: [last.r[0]!, last.r[3]!, last.r[6]!] as Vec3, ey: [last.r[1]!, last.r[4]!, last.r[7]!] as Vec3, ez: [last.r[2]!, last.r[5]!, last.r[8]!] as Vec3 };
  if (!(dt > 0) || !Number.isFinite(dt)) {
    const { ax, ay, gn } = pocketAccel(axes, ZERO, ZERO, ZERO, ZERO, g);
    return { ax, ay, gn, omega: 0, alpha: 0 };
  }
  const M = Math.max(1, Math.round((opts.smoothMs ?? 25) / 1000 / dt));

  // angular velocity series: w[k] rotates pose k-1 into pose k
  const w: Vec3[] = [ZERO];
  for (let k = 1; k < n; k++) w.push(angularVelocity(poses[k - 1]!, poses[k]!, dt));

  const avg = (get: (k: number) => Vec3, lo: number, hi: number): Vec3 => {
    lo = Math.max(lo, 0);
    if (hi < lo) return ZERO;
    let x = 0, y = 0, z = 0;
    for (let k = lo; k <= hi; k++) {
      const v = get(k);
      x += v[0]; y += v[1]; z += v[2];
    }
    const c = hi - lo + 1;
    return [x / c, y / c, z / c];
  };
  const omegaV = n >= 2 ? avg((k) => w[k]!, Math.max(1, n - M), n - 1) : ZERO;
  const alphaV = n >= 3 ? avg((k) => [(w[k]![0] - w[k - 1]![0]) / dt, (w[k]![1] - w[k - 1]![1]) / dt, (w[k]![2] - w[k - 1]![2]) / dt], Math.max(2, n - M), n - 1) : ZERO;
  const aFrame = n >= 3
    ? avg((k) => {
        const a = poses[k - 1]!.p, b = poses[k]!.p, c = poses[k + 1]!.p, d = dt * dt;
        return [(c[0] - 2 * b[0] + a[0]) / d, (c[1] - 2 * b[1] + a[1]) / d, (c[2] - 2 * b[2] + a[2]) / d];
      }, Math.max(1, n - 1 - M), n - 2)
    : ZERO;

  const { ax, ay, gn } = pocketAccel(axes, clampLen(aFrame, (opts.maxAccelG ?? 5) * G), ZERO, ZERO, ZERO, g);
  const clamp = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
  return { ax, ay, gn, omega: clamp(dot(omegaV, axes.ez), opts.maxOmega ?? 60), alpha: clamp(dot(alphaV, axes.ez), opts.maxAlpha ?? 200) };
}

/**
 * Keeps the last few world matrices of the pouch (copied, because three.js mutates `matrixWorld` in place) and turns
 * them into a Frame. Call `push` once per rendered frame with that frame's dt.
 */
export function createFrameTracker(opts: FrameOptions = {}) {
  const CAP = 8;
  const ring: Float64Array[] = [];
  return {
    push(matrix: Matrix4Like, dt: number): Frame {
      const slot = ring.length < CAP ? new Float64Array(16) : ring.shift()!;
      for (let i = 0; i < 16; i++) slot[i] = matrix[i] ?? 0;
      ring.push(slot);
      return frameFromMatrices(ring, dt, opts);
    },
    reset() {
      ring.length = 0;
    },
  };
}
