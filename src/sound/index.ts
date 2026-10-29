/*
 * A small sound kit that makes the folio feel tactile: recorded foley (public/sounds, see scripts/sounds) played through Web Audio.
 *
 *   const sound = createSoundKit();
 *   sound.play("pageTurn", { pan: -0.3 });
 *   sound.impact(state.speed, "card", pan);    // from pouch contacts, velocity-gated and debounced
 *   sound.setMuted(!sound.muted);              // persisted; call it from the toggle's click handler
 *
 * The AudioContext is made ahead of the first gesture, in a quiet moment after the page has come up (PREWARM_AFTER, then an idle
 * period long enough that nothing is animating): constructing one costs Chrome about 0.4 s of main thread (the audio device), and
 * inside the gesture that froze the first drag or click. Made then it starts suspended (autoplay policy), the sound files are
 * fetched and decoded, and the first gesture (the kit listens for pointerdown / touchend / click / keydown itself; hosts may also
 * call unlock() from their own handlers) only resumes it. Where the page offers no timer (or no quiet moment comes) the context
 * is made inside the first gesture, as before. Nothing plays before a gesture, and nothing is created or fetched at all while
 * muted; muting later fades out and suspends the context. Default: on for a fine (desktop) pointer, off for touch-first
 * devices, unless the visitor chose. A sound asked for while its files are still loading plays when they arrive if that is
 * within LATE seconds, else never. Once unlocked, the room's ambience (ambient.ts: a breeze in the leaves, a bird now and then)
 * fades in under the foley; it fades out when muted or while the page is hidden, and is never fetched for a visitor who asked to
 * save data (or with `ambient: false`).
 */

import { createAmbient, type Ambient } from "./ambient";
import { loadBank, soundKey, type Bank, type SoundName } from "./bank";
import { createEngine, DEFAULT_VOLUME, type Engine, type PlayOptions } from "./engine";
import type { Material } from "./gate";
import type { ItemKind } from "../profile/schema";

export type { Material } from "./gate";
export type { SoundName } from "./bank";
export type { PlayOptions } from "./engine";
export { MATERIALS, MIN_SPEED, MAX_SPEED } from "./gate";
export { SOUND_NAMES } from "./bank";

export type SoundKit = {
  /** Create/resume the AudioContext. Must run inside a user gesture; the kit also does this on its own listeners. */
  unlock(): void;
  play(name: SoundName, o?: PlayOptions): void;
  /** A contact: ignored below MIN_SPEED (m/s), louder and firmer with speed, debounced per material, at most 6 voices. */
  impact(speed: number, material: Material, pan?: number): void;
  readonly muted: boolean;
  setMuted(m: boolean): void;
  dispose(): void;
};

export const STORAGE_KEY = "sasshi:sound";
const GESTURES = ["pointerdown", "touchend", "click", "keydown"] as const;

/** The material each pouch item sounds like when it knocks into something. */
export function materialOf(kind: ItemKind): Material {
  switch (kind) {
    case "card":
    case "ticket":
    case "polaroid":
      return "card";
    case "resume":
    case "note":
      return "paper";
  }
}

type AudioCtor = new (o?: AudioContextOptions) => AudioContext;
type Env = {
  window?: Pick<Window, "addEventListener" | "removeEventListener"> & {
    matchMedia?: Window["matchMedia"];
    setTimeout?: (fn: () => void, ms: number) => number;
    clearTimeout?: (id: number) => void;
    requestIdleCallback?: (fn: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  AudioContext?: AudioCtor;
  webkitAudioContext?: AudioCtor;
  navigator?: { audioSession?: { type: string }; userActivation?: { isActive: boolean }; connection?: { saveData?: boolean } };
  document?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  fetch?: (url: string) => Promise<Response>;
};
/** Without navigator.userActivation, a gesture counts as current for this long (ms). */
const GESTURE_WINDOW = 300;
/** Muting fades the master out over this long, then suspends the context (ms). */
const MUTE_SUSPEND_DELAY = 80;
/** A sound whose files arrive this soon after it was asked for still plays (ms); later it would feel detached. */
export const LATE = 250;
/**
 * The context is made ahead of the first gesture no sooner than this after the kit (ms): the page's own start (the folio's build, its
 * cover swinging open) comes first. Then it waits for a quiet moment: an idle period of at least PREWARM_QUIET ms (the browser
 * offers that much only while nothing animates), looked for every PREWARM_RETRY ms, for at most PREWARM_GIVE_UP ms.
 */
export const PREWARM_AFTER = 2500;
export const PREWARM_QUIET = 40;
const PREWARM_RETRY = 300;
const PREWARM_GIVE_UP = 30000;
const env = () => globalThis as unknown as Env;

/** Where the sound files live: the app's base URL + "sounds/" (Vite sets BASE_URL; under bun test it is unset). */
const defaultBase = () => `${import.meta.env.BASE_URL ?? "/"}sounds/`;

function readStored(): boolean | null {
  try {
    const v = env().localStorage?.getItem(STORAGE_KEY);
    return v === "on" ? false : v === "off" ? true : null;
  } catch {
    return null;
  }
}

function defaultMuted(): boolean {
  try {
    return !env().window?.matchMedia?.("(pointer: fine)").matches;
  } catch {
    return true;
  }
}

/**
 * `ambient` (default true): the room's ambience under the foley (ambient.ts) — the breeze and a bird now and then. It follows the
 * kit (on, unlocked) and fades out while the page is hidden; a visitor who asked to save data never fetches it.
 */
export function createSoundKit(opts: { volume?: number; base?: string; ambient?: boolean } = {}): SoundKit {
  const volume = Math.min(1, Math.max(0, Number.isFinite(opts.volume) ? (opts.volume as number) : DEFAULT_VOLUME));
  const base = opts.base ?? defaultBase();
  let muted = readStored() ?? defaultMuted();
  let gestured = false;
  let gestureAt = -Infinity;
  let disposed = false;
  let ac: AudioContext | null = null;
  let engine: Engine | null = null;
  let bank: Bank | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  let ambient: Ambient | null = null;
  const ambientOn = opts.ambient !== false && !env().navigator?.connection?.saveData;

  /** The context, its engine and the files (fetched and decoded from here on). False when there is no Web Audio. */
  function make(): boolean {
    if (ac) return true;
    const e = env();
    const Ctor = e.AudioContext ?? e.webkitAudioContext;
    if (!Ctor) return false;
    try {
      // iOS 17+: mix with the visitor's music instead of interrupting it, and follow the ring/silent switch.
      if (e.navigator?.audioSession) e.navigator.audioSession.type = "ambient";
    } catch {
      // not supported
    }
    try {
      ac = new Ctor({ latencyHint: "interactive" });
      const f = e.fetch;
      bank = loadBank(ac, base, f ? (url) => f(url) : () => Promise.reject(new Error("no fetch")));
      engine = createEngine(ac, bank, { volume });
      return true;
    } catch {
      bank?.dispose();
      ac = null;
      engine = null;
      bank = null;
      return false;
    }
  }

  /** The room's ambience, while the kit is on and unlocked and the page is in view. */
  function room(): void {
    if (!ambientOn || disposed || muted || !gestured || !ac || !engine || env().document?.hidden) return;
    const f = env().fetch;
    ambient ??= createAmbient(ac, engine.master, base, f ? (url) => f(url) : () => Promise.reject(new Error("no fetch")));
    ambient.start();
  }
  const onVisibility = () => (env().document?.hidden ? ambient?.stop() : room());
  env().document?.addEventListener("visibilitychange", onVisibility);

  function ensure(): void {
    if (disposed || muted || !gestured) return;
    if (!make() || !ac) return;
    room();
    if (ac.state !== "running") {
      ac.resume().catch(() => {});
      try {
        // Older iOS Safari only unlocks output once a source has started inside the gesture: one silent frame.
        const s = ac.createBufferSource();
        s.buffer = ac.createBuffer(1, 1, ac.sampleRate);
        s.connect(ac.destination);
        s.start(0);
      } catch {
        // not needed
      }
    }
  }

  const onGesture = () => kit.unlock();
  const w = env().window;
  if (w) for (const g of GESTURES) w.addEventListener(g, onGesture, { capture: true, passive: true });

  // ahead of the first gesture: the context in a quiet moment (see PREWARM_AFTER). Only where the page has timers of its own.
  let prewarmTimer: number | undefined;
  let prewarmIdle: number | undefined;
  const prewarmFrom = Date.now();
  const prewarmDone = () => disposed || muted || ac !== null || Date.now() - prewarmFrom > PREWARM_GIVE_UP;
  const prewarm = () => {
    prewarmTimer = undefined;
    if (prewarmDone() || !w?.setTimeout) return;
    const ric = w.requestIdleCallback;
    // no idle callbacks (Safari): the timer's moment, after the page's start, is as quiet as it gets
    if (!ric) return void make();
    prewarmIdle = ric.call(w, (d) => {
      prewarmIdle = undefined;
      if (prewarmDone()) return;
      if (d.timeRemaining() >= PREWARM_QUIET) make();
      else prewarmTimer = w.setTimeout!.call(w, prewarm, PREWARM_RETRY);
    });
  };
  if (w?.setTimeout) prewarmTimer = w.setTimeout.call(w, prewarm, PREWARM_AFTER);

  /** Inside a gesture right now (transient user activation), or within GESTURE_WINDOW of one where that is not exposed. */
  const activated = () => {
    const ua = env().navigator?.userActivation;
    return ua ? ua.isActive : Date.now() - gestureAt < GESTURE_WINDOW;
  };

  const live = (): Engine | null => {
    // (a context made ahead of the gesture may be allowed to run at once — a site the visitor plays media on often: still silent)
    if (muted || disposed || !gestured || !engine || !ac) return null;
    if (ac.state === "running") return engine;
    // A context created or resumed in this gesture may report "suspended" until its first render quantum (Firefox, Safari).
    // Its clock is frozen, so a voice scheduled now starts the moment it runs. Outside a gesture nothing would start it, so
    // the sound is dropped rather than queued for a late burst.
    return ac.state === "suspended" && activated() ? engine : null;
  };

  const kit: SoundKit = {
    unlock() {
      if (disposed) return;
      gestured = true;
      gestureAt = Date.now();
      ensure();
    },
    play(name, o) {
      const e = live();
      if (!e || e.play(name, o) || !bank) return;
      const key = soundKey(name);
      if (bank.clips(key).length) return; // loaded, but refused (gain 0): nothing to wait for
      const asked = Date.now();
      const b = bank;
      b.loaded(key).then(() => {
        if (b === bank && Date.now() - asked <= LATE) live()?.play(name, o);
      });
    },
    impact(speed, material, pan) {
      live()?.impact(speed, material, pan);
    },
    get muted() {
      return muted;
    },
    setMuted(m) {
      muted = !!m;
      try {
        env().localStorage?.setItem(STORAGE_KEY, muted ? "off" : "on");
      } catch {
        // storage blocked: the choice lasts for this page only
      }
      engine?.setVolume(muted ? 0 : volume);
      clearTimeout(suspendTimer);
      if (muted) {
        ambient?.stop();
        // Fade out, then stop the audio thread while muted (battery). Unmuting resumes it, in the toggle's gesture.
        suspendTimer = setTimeout(() => {
          if (muted && ac?.state === "running") ac.suspend().catch(() => {});
        }, MUTE_SUSPEND_DELAY);
        return;
      }
      // The kit's capture listener has already seen the toggle's click, so a visitor who starts muted gets a context right
      // here, still inside that gesture. Called outside any gesture, this waits for the next one.
      ensure();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(suspendTimer);
      if (prewarmTimer !== undefined) w?.clearTimeout?.call(w, prewarmTimer);
      if (prewarmIdle !== undefined) w?.cancelIdleCallback?.call(w, prewarmIdle);
      if (w) for (const g of GESTURES) w.removeEventListener(g, onGesture, { capture: true });
      env().document?.removeEventListener("visibilitychange", onVisibility);
      ambient?.dispose();
      ambient = null;
      engine?.dispose();
      bank?.dispose();
      engine = null;
      bank = null;
      ac?.close().catch(() => {});
      ac = null;
    },
  };
  return kit;
}
