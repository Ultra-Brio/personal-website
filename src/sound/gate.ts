/*
 * Pure decision logic for the sound kit (no Web Audio, no DOM), unit-tested with a fake clock.
 *   - impactLevel: contact speed (m/s) -> voice gain, with a soft curve in decibels.
 *   - createImpactGate: per-material debounce so a resting contact never machine-guns.
 *   - createVoicePool: hard cap on simultaneous voices; impacts steal only quieter voices, UI sounds always get through.
 * All times are seconds on whatever clock the caller uses (the kit uses AudioContext.currentTime).
 */

export type Material = "paper" | "card" | "plastic" | "metal" | "vinyl";
export const MATERIALS: readonly Material[] = ["paper", "card", "plastic", "metal", "vinyl"];

/** Contacts slower than this make no sound (m/s). */
export const MIN_SPEED = 0.15;
/** Speed at which the curve saturates: the pouch sim caps a released body at 2.4 m/s. */
export const MAX_SPEED = 2.4;
/** Level at MIN_SPEED, in dB relative to a full-speed hit. */
export const FLOOR_DB = -30;
/** Per-material debounce (s). Soft materials blur together, so they wait longer. */
export const DEBOUNCE: Readonly<Record<Material, number>> = { paper: 0.09, card: 0.075, plastic: 0.065, metal: 0.06, vinyl: 0.085 };
/** Inside the debounce window a contact still sounds when it is at least this many times faster than the last one (a graze then a real hit). */
export const OVERRIDE_RATIO = 2;
export const MAX_VOICES = 6;

/** 0..1 position on the speed curve, eased out so the top end saturates gently. 0 below MIN_SPEED. */
export function impactAmount(speed: number): number {
  if (!(speed >= MIN_SPEED)) return 0;
  const x = Math.min(1, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
  return 1 - (1 - x) * (1 - x);
}

/** Linear gain for a contact speed: 0 below MIN_SPEED, FLOOR_DB at the threshold, 1 at MAX_SPEED and above. */
export function impactLevel(speed: number): number {
  if (!(speed >= MIN_SPEED)) return 0;
  return Math.pow(10, (FLOOR_DB * (1 - impactAmount(speed))) / 20);
}

export type ImpactGate = {
  /** Returns the voice level for this contact, or 0 when it is gated (too slow, or inside the material's debounce window). */
  admit(material: Material, speed: number, now: number): number;
  reset(): void;
};

export function createImpactGate(debounce: Readonly<Record<Material, number>> = DEBOUNCE): ImpactGate {
  const last = new Map<Material, { t: number; speed: number }>();
  return {
    admit(material, speed, now) {
      const level = impactLevel(speed);
      if (level <= 0) return 0;
      const prev = last.get(material);
      if (prev && now - prev.t < debounce[material] && speed < prev.speed * OVERRIDE_RATIO) return 0;
      last.set(material, { t: now, speed });
      return level;
    },
    reset() {
      last.clear();
    },
  };
}

export type VoiceHandle = { level: number; start: number; end: number; stop(at: number): void };

export type VoicePool = {
  /**
   * Try to start a voice. When the pool is full, `force` (UI sounds) steals the oldest voice; otherwise the quietest
   * voice is stolen only if the newcomer is louder, else the newcomer is dropped. Returns false when dropped.
   */
  claim(v: VoiceHandle, now: number, force?: boolean): boolean;
  /** Voices still sounding at `now`. */
  active(now: number): number;
  clear(): void;
};

export function createVoicePool(max = MAX_VOICES): VoicePool {
  let voices: VoiceHandle[] = [];
  const prune = (now: number) => {
    if (voices.some((v) => v.end <= now)) voices = voices.filter((v) => v.end > now);
  };
  return {
    claim(v, now, force = false) {
      prune(now);
      if (voices.length >= max) {
        let victim = 0;
        for (let i = 1; i < voices.length; i++) {
          const a = voices[i]!;
          const b = voices[victim]!;
          if (force ? a.start < b.start : a.level < b.level || (a.level === b.level && a.start < b.start)) victim = i;
        }
        const target = voices[victim]!;
        if (!force && v.level <= target.level) return false;
        target.stop(now);
        voices.splice(victim, 1);
      }
      voices.push(v);
      return true;
    },
    active(now) {
      prune(now);
      return voices.length;
    },
    clear() {
      voices = [];
    },
  };
}
