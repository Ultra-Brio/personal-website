import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

/*
 * Headless checks + screenshots of the folio harness (scripts/harness/folio.html): the ring-less résumé folio with a stand-in addon.
 * Never opens a visible window.
 *   bun scripts/harness/folio.shoot.ts [--base http://127.0.0.1:5188] [--out <dir>] [<name-prefix>]
 * Checks: zero-sheet state, anchors + setOpen, pointer routing (an addon claims a drag; a desk drag tilts), continuous frames while the
 * addon moves and none once it rests, shake(), setTilt(). Shots: closed / opening / open / tilted on desktop (1440x900) and phone (390x844),
 * frosted cover open / mid-closing / closed.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = `${flag("--base", "http://127.0.0.1:5188")}/scripts/harness/folio.html`;
const OUT = flag("--out", join(tmpdir(), "sasshi-folio-shots"));
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base" && args[i - 1] !== "--out");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

type Stats = { updates: number; moving: boolean; opens: number[]; downs: number; moves: number; ups: number; hovers: number; attached: boolean; disposed: boolean; anchor: number[] };
type Win = {
  __ready: boolean;
  __state: { index: number; count: number; closed: boolean } | null;
  __addon: { stats: Stats; kick(): void; screen(i: number): [number, number] | null };
  __book: {
    next(): void;
    prev(): void;
    toggleCover(): void;
    shake(s?: number): void;
    setTilt(x: number, y: number): void;
    debug: { setCover(t: number): void; release(): void; state(): { cover: number; spread: number }; tilt(): { x: number; y: number; lift: number; frames: number; dragging: boolean }; info(): { calls: number; textures: number; geometries: number } };
  };
};
const W = (page: Page) => page.evaluate(() => 0);
void W;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(ok ? "PASS" : "FAIL", name, detail);
  if (!ok) failures++;
}

async function open(q: string, vp: { width: number; height: number }) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log("  [console]", m.type(), m.text());
  });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e)));
  await page.goto(`${BASE}?${q}`);
  await page.waitForFunction(() => (window as unknown as Win).__ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector("canvas")!).opacity === "1");
  return { page, ctx };
}
const coverIs = (page: Page, c: number) => page.waitForFunction((c) => (window as unknown as Win).__book.debug.state().cover === c, c, { timeout: 8000 });
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });
const tiltOf = (page: Page) => page.evaluate(() => (window as unknown as Win).__book.debug.tilt());
const stats = (page: Page) => page.evaluate(() => (window as unknown as Win).__addon.stats);

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

await run("desk", async () => {
  const { page, ctx } = await open("cover=cloth&color=slate", { width: 1440, height: 900 });
  await coverIs(page, 1);
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => (window as unknown as Win).__state);
  check("zero sheets: one spread, index 0", !!st && st.count === 1 && st.index === 0 && !st.closed, JSON.stringify(st));
  const s0 = await stats(page);
  check("addon attached, told it is open", s0.attached && s0.opens.includes(1) && s0.opens[0] === 0, `opens ${s0.opens.slice(0, 3).join(",")}…${s0.opens.at(-1)}`);
  // anchor frame: origin on the back board (x > 0), z up out of the board, x to the right
  const a = s0.anchor;
  check("anchor frame: x right, y away, z up, on the back board", a[0]! > 0.99 && a[5]! > 0.99 && a[10]! > 0.99 && a[12]! > 1 && Math.abs(a[13]!) < 1e-3, `t=(${a[12]!.toFixed(3)}, ${a[13]!.toFixed(3)}, ${a[14]!.toFixed(4)})`);
  await shot(page, "folio-open-desk");
  // next() is a no-op with no sheets
  await page.evaluate(() => (window as unknown as Win).__book.next());
  await page.waitForTimeout(300);
  check("next() does nothing without sheets", (await page.evaluate(() => (window as unknown as Win).__book.debug.state().spread)) === 0);

  // continuous frames: kick the boxes → frames keep coming; once they rest → frames stop
  const f0 = (await tiltOf(page)).frames;
  await page.evaluate(() => (window as unknown as Win).__addon.kick());
  await page.waitForTimeout(400);
  const f1 = (await tiltOf(page)).frames;
  check("frames keep coming while the addon moves", f1 - f0 > 10, `${f1 - f0} frames in 400 ms`);
  await page.waitForFunction(() => !(window as unknown as Win).__addon.stats.moving, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const f2 = (await tiltOf(page)).frames;
  await page.waitForTimeout(600);
  const f3 = (await tiltOf(page)).frames;
  check("no frames once everything rests", f3 - f2 === 0, `${f3 - f2} frames in 600 ms`);

  // pointer routing: drag a box — the addon claims it, nothing else moves
  const p = await page.evaluate(() => (window as unknown as Win).__addon.screen(0));
  if (!p) throw new Error("no box position");
  const before = await stats(page);
  await page.mouse.move(p[0], p[1]);
  await page.mouse.down();
  await page.mouse.move(p[0] + 40, p[1] + 10, { steps: 4 });
  await page.mouse.move(p[0] + 90, p[1] + 30, { steps: 4 });
  const mid = await tiltOf(page);
  await shot(page, "folio-box-drag-desk");
  await page.mouse.up();
  const after = await stats(page);
  check("addon claims a drag on its object", after.downs === before.downs + 1 && after.moves > before.moves && after.ups === before.ups + 1, `downs ${after.downs - before.downs} moves ${after.moves - before.moves} ups ${after.ups - before.ups}`);
  check("an addon drag does not tilt or close", !mid.dragging && Math.abs(mid.x) < 1e-6 && (await page.evaluate(() => (window as unknown as Win).__book.debug.state().cover)) === 1);

  // hover routing
  await page.mouse.move(p[0] + 90, p[1] + 30);
  const cur = await page.evaluate(() => getComputedStyle(document.querySelector("canvas")!).cursor);
  check("hover over an addon object shows grab", cur === "grab", cur);

  // a drag on the desk tilts the book, and it springs back
  await page.mouse.move(60, 450);
  await page.mouse.down();
  await page.mouse.move(110, 520, { steps: 6 });
  await page.mouse.move(200, 600, { steps: 6 });
  await page.waitForTimeout(400);
  const t1 = await tiltOf(page);
  check("desk drag tilts the book", t1.dragging && Math.abs(t1.x) > 0.1 && Math.abs(t1.y) > 0.1, JSON.stringify(t1));
  await shot(page, "folio-tilt-drag-desk");
  await page.mouse.up();
  await page.waitForTimeout(1600);
  const t2 = await tiltOf(page);
  check("tilt springs back to level", !t2.dragging && Math.abs(t2.x) < 1e-4 && Math.abs(t2.y) < 1e-4 && t2.lift === 0, JSON.stringify(t2));
  // quick back-and-forth drag shakes the boxes
  await page.mouse.move(60, 450);
  await page.mouse.down();
  for (let k = 0; k < 6; k++) {
    await page.mouse.move(k % 2 ? 60 : 200, 450, { steps: 3 });
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  const s1 = await stats(page);
  check("a quick back-and-forth drag moves the addon", s1.moving);
  await page.waitForTimeout(1500);

  // setTilt (device orientation) and shake()
  await page.evaluate(() => (window as unknown as Win).__book.setTilt(0.3, -0.35));
  await page.waitForTimeout(1200);
  const t3 = await tiltOf(page);
  check("setTilt tilts (smoothed) and lifts the book", Math.abs(t3.x - 0.3) < 0.01 && Math.abs(t3.y + 0.35) < 0.01 && t3.lift > 0.1, JSON.stringify(t3));
  await shot(page, "folio-tilted-desk");
  await page.evaluate(() => (window as unknown as Win).__book.setTilt(0, 0));
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as unknown as Win).__book.shake(1));
  await page.waitForTimeout(120);
  await shot(page, "folio-shake-desk");
  const s2 = await stats(page);
  check("shake() moves the addon", s2.moving);
  await page.waitForTimeout(1500);

  // close (key path through prev()), closed shot, opening shot
  await page.evaluate(() => (window as unknown as Win).__book.prev());
  await coverIs(page, 0);
  await page.waitForTimeout(500);
  const s3 = await stats(page);
  check("addon told the folio closed", s3.opens.at(-1) === 0);
  check("state closed", (await page.evaluate(() => (window as unknown as Win).__state?.closed)) === true);
  await shot(page, "folio-closed-desk");
  await page.evaluate(() => (window as unknown as Win).__book.debug.setCover(0.42));
  await page.waitForTimeout(200);
  await shot(page, "folio-opening-desk");
  await page.evaluate(() => (window as unknown as Win).__book.debug.release());
  // a click on the closed cover opens it
  await page.evaluate(() => (window as unknown as Win).__book.debug.setCover(0));
  await page.evaluate(() => (window as unknown as Win).__book.debug.release());
  await page.mouse.click(1000, 450);
  await coverIs(page, 1);
  check("click on the closed cover opens it", true);
  await ctx.close();
});

await run("phone", async () => {
  const { page, ctx } = await open("cover=leather&color=clay", { width: 390, height: 844 });
  await coverIs(page, 1);
  await page.waitForTimeout(1200);
  await shot(page, "folio-open-phone");
  await page.evaluate(() => (window as unknown as Win).__book.setTilt(-0.25, 0.3));
  await page.waitForTimeout(1200);
  await shot(page, "folio-tilted-phone");
  await page.evaluate(() => (window as unknown as Win).__book.setTilt(0, 0));
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window as unknown as Win).__book.toggleCover());
  await coverIs(page, 0);
  await page.waitForTimeout(800);
  await shot(page, "folio-closed-phone");
  await page.evaluate(() => (window as unknown as Win).__book.debug.setCover(0.55));
  await page.waitForTimeout(200);
  await shot(page, "folio-opening-phone");
  await ctx.close();
});

await run("frost", async () => {
  const { page, ctx } = await open("cover=frost&color=paper", { width: 1440, height: 900 });
  await coverIs(page, 1);
  await page.waitForTimeout(900);
  await shot(page, "folio-frost-open");
  await page.evaluate(() => (window as unknown as Win).__book.setTilt(0.22, 0.25));
  await page.waitForTimeout(1200);
  await shot(page, "folio-frost-tilted");
  await page.evaluate(() => (window as unknown as Win).__book.setTilt(0, 0));
  await page.waitForTimeout(1200);
  for (const c of [0.62, 0.35, 0.12]) {
    await page.evaluate((c) => (window as unknown as Win).__book.debug.setCover(c), c);
    await page.waitForTimeout(200);
    await shot(page, `folio-frost-closing-${Math.round(c * 100)}`);
  }
  await page.evaluate(() => (window as unknown as Win).__book.debug.release());
  await page.evaluate(() => (window as unknown as Win).__book.debug.setCover(0));
  await page.waitForTimeout(200);
  await shot(page, "folio-frost-closed");
  await ctx.close();
});

await run("view", async () => {
  for (const vp of [
    { width: 1440, height: 900, tag: "desk" },
    { width: 390, height: 844, tag: "phone" },
  ]) {
    const { page, ctx } = await open("via=view&cover=cloth&color=moss", vp);
    await coverIs(page, 1);
    await page.waitForTimeout(900);
    check(`view ${vp.tag}: one WebGL canvas under StrictMode`, (await page.locator(".folio-stage > canvas").count()) === 1);
    const s0 = await stats(page);
    check(`view ${vp.tag}: the factory's addon is attached and told it is open`, s0.attached && s0.opens.includes(1) && !s0.disposed);
    check(`view ${vp.tag}: next is disabled without sheets`, await page.locator('button[aria-label="Next page"]').isDisabled());
    await page.evaluate(() => (window as unknown as { __handle: { current: { shake(s?: number): void } } }).__handle.current.shake(1));
    await page.waitForTimeout(120);
    check(`view ${vp.tag}: ref.shake() moves the addon`, (await stats(page)).moving);
    await page.waitForTimeout(1400);
    await page.evaluate(() => (window as unknown as { __handle: { current: { setTilt(x: number, y: number): void } } }).__handle.current.setTilt(0.2, 0.25));
    await page.waitForTimeout(1200);
    const t = await tiltOf(page);
    check(`view ${vp.tag}: ref.setTilt() tilts`, Math.abs(t.x - 0.2) < 0.01 && Math.abs(t.y - 0.25) < 0.01, JSON.stringify(t));
    await shot(page, `folio-view-tilted-${vp.tag}`);
    await page.evaluate(() => (window as unknown as { __handle: { current: { setTilt(x: number, y: number): void } } }).__handle.current.setTilt(0, 0));
    await page.waitForTimeout(1200);
    await page.click('button[aria-label="Close the album"]');
    await coverIs(page, 0);
    await page.waitForTimeout(600);
    await shot(page, `folio-view-closed-${vp.tag}`);
    await page.click("button.folio-btn-primary");
    await coverIs(page, 1);
    check(`view ${vp.tag}: close / open buttons`, true);
    await ctx.close();
  }
});

await browser.close();
console.log(failures ? `${failures} FAILED` : "all checks passed", "· screenshots in", OUT);
process.exitCode = failures ? 1 : 0;
