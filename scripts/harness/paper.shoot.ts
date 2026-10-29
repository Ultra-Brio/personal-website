import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

/*
 * Headless screenshots and behaviour checks of the paper viewer harness (scripts/harness/paper.html). Never opens a visible window.
 *   bun scripts/harness/paper.shoot.ts [--base http://127.0.0.1:5188] [--out <dir>] [<name-prefix>]
 * Start the dev server first. Time is driven deterministically (manual mode, 60 Hz advance), so the shots are reproducible.
 * Résumé: the first view at rest, a click turn at 30 / 60 / 90 %, the next view at rest, a hover peek, a pointer drag of the corner.
 * A wide host (1440x900) binds the résumé as a book of spreads: the sample is one spread (pages 1–2, nothing to turn), so the turning
 * checks there use a longer résumé (long=1: spreads 1–2 and 3–4, the turning leaf is sheet 1). A phone (390x844) shows loose pages.
 * Card: closed, half open, open, a drag back. Logs the largest per-frame change of any link angle in every motion.
 * Checks: keys (and that they fall through to the dialog at the ends), click halves, the Chinese sample, no-WebGL rejection, dispose.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = `${flag("--base", "http://127.0.0.1:5188")}/scripts/harness/paper.html`;
const OUT = flag("--out", join(tmpdir(), "sasshi-paper-shots"));
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base" && args[i - 1] !== "--out");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(2)}°`;
function expect(ok: boolean, what: string) {
  if (!ok) throw new Error(`expected ${what}`);
  say(`  ✓ ${what}`);
}

type Stats = { frameMax: number; max: number; progress: number[] };
type Viewer = {
  next(): void;
  prev(): void;
  dispose(): void;
  setDark(d: boolean): void;
  state: { page: number; count: number; first?: number; last?: number; total?: number };
  debug: { project(x: number, y: number, z: number): [number, number]; renderer: { getContext(): WebGL2RenderingContext; domElement: HTMLCanvasElement } };
};
type Api = { ready: boolean; error?: string; manual(on: boolean): void; advance(dt: number, frames?: number): void; stats(): Stats; viewer: Viewer };
type W = { __paper: Api };
const api = (p: Page) => ({
  advance: (frames: number) => p.evaluate((f) => (window as unknown as W).__paper.advance(1 / 60, f), frames),
  stats: () => p.evaluate(() => (window as unknown as W).__paper.stats()),
  next: () => p.evaluate(() => (window as unknown as W).__paper.viewer.next()),
  prev: () => p.evaluate(() => (window as unknown as W).__paper.viewer.prev()),
  state: () => p.evaluate(() => ({ ...(window as unknown as W).__paper.viewer.state })),
  project: (x: number, y: number, z = 0) => p.evaluate(([x, y, z]) => (window as unknown as W).__paper.viewer.debug.project(x!, y!, z!), [x, y, z] as const),
});

async function open(q: string, vp: { width: number; height: number }, dpr = 2, init?: () => void) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, hasTouch: phone, isMobile: phone });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  page.on("pageerror", (e) => say(`  pageerror: ${e.message}`));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !m.text().includes("404")) say(`  console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${BASE}?${q}`);
  await page.waitForFunction(() => (window as unknown as { __paper?: Api }).__paper?.ready === true, null, { timeout: 20000 });
  return { page, ctx };
}
async function openViewer(q: string, vp: { width: number; height: number }, dpr = 2) {
  const o = await open(q, vp, dpr);
  const err = await o.page.evaluate(() => (window as unknown as W).__paper.error);
  if (err) throw new Error(`viewer rejected: ${err}`);
  await o.page.evaluate(() => (window as unknown as W).__paper.manual(true));
  // let the canvas fade in, settle the camera
  await o.page.waitForTimeout(350);
  await api(o.page).advance(30);
  return o;
}

async function run(name: string, fn: () => Promise<void>) {
  if (only && !name.startsWith(only)) return;
  try {
    await fn();
    say(`ok ${name}`);
  } catch (e) {
    say(`FAIL ${name} ${String(e)}`);
    process.exitCode = 1;
  }
}

/** advance one 60 Hz frame at a time; returns the worst per-frame link-angle change */
async function frames(page: Page, n: number, until?: (s: Stats) => boolean): Promise<{ worst: number; n: number; s: Stats }> {
  const a = api(page);
  let worst = 0;
  let s = await a.stats();
  let i = 0;
  for (; i < n; i++) {
    await a.advance(1);
    s = await a.stats();
    worst = Math.max(worst, s.frameMax);
    if (until?.(s)) {
      i++;
      break;
    }
  }
  return { worst, n: i, s };
}

/** step until progress[idx] crosses each mark; screenshot at each */
async function turnShots(page: Page, prefix: string, marks: number[], idx = 0) {
  let worst = 0;
  let total = 0;
  for (const m of marks) {
    const r = await frames(page, 400, (s) => (s.progress[idx] ?? 0) >= m);
    worst = Math.max(worst, r.worst);
    total += r.n;
    await page.screenshot({ path: join(OUT, `${prefix}-${Math.round(m * 100)}.png`) });
    say(`  ${prefix} @${m}: progress ${(r.s.progress[idx] ?? 0).toFixed(3)} after ${total} frames`);
  }
  const r = await frames(page, 240);
  worst = Math.max(worst, r.worst);
  say(`  ${prefix}: max per-frame link-angle change ${deg(worst)} over ${total + 240} frames`);
  return worst;
}

/** drag with the mouse along a path (client px), one frame per step; screenshots at the given step indices */
async function drag(page: Page, path: [number, number][], shots: Record<number, string>, holdFrames = 0) {
  const m = page.mouse;
  let worst = 0;
  await m.move(path[0]![0], path[0]![1]);
  await m.down();
  for (let i = 1; i < path.length; i++) {
    await m.move(path[i]![0], path[i]![1]);
    const r = await frames(page, 1);
    worst = Math.max(worst, r.worst);
    if (shots[i]) await page.screenshot({ path: join(OUT, shots[i]!) });
  }
  if (holdFrames) worst = Math.max(worst, (await frames(page, holdFrames)).worst);
  await m.up();
  worst = Math.max(worst, (await frames(page, 240)).worst);
  return worst;
}

const A4 = { w: 2.1, h: 2.97 };

await run("resume-spread", async () => {
  const { page, ctx } = await openViewer("item=resume", { width: 1440, height: 900 }, 2);
  const a = api(page);
  const st = await a.state();
  say(`  state ${JSON.stringify(st)}`);
  expect(st.first === 1 && st.last === 2 && st.total === 2 && st.count === 1, "a wide host shows the sample as one spread, pages 1–2 of 2");
  await page.screenshot({ path: join(OUT, "resume-spread-rest.png") });
  await a.next();
  await frames(page, 60);
  expect((await a.state()).page === 0, "next() has nothing to turn on the only spread");
  await ctx.close();
});

for (const vp of [
  { name: "desk", width: 1440, height: 900, dpr: 2, q: "item=resume&long=1", leaf: 1 },
  { name: "phone", width: 390, height: 844, dpr: 3, q: "item=resume", leaf: 0 },
]) {
  await run(`resume-${vp.name}`, async () => {
    const { page, ctx } = await openViewer(vp.q, vp, vp.dpr);
    const a = api(page);
    say(`  state ${JSON.stringify(await a.state())}`);
    await page.screenshot({ path: join(OUT, `resume-${vp.name}-1-rest.png`) });
    await a.next();
    const w1 = await turnShots(page, `resume-${vp.name}-2-turn`, [0.3, 0.6, 0.9], vp.leaf);
    expect(w1 < (12 * Math.PI) / 180, `click turn has no single-frame jump (max ${deg(w1)} < 12°)`);
    await page.screenshot({ path: join(OUT, `resume-${vp.name}-3-page2.png`) });
    expect((await a.state()).page === 1, "the next view after next()");
    // back again with prev()
    await a.prev();
    const w2 = (await frames(page, 300)).worst;
    expect((await a.state()).page === 0 && (await a.stats()).progress[vp.leaf]! < 0.01, `prev() lays the sheet back (max ${deg(w2)})`);

    // hover peek (mouse only)
    if (vp.name === "desk") {
      const [hx, hy] = await a.project(A4.w - 0.12, -0.6);
      await page.mouse.move(hx, hy);
      await frames(page, 40);
      await page.screenshot({ path: join(OUT, `resume-${vp.name}-4-peek.png`) });
      const p = (await a.stats()).progress[vp.leaf]!;
      expect(p > 0.004 && p < 0.05, `hover lifts the free edge a little (progress ${p.toFixed(4)})`);
      await page.mouse.move(5, 5);
      await frames(page, 90);
      expect((await a.stats()).progress[vp.leaf]! < 0.002, "leaving lets it fall back");
    }

    // drag the bottom-right corner over to the left: the grab point follows the pointer
    const pts: [number, number][] = [];
    const [x0, y0] = await a.project(A4.w - 0.06, -A4.h / 2 + 0.12);
    // a finger cannot leave the screen: end the swipe inside the viewport
    const x1 = Math.max(10, (await a.project(-A4.w * 0.75, -A4.h / 2 + 0.12))[0]);
    const N = 46;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const e = t * t * (3 - 2 * t);
      pts.push([x0 + (x1 - x0) * e, y0 - Math.sin(Math.PI * t) * 60]);
    }
    const w3 = await drag(page, pts, { 12: `resume-${vp.name}-5-drag-a.png`, 24: `resume-${vp.name}-5-drag-b.png`, 36: `resume-${vp.name}-5-drag-c.png` });
    expect((await a.state()).page === 1, `a corner drag across turns the page (max ${deg(w3)})`);
    expect(w3 < (14 * Math.PI) / 180, "the drag has no single-frame jump (< 14°)");

    // a short drag that goes back: the page falls back
    const [sx, sy] = await a.project(A4.w - 0.06, 0);
    const short: [number, number][] = [];
    for (let i = 0; i <= 12; i++) short.push([sx - Math.sin((Math.PI * i) / 12) * 120, sy]);
    await drag(page, short, {});
    expect((await a.state()).page === 1, "a drag that returns does not turn");
    await ctx.close();
  });

  await run(`card-${vp.name}`, async () => {
    const { page, ctx } = await openViewer("item=card", vp, vp.dpr);
    const a = api(page);
    await page.screenshot({ path: join(OUT, `card-${vp.name}-1-closed.png`) });
    // click the card: it unfolds
    const [cx, cy] = await a.project(0, -0.27);
    await page.mouse.click(cx, cy);
    const w1 = await turnShots(page, `card-${vp.name}-2-open`, [0.5]);
    await frames(page, 60);
    await page.screenshot({ path: join(OUT, `card-${vp.name}-3-open.png`) });
    expect((await a.state()).page === 1 && (await a.stats()).progress[0]! > 0.97, `a click unfolds the card (max ${deg(w1)})`);
    // drag the cover's edge back down over the crease: it folds shut
    const [tx, ty] = await a.project(0, 0.5);
    const [bx, by] = await a.project(0, -0.45);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      pts.push([tx + (bx - tx) * t, ty + (by - ty) * t]);
    }
    const w2 = await drag(page, pts, { 14: `card-${vp.name}-4-drag-a.png`, 26: `card-${vp.name}-4-drag-b.png` });
    expect((await a.state()).page === 0 && (await a.stats()).progress[0]! < 0.03, `dragging the cover down closes it (max ${deg(w2)})`);
    expect(w2 < (14 * Math.PI) / 180, "no single-frame jump while dragging the card");
    await page.screenshot({ path: join(OUT, `card-${vp.name}-5-closed-again.png`) });
    // drag it open from the closed cover's edge
    const [ex, ey] = await a.project(0, -0.5);
    const [fx, fy] = await a.project(0, 0.55);
    const up: [number, number][] = [];
    for (let i = 0; i <= 40; i++) up.push([ex + (fx - ex) * (i / 40), ey + (fy - ey) * (i / 40)]);
    const w3 = await drag(page, up, { 20: `card-${vp.name}-6-drag-open.png` });
    expect((await a.state()).page === 1, `dragging the cover up opens it (max ${deg(w3)})`);
    await ctx.close();
  });
}

await run("zh", async () => {
  for (const item of ["resume", "card"]) {
    const { page, ctx } = await openViewer(`item=${item}&sample=zh&bg=veil`, { width: 1440, height: 900 }, 2);
    if (item === "card") {
      await api(page).next();
      await frames(page, 120);
    }
    await page.screenshot({ path: join(OUT, `zh-${item}.png`) });
    await ctx.close();
  }
});

await run("keys-and-clicks", async () => {
  const { page, ctx } = await openViewer("item=resume&long=1", { width: 1440, height: 900 }, 1);
  const a = api(page);
  // the viewer marks the key event handled (defaultPrevented) so the dialog does not also switch objects; at the ends it does not
  const prevented = () =>
    page.evaluate(() => {
      const w = window as unknown as { __last?: boolean };
      return w.__last;
    });
  await page.evaluate(() => {
    document.addEventListener("keydown", (e) => ((window as unknown as { __last?: boolean }).__last = e.defaultPrevented));
  });
  await page.focus("canvas");
  await page.keyboard.press("ArrowLeft");
  expect((await prevented()) === false, "ArrowLeft on the first spread falls through to the dialog");
  await page.keyboard.press("ArrowRight");
  await frames(page, 200);
  expect((await a.state()).page === 1 && (await prevented()) === true, "ArrowRight turns to the next spread and is consumed");
  await page.keyboard.press("ArrowRight");
  expect((await prevented()) === false, "ArrowRight on the last spread falls through");
  await page.keyboard.press("ArrowLeft");
  await frames(page, 200);
  expect((await a.state()).page === 0, "ArrowLeft turns back");
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await frames(page, 200);
  expect((await a.state()).page === 1, "a click on the right half turns forward");
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await frames(page, 200);
  expect((await a.state()).page === 0, "a click on the left half turns back");
  // dispose: canvas gone, its context parked for the next viewer with a 1 × 1 drawing buffer (or lost)
  const r = await page.evaluate(() => {
    const v = (window as unknown as W).__paper.viewer;
    const gl = v.debug.renderer.getContext();
    v.dispose();
    return { lost: gl.isContextLost(), parked: gl.drawingBufferWidth * gl.drawingBufferHeight === 1, canvases: document.querySelectorAll("canvas").length };
  });
  expect((r.lost || r.parked) && r.canvases === 0, "dispose() removes the canvas and frees its drawing buffer (the context is parked or lost)");
  await ctx.close();
});

await run("resize-and-peek", async () => {
  // a wide window shows the sample as one spread; narrowing it to a phone raises the type scale and re-flows onto loose pages
  const { page, ctx } = await openViewer("item=resume", { width: 1440, height: 900 }, 1);
  const a = api(page);
  const before = (await a.state()).count;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction((n) => (window as unknown as W).__paper.viewer.state.count !== n, before, { timeout: 5000 });
  await a.advance(10);
  const after = (await a.state()).count;
  expect(after > before && (await a.state()).total === after, `re-typesets on resize (${before} spread → ${after} pages)`);
  await page.screenshot({ path: join(OUT, "resize-phone.png") });
  await ctx.close();
  // the closed card peeks open a little under the mouse and settles back when it leaves
  const c = await openViewer("item=card", { width: 1440, height: 900 }, 2);
  const ca = api(c.page);
  const [x, y] = await ca.project(0, -0.27);
  await c.page.mouse.move(x, y);
  await frames(c.page, 50);
  await c.page.screenshot({ path: join(OUT, "card-desk-0-peek.png") });
  const p = (await ca.stats()).progress[0]!;
  expect(p > 0.02 && p < 0.08, `hover peeks the cover open (${p.toFixed(3)})`);
  await c.page.mouse.move(4, 4);
  await frames(c.page, 120);
  expect((await ca.stats()).progress[0]! < 0.01, "and it falls shut again");
  await c.ctx.close();
});

await run("no-webgl", async () => {
  const { page, ctx } = await open("item=resume", { width: 800, height: 600 }, 1, () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2" || type === "webgl") return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  const r = await page.evaluate(() => ({ error: (window as unknown as W).__paper.error, canvases: document.querySelectorAll("#host canvas").length }));
  expect(!!r.error && r.canvases === 0, `the promise rejects without touching the host (${r.error})`);
  await ctx.close();
});

writeFileSync(join(OUT, "shoot.log"), log.join("\n") + "\n");
await browser.close();
