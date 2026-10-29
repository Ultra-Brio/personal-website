import { describe, expect, test } from "bun:test";
import {
  createImpactGate,
  createVoicePool,
  DEBOUNCE,
  FLOOR_DB,
  impactAmount,
  impactLevel,
  MATERIALS,
  MAX_SPEED,
  MAX_VOICES,
  MIN_SPEED,
  OVERRIDE_RATIO,
  type VoiceHandle,
} from "./gate";

describe("impact speed curve", () => {
  test("silent below the threshold and for junk input", () => {
    for (const s of [0, 0.149, -1, -0.3, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(impactAmount(s)).toBe(0);
      expect(impactLevel(s)).toBe(0);
    }
  });

  test("FLOOR_DB at the threshold, unity at MAX_SPEED and above", () => {
    expect(impactLevel(MIN_SPEED)).toBeCloseTo(Math.pow(10, FLOOR_DB / 20), 12);
    expect(impactLevel(MAX_SPEED)).toBe(1);
    expect(impactLevel(MAX_SPEED * 3)).toBe(1);
    expect(impactLevel(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test("strictly increasing between, and soft: the top end saturates", () => {
    let prev = 0;
    for (let s = MIN_SPEED; s <= MAX_SPEED; s += 0.01) {
      const l = impactLevel(s);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
    // Eased out: the first half of the speed range covers more of the dB range than the second half.
    const mid = (MIN_SPEED + MAX_SPEED) / 2;
    const db = (x: number) => 20 * Math.log10(impactLevel(x));
    expect(db(mid) - db(MIN_SPEED)).toBeGreaterThan(db(MAX_SPEED) - db(mid));
  });
});

describe("impact gate (fake clock)", () => {
  test("debounce windows are 60-90 ms", () => {
    for (const m of MATERIALS) {
      expect(DEBOUNCE[m]).toBeGreaterThanOrEqual(0.06);
      expect(DEBOUNCE[m]).toBeLessThanOrEqual(0.09);
    }
  });

  test("a second contact inside the window is dropped, one at the window edge sounds", () => {
    const g = createImpactGate();
    expect(g.admit("paper", 1, 10)).toBeGreaterThan(0);
    expect(g.admit("paper", 1, 10.03)).toBe(0);
    expect(g.admit("paper", 1, 10 + DEBOUNCE.paper - 0.001)).toBe(0);
    expect(g.admit("paper", 1, 10 + DEBOUNCE.paper + 1e-9)).toBeGreaterThan(0);
  });

  test("materials are debounced independently", () => {
    const g = createImpactGate();
    expect(g.admit("metal", 1, 0)).toBeGreaterThan(0);
    expect(g.admit("card", 1, 0.001)).toBeGreaterThan(0);
    expect(g.admit("metal", 1, 0.002)).toBe(0);
    expect(g.admit("vinyl", 1, 0.003)).toBeGreaterThan(0);
  });

  test("a graze then a real hit: a much faster contact gets through the window", () => {
    const g = createImpactGate();
    expect(g.admit("card", 0.4, 0)).toBeGreaterThan(0);
    expect(g.admit("card", 0.4 * OVERRIDE_RATIO * 0.99, 0.01)).toBe(0);
    const hard = g.admit("card", 0.4 * OVERRIDE_RATIO, 0.02);
    expect(hard).toBeGreaterThan(0);
    expect(hard).toBe(impactLevel(0.4 * OVERRIDE_RATIO));
  });

  test("gated contacts do not extend the window (resting chatter sounds once per window, not never)", () => {
    const g = createImpactGate();
    let sounded = 0;
    // 1 s of a contact chattering every 5 ms at the same speed.
    for (let i = 0; i < 200; i++) if (g.admit("plastic", 0.8, i * 0.005) > 0) sounded++;
    // 65 ms window on a 5 ms grid: every 13th (or, with float rounding, 14th) contact -> 15-16 in a second. A gate whose
    // window slid with every gated contact would sound exactly once.
    expect(DEBOUNCE.plastic).toBe(0.065);
    expect(sounded).toBeGreaterThanOrEqual(15);
    expect(sounded).toBeLessThanOrEqual(16);
  });

  test("slow contacts never sound and never arm the window", () => {
    const g = createImpactGate();
    expect(g.admit("paper", 0.1, 0)).toBe(0);
    expect(g.admit("paper", 0.5, 0.001)).toBeGreaterThan(0);
  });

  test("the level is the speed curve", () => {
    const g = createImpactGate();
    expect(g.admit("vinyl", 1.3, 0)).toBe(impactLevel(1.3));
  });

  test("reset clears every window", () => {
    const g = createImpactGate();
    g.admit("metal", 1, 0);
    g.reset();
    expect(g.admit("metal", 1, 0.001)).toBeGreaterThan(0);
  });
});

describe("voice pool (fake clock)", () => {
  type V = VoiceHandle & { stoppedAt?: number; id: number };
  let id = 0;
  const voice = (level: number, start: number, len = 1): V => {
    const v: V = { id: id++, level, start, end: start + len, stop: (at) => (v.stoppedAt = at) };
    return v;
  };

  test(`never more than ${MAX_VOICES} voices`, () => {
    const p = createVoicePool();
    const vs = Array.from({ length: 40 }, (_, i) => voice(Math.random(), i * 0.001));
    vs.forEach((v, i) => {
      p.claim(v, v.start, i % 3 === 0);
      expect(p.active(v.start)).toBeLessThanOrEqual(MAX_VOICES);
    });
    expect(MAX_VOICES).toBe(6);
  });

  test("a quieter impact is dropped when full; nothing is stolen", () => {
    const p = createVoicePool(6);
    const vs = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((l, i) => voice(l, i * 0.01));
    for (const v of vs) expect(p.claim(v, v.start)).toBe(true);
    expect(p.claim(voice(0.4, 0.1), 0.1)).toBe(false);
    expect(p.claim(voice(0.5, 0.1), 0.1)).toBe(false); // equal is not louder
    expect(vs.every((v) => v.stoppedAt === undefined)).toBe(true);
    expect(p.active(0.1)).toBe(6);
  });

  test("a louder impact steals the quietest voice and stops it now", () => {
    const p = createVoicePool(6);
    const vs = [0.7, 0.3, 0.9, 0.3, 0.8, 1].map((l, i) => voice(l, i * 0.01));
    for (const v of vs) p.claim(v, v.start);
    expect(p.claim(voice(0.95, 0.2), 0.2)).toBe(true);
    // Two voices at 0.3: the older one goes.
    expect(vs[1]!.stoppedAt).toBe(0.2);
    expect(vs[3]!.stoppedAt).toBeUndefined();
    expect(p.active(0.2)).toBe(6);
  });

  test("a UI sound (force) always plays and steals the oldest voice", () => {
    const p = createVoicePool(6);
    const vs = [0.9, 0.1, 0.5, 0.5, 0.5, 0.5].map((l, i) => voice(l, i * 0.01));
    for (const v of vs) p.claim(v, v.start);
    expect(p.claim(voice(0.01, 0.2), 0.2, true)).toBe(true);
    expect(vs[0]!.stoppedAt).toBe(0.2);
    expect(vs.slice(1).every((v) => v.stoppedAt === undefined)).toBe(true);
  });

  test("finished voices free their slots as the clock moves", () => {
    const p = createVoicePool(6);
    for (let i = 0; i < 6; i++) p.claim(voice(0.5, 0, 0.1 + i * 0.1), 0);
    expect(p.active(0.05)).toBe(6);
    expect(p.active(0.25)).toBe(4);
    expect(p.claim(voice(0.1, 0.25), 0.25)).toBe(true);
    expect(p.active(0.25)).toBe(5);
    expect(p.active(10)).toBe(0);
  });

  test("clear empties the pool", () => {
    const p = createVoicePool(2);
    p.claim(voice(1, 0), 0);
    p.claim(voice(1, 0), 0);
    p.clear();
    expect(p.active(0)).toBe(0);
  });
});
