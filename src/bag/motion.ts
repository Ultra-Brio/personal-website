/*
 * Device motion for the pouch: the phone IS the pouch. Real gravity (and the hand's shake) replaces the desk's.
 *
 *   enableMotion()          call inside a user gesture (iOS asks for permission there; HTTPS only). Starts one shared
 *                           `devicemotion` listener for the whole page and resolves "granted" | "denied" | "unsupported".
 *   subscribeMotion(fn)     every pouch addon subscribes; `fn` runs when the filtered reading changed enough to matter.
 *   motionReading()         the latest filtered reading, or null while motion is off / not calibrated yet.
 *
 * Pipeline per sensor sample (pure functions below, unit-tested):
 *   accelerationIncludingGravity (device axes)  -> deviceToScreen (screen.orientation aware)
 *   -> sign calibration from the first resting sample (platforms disagree on the sign: W3C reports the reaction to gravity,
 *      some WebKit builds report gravity itself)  -> apparent gravity, i.e. the direction loose things fall
 *   -> low-pass (tau 0.14 s) = gravity, with a small hysteresis so hand tremor does not keep the sim awake;
 *      residual = shake, through a dead band and a gain (wrists move little, the pouch should still tumble).
 *
 * Screen axes: x right, y up, z out of the screen toward the viewer. The pouch on screen has the same axes (the folio is
 * seen from above, zip at the top), so the reading is used as pouch-frame apparent gravity directly.
 */
import { G } from "./constants";

export type MotionStatus = "granted" | "denied" | "unsupported";
export type Vec3 = { x: number; y: number; z: number };

/** Filtered reading in screen / pouch axes, m/s^2. `gravity` + `shake` is the apparent acceleration loose objects feel. */
export type MotionReading = { gravity: Vec3; shake: Vec3; t: number };

/** Low-pass time constant of the gravity estimate (s). */
export const GRAVITY_TAU = 0.14;
/** The published gravity moves only when the low-passed one drifted this far from it (m/s^2, about 0.8 degree). */
export const GRAVITY_STEP = 0.14;
/** Shake dead band and gain (m/s^2, factor). */
export const SHAKE_DEAD = 0.7;
export const SHAKE_GAIN = 1.6;

/**
 * Device axes (x right, y toward the top, z out of the screen, in the device's natural portrait orientation) to screen
 * axes for a screen rotated by `angle` degrees (screen.orientation.angle: 0, 90, 180, 270; window.orientation's -90 = 270).
 */
export function deviceToScreen(v: Vec3, angle: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  const { x, y, z } = v;
  if (a === 90) {
    out.x = -y;
    out.y = x;
  } else if (a === 180) {
    out.x = -x;
    out.y = -y;
  } else if (a === 270) {
    out.x = y;
    out.y = -x;
  } else {
    out.x = x;
    out.y = y;
  }
  out.z = z;
  return out;
}

/** A sample counts as resting when its magnitude is close to g. */
export function isResting(v: Vec3): boolean {
  const m = Math.hypot(v.x, v.y, v.z);
  return m > G * 0.88 && m < G * 1.12;
}

/**
 * Sign that turns a raw reading (screen axes) into apparent gravity, from a resting sample: someone looking at a phone
 * holds it top-up and screen toward them, so gravity points to the screen's bottom (-y) and out of its back (-z).
 * The W3C reading at rest is the reaction (+y / +z), so its sign is -1; platforms that report gravity itself get +1.
 * Decided on the larger of the y and z components (x carries no sign information: phones are rolled both ways).
 */
export function calibrateSign(screen: Vec3): 1 | -1 {
  const d = Math.abs(screen.y) >= Math.abs(screen.z) ? screen.y : screen.z;
  return d >= 0 ? -1 : 1;
}

/** Shake residual through the dead band and gain (soft knee: continuous at the dead band). */
export function shapeShake(r: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const m = Math.hypot(r.x, r.y, r.z);
  const k = m > SHAKE_DEAD ? (SHAKE_GAIN * (m - SHAKE_DEAD)) / m : 0;
  out.x = r.x * k;
  out.y = r.y * k;
  out.z = r.z * k;
  return out;
}

/**
 * The per-sample filter (pure state machine, no DOM). `push` returns true when the published reading changed enough that
 * a stopped render loop should wake up (gravity moved past the hysteresis step, or a shake is going on).
 */
export function createMotionFilter() {
  let sign: 1 | -1 | 0 = 0;
  let rest = 0;
  const prev: Vec3 = { x: 0, y: 0, z: 0 };
  const lp: Vec3 = { x: 0, y: 0, z: 0 };
  const scr: Vec3 = { x: 0, y: 0, z: 0 };
  const res: Vec3 = { x: 0, y: 0, z: 0 };
  const reading: MotionReading = { gravity: { x: 0, y: 0, z: -G }, shake: { x: 0, y: 0, z: 0 }, t: 0 };
  let shaking = false;
  return {
    /** Raw accelerationIncludingGravity in device axes, the screen angle (degrees), seconds since the last sample, a timestamp (s). */
    push(raw: Vec3, angle: number, dt: number, t: number): boolean {
      if (!Number.isFinite(raw.x + raw.y + raw.z)) return false;
      deviceToScreen(raw, angle, scr);
      if (sign === 0) {
        // calibrate on the first sample that is resting and steady (3 in a row within 0.4 m/s^2 of each other)
        const steady = isResting(scr) && Math.hypot(scr.x - prev.x, scr.y - prev.y, scr.z - prev.z) < 0.4;
        prev.x = scr.x;
        prev.y = scr.y;
        prev.z = scr.z;
        rest = steady ? rest + 1 : 0;
        if (rest < 3) return false;
        sign = calibrateSign(scr);
        lp.x = sign * scr.x;
        lp.y = sign * scr.y;
        lp.z = sign * scr.z;
        Object.assign(reading.gravity, lp);
        reading.t = t;
        return true;
      }
      const ax = sign * scr.x, ay = sign * scr.y, az = sign * scr.z;
      const k = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.2)) / GRAVITY_TAU);
      lp.x += (ax - lp.x) * k;
      lp.y += (ay - lp.y) * k;
      lp.z += (az - lp.z) * k;
      res.x = ax - lp.x;
      res.y = ay - lp.y;
      res.z = az - lp.z;
      shapeShake(res, reading.shake);
      reading.t = t;
      const g = reading.gravity;
      let changed = false;
      if (Math.hypot(lp.x - g.x, lp.y - g.y, lp.z - g.z) > GRAVITY_STEP) {
        Object.assign(g, lp);
        changed = true;
      }
      const sh = reading.shake.x !== 0 || reading.shake.y !== 0 || reading.shake.z !== 0;
      if (sh || shaking) changed = true; // also the sample where a shake ends, so the last residual is cleared downstream
      shaking = sh;
      return changed;
    },
    /** Null until calibrated. The object is reused: read it, do not keep it. */
    reading(): MotionReading | null {
      return sign === 0 ? null : reading;
    },
    sign: () => sign,
    reset() {
      sign = 0;
      rest = 0;
      shaking = false;
    },
  };
}

/* ── the page-wide listener ── */

type DeviceMotionEventIOS = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

const filter = createMotionFilter();
const subscribers = new Set<() => void>();
let listening = false;
/** Motion was granted and not turned off: the listener runs whenever a pouch is alive (it stops while none is). */
let wanted = false;
let lastStamp = 0;
let firstSample: (() => void) | null = null;

function screenAngle(): number {
  const so = typeof screen !== "undefined" ? screen.orientation : undefined;
  if (so && typeof so.angle === "number") return so.angle;
  const wo = (globalThis as { orientation?: unknown }).orientation;
  return typeof wo === "number" ? wo : 0;
}

function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x === null || a.y === null || a.z === null) return;
  const now = performance.now() / 1000;
  const dt = lastStamp ? now - lastStamp : (e.interval || 16) / 1000;
  lastStamp = now;
  firstSample?.();
  if (filter.push({ x: a.x, y: a.y, z: a.z }, screenAngle(), dt, now)) for (const fn of subscribers) fn();
}

/**
 * Turn device motion on (idempotent). Must be called from a user gesture (a click / tap handler): iOS shows its
 * permission prompt there and refuses otherwise. Resolves "unsupported" without a secure context, without the API,
 * or when no sensor sample arrives within a second (desktops).
 */
export function enableMotion(): Promise<MotionStatus> {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined" || !window.isSecureContext) return Promise.resolve("unsupported");
  if (listening) return Promise.resolve("granted");
  if (wanted) {
    if (subscribers.size) start();
    return Promise.resolve("granted");
  }
  const DME = DeviceMotionEvent as DeviceMotionEventIOS;
  // iOS 13+: requestPermission has to be the first thing the gesture handler does (no await before it)
  const ask = typeof DME.requestPermission === "function" ? DME.requestPermission().catch(() => "denied" as const) : Promise.resolve("granted" as const);
  return ask.then((p) => {
    if (p !== "granted") return "denied" as const;
    return new Promise<MotionStatus>((resolve) => {
      const timer = setTimeout(() => {
        firstSample = null;
        stop();
        resolve("unsupported");
      }, 1000);
      firstSample = () => {
        firstSample = null;
        clearTimeout(timer);
        wanted = true;
        resolve("granted");
      };
      start();
    });
  });
}

function start() {
  if (listening) return;
  listening = true;
  lastStamp = 0;
  filter.reset();
  // the screen angle is read per sample (the sign is a platform property and survives a rotation)
  window.addEventListener("devicemotion", onMotion);
}

function stop() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("devicemotion", onMotion);
  filter.reset();
  for (const fn of subscribers) fn();
}

/** Turn device motion off again (the pouch falls back to the desk's gravity). */
export function disableMotion(): void {
  wanted = false;
  stop();
}

/** Whether device motion is on (granted and listening). */
export function motionEnabled(): boolean {
  return listening;
}

/** Latest filtered reading, or null while motion is off or not calibrated yet (screen / pouch axes, m/s^2). */
export function motionReading(): MotionReading | null {
  return listening ? filter.reading() : null;
}

/**
 * Called when the reading changed enough to matter (and once when motion stops). Returns the unsubscribe function.
 * The page-wide listener only runs while someone is subscribed: it stops with the last pouch and resumes (no new
 * permission prompt) when the next one subscribes, as long as motion was granted and not disabled.
 */
export function subscribeMotion(fn: () => void): () => void {
  subscribers.add(fn);
  if (wanted && !listening) start();
  return () => {
    if (!subscribers.delete(fn)) return;
    if (subscribers.size === 0 && listening) {
      listening = false;
      window.removeEventListener("devicemotion", onMotion);
      filter.reset();
    }
  };
}
