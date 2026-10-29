import { chromium } from "playwright-core";

/*
 * One headless screenshot of a harness page (for quick looks while iterating).
 *   bun scripts/harness/folio.snap.ts <url> <out.png> [--vp 1440x900] [--dpr 1] [--wait 1500] [--clip x,y,w,h] [--full] [--eval "js"]...
 * Waits for window.__ready, then `--wait` ms; each --eval runs in order (awaited, with --wait after each).
 */

const a = process.argv.slice(2);
const url = a[0]!;
const out = a[1]!;
const opt = (n: string) => {
  const i = a.indexOf(n);
  return i >= 0 ? a[i + 1] : undefined;
};
const evals: string[] = [];
a.forEach((x, i) => x === "--eval" && a[i + 1] && evals.push(a[i + 1]!));
const [vw, vh] = (opt("--vp") ?? "1440x900").split("x").map(Number) as [number, number];
const dpr = Number(opt("--dpr") ?? 1);
const wait = Number(opt("--wait") ?? 1500);
const clip = opt("--clip")?.split(",").map(Number);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => console.log("console", m.type(), m.text()));
await page.goto(url);
await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30000 });
await page.waitForTimeout(wait);
for (const e of evals) {
  console.log("eval", JSON.stringify(await page.evaluate(e)));
  await page.waitForTimeout(wait);
}
await page.screenshot({ path: out, fullPage: a.includes("--full"), ...(clip && { clip: { x: clip[0]!, y: clip[1]!, width: clip[2]!, height: clip[3]! } }) });
await browser.close();
console.log("saved", out);
