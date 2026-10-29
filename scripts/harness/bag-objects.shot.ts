/*
 * Headless screenshots of the bag-objects harness. Run with the vite dev server up:
 *   # from the repo root: bunx vite --port 5263 --host 127.0.0.1 &
 *   bun scripts/harness/bag-objects.shot.ts <outDir> [shotName ...]
 * Shot names: pouch pouch-zh pouch-angled held shake <kind> <kind>-bare <kind>-back <kind>-zh <kind>-back-zh (default: all).
 * Shots are JPEG (quality 80).
 * Headless only, GPU through ANGLE/Metal, never a visible window.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.env.HARNESS_URL ?? "http://127.0.0.1:5263/scripts/harness/bag-objects.html";
const out = process.argv[2] ?? "./shots";
const only = process.argv.slice(3);
const kinds = ["card", "resume", "ticket", "polaroid", "note"];

type Shot = { name: string; qs: string; w: number; h: number; dpr: number };
const shots: Shot[] = [
  { name: "pouch", qs: "", w: 900, h: 1260, dpr: 1.5 },
  { name: "pouch-zh", qs: "sample=zh", w: 900, h: 1260, dpr: 1.5 },
  { name: "leak", qs: "leak=1", w: 600, h: 800, dpr: 1 },
  { name: "pouch-angled", qs: "view=angled", w: 900, h: 1260, dpr: 1.5 },
  { name: "pouch-redeal", qs: "deal=1", w: 900, h: 1260, dpr: 1.5 },
  { name: "held-card", qs: "held=card&kind=card&zoom=0.55", w: 900, h: 900, dpr: 1.5 },
  { name: "shake-ticket", qs: "shake=ticket&kind=ticket&zoom=0.7", w: 900, h: 900, dpr: 1.5 },
  { name: "flex-ticket-side", qs: "shake=ticket&kind=ticket&bare=1&solo=1&az=1.25&el=0.12&zoom=0.8", w: 1000, h: 800, dpr: 1.5 },
  { name: "card-edge", qs: "kind=card&bare=1&solo=1&az=0.75&el=-0.55&zoom=1.6", w: 1000, h: 800, dpr: 2 },
  { name: "resume-edge", qs: "kind=resume&bare=1&solo=1&az=0.9&el=0.35&zoom=1.1", w: 1000, h: 1000, dpr: 1.5 },
  ...kinds.map((k) => ({ name: k, qs: `kind=${k}`, w: 900, h: 900, dpr: 2 })),
  ...kinds.map((k) => ({ name: `${k}-bare`, qs: `kind=${k}&bare=1&solo=1`, w: 900, h: 900, dpr: 2 })),
  ...kinds.map((k) => ({ name: `${k}-back`, qs: `kind=${k}&bare=1&solo=1&back=1`, w: 900, h: 900, dpr: 2 })),
  ...kinds.map((k) => ({ name: `${k}-zh`, qs: `kind=${k}&bare=1&solo=1&sample=zh`, w: 900, h: 900, dpr: 2 })),
  ...kinds.map((k) => ({ name: `${k}-back-zh`, qs: `kind=${k}&bare=1&solo=1&back=1&sample=zh`, w: 900, h: 900, dpr: 2 })),
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
try {
  for (const s of shots) {
    if (only.length && !only.includes(s.name)) continue;
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
    });
    await page.goto(`${base}?${s.qs}${s.qs ? "&" : ""}dpr=${s.dpr}`);
    try {
      await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, undefined, { timeout: 30000 });
    } catch {
      failed++;
      console.error(`TIMEOUT ${s.name}`, errors.slice(0, 5));
      await page.close();
      continue;
    }
    const stats = await page.evaluate(() => (window as unknown as { __stats?: unknown }).__stats);
    const file = join(out, `${s.name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 80 });
    console.log(s.name, file, JSON.stringify(stats), errors.length ? `ERRORS ${errors.slice(0, 4).join(" | ")}` : "");
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
