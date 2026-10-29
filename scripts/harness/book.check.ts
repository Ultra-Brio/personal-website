import { chromium, type Page } from "playwright-core";

/*
 * Headless behaviour checks for the book shell (scripts/harness/book.html). Never opens a visible window.
 *   bun scripts/harness/book.check.ts [--base http://127.0.0.1:5188]
 * Covers: one canvas under StrictMode, arrows / buttons / cover toggle, pick events (⌘ = new tab), the transparent canvas over the host's desk, reduced-motion and context-loss
 * fallbacks to FlatBook, forced flat mode, the 390x844 phone running in narrow mode (no "rotate your phone"), live resize to narrow.
 * Round 4 (book.frame.html): the other language in place (E1: the same Book, the page and the open cover kept every frame, no long
 * task, GPU memory flat), and a part-filled postcard album whose empty last sheet is pulled flat past the spine (E6: it comes to rest
 * flat, nothing drawn after).
 * Exits non-zero when a check fails.
 */

const args = process.argv.slice(2);
const bi = args.indexOf("--base");
const BASE = `${bi >= 0 && args[bi + 1] ? args[bi + 1] : "http://127.0.0.1:5188"}/scripts/harness/book.html`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
};

type Win = { __ready: boolean; __state: { index: number; count: number; narrow: boolean; closed: boolean }; __picks: unknown[]; __book: { toggleCover(): void; debug: { state(): { cover: number } } } };
const state = (page: Page) => page.evaluate(() => (window as unknown as Win).__state);

async function open(q: string, vp = { width: 1280, height: 800 }, opts: Parameters<typeof browser.newContext>[0] = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("404") && logs.push(m.text()));
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await page.goto(`${BASE}?${q}`);
  await page.waitForFunction(() => document.querySelector(".folio-book") !== null);
  return { page, ctx, logs };
}
/** 3D book, ready and fully opened */
async function open3d(q: string, vp?: { width: number; height: number }, opts?: Parameters<typeof browser.newContext>[0]) {
  const r = await open(q, vp, opts);
  await r.page.waitForFunction(() => (window as unknown as Win).__ready === true);
  await r.page.waitForFunction(() => (window as unknown as Win).__book?.debug.state().cover === 1, null, { timeout: 8000 });
  await r.page.waitForTimeout(500);
  return r;
}

// 1. desktop 3D: keyboard, buttons, picks, cover toggle, transparent canvas
{
  const { page, ctx, logs } = await open3d("img=1&n=30");
  check("one canvas under StrictMode", (await page.locator("canvas").count()) === 1);
  check("mode 3d", (await page.getAttribute(".folio-book", "data-mode")) === "3d");
  await page.focus(".folio-book");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1800);
  let s = await state(page);
  check("ArrowRight -> spread 1", s.index === 1, JSON.stringify(s));
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1800);
  s = await state(page);
  check("ArrowLeft -> spread 0", s.index === 0, JSON.stringify(s));
  await page.click('button[aria-label="Next page"]');
  await page.waitForTimeout(1800);
  s = await state(page);
  check("Next button -> spread 1", s.index === 1, JSON.stringify(s));
  await page.click('button[aria-label="Previous page"]');
  await page.waitForTimeout(1800);
  await page.mouse.click(800, 224); // card 01
  await page.keyboard.down("Meta");
  await page.mouse.click(1030, 224); // card 02, new tab
  await page.keyboard.up("Meta");
  await page.waitForTimeout(300);
  const picks = JSON.stringify(await page.evaluate(() => (window as unknown as Win).__picks));
  check("onPick(index, {newTab})", picks.includes('"i":0') && picks.includes('"i":1,"newTab":true'), picks);
  check("hidden card list has links", (await page.locator(".folio-links a").count()) > 0);
  await page.click('button[aria-label="Close the album"]');
  await page.waitForFunction(() => (window as unknown as Win).__state.closed === true, null, { timeout: 8000 });
  check("close -> Open button shown", (await page.locator("button", { hasText: "Open the album" }).count()) === 1);
  await page.click("button.folio-btn-primary");
  await page.waitForFunction(() => (window as unknown as Win).__state.closed === false, null, { timeout: 8000 });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".folio-book")!).backgroundColor);
  check("the root is transparent (the host's desk is the ground)", bg === "rgba(0, 0, 0, 0)", bg);
  // the 3D canvas clears transparent: a corner pixel is the host page's desk (book.html: #e3e8eb) — decode it from a screenshot in the page
  const png = (await page.screenshot({ clip: { x: 4, y: 4, width: 4, height: 4 } })).toString("base64");
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png);
  check("transparent canvas: the desk shows through (#e3e8eb)", [227, 232, 235].every((v, i) => Math.abs(v - px[i]!) <= 1), JSON.stringify(px));
  check("no console errors / warnings", logs.length === 0, logs.join(" | "));
  await ctx.close();
}

// 2. fallbacks
{
  const { page, ctx, logs } = await open("img=1&n=14", { width: 1280, height: 800 }, { reducedMotion: "reduce" });
  await page.waitForTimeout(500);
  check("prefers-reduced-motion -> flat", (await page.getAttribute(".folio-book", "data-mode")) === "flat" && (await page.locator(".folio-stage > canvas").count()) === 0);
  check("flat: no console errors", logs.length === 0, logs.join(" | "));
  await ctx.close();
}
{
  const { page, ctx } = await open("mode=flat&img=1&n=14");
  await page.waitForTimeout(400);
  await page.click('a.folio-flat-item[href="#card-2"]');
  const picks = JSON.stringify(await page.evaluate(() => (window as unknown as Win).__picks));
  check("flat: card click -> onPick", picks.includes('"i":1'), picks);
  await page.click('button[aria-label="Close the album"]');
  await page.click(".folio-flat-cover");
  await page.click('button[aria-label="Next page"]');
  check("flat: close / open / next work", (await state(page)).index === 1);
  await ctx.close();
}
{
  const { page, ctx } = await open3d("img=1&n=14");
  await page.evaluate(() => {
    const gl = document.querySelector("canvas")!.getContext("webgl2")!;
    gl.getExtension("WEBGL_lose_context")!.loseContext();
  });
  // a lost context is waited for (scene.ts RESTORE_WAIT, 5 s of a visible page) before the book gives up and goes flat
  await page.waitForTimeout(600);
  check("WebGL context loss -> still 3d while it may come back", (await page.getAttribute(".folio-book", "data-mode")) === "3d");
  await page.waitForTimeout(5200);
  check("WebGL context loss -> flat", (await page.getAttribute(".folio-book", "data-mode")) === "flat");
  await ctx.close();
}

// 3. portrait phone: narrow mode, no rotate prompt
{
  const { page, ctx } = await open3d("img=1&n=30&cover=cloth&color=sage", { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  let s = await state(page);
  check("phone: engine runs narrow", s.narrow === true && (await page.getAttribute(".folio-book", "data-mode")) === "3d", JSON.stringify(s));
  await page.click('button[aria-label="Next page"]');
  await page.waitForTimeout(1500);
  s = await state(page);
  check("phone: next -> page 1", s.index === 1, JSON.stringify(s));
  await page.touchscreen.tap(250, 330);
  await page.waitForTimeout(400);
  const picks = JSON.stringify(await page.evaluate(() => (window as unknown as Win).__picks));
  check("phone: tap on a card -> onPick", picks.length > 2, picks);
  await ctx.close();
}

// 4. live resize
{
  const { page, ctx } = await open3d("img=1&n=14");
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(1200);
  check("resize to a narrow box -> engine goes narrow", (await state(page)).narrow === true);
  await ctx.close();
}

// 5. round 4 (book.frame.html, the shell's framing): another language in place; an empty sheet pulled past the spine comes to rest
const FRAME = BASE.replace(/book\.html$/, "book.frame.html");
type Frame = { __ready: boolean; __setZh(on: boolean): void; __book: { next(): void; debug: { state(): { cover: number; spread: number; sheets: { awake: boolean; angles: number[] }[] }; info(): { textures: number; geometries: number }; tilt(): { frames: number }; screenBox(): { back: { left: number; right: number; top: number; bottom: number } } } } };
for (const b of ["postcards", "resume"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await page.goto(`${FRAME}?b=${b}&ambient=0&tilt=0`);
  await page.waitForFunction(() => (window as unknown as Frame).__ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as unknown as Frame).__book?.debug.state().cover === 1, null, { timeout: 20000 });
  if (b !== "resume") {
    await page.evaluate(() => (window as unknown as Frame).__book.next());
    await page.waitForTimeout(2200);
  }
  const w = await page.evaluate(async () => {
    const win = window as unknown as Frame;
    const book = win.__book;
    const info0 = book.debug.info();
    const spread0 = book.debug.state().spread;
    const longs: number[] = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(Math.round(e.duration)))).observe({ type: "longtask" });
    let other = 0;
    let minCover = 1;
    let spreads = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      if (win.__book !== book) other++;
      const s = win.__book.debug.state();
      minCover = Math.min(minCover, s.cover);
      if (s.spread !== spread0) spreads++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (const on of [true, false, true]) {
      win.__setZh(on);
      await new Promise((r) => setTimeout(r, 2000));
    }
    done = true;
    const info = book.debug.info();
    return { other, minCover, spreads, longs, info0, info };
  });
  check(`${b}: the other language in place — the same book, the page and the open cover every frame, no long task, no new GPU memory`, w.other === 0 && w.minCover === 1 && w.spreads === 0 && w.longs.every((d) => d <= 50) && w.info.textures === w.info0.textures && w.info.geometries === w.info0.geometries, JSON.stringify(w));
  check(`${b}: language switch without page errors`, logs.length === 0, logs.join(" | "));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${FRAME}?b=postcards&n=7&ambient=0&tilt=0&narrow=0`);
  await page.waitForFunction(() => (window as unknown as Frame).__ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => { const s = (window as unknown as Frame).__book?.debug.state(); return s?.cover === 1 && !s.sheets.some((x) => x.awake); }, null, { timeout: 20000 });
  await page.evaluate(() => (window as unknown as Frame).__book.next());
  await page.waitForTimeout(2200);
  const box = await page.evaluate(() => (window as unknown as Frame).__book.debug.screenBox().back);
  const bw = box.right - box.left;
  const y = (box.top + box.bottom) / 2;
  const xr = box.right - bw * 0.07;
  // the QA r4 repro: held at the free edge, three quarters over in steps, then pulled flat past the spine and let go
  await page.mouse.move(xr, y);
  await page.mouse.down();
  for (const f of [0.25, 0.5, 0.75]) {
    await page.mouse.move(xr - bw * 2 * f, y - 30, { steps: 12 });
    await page.waitForTimeout(500);
  }
  await page.mouse.move(xr - bw * 2.1, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(4500);
  const r = await page.evaluate(async () => {
    const book = (window as unknown as Frame).__book;
    const f0 = book.debug.tilt().frames;
    await new Promise((res) => setTimeout(res, 2000));
    const s = book.debug.state();
    return { renders: book.debug.tilt().frames - f0, awake: s.sheets.some((x) => x.awake), flat: s.sheets.every((x) => x.angles.every((a) => Math.abs(a) < 1e-3 || Math.abs(a - Math.PI) < 1e-3)) };
  });
  check("postcards n=7: the empty last sheet pulled flat past the spine lands flat and rests (no fold under it, no frames after)", !r.awake && r.flat && r.renders === 0, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exitCode = failed ? 1 : 0;
