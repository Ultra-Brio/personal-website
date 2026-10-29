import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

/*
 * Headless screenshots of the book harness page (scripts/harness/book.html). Never opens a visible window.
 *   bun scripts/harness/book.shoot.ts [--base http://127.0.0.1:5188] [--out <dir>] [<name-prefix>]
 * Start the dev server first (bunx vite --port <N> --host 127.0.0.1). Output defaults to a folder in the OS temp dir, never the repo.
 * Shots: closed cover, opened spread, mid page-turn for each cover material (1280x800), dark mode, and a 390x844 portrait phone.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = `${flag("--base", "http://127.0.0.1:5188")}/scripts/harness/book.html`;
const OUT = flag("--out", join(tmpdir(), "sasshi-book-shots"));
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base" && args[i - 1] !== "--out");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

type Win = { __ready: boolean; __book: { debug: { setCover(t: number): void; setProgress(p: number): void; state(): { cover: number } }; toggleCover(): void } };
async function open(q: string, vp: { width: number; height: number }) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?${q}`);
  await page.waitForFunction(() => (window as unknown as Win).__ready === true, null, { timeout: 15000 });
  // headless can silently fall back to the flat book on a software renderer: refuse to shoot the wrong thing
  const mode = await page.getAttribute(".folio-book", "data-mode");
  if (mode !== "3d") throw new Error(`expected the 3D book, got ${mode}`);
  // the canvas fades in over ~420 ms after the first frame
  await page.waitForFunction(() => getComputedStyle(document.querySelector("canvas")!).opacity === "1");
  await page.waitForTimeout(600);
  return { page, ctx };
}
const coverIs = (page: Page, c: number) => page.waitForFunction((c) => (window as unknown as Win).__book.debug.state().cover === c, c, { timeout: 8000 });

async function run(name: string, fn: () => Promise<void>) {
  if (only && !name.startsWith(only)) return;
  try {
    await fn();
    console.log("ok", name);
  } catch (e) {
    console.log("FAIL", name, String(e));
    process.exitCode = 1;
  }
}

/** open (natural) -> close (natural) -> open -> frozen mid-turn */
async function sequence(page: Page, prefix: string) {
  await coverIs(page, 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${prefix}-2-open.png`) });
  await page.evaluate(() => (window as unknown as Win).__book.toggleCover());
  await coverIs(page, 0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${prefix}-1-closed.png`) });
  await page.evaluate(() => (window as unknown as Win).__book.toggleCover());
  await coverIs(page, 1);
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as Win).__book.debug.setProgress(0.45));
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${prefix}-3-turn.png`) });
}

for (const [cover, color] of [["frost", "seiji"], ["cloth", "ginnezu"], ["leather", "aitetsu"]] as const) {
  await run(`desk-${cover}`, async () => {
    const { page, ctx } = await open(`cover=${cover}&color=${color}&img=1&window=1`, { width: 1280, height: 800 });
    await sequence(page, cover);
    await ctx.close();
  });
}

await run("phone", async () => {
  const { page, ctx } = await open("cover=leather&color=aitetsu&img=1&window=1", { width: 390, height: 844 });
  await sequence(page, "phone");
  await ctx.close();
});

await browser.close();
console.log("screenshots in", OUT);
