import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

/*
 * Pixel golden for the card binder (headless only).
 *   bun scripts/harness/book.golden.ts --base http://127.0.0.1:5188 --out <dir> [--compare <golden.json>]
 * 1) book.golden.html: hashes of side textures, the sheet normal map and the cover window painted with fixed inputs.
 * 2) book.html frozen 3D frames (debug.setCover / setProgress) for three covers: hashes of the screenshots (PNGs saved too).
 * Writes <out>/golden.json; with --compare, reports every key whose hash differs.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = flag("--base", "http://127.0.0.1:5188");
const OUT = flag("--out", "/tmp/sasshi-golden");
const CMP = flag("--compare", "");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const golden: Record<string, string> = {};

{
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/scripts/harness/book.golden.html`);
  await page.waitForFunction(() => !!(window as unknown as { __golden?: unknown }).__golden, null, { timeout: 30000 });
  Object.assign(golden, await page.evaluate(() => (window as unknown as { __golden: Record<string, string> }).__golden));
  await ctx.close();
}

type Win = { __ready: boolean; __book: { debug: { setCover(t: number): void; setProgress(p: number, dir?: 1 | -1): void } } };
for (const [cover, color] of [
  ["frost", "paper"],
  ["cloth", "slate"],
  ["leather", "clay"],
] as const) {
  for (const vp of [
    { width: 1280, height: 800, tag: "desk" },
    { width: 390, height: 844, tag: "phone" },
  ]) {
    if (vp.tag === "phone" && cover !== "leather") continue;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/scripts/harness/book.html?cover=${cover}&color=${color}&img=1&window=1&n=14`);
    await page.waitForFunction(() => (window as unknown as Win).__ready === true, null, { timeout: 15000 });
    await page.waitForTimeout(900);
    for (const [name, fn] of [
      ["closed", (w: Win) => w.__book.debug.setCover(0)],
      ["open", (w: Win) => w.__book.debug.setCover(1)],
      ["turn45", (w: Win) => w.__book.debug.setProgress(0.45)],
    ] as const) {
      await page.evaluate(`(${fn.toString()})(window)`);
      await page.waitForTimeout(250);
      const png = await page.screenshot();
      writeFileSync(join(OUT, `${cover}-${vp.tag}-${name}.png`), png);
      golden[`frame:${cover}:${vp.tag}:${name}`] = createHash("sha256").update(png).digest("hex").slice(0, 24);
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(OUT, "golden.json"), JSON.stringify(golden, null, 1));
console.log(Object.keys(golden).length, "keys →", join(OUT, "golden.json"));
if (CMP && existsSync(CMP)) {
  const want = JSON.parse(readFileSync(CMP, "utf8")) as Record<string, string>;
  let bad = 0;
  for (const k of Object.keys(want)) {
    if (golden[k] !== want[k]) {
      bad++;
      console.log("DIFF", k, want[k], "→", golden[k]);
    }
  }
  console.log(bad ? `${bad} of ${Object.keys(want).length} differ` : `identical: all ${Object.keys(want).length} keys`);
  process.exitCode = bad ? 1 : 0;
}
