/*
 * The room under the foley (owner 2026-10-23): a morning breeze in the leaves outside the window, and now and then a distant bird.
 * public/sounds/ambient.json names the files (scripts/sounds/ambient.ts).
 *
 * The bed is one 30 s take played in passes that overlap by XFADE with equal-power fades, each pass from a random point of the take
 * to its end, so the swells never come round on a beat and no seam has to be sample-exact (AAC priming and padding sit inside a
 * fade). A bird phrase (never the one before) comes every BIRD_GAP seconds, a little to one side. Everything runs through one
 * gain that fades in on start() and out on stop(), into the kit's master after its compressor (a steady bed under it would make
 * the foley pump). Nothing is fetched before the first start(); nothing is scheduled more than LOOKAHEAD ahead, so a stop() is
 * quick and a hidden tab plays nothing.
 */

export type AmbientClip = { file: string; gainDb: number; duration: number };
export type AmbientManifest = { bed: AmbientClip; birds: AmbientClip[] };

/** Fade in when the room starts, out when it stops (s) */
export const FADE_IN = 3.5;
export const FADE_OUT = 1.2;
/** Overlap of two bed passes (s) */
export const XFADE = 4;
/** A pass starts this far into the take at most (fraction of its length) */
export const MAX_SKIP = 0.5;
/** Seconds between birds: the first comes after FIRST_BIRD, the rest every BIRD_GAP */
export const FIRST_BIRD: readonly [number, number] = [3, 6];
export const BIRD_GAP: readonly [number, number] = [10, 24];
/** How far to one side a bird may sing (stereo pan), and how much quieter than designed it may be (dB) */
const BIRD_PAN = 0.55;
const BIRD_DROP_DB = 4;
/** Scheduling horizon and the upkeep timer (s) */
const LOOKAHEAD = 6;
const TICK = 1;
/** The take's head and tail a pass leaves out (s): an encoder's priming / padding never reaches the mix */
const EDGE = 0.1;

export type Ambient = {
  /** Fade the room in (loading it the first time). Call while the context runs or is about to (inside a gesture). */
  start(): void;
  /** Fade the room out and stop scheduling. */
  stop(): void;
  readonly playing: boolean;
  dispose(): void;
};

type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
type Pass = { src: AudioBufferSourceNode; g: GainNode; end: number };

const db = (d: number) => Math.pow(10, d / 20);
const between = (r: () => number, [a, b]: readonly [number, number]) => a + (b - a) * r();

/** Equal-power fade curves (rising: sin, falling: cos), `n` points. */
export function fadeCurve(rising: boolean, n = 64): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (Math.PI / 2);
    c[i] = rising ? Math.sin(t) : Math.cos(t);
  }
  return c;
}

/**
 * The next bed pass after one ending at `prevEnd` (null: the first, at `now`): it starts XFADE before that end, from a random
 * point in the first MAX_SKIP of the take, so the room never opens on the same swell, and plays to the take's end.
 */
export function nextPass(prevEnd: number | null, now: number, length: number, rnd: () => number): { at: number; offset: number; dur: number } {
  const offset = EDGE + rnd() * (length - 2 * EDGE) * MAX_SKIP;
  return { at: prevEnd === null ? now : prevEnd - XFADE, offset, dur: length - EDGE - offset };
}

export function createAmbient(
  ac: BaseAudioContext,
  out: AudioNode,
  base: string,
  fetcher: (url: string) => Promise<Response>,
  o: { rnd?: () => number; timers?: Timers } = {},
): Ambient {
  const rnd = o.rnd ?? Math.random;
  const timers: Timers = o.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  const room = ac.createGain();
  room.gain.value = 0;
  room.connect(out);
  // every bed pass runs through this, at the manifest's trim once it is loaded
  const bedBus = ac.createGain();
  bedBus.connect(room);

  let loading: Promise<{ bed: AudioBuffer; birds: { buffer: AudioBuffer; gain: number }[] } | null> | null = null;
  let wanted = false;
  let disposed = false;
  let timer: unknown = null;
  let passes: Pass[] = [];
  let birdAt = 0;
  let lastBird = -1;

  async function decode(url: string): Promise<AudioBuffer> {
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return await ac.decodeAudioData(await res.arrayBuffer());
  }
  function load() {
    loading ??= (async () => {
      try {
        const res = await fetcher(`${base}ambient.json`);
        if (!res.ok) return null;
        const m = (await res.json()) as AmbientManifest;
        const [bed, ...birds] = await Promise.all([decode(base + m.bed.file), ...m.birds.map((b) => decode(base + b.file).catch(() => null))]);
        bedBus.gain.value = db(m.bed.gainDb);
        return {
          bed: bed!,
          birds: birds.flatMap((buffer, i) => (buffer ? [{ buffer, gain: db(m.birds[i]!.gainDb) }] : [])),
        };
      } catch {
        // no room tone: the foley still plays
        return null;
      }
    })();
    return loading;
  }

  function schedule(a: NonNullable<Awaited<ReturnType<typeof load>>>) {
    const now = ac.currentTime;
    passes = passes.filter((p) => p.end > now);
    // bed passes up to the horizon
    let last = passes[passes.length - 1];
    while (!last || last.end - XFADE < now + LOOKAHEAD) {
      const p = nextPass(last ? last.end : null, now + 0.02, a.bed.duration, rnd);
      const src = ac.createBufferSource();
      src.buffer = a.bed;
      const g = ac.createGain();
      g.gain.value = 0;
      // the first pass is brought in by the room's own fade; later ones cross the one before
      if (last) g.gain.setValueCurveAtTime(fadeCurve(true), p.at, XFADE);
      else g.gain.setValueAtTime(1, p.at);
      g.gain.setValueCurveAtTime(fadeCurve(false), p.at + p.dur - XFADE, XFADE);
      src.connect(g).connect(bedBus);
      src.start(p.at, p.offset, p.dur);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      last = { src, g, end: p.at + p.dur };
      passes.push(last);
    }
    // a bird when one is due within the horizon
    if (a.birds.length && birdAt < now + LOOKAHEAD) {
      let i = Math.floor(rnd() * a.birds.length);
      if (a.birds.length > 1 && i === lastBird) i = (i + 1) % a.birds.length;
      lastBird = i;
      const b = a.birds[i]!;
      const src = ac.createBufferSource();
      src.buffer = b.buffer;
      src.playbackRate.value = 1 + (rnd() * 2 - 1) * 0.03;
      const g = ac.createGain();
      g.gain.value = b.gain * db(-rnd() * BIRD_DROP_DB);
      let tail: AudioNode = g;
      if (typeof ac.createStereoPanner === "function") {
        const p = ac.createStereoPanner();
        p.pan.value = (rnd() * 2 - 1) * BIRD_PAN;
        g.connect(p);
        tail = p;
      }
      src.connect(g);
      tail.connect(room);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
        if (tail !== g) tail.disconnect();
      };
      src.start(Math.max(now + 0.02, birdAt));
      birdAt = Math.max(now, birdAt) + between(rnd, BIRD_GAP);
    }
  }

  function tick() {
    timer = null;
    if (!wanted || disposed) return;
    void load().then((a) => {
      if (!a || !wanted || disposed) return;
      schedule(a);
      timer = timers.setTimeout(tick, TICK * 1000);
    });
  }

  function silence(at: number) {
    for (const p of passes)
      try {
        p.src.stop(at);
      } catch {
        // not started yet or already stopped
      }
    passes = [];
  }

  return {
    start() {
      if (disposed || wanted) return;
      wanted = true;
      const t = ac.currentTime;
      room.gain.cancelScheduledValues(t);
      room.gain.setValueAtTime(room.gain.value, t);
      room.gain.linearRampToValueAtTime(1, t + FADE_IN);
      birdAt = t + between(rnd, FIRST_BIRD);
      if (timer === null) tick();
    },
    stop() {
      if (!wanted) return;
      wanted = false;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      const t = ac.currentTime;
      room.gain.cancelScheduledValues(t);
      room.gain.setValueAtTime(room.gain.value, t);
      room.gain.linearRampToValueAtTime(0, t + FADE_OUT);
      silence(t + FADE_OUT + 0.05);
    },
    get playing() {
      return wanted;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      wanted = false;
      if (timer !== null) timers.clearTimeout(timer);
      silence(ac.currentTime);
      bedBus.disconnect();
      room.disconnect();
    },
  };
}
