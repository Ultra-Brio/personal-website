import { describe, expect, test } from "bun:test";
import { createAmbient, FADE_IN, FADE_OUT, fadeCurve, MAX_SKIP, nextPass, XFADE } from "./ambient";

// ---- a minimal Web Audio stand-in: what the room schedules ----
class Param {
  events: { kind: string; v?: number; t: number; d?: number }[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    this.events.push({ kind: "set", v, t });
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ kind: "lin", v, t });
  }
  setValueCurveAtTime(c: Float32Array, t: number, d: number) {
    this.events.push({ kind: "curve", v: c[c.length - 1], t, d });
  }
  cancelScheduledValues(t: number) {
    this.events.push({ kind: "cancel", t });
  }
}
class Node {
  outputs: unknown[] = [];
  connect(d: unknown) {
    this.outputs.push(d);
    return d;
  }
  disconnect() {}
}
class Source extends Node {
  buffer: { duration: number } | null = null;
  playbackRate = new Param(1);
  onended: (() => void) | null = null;
  starts: { t: number; offset?: number; dur?: number }[] = [];
  stops: number[] = [];
  start(t: number, offset?: number, dur?: number) {
    this.starts.push({ t, offset, dur });
  }
  stop(t: number) {
    this.stops.push(t);
  }
}
class Ctx {
  currentTime = 0;
  nodes: Node[] = [];
  createGain() {
    const n = Object.assign(new Node(), { gain: new Param(1) });
    this.nodes.push(n);
    return n;
  }
  createStereoPanner() {
    const n = Object.assign(new Node(), { pan: new Param(0) });
    this.nodes.push(n);
    return n;
  }
  createBufferSource() {
    const n = new Source();
    this.nodes.push(n);
    return n;
  }
  decodeAudioData(b: ArrayBuffer) {
    return Promise.resolve({ duration: new DataView(b).getFloat32(0) });
  }
}
const MANIFEST = { bed: { file: "bed.m4a", gainDb: -26, duration: 30 }, birds: [1, 2, 3].map((i) => ({ file: `bird-${i}.m4a`, gainDb: -20, duration: 2.5 })) };
function setup() {
  const ac = new Ctx();
  const out = new Node();
  const fetched: string[] = [];
  const fetcher = (url: string) => {
    fetched.push(url);
    if (url.endsWith("ambient.json")) return Promise.resolve(new Response(JSON.stringify(MANIFEST)));
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, url.includes("bed") ? 30 : 2.5);
    return Promise.resolve(new Response(b));
  };
  const pending: { fn: () => void; ms: number }[] = [];
  const timers = { setTimeout: (fn: () => void, ms: number) => (pending.push({ fn, ms }), pending.length), clearTimeout: () => void pending.splice(0) };
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const room = createAmbient(ac as unknown as BaseAudioContext, out as unknown as AudioNode, "/sounds/", fetcher, { rnd, timers });
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  /** Advance the context clock second by second, running the room's upkeep each time */
  const run = async (s: number) => {
    for (let i = 0; i < s; i++) {
      ac.currentTime += 1;
      const p = pending.splice(0);
      for (const t of p) t.fn();
      await flush();
    }
  };
  const sources = () => ac.nodes.filter((n): n is Source => n instanceof Source);
  return { ac, fetched, room, flush, run, sources, gain: () => (ac.nodes[0] as Node & { gain: Param }).gain };
}

describe("the room's ambience", () => {
  test("equal-power crossfades: the two curves always add up to the same power", () => {
    const up = fadeCurve(true);
    const down = fadeCurve(false);
    expect(up[0]).toBeCloseTo(0, 6);
    expect(up[up.length - 1]).toBeCloseTo(1, 6);
    for (let i = 0; i < up.length; i++) expect(up[i]! ** 2 + down[i]! ** 2).toBeCloseTo(1, 5);
  });

  test("bed passes overlap by the crossfade, start somewhere in the take's first half, and play to its end", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;
    const first = nextPass(null, 5, 30, rnd);
    expect(first.at).toBe(5);
    let prev = first.at + first.dur;
    const offsets = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const p = nextPass(prev, 0, 30, rnd);
      expect(p.at).toBeCloseTo(prev - XFADE, 9);
      expect(p.offset).toBeGreaterThanOrEqual(0.1);
      expect(p.offset).toBeLessThanOrEqual(0.1 + 29.8 * MAX_SKIP);
      expect(p.offset + p.dur).toBeCloseTo(29.9, 9);
      expect(p.dur).toBeGreaterThan(2 * XFADE);
      offsets.add(Math.round(p.offset * 10));
      prev = p.at + p.dur;
    }
    // the swells do not come round on a beat
    expect(offsets.size).toBeGreaterThan(10);
  });

  test("nothing is fetched before start; then it fades in, keeps the bed going with crossfades, and drops in birds", async () => {
    const t = setup();
    await t.flush();
    expect(t.fetched).toEqual([]);
    t.room.start();
    await t.flush();
    expect(t.fetched[0]).toBe("/sounds/ambient.json");
    expect(t.fetched.length).toBe(5);
    expect(t.gain().events.at(-1)).toEqual({ kind: "lin", v: 1, t: FADE_IN });
    const bed0 = t.sources().filter((s) => s.buffer?.duration === 30);
    expect(bed0.length).toBeGreaterThanOrEqual(1);
    // the bed plays at the manifest's trim (it once played at full level, 30 dB over its design, and buried the birds)
    const bus = (bed0[0]!.outputs[0] as Node).outputs[0] as Node & { gain: Param };
    expect(bus.gain.value).toBeCloseTo(10 ** (-26 / 20), 6);
    expect(bus.outputs[0]).toBe(t.ac.nodes[0]);
    await t.run(90);
    const beds = t.sources().filter((s) => s.buffer?.duration === 30).map((s) => s.starts[0]!);
    // the bed never gaps: each pass starts before the one before it ends
    for (let i = 1; i < beds.length; i++) expect(beds[i]!.t).toBeLessThan(beds[i - 1]!.t + beds[i - 1]!.dur!);
    expect(beds.at(-1)!.t + beds.at(-1)!.dur!).toBeGreaterThan(90);
    const birds = t.sources().filter((s) => s.buffer?.duration === 2.5).map((s) => s.starts[0]!.t);
    expect(birds.length).toBeGreaterThanOrEqual(2);
    expect(birds.length).toBeLessThanOrEqual(10);
    expect(birds[0]!).toBeGreaterThanOrEqual(3);
  });

  test("stop fades out and silences what was scheduled; a second start picks up again", async () => {
    const t = setup();
    t.room.start();
    await t.flush();
    await t.run(10);
    t.room.stop();
    expect(t.room.playing).toBe(false);
    expect(t.gain().events.at(-1)).toEqual({ kind: "lin", v: 0, t: 10 + FADE_OUT });
    const live = t.sources().filter((s) => s.buffer?.duration === 30);
    for (const s of live.filter((s) => s.starts[0]!.t + s.starts[0]!.dur! > 10)) expect(s.stops.length).toBe(1);
    const n = t.sources().length;
    await t.run(5);
    // stopped: nothing new
    expect(t.sources().length).toBe(n);
    t.room.start();
    await t.flush();
    expect(t.sources().length).toBeGreaterThan(n);
    t.room.dispose();
  });
});
