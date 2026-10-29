/*
 * Headless behaviour check of the pouch addon in its stand-in host (scripts/harness/pouch.html, manual frames):
 *   settle -> idle (update() false), slow tilt 15 deg (nothing moves) and 30 deg (everything slides down and rests), the Shake
 *   button, a frame-driven board shake, hover + click -> onPick, drag + fling, close / open settle, device motion (both sign
 *   conventions, a jolt, flat), a language switch in place (setProfile: nothing moves, nothing is allocated), dispose (GPU memory
 *   back to the host's baseline). Every frame: all bodies inside the pouch.
 *   # from the repo root: bunx vite --port 5212 --host 127.0.0.1 &
 *   bun scripts/harness/pouch.check.ts --base http://127.0.0.1:5212
 * Exit code 1 when a check fails. Headless only (ANGLE / Metal), never a visible window.
 */
import { chromium, type Page } from "playwright-core";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const base = arg("base", "http://127.0.0.1:5212");
const seed = arg("seed", "7");

type St = { id: string; x: number; y: number; angle: number; vx: number; vy: number; w: number; layer: number; held: boolean; ghost?: boolean };
type Spec = { id: string; w: number; h: number; layer: number; shape: "rect" | "circle" | "capsule"; radius?: number };
type Fr = { ax: number; ay: number; gn: number; omega: number; alpha: number };
type Host = {
  ready: boolean;
  advance(dt: number, n: number): boolean;
  setTilt(x: number, y?: number): void;
  shake(s?: number): void;
  shakeBook(s?: number): void;
  setOpen(c: number): void;
  states(): St[];
  specs(): Spec[];
  simStats(): { substeps: number; wallClamps: number; nanResets: number };
  frame(): Fr;
  idle(): boolean;
  held(): string | null;
  hitAt(x: number, y: number): string | null;
  screenOf(id: string, dx?: number, dy?: number): { x: number; y: number };
  screenOfLocal(x: number, y: number, z?: number): { x: number; y: number };
  log: { picks: string[]; hovers: (string | null)[]; impacts: { speed: number; kind: string; pan: number; t: number }[]; sounds: { name: string; gain?: number; pan?: number; t: number }[] };
  stats: { frames: number; updates: number; lastActive: boolean; updateMs: number; updateMaxMs: number };
  enableMotion(): Promise<string>;
  disableMotion(): void;
  feedMotion(x: number, y: number, z: number): void;
  dispose(): { before: { geometries: number; textures: number }; after: { geometries: number; textures: number }; children: number };
  baseline: { geometries: number; textures: number };
  info(): { geometries: number; textures: number };
  setLang(lang: "en" | "zh"): Promise<boolean>;
};
declare const window: { __host: Host } & Pick<typeof globalThis, "setInterval" | "clearInterval">;

const PW = 0.23, PH = 0.32;
/**
 * Tolerances. OUT: a body may press this far past the usable area (into the 3 mm film pillow, invisible) when a pile or an
 * impact leans on it: planck's contact slop. DEPTH: same-layer overlap that still reads as touching at pouch scale.
 */
const OUT = 0.002;
const DEPTH = 0.0015;
const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const mm = (m: number) => (m * 1000).toFixed(2);

/* ── geometry of the sim's own shapes (rect / circle / capsule), as signed distance functions ── */
function sdf(sp: Spec, s: St, px: number, py: number): number {
  const dx = px - s.x, dy = py - s.y, c = Math.cos(s.angle), sn = Math.sin(s.angle);
  const u = dx * c + dy * sn, v = -dx * sn + dy * c;
  if (sp.shape === "circle") return Math.hypot(u, v) - (sp.radius ?? Math.min(sp.w, sp.h) / 2);
  if (sp.shape === "capsule") {
    const half = Math.min(sp.w, sp.h) / 2;
    const r = Math.min(sp.radius ?? half, half);
    const long = sp.w >= sp.h;
    const a = (long ? sp.w : sp.h) / 2 - r;
    const [p, q] = long ? [u, v] : [v, u];
    return Math.hypot(Math.max(Math.abs(p) - a, 0), q) - r;
  }
  const qx = Math.abs(u) - sp.w / 2, qy = Math.abs(v) - sp.h / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
/** Points on a shape's boundary (star-shaped from its centre), pouch coordinates. */
function boundary(sp: Spec, s: St, n = 96): [number, number][] {
  const out: [number, number][] = [];
  const R = Math.hypot(sp.w, sp.h);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, cx = Math.cos(t), cy = Math.sin(t);
    let lo = 0, hi = R;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (sdf(sp, s, s.x + cx * mid, s.y + cy * mid) < 0) lo = mid;
      else hi = mid;
    }
    out.push([s.x + cx * lo, s.y + cy * lo]);
  }
  return out;
}
/** Deepest same-layer penetration (m) and the worst excursion past the pouch edge (m). */
function audit(specs: Spec[], st: St[]) {
  let depth = 0, pair = "", outside = 0;
  const pts = st.map((s, i) => boundary(specs[i]!, s));
  for (let i = 0; i < st.length; i++) {
    for (const [x, y] of pts[i]!) outside = Math.max(outside, Math.abs(x) - PW / 2, Math.abs(y) - PH / 2);
    for (let j = 0; j < st.length; j++) {
      if (i === j) continue;
      const a = st[i]!, b = st[j]!;
      // ghosts (held, or released over a body of their layer and waiting) are drawn on the top layer and collide with nothing
      if (a.ghost || b.ghost || a.layer !== specs[i]!.layer || b.layer !== specs[j]!.layer || specs[i]!.layer !== specs[j]!.layer) continue;
      for (const [x, y] of pts[i]!) {
        const d = -sdf(specs[j]!, b, x, y);
        if (d > depth) {
          depth = d;
          pair = `${a.id}/${b.id}`;
        }
      }
    }
  }
  return { depth, pair, outside };
}
/** Each body rests on the low edge (-y), or on a same-layer body below it, within `tol`. */
function supported(specs: Spec[], st: St[], tol: number) {
  const bad: string[] = [];
  st.forEach((s, i) => {
    const sp = specs[i]!;
    const pts = boundary(sp, s);
    const low = Math.min(...pts.map((p) => p[1]));
    if (low <= -PH / 2 + tol) return;
    const lowest = pts.filter((p) => p[1] <= low + 0.03);
    const onOther = st.some((o, j) => j !== i && specs[j]!.layer === sp.layer && o.y < s.y && lowest.some(([x, y]) => sdf(specs[j]!, o, x, y) < tol));
    if (!onOther) bad.push(`${s.id}@${mm(low + PH / 2)}mm`);
  });
  return bad;
}
const maxMove = (a: St[], b: St[]) => Math.max(...a.map((s, i) => Math.hypot(s.x - b[i]!.x, s.y - b[i]!.y)));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errors: string[] = [];
let page: Page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${base}/scripts/harness/pouch.html?manual=1&ui=0&seed=${seed}`);
  await page.waitForFunction("window.__host && window.__host.ready === true", undefined, { timeout: 30000 });
  const specs = await page.evaluate(() => window.__host.specs());
  const states = () => page.evaluate(() => window.__host.states());
  const adv = (n = 1) => page.evaluate((n) => window.__host.advance(1 / 60, n), n);
  /** Sound hooks logged since a mark (counts of impacts / sounds) */
  const mark = () => page.evaluate(() => ({ i: window.__host.log.impacts.length, s: window.__host.log.sounds.length }));
  const since = (m: { i: number; s: number }) => page.evaluate((m) => ({ impacts: window.__host.log.impacts.slice(m.i), sounds: window.__host.log.sounds.slice(m.s) }), m);
  const KINDS = new Set(["card", "resume", "ticket", "polaroid", "note"]);
  const fmtImpacts = (xs: { speed: number; kind: string; pan: number }[]) => xs.slice(0, 6).map((x) => `${x.kind} ${x.speed.toFixed(2)} m/s pan ${x.pan.toFixed(2)}`).join("; ");
  /** Advance frame by frame (up to `max`), auditing every frame; returns frames until update() went quiet (-1: never). */
  async function run(max: number, opts: { untilQuiet?: boolean; each?: (i: number) => Promise<void> } = {}) {
    let worstOut = -1, worstDepth = 0, pair = "", quietAt = -1, vmax = 0;
    for (let i = 0; i < max; i++) {
      if (opts.each) await opts.each(i);
      const active = await adv(1);
      const st = await states();
      const a = audit(specs, st);
      worstOut = Math.max(worstOut, a.outside);
      if (a.depth > worstDepth) {
        worstDepth = a.depth;
        pair = a.pair;
      }
      vmax = Math.max(vmax, ...st.map((s) => Math.hypot(s.vx, s.vy)));
      if (!active && quietAt < 0) {
        quietAt = i + 1;
        if (opts.untilQuiet) break;
      }
    }
    return { worstOut, worstDepth, pair, quietAt, vmax };
  }

  // ── 1. settle
  {
    const r = await run(600, { untilQuiet: true });
    const st = await states();
    const a = audit(specs, st);
    check("settles and update() returns false (host may stop rendering)", r.quietAt > 0, `quiet after ${r.quietAt} frames`);
    check("dealt layout: inside the pouch, no visible same-layer overlap", a.outside <= OUT && a.depth <= DEPTH, `outside ${mm(a.outside)} mm, deepest ${mm(a.depth)} mm ${a.pair}`);
    const before = await states();
    const m0 = await mark();
    await adv(120);
    check("idle costs nothing: 2 s of frames move nothing", maxMove(before, await states()) === 0, `${mm(maxMove(before, await states()))} mm`);
    const quiet = await since(m0);
    check("sound: a resting pouch is silent (no impacts, no sounds)", quiet.impacts.length === 0 && quiet.sounds.length === 0, `${quiet.impacts.length} impacts, ${quiet.sounds.length} sounds`);
  }

  // ── 2. tilt: 15 deg (below the ~20 deg breakaway) holds, 30 deg slides everything to the low edge
  {
    const before = await states();
    const ramp = (from: number, to: number, n: number) => async (i: number) => {
      if (i < n) await page.evaluate((d) => window.__host.setTilt(d, 0), from + ((to - from) * (i + 1)) / n);
    };
    const m15a = await mark();
    const r15 = await run(150, { each: ramp(0, 15, 60) });
    const m15 = maxMove(before, await states());
    check("tilt 15 deg over 1 s: nothing slides", m15 < 0.0005, `max move ${mm(m15)} mm, inside ${r15.worstOut <= OUT}`);
    const q15 = await since(m15a);
    check("sound: tilting 15 deg (nothing slides) is silent", q15.impacts.length === 0, fmtImpacts(q15.impacts));
    const m30a = await mark();
    // a capsule leaning on a disc can take several seconds to topple over on a slope: give it 12 s
    const r30 = await run(720, { each: ramp(15, 30, 30) });
    const st = await states();
    const meanDrop = before.reduce((a, s, i) => a + (s.y - st[i]!.y), 0) / st.length;
    const bad = supported(specs, st, 0.002);
    check("tilt 30 deg: every object slid down to the low edge (or onto one resting there)", bad.length === 0 && meanDrop > 0.05, `mean drop ${mm(meanDrop)} mm, unsupported: ${bad.join(", ") || "none"}`);
    check("tilt 30 deg: inside the pouch and no same-layer overlap on any frame", r30.worstOut <= OUT && r30.worstDepth <= DEPTH, `outside ${mm(r30.worstOut)} mm, deepest ${mm(r30.worstDepth)} mm ${r30.pair}`);
    check("tilted and at rest: update() goes quiet again", r30.quietAt > 0, `quiet at frame ${r30.quietAt}`);
    const s30 = await since(m30a);
    console.log(`  tilt 30: ${s30.impacts.length} impacts, e.g. ${fmtImpacts(s30.impacts)}`);
    check("sound: sliding down at 30 deg knocks (impacts reported, valid kinds, |pan| <= 1)", s30.impacts.length > 0 && s30.impacts.every((x) => KINDS.has(x.kind) && Math.abs(x.pan) <= 1 && x.speed >= 0.1), `${s30.impacts.length} impacts`);
    await run(240, { each: ramp(30, 0, 60) });
  }

  // ── 3. the Shake button
  {
    const before = await states();
    const ms = await mark();
    await page.evaluate(() => window.__host.shake(1));
    const r = await run(900, { untilQuiet: true });
    const after = await states();
    const stats = await page.evaluate(() => window.__host.simStats());
    const ss = await since(ms);
    const shakes = ss.sounds.filter((x) => x.name === "shake");
    console.log(`  shake: sounds ${JSON.stringify(ss.sounds.map((x) => [x.name, x.gain]))}, ${ss.impacts.length} impacts over ${((ss.impacts.at(-1)?.t ?? 0) - (ss.impacts[0]?.t ?? 0)).toFixed(2)} s, top ${fmtImpacts([...ss.impacts].sort((a, b) => b.speed - a.speed))}`);
    check("sound: Shake -> one 'shake' sound and a burst of impacts (valid kinds, speeds >= 0.1 m/s, |pan| <= 1)", shakes.length === 1 && ss.sounds.length === 1 && ss.impacts.length >= 3 && ss.impacts.every((x) => KINDS.has(x.kind) && Math.abs(x.pan) <= 1 && x.speed >= 0.1), `${shakes.length} shake sounds, ${ss.impacts.length} impacts`);
    const moves = after.map((s, i) => Math.hypot(s.x - before[i]!.x, s.y - before[i]!.y));
    const movedN = moves.filter((m) => m > 0.01).length;
    check("Shake button: things are thrown (peak speed) and rearranged (most move > 10 mm)", r.vmax > 0.4 && movedN >= after.length - 2, `peak ${r.vmax.toFixed(2)} m/s, moves ${moves.map((m, i) => `${after[i]!.id} ${mm(m)}`).join(", ")} mm`);
    check("Shake button: inside the pouch and no same-layer overlap on any frame, guards never fired", r.worstOut <= OUT && r.worstDepth <= DEPTH && stats.wallClamps === 0 && stats.nanResets === 0, `outside ${mm(r.worstOut)} mm, deepest ${mm(r.worstDepth)} mm ${r.pair}, clamps ${stats.wallClamps}, NaN ${stats.nanResets}`);
    check("Shake button: comes to rest and update() goes quiet", r.quietAt > 0, `quiet after ${(r.quietAt / 60).toFixed(2)} s`);
  }

  // ── 4. a frame-driven shake (the board itself shakes: apparent acceleration from the anchor's matrices)
  {
    const before = await states();
    await page.evaluate(() => window.__host.shakeBook(1));
    const r = await run(900, { untilQuiet: true });
    const m = maxMove(before, await states());
    check("board shake (frame acceleration): things move, stay inside, rest again", m > 0.005 && r.worstOut <= OUT && r.worstDepth <= DEPTH && r.quietAt > 0, `max move ${mm(m)} mm, peak ${r.vmax.toFixed(2)} m/s, outside ${mm(r.worstOut)} mm, deepest ${mm(r.worstDepth)} mm, quiet after ${(r.quietAt / 60).toFixed(2)} s`);
  }

  // ── 5. hover + click -> onPick
  let target = "";
  let tp = { x: 0, y: 0 };
  {
    const st = await states();
    for (const s of [...st].sort((a, b) => b.layer - a.layer)) {
      const p = await page.evaluate((id) => window.__host.screenOf(id), s.id);
      if ((await page.evaluate(([x, y]) => window.__host.hitAt(x!, y!), [p.x, p.y])) === s.id) {
        target = s.id;
        tp = p;
        break;
      }
    }
    await page.mouse.move(tp.x, tp.y);
    const hovers = await page.evaluate(() => window.__host.log.hovers.slice());
    check("hover over an object reports it (tooltip), hover() true", hovers[hovers.length - 1] === target, `hovered ${hovers[hovers.length - 1]}`);
    const before = await states();
    const mc = await mark();
    await page.mouse.down();
    await adv(2);
    await page.mouse.move(tp.x + 2, tp.y + 1);
    await page.mouse.up();
    await adv(30);
    const sc = await since(mc);
    console.log(`  click: ${JSON.stringify(sc.sounds.map((x) => [x.name, x.gain && +x.gain.toFixed(2), x.pan && +x.pan.toFixed(2)]))}`);
    check("sound: a click lifts and sets down (pickUp, then a soft drop)", sc.sounds.map((x) => x.name).join(",") === "pickUp,drop" && Math.abs((sc.sounds[1]?.gain ?? 0) - 0.35) < 0.01, JSON.stringify(sc.sounds));
    const picks = await page.evaluate(() => window.__host.log.picks.slice());
    check("click (< 6 px, < 250 ms) -> onPick(id)", picks[picks.length - 1] === target, `picked ${picks.join(",")}`);
    const m = maxMove(before, await states());
    check("a click barely moves the object", m < 0.003, `${mm(m)} mm`);
    await page.mouse.move(8, 8);
    const h2 = await page.evaluate(() => window.__host.log.hovers.slice());
    check("hover off the objects reports null", h2[h2.length - 1] === null, `last ${h2[h2.length - 1]}`);
    await run(300, { untilQuiet: true });
  }

  // ── 6. drag and fling
  {
    const picks0 = (await page.evaluate(() => window.__host.log.picks.length));
    const p = await page.evaluate((id) => window.__host.screenOf(id), target);
    const s0 = (await states()).find((s) => s.id === target)!;
    await page.mouse.move(p.x, p.y);
    const mf = await mark();
    await page.mouse.down();
    await adv(3);
    const heldNow = await page.evaluate(() => window.__host.held());
    const sh = (await states()).find((s) => s.id === target)!;
    check("press on an object claims the gesture: held, on the top layer", heldNow === target && sh.held && sh.layer === 2, `held ${heldNow}, layer ${sh.layer}`);
    // up toward the open middle of the pouch, so the walls do not stop it and it lands where its layer is free (a released body over
    // another on its layer waits as a ghost on top until it is moved: by design, but not what this check is about)
    const c = await page.evaluate(() => window.__host.screenOfLocal(0, 0.08));
    const len = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const ux = (c.x - p.x) / len, uy = (c.y - p.y) / len;
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(p.x + 24 * i * ux, p.y + 24 * i * uy);
      await page.waitForTimeout(16);
      await adv(1);
    }
    await page.mouse.up();
    const r0 = (await states()).find((s) => s.id === target)!;
    const speed = Math.hypot(r0.vx, r0.vy);
    const r = await run(900, { untilQuiet: true });
    const s1 = (await states()).find((s) => s.id === target)!;
    const picks1 = await page.evaluate(() => window.__host.log.picks.length);
    check("drag follows the pointer and a fling releases with the pointer's velocity (capped by the sim)", speed > 0.1 && Math.hypot(s1.x - s0.x, s1.y - s0.y) > 0.03, `release ${speed.toFixed(2)} m/s, travelled ${mm(Math.hypot(s1.x - s0.x, s1.y - s0.y))} mm`);
    check("a drag is not a click", picks1 === picks0, `picks ${picks0} -> ${picks1}`);
    const sf = await since(mf);
    console.log(`  fling: ${JSON.stringify(sf.sounds.map((x) => [x.name, x.gain && +x.gain.toFixed(2), x.pan && +x.pan.toFixed(2)]))}, then ${sf.impacts.length} impacts ${fmtImpacts(sf.impacts)}`);
    // dropGain: 0.35 for a set-down, smoothstep up to 1 at 1.5 m/s (this harness's fling is a gentle one)
    const k = Math.min(1, speed / 1.5);
    const want = 0.35 + 0.65 * k * k * (3 - 2 * k);
    // (the release speed itself depends on real event timing, see the check above: a late pointerup can make it 0)
    check("sound: a fling is pickUp then a drop whose gain follows the release speed (louder than a set-down when it moves)", sf.sounds.map((x) => x.name).join(",") === "pickUp,drop" && (speed < 0.05 || (sf.sounds[1]?.gain ?? 0) > 0.35) && Math.abs((sf.sounds[1]?.gain ?? 0) - want) < 0.03, `${JSON.stringify(sf.sounds)}, release ${speed.toFixed(2)} m/s -> want ${want.toFixed(3)}`);
    check("fling: stays inside, no overlap, rests, update() quiet", r.worstOut <= OUT && r.worstDepth <= DEPTH && r.quietAt > 0, `outside ${mm(r.worstOut)} mm, deepest ${mm(r.worstDepth)} mm ${r.pair}, quiet after ${(r.quietAt / 60).toFixed(2)} s`);
  }

  // ── 7. close / open: frozen while closed, a small settle when the folio has opened
  {
    await page.evaluate(() => window.__host.setOpen(0));
    const r0 = await run(120, { untilQuiet: true });
    const closedSt = await states();
    const mx = await mark();
    await page.evaluate(() => window.__host.shake(1));
    await adv(30);
    check("closed: update() goes quiet, the Shake button does nothing", r0.quietAt > 0 && maxMove(closedSt, await states()) === 0, `quiet after ${r0.quietAt} frames`);
    const sx = await since(mx);
    check("sound: closed, Shake is silent (no shake sound, no impacts)", sx.sounds.length === 0 && sx.impacts.length === 0, JSON.stringify(sx));
    const before = await states();
    let peak = 0;
    // the cover tween: the engine renders (and calls update) on every frame of it
    await run(30, { each: async (i) => page.evaluate((c) => window.__host.setOpen(c), (i + 1) / 30) });
    const r = await run(240, { untilQuiet: true, each: async () => void (peak = Math.max(peak, maxMove(before, await states()))) });
    const m = maxMove(before, await states());
    check("opened: a small natural settle (objects shift a hair, no jump), then quiet", m > 0.0001 && m < 0.006 && peak < 0.008 && r.quietAt > 0, `final shift ${mm(m)} mm, peak ${mm(peak)} mm, quiet after ${(r.quietAt / 60).toFixed(2)} s`);
  }

  // ── 8. device motion (synthetic DeviceMotionEvents: no permission prompt on desktop Chrome, 127.0.0.1 is a secure context)
  {
    const feedN = (x: number, y: number, z: number) => async () => page.evaluate(([x, y, z]) => window.__host.feedMotion(x!, y!, z!), [x, y, z]);
    // W3C convention, phone held upright: the reading is the reaction to gravity, +y
    const status = await page.evaluate(async () => {
      const iv = setInterval(() => window.__host.feedMotion(0, 9.81, 0.3), 16);
      const s = await window.__host.enableMotion();
      clearInterval(iv);
      return s;
    });
    check("enableMotion() resolves granted once samples arrive", status === "granted", status);
    const before = await states();
    const up = feedN(0, 9.81, 0.3);
    const r = await run(360, { each: up });
    const f = await page.evaluate(() => window.__host.frame());
    const st = await states();
    const bad = supported(specs, st, 0.002);
    const meanDrop = before.reduce((a, s, i) => a + (s.y - st[i]!.y), 0) / st.length;
    check("phone upright (W3C sign): apparent gravity along -y, normal load ~0", f.ay < -9 && Math.abs(f.gn) < 0.6, `ax ${f.ax.toFixed(2)} ay ${f.ay.toFixed(2)} gn ${f.gn.toFixed(2)}`);
    // five objects fill most of the pouch (the 182 mm note and the résumé leave little room to fall): 40 mm on average is a full slide
    check("phone upright: everything slides to the bottom of the pouch and rests there", bad.length === 0 && meanDrop > 0.04 && r.worstOut <= OUT && r.worstDepth <= DEPTH, `mean drop ${mm(meanDrop)} mm, unsupported ${bad.join(",") || "none"}, deepest ${mm(r.worstDepth)} mm`);
    // laid flat: desk-like (the gravity low-pass runs on the samples' real arrival times: feed at a phone's 60 Hz)
    await run(90, { each: async () => (await feedN(0, 0, 9.81)(), await page.waitForTimeout(16)) });
    const ff = await page.evaluate(() => window.__host.frame());
    check("phone flat: no in-plane push, full normal load", Math.hypot(ff.ax, ff.ay) < 0.3 && Math.abs(ff.gn - 9.81) < 0.3, `ax ${ff.ax.toFixed(2)} ay ${ff.ay.toFixed(2)} gn ${ff.gn.toFixed(2)}`);
    // a jolt to the right: things are thrown to the left
    const b2 = await states();
    const rj = await run(240, { each: async (i) => (i < 4 ? feedN(30, 0, 9.81)() : feedN(0, 0, 9.81)()) });
    const a2 = await states();
    const dx = b2.reduce((a, s, i) => a + (a2[i]!.x - s.x), 0) / a2.length;
    check("a jolt of the phone throws things the other way, inside the pouch", dx < -0.002 && rj.worstOut <= OUT, `mean dx ${mm(dx)} mm, peak ${rj.vmax.toFixed(2)} m/s`);
    // the other sign convention (platforms that report gravity itself): same apparent gravity after calibration
    await page.evaluate(() => window.__host.disableMotion());
    const s2 = await page.evaluate(async () => {
      const iv = setInterval(() => window.__host.feedMotion(0, -9.81, -0.3), 16);
      const s = await window.__host.enableMotion();
      clearInterval(iv);
      return s;
    });
    await run(30, { each: feedN(0, -9.81, -0.3) });
    const f2 = await page.evaluate(() => window.__host.frame());
    check("phone upright (gravity-sign platform): same apparent gravity after auto-calibration", s2 === "granted" && f2.ay < -9 && Math.abs(f2.gn) < 0.6, `ay ${f2.ay.toFixed(2)} gn ${f2.gn.toFixed(2)}`);
    await page.evaluate(() => window.__host.disableMotion());
    await run(30);
    const f3 = await page.evaluate(() => window.__host.frame());
    check("motion off: back to the desk's gravity", Math.abs(f3.gn - 9.81) < 0.1 && Math.hypot(f3.ax, f3.ay) < 0.1, `gn ${f3.gn.toFixed(2)}`);
    await run(600, { untilQuiet: true });
  }

  // ── 8b. another language, in place (brief r4 E1): the same objects print the other words; nothing moves, nothing is allocated
  {
    const before = await page.evaluate(() => ({ s: window.__host.states(), m: window.__host.info() }));
    const ok = await page.evaluate(async () => (await window.__host.setLang("zh")) && (await window.__host.setLang("en")) && (await window.__host.setLang("zh")));
    await run(5);
    const after = await page.evaluate(() => ({ s: window.__host.states(), m: window.__host.info() }));
    const moved = Math.max(...after.s.map((a) => {
      const b = before.s.find((x) => x.id === a.id)!;
      return Math.hypot(a.x - b.x, a.y - b.y) * 1000;
    }));
    check("a language switch repaints in place: nothing moves, no geometry or texture is added", ok && moved < 0.01 && after.m.geometries === before.m.geometries && after.m.textures === before.m.textures, `swapped ${ok}, moved ${moved.toFixed(3)} mm, ${before.m.geometries} -> ${after.m.geometries} geo, ${before.m.textures} -> ${after.m.textures} tex`);
    await page.evaluate(() => window.__host.setLang("en"));
  }

  // ── 9. cost and dispose
  {
    const s = await page.evaluate(() => window.__host.stats);
    console.log(`update(): ${s.updates} calls, mean ${(s.updateMs / s.updates).toFixed(3)} ms, max ${s.updateMaxMs.toFixed(2)} ms (sim + objects, headless Chrome)`);
    const d = await page.evaluate(() => window.__host.dispose());
    const b = await page.evaluate(() => window.__host.baseline);
    check("dispose frees every geometry and texture the pouch made", d.after.geometries === b.geometries && d.after.textures === b.textures && d.children === 0, `before ${d.before.geometries} geo / ${d.before.textures} tex, after ${d.after.geometries} / ${d.after.textures}, host baseline ${b.geometries} / ${b.textures}`);
  }
  check("no console errors or warnings", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
