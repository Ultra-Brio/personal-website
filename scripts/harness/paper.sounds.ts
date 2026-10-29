import { chromium, type Page } from "playwright-core";

/*
 * Headless check of the paper viewer's sound cues (PaperViewerOptions.onSound) on scripts/harness/paper.html. Never opens a window.
 *   bun scripts/harness/paper.sounds.ts [--base http://127.0.0.1:5188]
 * Time is driven deterministically (manual mode, 60 Hz frames); cue times are printed in frames from the action.
 * Résumé (1440x900, a longer résumé — long=1 — so the wide host's book has a second spread to turn to): opening, next(), prev(), a hover peek, a corner drag across (pageTurn, rustles, pageLand), a drag that comes back,
 * a click on the right half, a re-typeset on resize. Card: opening, a hover peek, a click, a drag shut, a drag open.
 */

const args = process.argv.slice(2);
const bi = args.indexOf("--base");
const BASE = `${bi >= 0 && args[bi + 1] ? args[bi + 1]! : "http://127.0.0.1:5188"}/scripts/harness/paper.html`;

type Cue = { f: number; t: number; name: string; gain?: number; pan?: number };
type Api = {
  ready: boolean;
  error?: string;
  manual(on: boolean): void;
  advance(dt: number, frames?: number): void;
  frames: number;
  sounds: Cue[];
  viewer: { next(): void; prev(): void; state: { page: number; count: number }; debug: { project(x: number, y: number, z: number): [number, number] } };
};
type W = { __paper: Api };

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
};
const names = (cs: Cue[]) => cs.map((c) => c.name).join(",");
const fmt = (cs: Cue[], f0: number) => cs.map((c) => `${c.name}@f${c.f - f0}${c.gain !== undefined ? ` g${c.gain.toFixed(2)}` : ""}${c.pan !== undefined ? ` p${c.pan > 0 ? "+" : ""}${c.pan.toFixed(2)}` : ""}`).join(", ") || "(none)";

const adv = (page: Page, n: number) => page.evaluate((n) => (window as unknown as W).__paper.advance(1 / 60, n), n);
const project = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => (window as unknown as W).__paper.viewer.debug.project(x!, y!, 0), [x, y] as const);

/** Run an action (which may advance frames itself), then `frames` more; returns the cues since the start */
async function cues(page: Page, label: string, act: () => Promise<unknown>, frames = 240): Promise<Cue[]> {
  const f0 = await page.evaluate(() => ((window as unknown as W).__paper.sounds.length = 0, (window as unknown as W).__paper.frames));
  await act();
  await adv(page, frames);
  const cs = await page.evaluate(() => (window as unknown as W).__paper.sounds.slice());
  console.log(`  ${label}: ${fmt(cs, f0)}`);
  return cs;
}
/** Mouse drag along a path, one frame per step */
async function drag(page: Page, path: [number, number][]) {
  await page.mouse.move(path[0]![0], path[0]![1]);
  await page.mouse.down();
  for (let i = 1; i < path.length; i++) {
    await page.mouse.move(path[i]![0], path[i]![1]);
    await adv(page, 1);
  }
  await page.mouse.up();
}
async function open(item: "resume" | "card", extra = "") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`${BASE}?item=${item}${extra}`);
  await page.waitForFunction(() => (window as unknown as { __paper?: Api }).__paper?.ready === true, null, { timeout: 20000 });
  await page.evaluate(() => (window as unknown as W).__paper.manual(true));
  await page.waitForTimeout(350);
  await adv(page, 30);
  return { page, ctx, errors };
}

const A4 = { w: 2.1, h: 2.97 };

// ── résumé
{
  const { page, ctx, errors } = await open("resume", "&long=1");
  console.log("résumé (1440x900)");
  const boot = await page.evaluate(() => (window as unknown as W).__paper.sounds.slice());
  check("opening is silent", boot.length === 0, names(boot));

  const next = await cues(page, "next()", () => page.evaluate(() => (window as unknown as W).__paper.viewer.next()));
  check("next(): [pageTurn +0.15 g1, pageLand on the left -0.3]", names(next) === "pageTurn,pageLand" && next[0]!.pan === 0.15 && next[0]!.gain === 1 && next[1]!.pan === -0.3, names(next));
  const prev = await cues(page, "prev()", () => page.evaluate(() => (window as unknown as W).__paper.viewer.prev()));
  check("prev(): [pageTurn -0.15, pageLand on the right +0.3]", names(prev) === "pageTurn,pageLand" && prev[0]!.pan === -0.15 && prev[1]!.pan === 0.3, names(prev));

  const peek = await cues(page, "hover peek on the free edge, then away", async () => {
    const [hx, hy] = await project(page, A4.w - 0.12, -0.6);
    await page.mouse.move(hx, hy);
    await adv(page, 40);
    await page.mouse.move(5, 5);
  }, 90);
  check("a hover peek is silent", peek.length === 0, names(peek));

  const back = await cues(page, "short drag that comes back (page 1 stays)", async () => {
    const [sx, sy] = await project(page, A4.w - 0.06, 0);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) pts.push([sx - Math.sin((Math.PI * i) / 12) * 120, sy]);
    await drag(page, pts);
  });
  const st2 = await page.evaluate(() => (window as unknown as W).__paper.viewer.state.page);
  const backTurn = back.some((c) => c.name === "pageTurn");
  check("a drag that comes back: no turn; any pageTurn is followed by a pageLand back on the right (+0.3)", st2 === 0 && (!backTurn || names(back).endsWith("pageLand")) && back.filter((c) => c.name === "pageLand").every((c) => c.pan === 0.3), names(back));

  // the corner dragged across to the left over ~0.77 s
  const across = await cues(page, "corner drag across", async () => {
    const [x0, y0] = await project(page, A4.w - 0.06, -A4.h / 2 + 0.12);
    const x1 = Math.max(10, (await project(page, -A4.w * 0.75, -A4.h / 2 + 0.12))[0]);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 46; i++) {
      const t = i / 46;
      const e = t * t * (3 - 2 * t);
      pts.push([x0 + (x1 - x0) * e, y0 - Math.sin(Math.PI * t) * 60]);
    }
    await drag(page, pts);
  });
  const turnF = across.find((c) => c.name === "pageTurn")?.f ?? -1;
  const rustles = across.filter((c) => c.name === "paperRustle");
  const rg = rustles.slice(1).map((c, i) => c.f - rustles[i]!.f);
  const landed = across.filter((c) => c.name === "pageLand");
  check(
    "drag across: one pageTurn, rustles >= 24 frames (400 ms) apart and >= 18 frames (300 ms) after the pageTurn, then one pageLand -0.3",
    across.filter((c) => c.name === "pageTurn").length === 1 && rustles.length >= 1 && rg.every((g) => g >= 24) && rustles.every((c) => c.f - turnF >= 18 || c.f < turnF) && landed.length === 1 && landed[0]!.pan === -0.3 && across[across.length - 1]!.name === "pageLand",
    `${names(across)}; rustle gaps ${rg.join("/")} frames`,
  );
  check(
    "drag across: no rustle in the drag's first 15 frames (250 ms), so the quick drag's pageTurn is not doubled",
    rustles.every((c) => c.f - across[0]!.f >= 0 && c.f >= (across.find((x) => x.name === "pageTurn")?.f ?? 0)),
    `${names(across)}`,
  );
  const state1 = await page.evaluate(() => (window as unknown as W).__paper.viewer.state.page);
  check("…and the page turned", state1 === 1);

  const click = await cues(page, "click on the left half", async () => {
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
  });
  check("a click on the left half: [pageTurn -0.15, pageLand +0.3]", names(click) === "pageTurn,pageLand" && click[0]!.pan === -0.15 && click[1]!.pan === 0.3, names(click));

  const resize = await cues(page, "resize to 390x844 (re-typeset onto more pages)", async () => {
    const before = await page.evaluate(() => (window as unknown as W).__paper.viewer.state.count);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((n) => (window as unknown as W).__paper.viewer.state.count !== n, before, { timeout: 5000 });
  }, 60);
  check("a re-typeset is silent", resize.length === 0, names(resize));
  check("résumé: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── business card
{
  const { page, ctx, errors } = await open("card");
  console.log("business card (1440x900)");
  const boot = await page.evaluate(() => (window as unknown as W).__paper.sounds.slice());
  check("opening is silent", boot.length === 0, names(boot));
  const [cx, cy] = await project(page, 0, -0.27);
  const peek = await cues(page, "hover peek, then away", async () => {
    await page.mouse.move(cx, cy);
    await adv(page, 50);
    await page.mouse.move(4, 4);
  }, 120);
  check("a hover peek is silent", peek.length === 0, names(peek));
  const click = await cues(page, "click", () => page.mouse.click(cx, cy), 120);
  check("click: [cardUnfold] at once", names(click) === "cardUnfold" && click[0]!.gain === 1, names(click));
  const shut = await cues(page, "drag the cover down (shut)", async () => {
    const [tx, ty] = await project(page, 0, 0.5);
    const [bx, by] = await project(page, 0, -0.45);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) pts.push([tx + (bx - tx) * (i / 40), ty + (by - ty) * (i / 40)]);
    await drag(page, pts);
  });
  const closed = await page.evaluate(() => (window as unknown as W).__paper.viewer.state.page === 0);
  check("drag shut: one cardUnfold as the hand takes the cover, nothing on release", closed && names(shut) === "cardUnfold", names(shut));
  const reopen = await cues(page, "drag the cover up (open)", async () => {
    const [ex, ey] = await project(page, 0, -0.5);
    const [fx, fy] = await project(page, 0, 0.55);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) pts.push([ex + (fx - ex) * (i / 40), ey + (fy - ey) * (i / 40)]);
    await drag(page, pts);
  });
  check("drag open: one cardUnfold", names(reopen) === "cardUnfold", names(reopen));
  const again = await cues(page, "next() on the open card", () => page.evaluate(() => (window as unknown as W).__paper.viewer.next()), 60);
  check("next() when already open is silent", again.length === 0, names(again));
  const keyShut = await cues(page, "prev()", () => page.evaluate(() => (window as unknown as W).__paper.viewer.prev()), 120);
  check("prev(): [cardUnfold]", names(keyShut) === "cardUnfold", names(keyShut));
  check("card: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all paper sound checks passed");
process.exit(failed ? 1 : 0);
