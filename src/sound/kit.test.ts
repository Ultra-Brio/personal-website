/*
 * The bank, the engine and the kit against a fake Web Audio graph and a fake fetch: loading (with missing and broken files),
 * where a decoded file really starts, variant and tier choice, what gets scheduled (rate and level jitter, the voice cap,
 * the impact gate end to end), and when a context may exist and files may be fetched at all (inside the first gesture, or ahead
 * of it in a quiet moment where the page has timers; never while muted), and that nothing sounds before a gesture. The fake throws where the real API throws (negative times and offsets).
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { audibleSpan, impactBankOf, impactKey, loadBank, pickVariant, TIER_AT, tierOf, TIERS, type Clip, type ImpactBank, type Manifest } from "./bank";
import { createEngine, LEVEL_JITTER_DB, mulberry32, RATE_JITTER, WARMUP } from "./engine";
import { DEBOUNCE, impactAmount, MATERIALS, MAX_SPEED, MAX_VOICES, MIN_SPEED } from "./gate";
import { createSoundKit, LATE, materialOf, PREWARM_AFTER, PREWARM_QUIET, SOUND_NAMES, STORAGE_KEY } from "./index";

const SR = 48000;
const flush = () => new Promise((r) => setTimeout(r, 1));

// ---- fake audio data and fetch ----

function fakeBuffer(x: Float32Array): AudioBuffer {
  return { sampleRate: SR, length: x.length, duration: x.length / SR, numberOfChannels: 1, getChannelData: () => x } as unknown as AudioBuffer;
}

/** A "file": `lead` silent samples (decoder priming), a sound of `n` samples, `tail` silent samples, as raw float32 bytes. */
function fileBytes(n = 4800, lead = 0, tail = 0): ArrayBuffer {
  const x = new Float32Array(lead + n + tail);
  for (let i = 0; i < n; i++) x[lead + i] = 0.5 * Math.sin(i / 3) * Math.sin((Math.PI * (i + 1)) / (n + 1));
  return x.buffer;
}

/** decodeAudioData stand-in: float32 bytes become a buffer; anything else (length not a multiple of 4) fails. */
function fakeDecode(data: ArrayBuffer, ok?: (b: AudioBuffer) => void, err?: (e: unknown) => void): Promise<AudioBuffer> {
  const p = data.byteLength > 0 && data.byteLength % 4 === 0 ? Promise.resolve(fakeBuffer(new Float32Array(data))) : Promise.reject(new Error("EncodingError"));
  p.then(ok, err);
  return p;
}

type Body = Manifest | ArrayBuffer | 404;
function fakeFetch(table: Record<string, Body>, log: string[] = []) {
  return (url: string) => {
    log.push(url);
    const b = table[url];
    if (b === undefined || b === 404) return Promise.resolve({ ok: false, json: () => Promise.reject(new Error("404")), arrayBuffer: () => Promise.reject(new Error("404")) } as unknown as Response);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(b), arrayBuffer: () => Promise.resolve((b as ArrayBuffer).slice(0)) } as unknown as Response);
  };
}

/** A full set: every sound name but keyJingle with 1-3 variants, every impact tier with 2. */
const VARIANTS: Partial<Record<string, number>> = { pageTurn: 3, pageLand: 3, tab: 2, copy: 1 };
function fullSet(): Record<string, Body> {
  const m: Manifest = { sounds: {}, impacts: {} };
  const t: Record<string, Body> = {};
  for (const name of SOUND_NAMES) {
    if (name === "keyJingle") continue;
    m.sounds[name] = Array.from({ length: VARIANTS[name] ?? 2 }, (_, i) => ({ file: `${name}-${i + 1}.m4a`, gainDb: -6 - 3 * i }));
    for (const v of m.sounds[name]!) t[`/sounds/${v.file}`] = fileBytes(2400 + 480 * name.length, 1024);
  }
  for (const bank of ["paper", "card"] as ImpactBank[]) {
    m.impacts![bank] = {};
    for (const tier of TIERS) {
      m.impacts![bank]![tier] = [1, 2].map((i) => ({ file: `impact-${bank}-${tier}-${i}.m4a`, gainDb: -10 }));
      for (const v of m.impacts![bank]![tier]!) t[`/sounds/${v.file}`] = fileBytes(2400);
    }
  }
  t["/sounds/manifest.json"] = m;
  return t;
}

// ---- fake Web Audio ----

const time = (t: number) => {
  if (!Number.isFinite(t) || t < 0) throw new RangeError(`bad time ${t}`);
};

class FakeParam {
  ramps: { kind: "lin" | "exp"; v: number; t: number }[] = [];
  cancels: number[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    time(t);
    if (t === 0) this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    time(t);
    this.ramps.push({ kind: "lin", v, t });
    return this;
  }
  cancelScheduledValues(t: number) {
    time(t);
    this.cancels.push(t);
    return this;
  }
}

class FakeNode {
  outputs: unknown[] = [];
  disconnects = 0;
  constructor(public kind: string) {}
  connect(d: unknown) {
    this.outputs.push(d);
    return d;
  }
  disconnect() {
    this.disconnects++;
  }
}

class FakeSource extends FakeNode {
  starts: { t: number; offset: number; dur?: number }[] = [];
  stops: number[] = [];
  onended: (() => void) | null = null;
  buffer: AudioBuffer | null = null;
  playbackRate = new FakeParam(1);
  start(t = 0, offset = 0, dur?: number) {
    time(t);
    if (offset < 0 || (dur !== undefined && !(dur > 0))) throw new RangeError("bad offset / duration");
    this.starts.push({ t, offset, dur });
  }
  stop(t = 0) {
    time(t);
    this.stops.push(t);
  }
}

class FakeContext {
  static made = 0;
  static last: FakeContext | null = null;
  static startState: AudioContextState = "running";
  currentTime = 0;
  sampleRate = SR;
  state: AudioContextState = FakeContext.startState;
  destination = new FakeNode("destination");
  nodes: FakeNode[] = [];
  resumes = 0;
  suspends = 0;
  closed = false;
  resumeWorks = true;
  constructor() {
    FakeContext.made++;
    FakeContext.last = this;
  }
  private add<T extends FakeNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.add(Object.assign(new FakeNode("gain"), { gain: new FakeParam(1) }));
  }
  createBiquadFilter() {
    return this.add(Object.assign(new FakeNode("biquad"), { type: "lowpass", frequency: new FakeParam(350), Q: new FakeParam(1) }));
  }
  createDynamicsCompressor() {
    const p = () => new FakeParam(0);
    return this.add(Object.assign(new FakeNode("compressor"), { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }));
  }
  createDelay() {
    return this.add(Object.assign(new FakeNode("delay"), { delayTime: new FakeParam(0) }));
  }
  createStereoPanner() {
    return this.add(Object.assign(new FakeNode("panner"), { pan: new FakeParam(0) }));
  }
  createBufferSource() {
    return this.add(new FakeSource("buffer"));
  }
  createBuffer(channels: number, length: number) {
    return fakeBuffer(new Float32Array(length * channels));
  }
  decodeAudioData(data: ArrayBuffer, ok?: (b: AudioBuffer) => void, err?: (e: unknown) => void) {
    return fakeDecode(data, ok, err);
  }
  resume() {
    this.resumes++;
    if (this.resumeWorks) this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

const fakeCtx = () => new FakeContext() as unknown as BaseAudioContext & FakeContext;
const sources = (ac: FakeContext, from = 0) => ac.nodes.slice(from).filter((n): n is FakeSource => n instanceof FakeSource);
const gains = (ac: FakeContext, from = 0) => ac.nodes.slice(from).filter((n) => n.kind === "gain") as (FakeNode & { gain: FakeParam })[];

/** A bank already loaded on `ac` from the full set. */
async function loadedBank(ac: BaseAudioContext) {
  const bank = loadBank(ac, "/sounds/", fakeFetch(fullSet()));
  for (const k of ["pageTurn", "tab", "copy", "paperRustle", "pickUp", "zip"]) await bank.loaded(k);
  for (const b of ["paper", "card"] as ImpactBank[]) for (const t of TIERS) await bank.loaded(impactKey(b, t));
  await flush();
  return bank;
}

// ---- bank ----

describe("bank", () => {
  const manifest: Manifest = {
    sounds: {
      pageTurn: [
        { file: "pageTurn-1.m4a", gainDb: -6 },
        { file: "pageTurn-2.m4a", gainDb: -12 },
        { file: "pageTurn-3.m4a", gainDb: 0 },
      ],
      tab: [{ file: "tab-1.m4a", gainDb: -20 }],
    },
    impacts: { paper: { soft: [{ file: "impact-paper-soft-1.m4a", gainDb: -10 }] } },
  };
  const ctx = { decodeAudioData: fakeDecode } as unknown as BaseAudioContext;

  test("decodes every file the manifest names; a missing or broken file is skipped, the others play", async () => {
    const log: string[] = [];
    const bank = loadBank(
      ctx,
      "/s/",
      fakeFetch(
        {
          "/s/manifest.json": manifest,
          "/s/pageTurn-1.m4a": fileBytes(),
          "/s/pageTurn-2.m4a": 404,
          "/s/pageTurn-3.m4a": new ArrayBuffer(6),
          "/s/tab-1.m4a": fileBytes(960),
          "/s/impact-paper-soft-1.m4a": fileBytes(),
        },
        log,
      ),
    );
    expect(bank.clips("pageTurn")).toEqual([]);
    await bank.loaded("pageTurn");
    const turns = bank.clips("pageTurn");
    expect(turns.map((c) => c.file)).toEqual(["pageTurn-1.m4a"]);
    expect(turns[0]!.gain).toBeCloseTo(Math.pow(10, -6 / 20), 9);
    await bank.loaded(impactKey("paper", "soft"));
    expect(bank.clips(impactKey("paper", "soft")).length).toBe(1);
    // the audible span of a 960-sample sound whose first and last samples are 0
    expect(Math.abs(bank.clips("tab")[0]!.duration - 960 / SR)).toBeLessThanOrEqual(2 / SR);
    expect(log.sort()).toEqual(["/s/impact-paper-soft-1.m4a", "/s/manifest.json", "/s/pageTurn-1.m4a", "/s/pageTurn-2.m4a", "/s/pageTurn-3.m4a", "/s/tab-1.m4a"]);
    // a name the manifest leaves out (keyJingle) settles at once and stays empty
    await bank.loaded("keyJingle");
    expect(bank.clips("keyJingle")).toEqual([]);
  });

  test("no manifest (404, network error, junk): an empty bank that never throws", async () => {
    for (const f of [fakeFetch({}), () => Promise.reject(new Error("offline")), fakeFetch({ "/s/manifest.json": fileBytes() })]) {
      const bank = loadBank(ctx, "/s/", f as ReturnType<typeof fakeFetch>);
      await bank.loaded("pageTurn");
      await flush();
      expect(bank.clips("pageTurn")).toEqual([]);
    }
  });

  test("after dispose, late decodes are dropped", async () => {
    const bank = loadBank(ctx, "/s/", fakeFetch({ "/s/manifest.json": manifest, "/s/tab-1.m4a": fileBytes() }));
    bank.dispose();
    await bank.loaded("tab");
    expect(bank.clips("tab")).toEqual([]);
  });

  test("audibleSpan skips a decoder's leading priming and trailing padding", () => {
    const s = audibleSpan(fakeBuffer(new Float32Array(fileBytes(4800, 2112, 960))));
    expect(s.offset * SR).toBeGreaterThanOrEqual(2112);
    expect(s.offset * SR).toBeLessThan(2112 + 4);
    expect((s.offset + s.duration) * SR).toBeGreaterThan(2112 + 4800 - 4);
    expect((s.offset + s.duration) * SR).toBeLessThanOrEqual(2112 + 4800);
    expect(audibleSpan(fakeBuffer(new Float32Array(fileBytes(4800)))).offset * SR).toBeLessThan(2);
    const z = audibleSpan(fakeBuffer(new Float32Array(100)));
    expect(z.offset).toBe(0);
    expect(z.duration).toBeGreaterThan(0);
  });

  test("pickVariant never returns the previous pick when there is a choice, and reaches every variant", () => {
    const rnd = mulberry32(9);
    for (const n of [2, 3, 4]) {
      const list = Array.from({ length: n }, (_, i) => i);
      const seen = new Set<number>();
      let last: number | undefined;
      for (let i = 0; i < 300; i++) {
        const v = pickVariant(list, last, rnd)!;
        expect(v).not.toBe(last);
        seen.add(v);
        last = v;
      }
      expect(seen.size).toBe(n);
    }
    expect(pickVariant([7], 7, rnd)).toBe(7);
    expect(pickVariant([], undefined, rnd)).toBeUndefined();
  });

  test("the tier follows the speed curve (soft, medium, hard, never back); paper is paper, everything else card", () => {
    expect(tierOf(impactAmount(MIN_SPEED))).toBe("soft");
    expect(tierOf(impactAmount(MAX_SPEED))).toBe("hard");
    expect(tierOf(TIER_AT.medium - 1e-9)).toBe("soft");
    expect(tierOf(TIER_AT.medium)).toBe("medium");
    expect(tierOf(TIER_AT.hard)).toBe("hard");
    const rank = { soft: 0, medium: 1, hard: 2 };
    let prev = 0;
    for (let s = MIN_SPEED; s <= MAX_SPEED; s += 0.01) {
      const r = rank[tierOf(impactAmount(s))];
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    for (const m of MATERIALS) expect(impactBankOf(m)).toBe(m === "paper" ? "paper" : "card");
  });
});

// ---- engine ----

describe("engine", () => {
  test("every sound plays a recorded variant: its buffer from its audible start, rate within ±3 %, level never above designed", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank, { rnd: mulberry32(7) });
    for (const name of SOUND_NAMES) {
      await bank.loaded(name);
      for (let i = 0; i < 12; i++) {
        const from = ac.nodes.length;
        const rate = [1, 0.8, 1.5][i % 3]!;
        const gain = [1, 0.5, 0.2][i % 3]!;
        const clip = engine.play(name, { rate, gain }, 1 + i);
        if (name === "keyJingle") {
          expect(clip).toBeNull();
          expect(ac.nodes.length).toBe(from);
          continue;
        }
        expect(clip).not.toBeNull();
        expect(bank.clips(name)).toContain(clip!);
        const [src] = sources(ac, from);
        expect(src!.buffer).toBe(clip!.buffer);
        expect(src!.starts).toEqual([{ t: 1 + i, offset: clip!.offset, dur: clip!.duration }]);
        // the files carry 1024 samples of "priming": playback starts after it
        expect(clip!.offset * SR).toBeGreaterThanOrEqual(1024);
        expect(src!.playbackRate.value).toBeGreaterThanOrEqual(rate * (1 - RATE_JITTER) - 1e-9);
        expect(src!.playbackRate.value).toBeLessThanOrEqual(rate * (1 + RATE_JITTER) + 1e-9);
        const level = gains(ac, from)[0]!.gain.value;
        expect(level).toBeLessThanOrEqual(gain * clip!.gain + 1e-12);
        expect(level).toBeGreaterThanOrEqual(gain * clip!.gain * Math.pow(10, -LEVEL_JITTER_DB / 20) - 1e-12);
      }
    }
  });

  test("never the same variant twice in a row; every variant gets used; a single take simply repeats", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank, { rnd: mulberry32(3) });
    for (const name of ["pageTurn", "tab"] as const) {
      const seen = new Set<string>();
      let prev = "";
      for (let i = 0; i < 60; i++) {
        const f = engine.play(name, {}, 1 + i)!.file;
        expect(f).not.toBe(prev);
        seen.add(f);
        prev = f;
      }
      expect(seen.size).toBe(VARIANTS[name]!);
    }
    expect(engine.play("copy", {}, 100)!.file).toBe(engine.play("copy", {}, 101)!.file);
    // speed picks the tier, the tier's variants alternate too
    let prevImpact = "";
    for (let i = 0; i < 20; i++) {
      const c = engine.impact(MAX_SPEED, "card", 0, 200 + i)!;
      expect(c.key).toBe(impactKey("card", "hard"));
      expect(c.file).not.toBe(prevImpact);
      prevImpact = c.file;
    }
  });

  test("impacts: the tier comes from the speed, the level from the gate; harder materials use the card takes", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank, { rnd: mulberry32(5) });
    let t = 1;
    for (const m of MATERIALS)
      for (const speed of [0.16, 0.5, 1.2, 2.4, 9]) {
        const from = ac.nodes.length;
        const c = engine.impact(speed, m, 0.5, (t += 1))!;
        expect(c.key).toBe(impactKey(impactBankOf(m), tierOf(impactAmount(speed))));
        const level = gains(ac, from)[0]!.gain.value;
        expect(level).toBeLessThanOrEqual(c.gain + 1e-12);
      }
    // louder with speed (same tier, no jitter: compare the gate's level through the voice gain)
    const quiet = createEngine(ac, bank, { rnd: () => 0.5 });
    const a = ac.nodes.length;
    quiet.impact(0.2, "paper", 0, 50);
    const la = gains(ac, a)[0]!.gain.value;
    const b = ac.nodes.length;
    quiet.impact(0.3, "paper", 0, 51);
    expect(gains(ac, b)[0]!.gain.value).toBeGreaterThan(la);
  });

  test("impacts below 0.15 m/s create nothing; the gate debounces per material on the context clock", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank);
    const n = ac.nodes.length;
    expect(engine.impact(0.149, "card", 0, 1)).toBeNull();
    expect(engine.impact(Number.NaN, "card", 0, 1)).toBeNull();
    expect(ac.nodes.length).toBe(n);
    expect(engine.impact(1, "card", 0, 2)).not.toBeNull();
    expect(engine.impact(1, "card", 0, 2.02)).toBeNull();
    expect(engine.impact(1, "paper", 0, 2.02)).not.toBeNull();
    expect(engine.impact(1, "card", 0, 2 + DEBOUNCE.card + 1e-9)).not.toBeNull();
  });

  test(`a storm of contacts never holds more than ${MAX_VOICES} voices; stolen voices fade and stop`, async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank, { rnd: mulberry32(11) });
    const rnd = mulberry32(5);
    let accepted = 0;
    for (let i = 0; i < 120; i++) {
      ac.currentTime = 1 + i * 0.002;
      if (engine.impact(0.2 + rnd() * 2.2, MATERIALS[i % MATERIALS.length]!, rnd() * 2 - 1)) accepted++;
      expect(engine.voices()).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(accepted).toBeGreaterThan(MAX_VOICES);
    const stolen = gains(ac).filter((g) => g.gain.cancels.length > 0);
    expect(stolen.length).toBeGreaterThan(0);
    for (const g of stolen) expect(g.gain.ramps.at(-1)).toMatchObject({ kind: "lin", v: 0 });
  });

  test("UI sounds always play, even into a full pool", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank);
    for (let i = 0; i < MAX_VOICES; i++) engine.play("paperRustle", {}, 1);
    expect(engine.play("tab", {}, 1.001)).not.toBeNull();
    expect(engine.voices()).toBeLessThanOrEqual(MAX_VOICES);
  });

  test("options are clamped: gain 0 plays nothing, wild rate/pan stay legal; nothing loaded plays nothing", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank);
    const n = ac.nodes.length;
    expect(engine.play("pageTurn", { gain: 0 }, 1)).toBeNull();
    expect(ac.nodes.length).toBe(n);
    expect(engine.play("pageTurn", { rate: 100, pan: -7, gain: 9 }, 1)).not.toBeNull();
    const pan = ac.nodes.slice(n).find((x) => x.kind === "panner") as FakeNode & { pan: FakeParam };
    expect(pan.pan.value).toBe(-1);
    expect(sources(ac, n)[0]!.playbackRate.value).toBeLessThanOrEqual(2 * (1 + RATE_JITTER));
    expect(engine.play("pageTurn", { rate: Number.NaN }, 2)).not.toBeNull();
    const empty = createEngine(ac, { clips: (): Clip[] => [] });
    const m = ac.nodes.length;
    expect(empty.play("pageTurn", {}, 3)).toBeNull();
    expect(empty.impact(2, "card", 0, 3)).toBeNull();
    expect(ac.nodes.length).toBe(m);
  });

  test("the warm-up bypass is dropped once the compressor has opened", async () => {
    const ac = fakeCtx();
    const bank = await loadedBank(ac);
    const engine = createEngine(ac, bank);
    const delay = ac.nodes.find((x) => x.kind === "delay")!;
    engine.play("tab", {}, 0.01);
    expect(delay.disconnects).toBe(0);
    ac.currentTime = WARMUP + 0.5;
    engine.play("tab");
    expect(delay.disconnects).toBe(1);
  });
});

// ---- kit ----

type Listener = () => void;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const KEYS = ["window", "localStorage", "AudioContext", "webkitAudioContext", "navigator", "fetch"] as const;
let store: Map<string, string>;
let listeners: Map<string, Listener>;
let pointerFine: boolean;
let fetched: string[];
/** The page's timers, when a test gives the window some (run by hand). */
type Timers = { timeouts: Map<number, { fn: () => void; ms: number }>; idles: Map<number, (d: { timeRemaining(): number; didTimeout: boolean }) => void>; cleared: number[] };
let timers: Timers;

function install(o: { storage?: "ok" | "throws" | "none"; matchMedia?: boolean; userActivation?: { isActive: boolean }; fetch?: (url: string) => Promise<Response>; timers?: "idle" | "timeout" } = {}) {
  const g = globalThis as Record<string, unknown>;
  store = new Map();
  listeners = new Map();
  fetched = [];
  timers = { timeouts: new Map(), idles: new Map(), cleared: [] };
  let id = 0;
  const t = timers;
  g.window = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    ...(o.matchMedia === false ? {} : { matchMedia: (q: string) => ({ matches: q === "(pointer: fine)" && pointerFine }) }),
    ...(o.timers
      ? {
          setTimeout: (fn: () => void, ms: number) => (t.timeouts.set(++id, { fn, ms }), id),
          clearTimeout: (i: number) => (t.timeouts.delete(i), t.cleared.push(i)),
        }
      : {}),
    ...(o.timers === "idle"
      ? {
          requestIdleCallback: (fn: (d: { timeRemaining(): number; didTimeout: boolean }) => void) => (t.idles.set(++id, fn), id),
          cancelIdleCallback: (i: number) => (t.idles.delete(i), t.cleared.push(i)),
        }
      : {}),
  };
  if (o.storage === "throws")
    g.localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
  else if (o.storage !== "none")
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  g.AudioContext = FakeContext;
  g.fetch = o.fetch ?? fakeFetch(fullSet(), fetched);
  Object.defineProperty(globalThis, "navigator", { value: o.userActivation ? { userActivation: o.userActivation } : {}, configurable: true, writable: true });
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  FakeContext.made = 0;
  FakeContext.last = null;
  FakeContext.startState = "running";
  pointerFine = true;
});

afterEach(() => {
  for (const k of KEYS) {
    const d = saved[k];
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as Record<string, unknown>)[k];
  }
  setSystemTime();
});

const gesture = (type = "pointerdown") => listeners.get(type)?.();
/** Run the one pending timeout (asserting its delay), or the one pending idle callback with `idle` ms to spare. */
function runTimeout(ms?: number) {
  expect(timers.timeouts.size).toBe(1);
  const [k, t] = [...timers.timeouts][0]!;
  if (ms !== undefined) expect(t.ms).toBe(ms);
  timers.timeouts.delete(k);
  t.fn();
}
function runIdle(idle: number) {
  expect(timers.idles.size).toBe(1);
  const [k, fn] = [...timers.idles][0]!;
  timers.idles.delete(k);
  fn({ timeRemaining: () => idle, didTimeout: false });
}
/** Sources started by the kit after `from` nodes, the unlock's one-frame silent source excluded. */
const voicesSince = (ac: FakeContext, from: number) => sources(ac, from).filter((s) => s.buffer && s.buffer.length > 1).length;

describe("sound kit", () => {
  test("nothing is created or fetched before the first gesture; then the files load and play", async () => {
    install();
    const kit = createSoundKit();
    expect(kit.muted).toBe(false);
    kit.play("pageTurn");
    kit.impact(2, "card");
    expect(FakeContext.made).toBe(0);
    expect(fetched).toEqual([]);
    gesture();
    expect(FakeContext.made).toBe(1);
    // the foley's manifest, and the room's (ambient.ts starts with the kit)
    expect(fetched).toEqual(["/sounds/manifest.json", "/sounds/ambient.json"]);
    await flush();
    expect(fetched.length).toBeGreaterThan(30);
    const ac = FakeContext.last!;
    const n = ac.nodes.length;
    kit.play("pageTurn");
    expect(voicesSince(ac, n)).toBe(1);
    gesture("click");
    expect(FakeContext.made).toBe(1);
    kit.dispose();
  });

  test("ahead of the first gesture: made in a quiet moment (suspended), its files loading, silent; the gesture only resumes it", async () => {
    install({ timers: "idle" });
    FakeContext.startState = "suspended";
    const kit = createSoundKit();
    expect(FakeContext.made).toBe(0);
    runTimeout(PREWARM_AFTER);
    // something is animating: only a sliver of idle time per frame, so not now; it looks again a little later
    runIdle(PREWARM_QUIET - 30);
    expect(FakeContext.made).toBe(0);
    runTimeout();
    runIdle(PREWARM_QUIET + 9);
    expect(FakeContext.made).toBe(1);
    expect(fetched).toEqual(["/sounds/manifest.json"]);
    await flush();
    expect(fetched.length).toBeGreaterThan(30);
    const ac = FakeContext.last!;
    expect(ac.resumes).toBe(0);
    // allowed to run at once (a site the visitor often plays media on), it still says nothing before a gesture
    ac.state = "running";
    const n = ac.nodes.length;
    kit.play("tab");
    kit.impact(2, "card");
    expect(ac.nodes.length).toBe(n);
    ac.state = "suspended";
    gesture();
    expect(FakeContext.made).toBe(1);
    expect(ac.resumes).toBe(1);
    const m = ac.nodes.length;
    kit.play("tab");
    expect(voicesSince(ac, m)).toBe(1);
    expect(timers.timeouts.size + timers.idles.size).toBe(0);
    kit.dispose();
  });

  test("ahead of the gesture: at the timer where there are no idle callbacks; never while muted; nothing left behind on dispose", () => {
    install({ timers: "timeout" });
    const kit = createSoundKit();
    runTimeout(PREWARM_AFTER);
    expect(FakeContext.made).toBe(1);
    kit.dispose();
    install({ timers: "idle" });
    store.set(STORAGE_KEY, "off");
    const muted = createSoundKit();
    runTimeout(PREWARM_AFTER);
    expect(timers.idles.size).toBe(0);
    expect(FakeContext.made).toBe(1);
    expect(fetched).toEqual([]);
    muted.dispose();
    install({ timers: "idle" });
    const early = createSoundKit();
    early.dispose();
    expect(timers.cleared.length).toBe(1);
    // a gesture before the quiet moment: made in the gesture, the prewarm then has nothing to do
    install({ timers: "idle" });
    const kit2 = createSoundKit();
    runTimeout(PREWARM_AFTER);
    gesture();
    expect(FakeContext.made).toBe(2);
    runIdle(49);
    expect(FakeContext.made).toBe(2);
    kit2.dispose();
  });

  test("a sound asked for while its files load plays when they arrive, if that is soon enough", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = fakeFetch(fullSet());
    install({ fetch: (url) => gate.then(() => inner(url)) });
    setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const kit = createSoundKit();
    gesture();
    const ac = FakeContext.last!;
    const n = ac.nodes.length;
    kit.play("tab");
    expect(voicesSince(ac, n)).toBe(0);
    release();
    await flush();
    expect(voicesSince(ac, n)).toBe(1);
    kit.dispose();

    let release2!: () => void;
    const gate2 = new Promise<void>((r) => (release2 = r));
    install({ fetch: (url) => gate2.then(() => inner(url)) });
    const kit2 = createSoundKit();
    gesture();
    const ac2 = FakeContext.last!;
    const m = ac2.nodes.length;
    kit2.play("tab");
    setSystemTime(new Date(Date.now() + LATE + 50));
    release2();
    await flush();
    expect(voicesSince(ac2, m)).toBe(0);
    kit2.dispose();
  });

  test("the kit listens for gestures itself and stops listening on dispose", () => {
    install();
    const kit = createSoundKit();
    expect([...listeners.keys()].sort()).toEqual(["click", "keydown", "pointerdown", "touchend"]);
    kit.dispose();
    expect(listeners.size).toBe(0);
    kit.unlock();
    expect(FakeContext.made).toBe(0);
  });

  test("defaults: on for a fine pointer, off for touch-first or unknown", () => {
    install();
    expect(createSoundKit().muted).toBe(false);
    pointerFine = false;
    install();
    expect(createSoundKit().muted).toBe(true);
    install({ matchMedia: false });
    expect(createSoundKit().muted).toBe(true);
  });

  test("muted: no context and no downloads, even after gestures; unmuting inside a gesture starts both and persists the choice", async () => {
    install();
    store.set(STORAGE_KEY, "off");
    const kit = createSoundKit();
    expect(kit.muted).toBe(true);
    gesture();
    kit.play("tab");
    expect(FakeContext.made).toBe(0);
    expect(fetched).toEqual([]);
    kit.setMuted(false);
    expect(store.get(STORAGE_KEY)).toBe("on");
    expect(FakeContext.made).toBe(1);
    expect(fetched).toEqual(["/sounds/manifest.json", "/sounds/ambient.json"]);
    await flush();
    kit.setMuted(true);
    expect(store.get(STORAGE_KEY)).toBe("off");
    const ac = FakeContext.last!;
    const n = ac.nodes.length;
    kit.play("tab");
    expect(ac.nodes.length).toBe(n);
    kit.dispose();
  });

  test("the stored choice wins over the default", () => {
    install();
    pointerFine = false;
    store.set(STORAGE_KEY, "on");
    expect(createSoundKit().muted).toBe(false);
  });

  test("blocked storage never throws; the choice lasts for the page", () => {
    install({ storage: "throws" });
    const kit = createSoundKit();
    expect(kit.muted).toBe(false);
    expect(() => kit.setMuted(true)).not.toThrow();
    expect(kit.muted).toBe(true);
    install({ storage: "none" });
    expect(() => createSoundKit().setMuted(true)).not.toThrow();
  });

  test("muting fades out, then suspends the context; unmuting resumes it", async () => {
    install();
    const kit = createSoundKit();
    gesture();
    const ac = FakeContext.last!;
    kit.setMuted(true);
    expect(ac.suspends).toBe(0);
    await Bun.sleep(120);
    expect(ac.suspends).toBe(1);
    expect(ac.state).toBe("suspended");
    kit.setMuted(false);
    expect(ac.state).toBe("running");
    kit.dispose();
    expect(ac.closed).toBe(true);
  });

  test("a context still starting inside the gesture takes sounds; outside a gesture they are dropped, not queued", async () => {
    install();
    FakeContext.startState = "suspended";
    setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const kit = createSoundKit();
    gesture();
    await flush();
    const ac = FakeContext.last!;
    ac.resumeWorks = false;
    ac.state = "suspended";
    const n = ac.nodes.length;
    kit.play("pickUp");
    expect(voicesSince(ac, n)).toBe(1);
    setSystemTime(new Date("2026-10-19T10:00:01Z"));
    const m = ac.nodes.length;
    kit.play("pickUp");
    expect(ac.nodes.length).toBe(m);
    kit.dispose();
  });

  test("navigator.userActivation, where exposed, decides instead of the time window", async () => {
    const ua = { isActive: true };
    install({ userActivation: ua });
    FakeContext.startState = "suspended";
    const kit = createSoundKit();
    kit.unlock();
    await flush();
    const ac = FakeContext.last!;
    ac.resumeWorks = false;
    ac.state = "suspended";
    const n = ac.nodes.length;
    kit.play("tab");
    expect(voicesSince(ac, n)).toBe(1);
    ua.isActive = false;
    const m = ac.nodes.length;
    kit.play("tab");
    expect(ac.nodes.length).toBe(m);
    kit.dispose();
  });

  test("no Web Audio, no fetch, or no files: everything is a silent no-op", async () => {
    for (const setup of [
      () => delete (globalThis as Record<string, unknown>).AudioContext,
      () => delete (globalThis as Record<string, unknown>).fetch,
      () => ((globalThis as Record<string, unknown>).fetch = fakeFetch({})),
    ]) {
      install();
      setup();
      const kit = createSoundKit();
      expect(() => {
        kit.unlock();
        kit.play("zip");
        kit.impact(1, "card", 0);
      }).not.toThrow();
      await flush();
      expect(() => {
        kit.play("zip");
        kit.setMuted(true);
        kit.setMuted(false);
        kit.dispose();
      }).not.toThrow();
    }
  });

  test("materialOf maps every pocket item kind", () => {
    expect(materialOf("resume")).toBe("paper");
    expect(materialOf("note")).toBe("paper");
    for (const k of ["card", "ticket", "polaroid"] as const) expect(materialOf(k)).toBe("card");
  });
});
