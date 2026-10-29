import { describe, expect, test } from "bun:test";
import { SIM_HZ } from "../constants";
import { createBagSim } from "./world";
import { OPTS, SUBSTEP, chaosSchedule, tilted } from "./testkit";

/** Mean wall-clock cost of one 120 Hz substep (everything included: friction pass, planck step with bullets, guards, ghost retry, state output). */
function measure(agitate: (sim: ReturnType<typeof createBagSim>, i: number) => void, frame: (t: number) => ReturnType<typeof tilted>, seconds: number) {
  const sim = createBagSim(OPTS);
  const total = Math.round(seconds * SIM_HZ);
  const times: number[] = [];
  for (let i = 0; i < total; i++) {
    agitate(sim, i);
    const before = sim.stats().substeps;
    const t0 = performance.now();
    sim.step(SUBSTEP, frame(i / SIM_HZ));
    const dt = performance.now() - t0;
    if (sim.stats().substeps > before) times.push(dt); // idle frames cost nothing and are not counted
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { mean, p50: times[Math.floor(times.length * 0.5)]!, p95: times[Math.floor(times.length * 0.95)]!, max: times[times.length - 1]!, n: times.length };
}

describe("performance (7 bodies, bun/JSC, all bodies bullets)", () => {
  test("mean cost per 120 Hz substep is below 0.15 ms, in a pouch that is always being thrown around", () => {
    const chaos = chaosSchedule(17);
    // warm-up (JIT), then best of three runs so a busy machine does not decide the verdict
    measure(() => {}, (t) => chaos(t % 20), 5);
    const runs = [0, 1, 2].map(() => measure((sim, i) => { if (i % 30 === 0) sim.shake(1.2); }, (t) => chaos(t % 20), 25));
    const best = runs.reduce((a, b) => (a.mean <= b.mean ? a : b));
    console.log(`substep cost, agitated: mean ${best.mean.toFixed(4)} ms, p50 ${best.p50.toFixed(4)}, p95 ${best.p95.toFixed(4)}, max ${best.max.toFixed(3)} (${best.n} substeps; runs: ${runs.map((r) => r.mean.toFixed(4)).join(" / ")})`);
    expect(best.mean).toBeLessThan(0.15);
  });
  test("a rotating pouch (per-body Euler / centrifugal / Coriolis terms) stays under the budget too", () => {
    const rot = (t: number) => ({ ...tilted(0.6), omega: 6 * Math.sin(t * 3), alpha: 18 * Math.cos(t * 3) });
    measure(() => {}, rot, 3);
    const runs = [0, 1, 2].map(() => measure((sim, i) => { if (i % 40 === 0) sim.shake(1); }, rot, 15));
    const best = runs.reduce((a, b) => (a.mean <= b.mean ? a : b));
    console.log(`substep cost, rotating frame: mean ${best.mean.toFixed(4)} ms, p50 ${best.p50.toFixed(4)}, p95 ${best.p95.toFixed(4)}, max ${best.max.toFixed(3)} (${best.n} substeps)`);
    expect(best.mean).toBeLessThan(0.15);
  });
});
