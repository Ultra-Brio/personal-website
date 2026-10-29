import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

/*
 * Frame sequences of the paper viewer, headless (never opens a window), for looking at a turn angle by angle.
 *   bun scripts/harness/paper.turn.ts [--base http://127.0.0.1:5188] [--out <dir>] [--step 15] [--only <prefix>]
 * Every sequence drives time deterministically (manual mode, 60 Hz) and captures a frame each time the turning sheet's mean angle
 * crosses the next multiple of --step degrees, then a contact sheet of all of them. Logs the largest per-frame link-angle change,
 * the framing mode and whether the print faces loaded. Hosts are the lightbox's real paper hosts (src/app/detail.css):
 *  - spread-desk / spread-zh / spread-laptop: the sample (and the Chinese sample) at rest on a wide host — one spread, pages 1–2.
 *  - resume-desk: 1440x900, host 904x800 at top 24 over the scrim, a longer résumé (long=1): spread 1–2 at rest, next() 0 → 180°
 *    (the leaf with pages 2 | 3), spread 3–4 at rest, prev() back. resume-zh: the Chinese sample (next only).
 *    resume-laptop: 1280x720, host 744x648 at top 12; resume-short: 1440x760, host 904x660 at top 24 (little room above the host).
 *  - resume-phone: 390x844 at DPR 3, host 358x506 at top 64, the sample: next() 0 → 180°, every page at rest, prev() back from the last.
 *  - resume-drag: a corner drag across on the desk host (long=1), a frame every 4 frames.
 *  - card-desk / card-phone: the business card opening (next) and closing (prev).
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = `${flag("--base", "http://127.0.0.1:5188")}/scripts/harness/paper.html`;
const OUT = flag("--out", join(tmpdir(), "sasshi-paper-turn"));
const STEP = Number(flag("--step", "15"));
const ONLY = flag("--only", "");
mkdirSync(OUT, { recursive: true });

type Stats = { frameMax: number; max: number; progress: number[] };
type W = {
  __paper: {
    ready: boolean;
    error?: string;
    manual(on: boolean): void;
    advance(dt: number, frames?: number): void;
    stats(): Stats;
    viewer: { next(): void; prev(): void; state: { page: number; count: number }; debug: { project(x: number, y: number, z: number): [number, number]; mode(): string } };
  };
};

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(2)}°`;

type Vp = { width: number; height: number; dpr: number; host: string; top: number };
const DESK: Vp = { width: 1440, height: 900, dpr: 2, host: "904x800", top: 24 };
const LAPTOP: Vp = { width: 1280, height: 720, dpr: 2, host: "744x648", top: 12 };
const SHORT: Vp = { width: 1440, height: 760, dpr: 2, host: "904x660", top: 24 };
const PHONE: Vp = { width: 390, height: 844, dpr: 3, host: "358x506", top: 64 };
const PHONE_CARD: Vp = { ...PHONE, host: "358x630" };

async function open(q: string, vp: Vp) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, hasTouch: phone, isMobile: phone });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => say(`  pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") say(`  console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("requestfailed", (r) => say(`  requestfailed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) say(`  http ${r.status()}: ${r.url()}`);
  });
  await page.goto(`${BASE}?hud=0&host=${vp.host}&top=${vp.top}&${q}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__paper?.ready === true, null, { timeout: 20000 });
  const err = await page.evaluate(() => (window as unknown as W).__paper.error);
  if (err) throw new Error(`viewer rejected: ${err}`);
  await page.evaluate(() => (window as unknown as W).__paper.manual(true));
  await page.waitForTimeout(400);
  await adv(page, 40);
  const info = await page.evaluate(() => {
    const faces = [...document.fonts].filter((f) => /Shippori|Zen Kaku|Klee|Noto|LXGW/.test(f.family)).map((f) => `${f.family.replace(/"/g, "")}/${f.style}/${f.status}`);
    const loaded = [...new Set(faces.filter((f) => f.endsWith("loaded")).map((f) => f.split("/")[0]))];
    const canvas = document.querySelector("#host canvas") as HTMLCanvasElement | null;
    const host = document.getElementById("host")!.getBoundingClientRect();
    const c = canvas?.getBoundingClientRect();
    return { mode: (window as unknown as W).__paper.viewer.debug.mode(), loaded, host: [host.left, host.top, host.width, host.height].map(Math.round), canvas: c ? [c.left, c.top, c.width, c.height].map(Math.round) : null };
  });
  say(`  ${q} @${vp.width}x${vp.height}: mode ${info.mode}; faces loaded: ${info.loaded.join(", ")}; host ${info.host.join(",")}; canvas ${info.canvas?.join(",")}`);
  return { page, ctx };
}
const adv = (page: Page, n: number) => page.evaluate((n) => (window as unknown as W).__paper.advance(1 / 60, n), n);
const stats = (page: Page) => page.evaluate(() => (window as unknown as W).__paper.stats());
const settle = async (page: Page, n = 240) => {
  let worst = 0;
  for (let k = 0; k < n; k++) {
    await adv(page, 1);
    worst = Math.max(worst, (await stats(page)).frameMax);
  }
  return worst;
};

/**
 * Start a turn (`start`), find the sheet that moves, and advance frame by frame; shoot whenever its angle (progress × 180°) crosses
 * the next multiple of STEP (the first frame is the rest before the turn).
 */
async function sweep(page: Page, prefix: string, dir: 1 | -1, start: () => Promise<void>, maxFrames = 600): Promise<string[]> {
  const files: string[] = [];
  let worst = 0;
  const p0 = (await stats(page)).progress;
  const shot = async (a: number) => {
    const f = join(OUT, `${prefix}-${String(Math.round(a)).padStart(3, "0")}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  };
  await shot(dir === 1 ? 0 : 180);
  await start();
  await adv(page, 1);
  let s = await stats(page);
  let idx = 0;
  s.progress.forEach((v, i) => {
    if (Math.abs(v - (p0[i] ?? 0)) > Math.abs((s.progress[idx] ?? 0) - (p0[idx] ?? 0))) idx = i;
  });
  const angle = (s: Stats) => (s.progress[idx] ?? 0) * 180;
  let mark = dir === 1 ? Math.floor(angle(s) / STEP) * STEP + STEP : Math.ceil(angle(s) / STEP) * STEP - STEP;
  let frames = 1;
  for (let i = 0; i < maxFrames; i++) {
    await adv(page, 1);
    frames++;
    s = await stats(page);
    worst = Math.max(worst, s.frameMax);
    const a = angle(s);
    while (dir === 1 ? a >= mark - 1e-6 && mark <= 180 : a <= mark + 1e-6 && mark >= 0) {
      await shot(mark);
      mark += dir * STEP;
    }
    if ((dir === 1 && mark > 180) || (dir === -1 && mark < 0)) break;
  }
  worst = Math.max(worst, await settle(page));
  say(`  ${prefix}: sheet ${idx}, ${files.length} frames over ${frames} sim frames, max per-frame link-angle change ${deg(worst)}`);
  return files;
}

/** A grid of the captured frames, one image */
async function contact(files: string[], name: string, cols: number, cellW: number) {
  if (!files.length) return;
  const ctx = await browser.newContext({ viewport: { width: cols * cellW, height: 400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString("base64")}"><figcaption>${f.split("/").pop()}</figcaption></figure>`).join("");
  await page.setContent(
    `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:0}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:4px;top:2px;font:11px monospace;color:#fff;background:#0008;padding:1px 4px}</style>${imgs}`,
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  await ctx.close();
}

async function run(name: string, fn: () => Promise<void>) {
  if (ONLY && !name.startsWith(ONLY)) return;
  try {
    await fn();
    say(`ok ${name}`);
  } catch (e) {
    say(`FAIL ${name} ${String(e)}`);
    process.exitCode = 1;
  }
}

const next = (page: Page) => page.evaluate(() => (window as unknown as W).__paper.viewer.next());
const prev = (page: Page) => page.evaluate(() => (window as unknown as W).__paper.viewer.prev());
const pageOf = (page: Page) => page.evaluate(() => (window as unknown as W).__paper.viewer.state as { page: number; count: number; first?: number; last?: number; total?: number });

/* the sample on a wide host is one spread (pages 1–2): at rest, in English and Chinese, desk and laptop */
for (const [name, vp, q] of [
  ["spread-desk", DESK, "item=resume&bg=veil"],
  ["spread-zh", DESK, "item=resume&bg=veil&sample=zh"],
  ["spread-laptop", LAPTOP, "item=resume&bg=veil"],
] as const) {
  await run(name, async () => {
    const { page, ctx } = await open(q, vp);
    await page.screenshot({ path: join(OUT, `${name}-rest.png`) });
    say(`  ${name}: state ${JSON.stringify(await pageOf(page))}`);
    await ctx.close();
  });
}

/* a longer résumé on a wide host: spread 1–2 → 3–4 and back (both faces of the turning leaf are printed) */
for (const [name, vp, q] of [
  ["resume-desk", DESK, "item=resume&bg=veil&long=1"],
  ["resume-zh", DESK, "item=resume&bg=veil&long=1&sample=zh"],
  ["resume-laptop", LAPTOP, "item=resume&bg=veil&long=1"],
  ["resume-short", SHORT, "item=resume&bg=veil&long=1"],
] as const) {
  await run(name, async () => {
    const { page, ctx } = await open(q, vp);
    await page.screenshot({ path: join(OUT, `${name}-page1-rest.png`) });
    const f = await sweep(page, `${name}-next`, 1, () => next(page));
    await page.screenshot({ path: join(OUT, `${name}-spread-rest.png`) });
    say(`  ${name}: state ${JSON.stringify(await pageOf(page))}`);
    await contact(f, `${name}-next-contact`, 4, 480);
    if (name !== "resume-zh") {
      const b = await sweep(page, `${name}-prev`, -1, () => prev(page));
      await page.screenshot({ path: join(OUT, `${name}-back-rest.png`) });
      await contact(b, `${name}-prev-contact`, 4, 480);
    }
    await ctx.close();
  });
}

await run("resume-phone", async () => {
  const { page, ctx } = await open("item=resume&bg=veil", PHONE);
  await page.screenshot({ path: join(OUT, "resume-phone-page1-rest.png") });
  const f = await sweep(page, "resume-phone-next", 1, () => next(page));
  await contact(f, "resume-phone-next-contact", 7, 220);
  const st = await pageOf(page);
  const rest: string[] = [join(OUT, "resume-phone-page1-rest.png")];
  for (let p = st.page; ; p++) {
    const file = join(OUT, `resume-phone-page${p + 1}-rest.png`);
    await page.screenshot({ path: file });
    rest.push(file);
    if (p >= st.count - 1) break;
    await next(page);
    await settle(page, 200);
  }
  say(`  resume-phone: ${st.count} pages`);
  await contact(rest, "resume-phone-pages", Math.min(7, rest.length), 300);
  const b = await sweep(page, "resume-phone-prev", -1, () => prev(page));
  await contact(b, "resume-phone-prev-contact", 7, 220);
  await ctx.close();
});

await run("resume-drag", async () => {
  const { page, ctx } = await open("item=resume&bg=veil&long=1", DESK);
  const project = (x: number, y: number) => page.evaluate(([x, y]) => (window as unknown as W).__paper.viewer.debug.project(x!, y!, 0), [x, y] as const);
  const [x0, y0] = await project(2.04, -1.3);
  const [x1] = await project(-1.6, -1.3);
  const files: string[] = [];
  let worst = 0;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const N = 64;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const e = t * t * (3 - 2 * t);
    await page.mouse.move(x0 + (x1 - x0) * e, y0 - Math.sin(Math.PI * t) * 80);
    await adv(page, 1);
    worst = Math.max(worst, (await stats(page)).frameMax);
    if (i % 4 === 0) {
      const p = join(OUT, `resume-drag-${String(i).padStart(2, "0")}.png`);
      await page.screenshot({ path: p });
      files.push(p);
    }
  }
  await page.mouse.up();
  worst = Math.max(worst, await settle(page));
  const p = join(OUT, "resume-drag-rest.png");
  await page.screenshot({ path: p });
  files.push(p);
  say(`  resume-drag: max per-frame link-angle change ${deg(worst)}; page ${(await pageOf(page)).page}`);
  await contact(files, "resume-drag-contact", 4, 480);
  await ctx.close();
});

for (const [name, vp] of [
  ["card-desk", DESK],
  ["card-phone", PHONE_CARD],
] as const) {
  await run(name, async () => {
    const { page, ctx } = await open("item=card&bg=veil", vp);
    await page.screenshot({ path: join(OUT, `${name}-closed.png`) });
    const f = await sweep(page, `${name}-open`, 1, () => next(page));
    await page.screenshot({ path: join(OUT, `${name}-open-rest.png`) });
    const b = await sweep(page, `${name}-close`, -1, () => prev(page));
    await page.screenshot({ path: join(OUT, `${name}-closed-rest.png`) });
    const desk = vp.width > 600;
    await contact([...f, ...b], `${name}-contact`, desk ? 4 : 7, desk ? 480 : 220);
    await ctx.close();
  });
}

writeFileSync(join(OUT, "turn.log"), log.join("\n") + "\n");
await browser.close();
