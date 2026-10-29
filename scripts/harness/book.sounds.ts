import { chromium, type Page } from "playwright-core";

/*
 * Headless check of the book engine's sound cues (BookOptions.onSound / BookView onSound), on the real-time loop. Never opens a window.
 *   bun scripts/harness/book.sounds.ts [--base http://127.0.0.1:5188]
 * Logs the cue sequence of every action and checks it:
 *   card binder (book.html, through BookView under StrictMode): the automatic opening; Next / Previous buttons; a drag turn forward and
 *   back; aborted drags (a small one and one past the turn threshold); a quick riffle of key turns; closing on spread 2 (the carried
 *   pages stay silent); opening by button and by dragging the cover; theme, resize and the debug poses (all silent).
 *   folio (folio.html, sheets 0, direct and ?via=view): the automatic opening, prev() closing it, toggleCover() opening, next() silent.
 * The rule for aborted drags: pageTurn only once the page was lifted past 0.05 of a turn (and then always a pageLand back on its own
 * stack); below that, a pageLand alone (quiet) if the drag lifted any link at least 0.15 rad, else nothing.
 */

const args = process.argv.slice(2);
const bi = args.indexOf("--base");
const BASE = bi >= 0 && args[bi + 1] ? args[bi + 1]! : "http://127.0.0.1:5188";

type Cue = { t: number; name: string; gain?: number; pan?: number };
type SheetState = { i: number; p: number; angles: number[] };
type Win = {
  __ready: boolean;
  __sounds: Cue[];
  __state: { index: number; closed: boolean };
  __book: {
    next(): void;
    prev(): void;
    toggleCover(): void;
    debug: { state(): { spread: number; cover: number; sheets: SheetState[] }; setProgress(p: number): void; setCover(t: number): void; release(): void };
  };
};

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
};
const fmt = (cs: Cue[], t0: number) => cs.map((c) => `${c.name}@${Math.round(c.t - t0)}ms${c.gain !== undefined ? ` g${c.gain.toFixed(2)}` : ""}${c.pan !== undefined ? ` p${c.pan > 0 ? "+" : ""}${c.pan.toFixed(2)}` : ""}`).join(", ") || "(none)";
const names = (cs: Cue[]) => cs.map((c) => c.name).join(",");

/** Run an action and collect the cues it caused within `ms` */
async function cues(page: Page, label: string, act: () => Promise<unknown>, ms = 1900): Promise<Cue[]> {
  const t0 = await page.evaluate(() => ((window as unknown as Win).__sounds.length = 0, performance.now()));
  await act();
  await page.waitForTimeout(ms);
  const cs = await page.evaluate(() => (window as unknown as Win).__sounds.slice());
  console.log(`  ${label}: ${fmt(cs, t0)}`);
  return cs;
}

/** Page-relative drag with real pointer events at ~60 Hz; also samples the moved sheet's progress / lift while it is held */
async function drag(page: Page, from: [number, number], to: [number, number], steps: number, sheet: number, back = false) {
  let maxP = 0;
  let maxLift = 0;
  const sample = async () => {
    const st = await page.evaluate((i) => (window as unknown as Win).__book.debug.state().sheets.find((s) => s.i === i)!, sheet);
    const toward = back ? 1 - st.p : st.p;
    maxP = Math.max(maxP, toward);
    const dev = Math.min(Math.max(...st.angles.map((a) => Math.abs(a))), Math.max(...st.angles.map((a) => Math.abs(a - Math.PI))));
    maxLift = Math.max(maxLift, dev);
  };
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * k) / steps, from[1] + ((to[1] - from[1]) * k) / steps);
    await page.waitForTimeout(16);
    await sample();
  }
  return {
    release: async () => {
      await page.mouse.up();
      // it keeps rising a little after the release (the hand lets go, the page carries on): watch the start of the fall too
      for (let k = 0; k < 12; k++) {
        await page.waitForTimeout(16);
        await sample();
      }
      return { maxP, maxLift };
    },
    hold: async (to2: [number, number], steps2: number) => {
      const [x0, y0] = to;
      for (let k = 1; k <= steps2; k++) {
        await page.mouse.move(x0 + ((to2[0] - x0) * k) / steps2, y0 + ((to2[1] - y0) * k) / steps2);
        await page.waitForTimeout(16);
        await sample();
      }
    },
  };
}

// ── A. the card binder through BookView (StrictMode: two scenes are built, the first is disposed)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`${BASE}/scripts/harness/book.html?img=1&n=30`);
  await page.waitForFunction(() => (window as unknown as Win).__ready === true);
  await page.waitForFunction(() => (window as unknown as Win).__book?.debug.state().cover === 1, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  console.log("card binder (book.html?img=1&n=30, 1280x800)");
  const boot = await page.evaluate(() => (window as unknown as Win).__sounds.slice());
  console.log(`  load + automatic opening: ${fmt(boot, boot[0]?.t ?? 0)}`);
  check("build is silent; the automatic opening sounds once: [coverOpen]", names(boot) === "coverOpen" && boot[0]!.gain === 1, names(boot));

  const next = await cues(page, "Next button", () => page.click('button[aria-label="Next page"]'));
  check("click turn forward: [pageTurn +0.15, pageLand on the left -0.4]", names(next) === "pageTurn,pageLand" && next[0]!.pan === 0.15 && next[0]!.gain === 1 && next[1]!.pan === -0.4 && next[1]!.gain! > 0.5, names(next));
  check("pageLand comes 0.6 … 1.1 s after pageTurn (when the page meets the stack)", next.length === 2 && next[1]!.t - next[0]!.t > 600 && next[1]!.t - next[0]!.t < 1100, `${Math.round((next[1]?.t ?? 0) - (next[0]?.t ?? 0))} ms`);
  const prev = await cues(page, "Previous button", () => page.click('button[aria-label="Previous page"]'));
  check("click turn back: [pageTurn -0.15, pageLand on the right +0.4]", names(prev) === "pageTurn,pageLand" && prev[0]!.pan === -0.15 && prev[1]!.pan === 0.4, names(prev));

  // drag turns: from the right page's outer part to the far left, and back
  let dragInfo = { maxP: 0, maxLift: 0 };
  const dragFwd = await cues(page, "drag turn forward", async () => {
    const d = await drag(page, [1050, 400], [250, 380], 24, 0);
    dragInfo = await d.release();
  });
  const st1 = await page.evaluate(() => (window as unknown as Win).__book.debug.state().spread);
  check("drag turn forward: [pageTurn, pageLand -0.4], spread 1", names(dragFwd) === "pageTurn,pageLand" && dragFwd[1]!.pan === -0.4 && st1 === 1, `${names(dragFwd)}, spread ${st1}, progress ${dragInfo.maxP.toFixed(2)}`);
  const dragBack = await cues(page, "drag turn back", async () => {
    const d = await drag(page, [230, 400], [1030, 380], 24, 0, true);
    await d.release();
  });
  const st0 = await page.evaluate(() => (window as unknown as Win).__book.debug.state().spread);
  check("drag turn back: [pageTurn -0.15, pageLand +0.4], spread 0", names(dragBack) === "pageTurn,pageLand" && dragBack[0]!.pan === -0.15 && dragBack[1]!.pan === 0.4 && st0 === 0, `${names(dragBack)}, spread ${st0}`);

  // aborted drags: the page is lifted and put back where it was (no commit: back toward the start, slowly, then let go)
  for (const [label, dx] of [
    ["aborted drag, a twitch", 7],
    ["aborted drag, edge lifted", 14],
    ["aborted drag, past the threshold", 260],
  ] as const) {
    let info = { maxP: 0, maxLift: 0 };
    const cs = await cues(page, label, async () => {
      const d = await drag(page, [1100, 420], [1100 - dx, 420], 10, 0);
      await d.hold([1100 - dx * 0.5, 420], 14);
      info = await d.release();
    });
    const spread = await page.evaluate(() => (window as unknown as Win).__book.debug.state().spread);
    const wantTurn = info.maxP >= 0.05;
    const wantLand = wantTurn || info.maxLift >= 0.15;
    const want = [wantTurn && "pageTurn", wantLand && "pageLand"].filter(Boolean).join(",");
    console.log(`    measured: progress ${info.maxP.toFixed(3)} of a turn, lift ${info.maxLift.toFixed(3)} rad -> expect [${want}]`);
    check(`${label}: spec (pageTurn iff lifted past 0.05 of a turn, pageLand iff lifted 0.15 rad; lands back on the right +0.4), no turn`, names(cs) === want && spread === 0 && cs.filter((c) => c.name === "pageLand").every((c) => c.pan === 0.4), `${names(cs)} vs [${want}], spread ${spread}`);
    if (dx > 100) check(`${label}: the page really moved, so it is [pageTurn, pageLand]`, want === "pageTurn,pageLand");
    else if (dx > 10) check(`${label}: the edge flapped up and fell back, below the turn threshold: at most a quiet pageLand`, !cs.some((c) => c.name === "pageTurn") && cs.every((c) => (c.gain ?? 1) < 0.5));
    // the drag mapping lifts the free edge quickly: even 7 px (just past the 5 px slop) raises it ~20 degrees, a quiet tap when it drops
    else check(`${label}: no pageTurn; silent, or one quiet pageLand if the edge visibly lifted`, !cs.some((c) => c.name === "pageTurn") && (info.maxLift < 0.15 ? cs.length === 0 : cs.length === 1 && cs[0]!.gain! < 0.4), `lift ${info.maxLift.toFixed(3)}`);
  }

  // a quick riffle: three key turns in a row, to the last spread (30 cards = 3 sheets; staggered pages, one pageTurn + one pageLand
  // each; later turns / landings of a riffle softer)
  await page.focus(".folio-book");
  const riffle = await cues(page, "3x ArrowRight", async () => {
    for (let k = 0; k < 3; k++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(40);
    }
  }, 2600);
  const turns = riffle.filter((c) => c.name === "pageTurn");
  const lands = riffle.filter((c) => c.name === "pageLand");
  const gaps = turns.slice(1).map((c, i) => Math.round(c.t - turns[i]!.t));
  // the stagger is 110 ms of physics time; wall-clock gaps jitter with the frames
  check("riffle: 3 pageTurns staggered (>= 50 ms apart in wall time), later ones softer, and 3 pageLands on the left", turns.length === 3 && lands.length === 3 && gaps.every((g) => g >= 50) && turns.slice(1).every((c) => c.gain! < 1) && lands.every((c) => c.pan === -0.4), `turn gaps ${gaps.join("/")} ms`);

  // closing on the last spread: the pages the front board carries back fall onto the right stack silently
  const close = await cues(page, "Close button on spread 3", () => page.click('button[aria-label="Close the album"]'), 2600);
  check("close: exactly [coverClose] (carried pages make no pageLand)", names(close) === "coverClose" && close[0]!.gain === 1, names(close));
  const open = await cues(page, "Open button", () => page.click("button.folio-btn-primary"), 2200);
  check("open: exactly [coverOpen]", names(open) === "coverOpen", names(open));

  // silent: resize, debug poses (and the cover easing back after a debug pose is not a cover motion either)
  const silent = await cues(page, "resize, debug.setProgress / setCover / release", async () => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as unknown as Win).__book.debug.setProgress(0.45));
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as unknown as Win).__book.debug.setCover(0.3));
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as unknown as Win).__book.debug.release());
  }, 1500);
  check("resize and debug poses are silent", silent.length === 0, names(silent));

  // the cover lies closed now (setCover(0.3) + release eased it shut): drag it open
  const closedNow = await page.evaluate(() => (window as unknown as Win).__book.debug.state().cover < 0.01);
  const coverDrag = await cues(page, "drag the closed cover open", async () => {
    await page.mouse.move(800, 400);
    await page.mouse.down();
    for (let k = 1; k <= 16; k++) {
      await page.mouse.move(800 - 26 * k, 400);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }, 2200);
  check("cover drag: [coverOpen] once, on release", closedNow && names(coverDrag) === "coverOpen", `${names(coverDrag)} (was closed: ${closedNow})`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── B. the folio (no pages), direct createBook and through BookView
for (const via of ["", "&via=view"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/scripts/harness/folio.html?film=0${via}`);
  await page.waitForFunction(() => (window as unknown as Win).__ready === true, null, { timeout: 15000 });
  await page.waitForFunction(() => (window as unknown as Win).__book?.debug.state().cover === 1, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  console.log(`folio (folio.html${via ? "?via=view" : ""})`);
  const boot = await page.evaluate(() => (window as unknown as Win).__sounds.slice());
  console.log(`  load + automatic opening: ${fmt(boot, boot[0]?.t ?? 0)}`);
  check(`folio${via}: the automatic opening sounds once: [coverOpen]`, names(boot) === "coverOpen", names(boot));
  const n = await cues(page, "next() on the open folio", () => page.evaluate(() => (window as unknown as Win).__book.next()), 600);
  check(`folio${via}: next() has nothing to turn: silent`, n.length === 0, names(n));
  const c = await cues(page, "prev() closes it", () => page.evaluate(() => (window as unknown as Win).__book.prev()), 2000);
  check(`folio${via}: prev() -> [coverClose]`, names(c) === "coverClose", names(c));
  const o = await cues(page, "toggleCover() opens it", () => page.evaluate(() => (window as unknown as Win).__book.toggleCover()), 2200);
  check(`folio${via}: toggleCover() -> [coverOpen]`, names(o) === "coverOpen", names(o));
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all sound checks passed");
process.exit(failed ? 1 : 0);
