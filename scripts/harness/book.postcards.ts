import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

/*
 * Headless shots + numbers for the postcard binder (book.html?kind=postcards) and the album cards' procedural faces (kind=album).
 *   bun scripts/harness/book.postcards.ts --base http://127.0.0.1:5188 --out <dir> [<name-prefix>]
 * Never opens a visible window.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = `${flag("--base", "http://127.0.0.1:5188")}/scripts/harness/book.html`;
const OUT = flag("--out", "/tmp/sasshi-postcards");
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base" && args[i - 1] !== "--out");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

type Info = { textures: number; geometries: number; sides: number; sheets: number; calls: number };
type Win = {
  __ready: boolean;
  __state: { index: number; count: number; closed: boolean };
  __picks: { i: number; id: string }[];
  __book: { next(): void; prev(): void; toggleCover(): void; debug: { setCover(t: number): void; setProgress(p: number, dir?: 1 | -1): void; release(): void; state(): { cover: number; spread: number; sheets: { p: number; awake: boolean }[] }; info(): Info; physics: { finger: { torque: number }; hand: { maxF: number }; pvc: number; card: number } } };
};
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(ok ? "PASS" : "FAIL", name, detail);
  if (!ok) failures++;
};

async function open(q: string, vp: { width: number; height: number }) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  const page = await ctx.newPage();
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("404") && console.log("  [console]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e)));
  await page.goto(`${BASE}?${q}`);
  await page.waitForFunction(() => (window as unknown as Win).__ready === true, null, { timeout: 20000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector("canvas")!).opacity === "1");
  await page.waitForFunction(() => (window as unknown as Win).__book.debug.state().cover === 1, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  return { page, ctx };
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as Win).__book.debug.state().sheets.every((s) => !s.awake), null, { timeout: 8000 });

async function run(name: string, fn: () => Promise<void>) {
  if (only && !name.startsWith(only)) return;
  try {
    await fn();
    console.log("ok", name);
  } catch (e) {
    console.log("FAIL", name, String(e));
    failures++;
  }
}

await run("postcards-desk", async () => {
  const { page, ctx } = await open("kind=postcards&n=10&cover=cloth&color=sand", { width: 1440, height: 900 });
  const st = await page.evaluate(() => (window as unknown as Win).__state);
  // 10 postcards, 4 per sheet → 3 sheets → 4 spreads
  check("postcards: 3 sheets / 4 spreads for 10 cards", st.count === 4, JSON.stringify(st));
  const ph = await page.evaluate(() => (window as unknown as Win).__book.debug.physics);
  check("postcard physics profile scaled (torque ×≈3, pvc ×≈1.9)", ph.finger.torque > 23 && ph.finger.torque < 26 && ph.pvc > 0.025 && ph.pvc < 0.0265 && ph.card === 0.00466, JSON.stringify({ t: ph.finger.torque, f: ph.hand.maxF, pvc: ph.pvc }));
  await shot(page, "postcard-open-desk");
  const info0 = await page.evaluate(() => (window as unknown as Win).__book.debug.info());
  // mid-turn: the first sheet lifted half-way shows the message sides on its back
  await page.evaluate(() => (window as unknown as Win).__book.debug.setProgress(0.32));
  await page.waitForTimeout(250);
  await shot(page, "postcard-midturn-desk");
  await page.evaluate(() => (window as unknown as Win).__book.debug.setProgress(0.82));
  await page.waitForTimeout(250);
  await shot(page, "postcard-lateturn-desk");
  await page.evaluate(() => (window as unknown as Win).__book.debug.release());
  await page.evaluate(() => (window as unknown as Win).__book.debug.setProgress(0));
  await page.evaluate(() => (window as unknown as Win).__book.debug.release());
  await page.waitForTimeout(300);
  // a real click turn: lands and sleeps
  const t0 = Date.now();
  await page.evaluate(() => (window as unknown as Win).__book.next());
  await settle(page);
  const turn = Date.now() - t0;
  const st1 = await page.evaluate(() => (window as unknown as Win).__state);
  check("click turn lands (spread 1) and sleeps", st1.index === 1 && turn < 3000, `${turn} ms`);
  await page.waitForTimeout(400);
  await shot(page, "postcard-spread1-desk");
  // pick a postcard on the back side: same item as its picture side
  await page.mouse.click(280, 330);
  await page.waitForTimeout(200);
  const picks = await page.evaluate(() => (window as unknown as Win).__picks);
  check("click on a message side picks that postcard (id)", picks.length > 0 && picks.at(-1)!.id.startsWith("p"), JSON.stringify(picks.at(-1)));

  // frame rate and draw calls while pages turn
  const perf = await page.evaluate(async () => {
    const b = (window as unknown as Win).__book;
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let on = true;
    const tick = (t: number) => {
      frames++;
      worst = Math.max(worst, t - last);
      last = t;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    b.next();
    await new Promise((r) => setTimeout(r, 700));
    b.next();
    await new Promise((r) => setTimeout(r, 700));
    b.prev();
    await new Promise((r) => setTimeout(r, 900));
    on = false;
    const s = (performance.now() - t0) / 1000;
    return { fps: frames / s, worstMs: worst, info: b.debug.info() };
  });
  console.log("PERF postcards desktop", JSON.stringify({ ...perf, idle: info0 }));
  await ctx.close();
});

await run("postcards-phone", async () => {
  const { page, ctx } = await open("kind=postcards&n=10&cover=leather&color=clay", { width: 390, height: 844 });
  await shot(page, "postcard-open-phone");
  await page.evaluate(() => (window as unknown as Win).__book.next());
  await settle(page);
  await page.waitForTimeout(900);
  await shot(page, "postcard-page1-phone");
  const info = await page.evaluate(() => (window as unknown as Win).__book.debug.info());
  console.log("PERF postcards phone idle", JSON.stringify(info));
  await ctx.close();
});

await run("postcards-frost", async () => {
  const { page, ctx } = await open("kind=postcards&n=7&cover=frost&color=paper&msg=long", { width: 1440, height: 900 });
  await page.evaluate(() => (window as unknown as Win).__book.next());
  await settle(page);
  await page.waitForTimeout(500);
  await shot(page, "postcard-frost-spread1");
  await page.evaluate(() => (window as unknown as Win).__book.toggleCover());
  await page.waitForFunction(() => (window as unknown as Win).__book.debug.state().cover === 0, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  await shot(page, "postcard-frost-closed");
  await ctx.close();
});

await run("album", async () => {
  const { page, ctx } = await open("kind=album&n=14&img=1&cover=cloth&color=slate", { width: 1440, height: 900 });
  await shot(page, "album-open-desk");
  await ctx.close();
});

await run("flat", async () => {
  const { page, ctx } = await open("kind=postcards&n=10&cover=cloth&color=sand", { width: 1440, height: 900 }).catch(() => ({ page: null, ctx: null }));
  if (ctx) await ctx.close();
  void page;
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p2 = await c2.newPage();
  await p2.goto(`${BASE}?kind=postcards&n=10&cover=cloth&color=sand&mode=flat`);
  await p2.waitForTimeout(900);
  await p2.click('button[aria-label="Next page"]');
  await p2.waitForTimeout(700);
  await shot(p2, "postcard-flat-spread1");
  await c2.close();
});

await browser.close();
console.log(failures ? `${failures} FAILED` : "all checks passed", "· shots in", OUT);
process.exitCode = failures ? 1 : 0;
