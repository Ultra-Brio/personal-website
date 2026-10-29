import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

/*
 * Polish-round matrix (headless only): every booklet × case material, open and closed, through BookView (StrictMode) with the
 * site's fonts and desk tokens, swapping the case LIVE (cover prop → Book.setCover) — never by reloading. Checks along the way:
 *  - one WebGL canvas and the same Book (no scene rebuild, no new context) across all swaps;
 *  - the open / closed state and (folio) the pouch's object positions survive each swap;
 *  - the canvas corner pixel equals the page's desk (--folio-bg: the canvas is transparent over it).
 *   bun scripts/harness/folio.polish.ts --base http://127.0.0.1:5262 --out <dir> [--only resume,cards,postcards]
 * Writes PNGs and <out>/report.json; exits 1 when a check fails. A page that reloads under the run (a dev server's full reload when
 * another file is saved) is reported as RELOADED and that booklet / theme is run again once — a reload is not a swap failure.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BASE = flag("--base", "http://127.0.0.1:5262");
const OUT = flag("--out", "/tmp/sasshi-polish");
const ONLY = flag("--only", "resume,cards,postcards").split(",");
const THEMES = flag("--theme", "light").split(",");
mkdirSync(OUT, { recursive: true });

type Booklet = { name: string; url: string; defaults: { material: string; color: string; foil: string } };
const booklets: Booklet[] = [
  { name: "resume", url: "folio.html?via=view&pouch=1&shot=1", defaults: { material: "leather", color: "aitetsu", foil: "silver" } },
  { name: "cards", url: "book.polish.html?shot=1&kind=album&n=11&title=Cards", defaults: { material: "frost", color: "seiji", foil: "silver" } },
  { name: "postcards", url: "book.polish.html?shot=1&kind=postcards&n=7&title=Postcards", defaults: { material: "cloth", color: "ginnezu", foil: "blind" } },
];
const MATERIALS = ["leather", "cloth", "frost"];

const report: Record<string, unknown> = {};
const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(ok ? "PASS" : "FAIL", what);
  if (!ok) fails.push(what);
};

type W = {
  __book: { debug: { state(): { cover: number }; tilt(): { frames: number } } } | null;
  __state: { closed: boolean } | null;
  __setCover(c: Record<string, string>): void;
  __handle?: { current: { toggleCover(): void } | null };
  __pouch?: { debug: { sim: { state(): { id: string; x: number; y: number }[] } } };
};

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
class Reloaded extends Error {}
async function run(b: Booklet, theme: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fails.push(`${b.name} pageerror ${e.message}`));
  let loads = 0;
  page.on("load", () => loads++);
  const same = () => {
    if (loads > 1) throw new Reloaded(`${b.name} ${theme}`);
  };
  const q = `&cover=${b.defaults.material}&color=${b.defaults.color}&foil=${b.defaults.foil}`;
  await page.goto(`${BASE}/scripts/harness/${b.url}${q}`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(3200); // auto-open lands
  await page.evaluate(() => {
    const w = window as unknown as W & { __first: unknown; __gl0: unknown };
    w.__first = w.__book;
    w.__gl0 = document.querySelector(".folio-stage > canvas, #stage canvas");
  });
  const pouchBefore = await page.evaluate(() => (window as unknown as W).__pouch?.debug.sim.state().map((s) => [s.id, +s.x.toFixed(4), +s.y.toFixed(4)]) ?? null);
  // corner pixel = the page colour, as composited (the WebGL drawing buffer is not kept between frames, so read a screenshot of it)
  const shot0 = (await page.screenshot({ clip: { x: 3, y: 3, width: 1, height: 1 } })).toString("base64");
  const corner = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const g = probe.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, 1, 1).data;
    // the canvas is transparent: a bare corner is the page's desk
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--folio-bg").trim();
    return { px: [d[0], d[1], d[2]], paper };
  }, shot0);
  report[`${b.name}:${theme}:corner`] = corner;
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const want = hex(corner.paper);
  check(corner.px.every((v, i) => Math.abs(v! - want[i]!) <= 2), `${b.name} ${theme}: canvas corner ${corner.px} = the desk ${corner.paper}`);

  for (const state of ["open", "closed"] as const) {
    if (state === "closed") {
      // close only once the opening has landed (a toggle while it opens would open it again)
      await page.waitForFunction(() => {
        const w = window as unknown as W;
        return w.__state?.closed === false && w.__book?.debug.state().cover === 1;
      }, null, { timeout: 10000 });
      await page.evaluate(() => {
        const w = window as unknown as W;
        (w.__handle?.current ?? (w as unknown as { __book: { toggleCover(): void } }).__book).toggleCover();
      });
      await page.waitForTimeout(2200);
    }
    for (const m of [...MATERIALS.filter((x) => x !== b.defaults.material), b.defaults.material]) {
      await page.evaluate((mat) => (window as unknown as W).__setCover({ material: mat }), m);
      if (m === MATERIALS.find((x) => x !== b.defaults.material) && state === "open" && theme === "light") {
        // mid cross-fade, once per booklet
        await page.waitForTimeout(170);
        await page.screenshot({ path: join(OUT, `${b.name}-${theme}-${state}-${m}-midfade.png`) });
      }
      await page.waitForTimeout(900);
      const shot = `${b.name}-${theme}-${state}-${m}.png`;
      await page.screenshot({ path: join(OUT, shot) });
      const st = await page.evaluate(() => {
        const w = window as unknown as W & { __first: unknown; __gl0: unknown };
        const gl = [...document.querySelectorAll("canvas")].filter((c) => c.style.position !== "absolute");
        return { same: w.__book === w.__first, glSame: document.querySelector(".folio-stage > canvas, #stage canvas") === w.__gl0, canvases: gl.length, closed: w.__state?.closed ?? null, cover: w.__book?.debug.state().cover ?? null };
      });
      same();
      report[shot] = st;
      check(st.same && st.glSame, `${shot}: same Book and WebGL canvas after the swap`);
      check(st.closed === (state === "closed"), `${shot}: still ${state}`);
    }
  }
  if (pouchBefore) {
    // re-open and compare the pouch: nothing should have been reset by the swaps
    const after = await page.evaluate(() => (window as unknown as W).__pouch?.debug.sim.state().map((s) => [s.id, +s.x.toFixed(4), +s.y.toFixed(4)]) ?? null);
    report[`${b.name}:${theme}:pouch`] = { before: pouchBefore, after };
    check(!!after && after.length === pouchBefore.length, `${b.name} ${theme}: pouch keeps its ${pouchBefore.length} objects across swaps`);
  }
  await ctx.close();
}
for (const b of booklets) {
  if (!ONLY.includes(b.name)) continue;
  for (const theme of THEMES) {
    const before = fails.length;
    try {
      await run(b, theme);
    } catch (e) {
      if (!(e instanceof Reloaded)) throw e;
      console.log("RELOADED", e.message, "— running it again");
      fails.length = before;
      await run(b, theme);
    }
  }
}
await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log(fails.length ? `${fails.length} FAILED:\n${fails.join("\n")}` : "all checks passed");
process.exitCode = fails.length ? 1 : 0;
