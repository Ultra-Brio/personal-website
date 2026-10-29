/*
 * Headless screenshots of the pouch addon in its stand-in host (scripts/harness/pouch.html), deterministic frames
 * (manual mode: the page renders only through window.__host.advance).
 *   # from the repo root: bunx vite --port 5212 --host 127.0.0.1 &
 *   bun scripts/harness/pouch.shot.ts --base http://127.0.0.1:5212 --out <dir> [--only desktop-en] [--seed 7]
 * Per sample (en, zh) x viewport (1440x900, 390x844): settled, shake (mid-tumble after the Shake button), after-shake (at rest
 * again), tilt (30 degrees, slid to the low edge), hold (the card picked up and dragged). Light only. Headless only (ANGLE / Metal), never a visible window.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const base = arg("base", "http://127.0.0.1:5212");
const out = arg("out", "./pouch-shots");
const only = arg("only", "");
const seed = arg("seed", "7");
const extra = arg("qs", "");
mkdirSync(out, { recursive: true });

type Host = {
  ready: boolean;
  advance(dt: number, n: number): boolean;
  setTilt(x: number, y?: number): void;
  shake(s?: number): void;
  shakeBook(s?: number): void;
  screenOf(id: string, dx?: number, dy?: number): { x: number; y: number };
};
/** Evaluated in the page, so plain JS (no TS syntax). */
const H = "window.__host";

async function adv(page: Page, n: number) {
  await page.evaluate((n) => (window as unknown as { __host: Host }).__host.advance(1 / 60, n), n);
}

const views = [
  { name: "desktop", w: 1440, h: 900, dpr: 1.5 },
  { name: "phone", w: 390, h: 844, dpr: 2 },
];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
try {
  for (const lang of ["en", "zh"]) {
    for (const v of views) {
      const tag = `${v.name}-${lang}`;
      if (only && !tag.includes(only)) continue;
      const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dpr });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
      });
      await page.goto(`${base}/scripts/harness/pouch.html?manual=1&ui=0&seed=${seed}${lang === "zh" ? "&sample=zh" : ""}${extra ? "&" + extra : ""}`);
      await page.waitForFunction(`${H}?.ready === true`, undefined, { timeout: 30000 });
      const shot = async (name: string) => {
        const file = join(out, `${tag}-${name}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      };
      // settled
      await adv(page, 90);
      await shot("1-settled");
      // the Shake button: caught mid-tumble, then at rest again
      await page.evaluate(() => (window as unknown as { __host: Host }).__host.shake(1));
      await adv(page, 12);
      await shot("2-shake");
      await adv(page, 180);
      await shot("3-after-shake");
      // tilt 30 degrees (top edge up): everything slides to the low (bottom) edge
      await page.evaluate(() => (window as unknown as { __host: Host }).__host.setTilt(30, 0));
      await adv(page, 150);
      await shot("4-tilt");
      await page.evaluate(() => (window as unknown as { __host: Host }).__host.setTilt(0, 0));
      await adv(page, 90);
      // hold: press the card, drag it up and to the right, keep holding
      const p = await page.evaluate(() => (window as unknown as { __host: Host }).__host.screenOf("card"));
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await adv(page, 6);
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(p.x + (v.w * 0.1 * i) / steps, p.y - (v.h * 0.18 * i) / steps);
        await adv(page, 2);
      }
      await adv(page, 30);
      await shot("5-hold");
      await page.mouse.up();
      await adv(page, 60);
      if (errors.length) {
        failed++;
        console.error(tag, "ERRORS", errors.slice(0, 5));
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
