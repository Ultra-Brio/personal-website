/*
 * The audio graph, independent of how the context was obtained, so the live kit and the harnesses (offline renders, the
 * audition page) play through exactly the same chain:
 *
 *   buffer source (rate) -> voice gain (level) -> [stereo panner] -> bus: highpass 30 Hz -> compressor -> master gain -> destination
 *
 * Voices are capped by the pool (gate.ts); impacts go through the per-material gate first. Every play picks a recorded
 * variant (never the one this slot played last), nudges its rate by up to ±3 % and drops its level by up to 1.5 dB, so a
 * repeated gesture never sounds like a loop.
 *
 * Warm-up: a fresh DynamicsCompressorNode starts fully clamped and opens over about its release time (measured in Chrome:
 * -13 dB at 5 ms, -3 dB at 40 ms, settled by ~120 ms). The context is created inside the visitor's first gesture and that
 * gesture's sound plays at once, so for the first WARMUP seconds the bus bypasses the compressor through a path matched to
 * it in delay (its 6 ms look-ahead) and level (its automatic makeup gain), then crossfades to it. Below the threshold the
 * two paths are sample-identical, so the switch is inaudible.
 */

import { impactBankOf, impactKey, pickVariant, soundKey, tierOf, type Bank, type Clip, type SoundName } from "./bank";
import { createImpactGate, createVoicePool, impactAmount, MAX_VOICES, type Material, type VoiceHandle } from "./gate";

export type PlayOptions = { /** 0..1, multiplies the designed level */ gain?: number; /** pitch and speed, 0.5..2 */ rate?: number; /** -1 (left) .. 1 (right) */ pan?: number };

export const DEFAULT_VOLUME = 0.8;
/** Random rate change per play (±, as a fraction). */
export const RATE_JITTER = 0.03;
/** Random level drop per play, up to this many dB (never louder than designed). */
export const LEVEL_JITTER_DB = 1.5;
/** Scheduling lead on a live context, so no voice starts in the past (s). */
export const LEAD = 0.008;
/** Fade applied to a stolen voice (s). */
const STEAL_FADE = 0.012;
/** Compressor bypass after the engine is created, then the crossfade to the compressor (s). */
export const WARMUP = 0.2;
const XFADE = 0.03;
/** The compressor kernel's look-ahead (s; Blink/WebKit/Gecko all use 6 ms, floored to whole frames). */
const COMP_LOOKAHEAD = 0.006;
/** Its automatic makeup gain for the settings below (dB, measured: constant below the threshold). */
export const COMP_MAKEUP_DB = 2.45;

export type Engine = {
  /** Schedule a sound at `at` (context time; default now + LEAD). Returns the variant it plays, or null (not loaded, gain 0, pool full). */
  play(name: SoundName, o?: PlayOptions, at?: number): Clip | null;
  /** Schedule a contact sound. Returns the variant, or null when gated (slow, debounced), not loaded, or dropped by the pool. */
  impact(speed: number, material: Material, pan?: number, at?: number): Clip | null;
  /** Ramp the master gain (s). */
  setVolume(volume: number, ramp?: number): void;
  /** Voices still sounding. */
  voices(): number;
  /** Where a steady source (the room's ambience) joins: the master gain, after the compressor, so the bed never makes the foley pump. */
  readonly master: AudioNode;
  dispose(): void;
};

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const finite = (x: number | undefined, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const db = (d: number) => Math.pow(10, d / 20);

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEngine(ac: BaseAudioContext, bank: Pick<Bank, "clips">, o: { volume?: number; rnd?: () => number; maxVoices?: number } = {}): Engine {
  const rnd = o.rnd ?? Math.random;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 30;
  hp.Q.value = 0.707;
  const comp = ac.createDynamicsCompressor();
  // A safety net for stacked voices, not a sound shaper: single sounds are levelled to stay below the knee, because
  // compressing them would pump their decays flat (the node also adds COMP_MAKEUP_DB of automatic makeup gain).
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  const master = ac.createGain();
  master.gain.value = clamp(finite(o.volume, DEFAULT_VOLUME), 0, 1);
  // Warm-up bypass (see the header): delay- and level-matched to the compressor, crossfaded out once it has opened.
  const t0 = ac.currentTime;
  const bypassDelay = ac.createDelay(0.05);
  bypassDelay.delayTime.value = Math.floor(COMP_LOOKAHEAD * ac.sampleRate) / ac.sampleRate;
  const bypass = ac.createGain();
  const makeup = db(COMP_MAKEUP_DB);
  bypass.gain.setValueAtTime(makeup, t0);
  bypass.gain.setValueAtTime(makeup, t0 + WARMUP);
  bypass.gain.linearRampToValueAtTime(0, t0 + WARMUP + XFADE);
  const wet = ac.createGain();
  wet.gain.setValueAtTime(0, t0);
  wet.gain.setValueAtTime(0, t0 + WARMUP);
  wet.gain.linearRampToValueAtTime(1, t0 + WARMUP + XFADE);
  hp.connect(comp);
  comp.connect(wet);
  wet.connect(master);
  hp.connect(bypassDelay);
  bypassDelay.connect(bypass);
  bypass.connect(master);
  master.connect(ac.destination);
  // Drop the bypass branch once it is silent, so it costs nothing afterwards. Checked lazily on the context clock (a context
  // that is still suspended has not warmed up, however much wall time has passed).
  let bypassed = true;
  const settle = () => {
    if (!bypassed || ac.currentTime < t0 + WARMUP + XFADE + 0.05) return;
    bypassed = false;
    try {
      hp.disconnect(bypassDelay);
      bypassDelay.disconnect();
      bypass.disconnect();
    } catch {
      // already gone
    }
  };
  const pool = createVoicePool(o.maxVoices ?? MAX_VOICES);
  const gate = createImpactGate();
  const last = new Map<string, Clip>();

  function voice(clip: Clip, level: number, pan: number, rate: number, t: number, force: boolean): boolean {
    const g = ac.createGain();
    g.gain.value = level;
    const src = ac.createBufferSource();
    const handle: VoiceHandle = {
      level,
      start: t,
      end: t + clip.duration / rate,
      stop(at) {
        const s = Math.max(at, ac.currentTime);
        g.gain.cancelScheduledValues(s);
        g.gain.setValueAtTime(level, s);
        g.gain.linearRampToValueAtTime(0, s + STEAL_FADE);
        try {
          src.stop(s + STEAL_FADE + 0.002);
        } catch {
          // already stopped
        }
      },
    };
    if (!pool.claim(handle, t, force)) return false;
    src.buffer = clip.buffer;
    src.playbackRate.value = rate;
    src.connect(g);
    let out: AudioNode = g;
    // Always pan (when supported) so the level law is the same everywhere: centre = -3 dB per channel, hard left/right = 0 dB.
    if (typeof ac.createStereoPanner === "function") {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(hp);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (out !== g) out.disconnect();
    };
    src.start(t, clip.offset, clip.duration);
    return true;
  }

  /** A variant of the slot, never the one it played last; remembered only once it actually sounds. */
  const choose = (key: string) => pickVariant(bank.clips(key), last.get(key), rnd);
  const now = () => ac.currentTime + LEAD;
  const rateJitter = () => 1 + (rnd() * 2 - 1) * RATE_JITTER;
  const levelJitter = () => db(-rnd() * LEVEL_JITTER_DB);

  return {
    play(name, opts = {}, at) {
      settle();
      const gain = clamp(finite(opts.gain, 1), 0, 1);
      if (gain <= 0) return null;
      const key = soundKey(name);
      const clip = choose(key);
      if (!clip) return null;
      const rate = clamp(finite(opts.rate, 1), 0.5, 2) * rateJitter();
      if (!voice(clip, gain * clip.gain * levelJitter(), clamp(finite(opts.pan, 0), -1, 1), rate, at ?? now(), true)) return null;
      last.set(key, clip);
      return clip;
    },
    impact(speed, material, pan = 0, at) {
      settle();
      const t = at ?? now();
      const lv = gate.admit(material, finite(speed, 0), t);
      if (lv <= 0) return null;
      const key = impactKey(impactBankOf(material), tierOf(impactAmount(speed)));
      const clip = choose(key);
      if (!clip || !voice(clip, lv * clip.gain * levelJitter(), clamp(finite(pan, 0), -1, 1), rateJitter(), t, false)) return null;
      last.set(key, clip);
      return clip;
    },
    setVolume(volume, ramp = 0.02) {
      const t = ac.currentTime;
      const v = clamp(finite(volume, 0), 0, 1);
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(v, t + Math.max(0.001, ramp));
    },
    voices() {
      return pool.active(ac.currentTime);
    },
    master,
    dispose() {
      pool.clear();
      gate.reset();
      last.clear();
      master.disconnect();
    },
  };
}
