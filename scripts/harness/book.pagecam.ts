import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type CDPSession, type Page } from "playwright-core";

/*
 * The phone's page camera (brief r4 E2), frame by frame: a narrow album (book.frame.html, the shell's insets and narrow rule) driven
 * on the engine's manual clock (1/60 s a frame) with real input — touch (CDP Input.dispatchTouchEvent in a hasTouch / isMobile
 * context) or the mouse — whose event times step with the clock. Every frame logs the camera (target x, distance) and the boards'
 * screen boxes (Book.debug.screenBox).
 * Scenarios: next / prev through every page and back (the keys and the shell's buttons call the same), a quick double press each way,
 * then by hand: a drag that reverses and falls back, a slow drag that turns, a drag back, a fling, a pan of the spread, on every page
 * forward and back again; at the last page a drag that has nowhere to go; at the first a cover drag let go early, one that closes
 * the cover, and the cover opened again.
 * Per frame with the cover open (swing frames are D1's, reported apart): the open book on screen (front + back board inside the
 * canvas ≥ 60 % of the least at rest), its height ≥ 85 % of the resting height, and — except while a finger holds the camera — the
 * camera's change ≤ 2 % (the slide of the view's middle, in canvas widths, or the change of distance); frames per motion.
 *   bun scripts/harness/book.pagecam.ts --base http://127.0.0.1:5221 --out <dir> [--vp 390x844,375x667,396x690,834x1112]
 *     [--b cards,postcards] [--input touch,mouse] [--q "&tilt=0"]
 * Never opens a visible window. Exit code 1 when a check fails.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const BASE = `${flag("--base", "http://127.0.0.1:5188")}/scripts/harness/book.frame.html`;
const OUT = flag("--out", "/tmp/sasshi-pagecam");
const VPS = flag("--vp", "390x844,375x667,396x690,834x1112").split(",").map((s) => s.split("x").map(Number) as [number, number]);
const BOOKLETS = flag("--b", "cards,postcards").split(",");
const INPUTS = flag("--input", "touch,mouse").split(",") as ("touch" | "mouse")[];
const EXTRA = flag("--q", "&tilt=0");
mkdirSync(OUT, { recursive: true });

type R = { left: number; top: number; right: number; bottom: number };
type F = { ph: string; finger: boolean; cover: number; page: number; awake: number; x: number; d: number; front: R; back: R; all: R };
const TAN = Math.tan((12 * Math.PI) / 180);
const COS = Math.cos((9 * Math.PI) / 180);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failures = 0;
const summary: unknown[] = [];

for (const b of BOOKLETS)
  for (const [W, H] of VPS)
    for (const input of INPUTS) {
      const name = `${b}-${W}x${H}-${input}`;
      const touch = input === "touch";
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log(name, "[pageerror]", e.message));
      await page.goto(`${BASE}?b=${b}&ambient=0${EXTRA}`);
      await page.waitForFunction(() => (window as unknown as { __ready: boolean }).__ready === true, null, { timeout: 60000 });
      // the cover opens by itself on the real clock
      await page.waitForFunction(() => {
        const bk = (window as unknown as { __book: { debug: { state(): { cover: number; sheets: { awake: boolean }[] } } } }).__book;
        const s = bk.debug.state();
        return s.cover === 1 && !s.sheets.some((x) => x.awake);
      }, null, { timeout: 30000 });
      await page.waitForTimeout(300);
      const cdp = await ctx.newCDPSession(page);
      const r = await drive(page, cdp, W, H, touch);
      const rep = report(name, r.frames, r.motions, W, H);
      summary.push(rep);
      writeFileSync(`${OUT}/${name}.json`, JSON.stringify(r.frames));
      await ctx.close();
    }
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
await browser.close();
console.log(failures ? `${failures} FAIL` : "all PASS");
process.exit(failures ? 1 : 0);

async function drive(page: Page, cdp: CDPSession, W: number, H: number, touch: boolean) {
  const frames: F[] = [];
  const motions: { ph: string; frames: number }[] = [];
  const base = Date.now() / 1000;
  let f = 0;
  let finger = false;
  let ph = "rest";
  const at = () => base + f / 60;
  const ptr = async (type: "down" | "move" | "up", x: number, y: number) => {
    if (touch) {
      const t = type === "down" ? "touchStart" : type === "move" ? "touchMove" : "touchEnd";
      await cdp.send("Input.dispatchTouchEvent", { type: t, touchPoints: type === "up" ? [] : [{ x, y }], timestamp: at() });
    } else {
      const t = type === "down" ? "mousePressed" : type === "move" ? "mouseMoved" : "mouseReleased";
      await cdp.send("Input.dispatchMouseEvent", { type: t, x, y, button: "left", buttons: type === "up" ? 0 : 1, clickCount: 1, timestamp: at() });
    }
    finger = type !== "up";
  };
  const frame = async () => {
    const s = (await page.evaluate(() => {
      const bk = (window as unknown as { __book: any }).__book;
      bk.debug.advance(1 / 60);
      const st = bk.debug.state();
      const sb = bk.debug.screenBox();
      const cam = bk.debug.tilt().cam as [number, number];
      return { cover: st.cover, page: st.page, awake: st.sheets.filter((x: { awake: boolean }) => x.awake).length, cam, front: sb.front, back: sb.back, all: sb.all };
    })) as { cover: number; page: number; awake: number; cam: [number, number]; front: R; back: R; all: R };
    // the camera's distance from its target out of its distance from the origin (put(): (x, −sin T · d, cos T · d + 0.04))
    const [x, len] = s.cam;
    const c = 0.0016 + x * x - len * len;
    const d = (-0.08 * COS + Math.sqrt(0.0064 * COS * COS - 4 * c)) / 2;
    frames.push({ ph, finger, cover: s.cover, page: s.page, awake: s.awake, x, d, front: s.front, back: s.back, all: s.all });
    f++;
    return frames[frames.length - 1]!;
  };
  /** Frames until the pages lie still, the camera has stopped and the cover is open (or `max`) */
  const settle = async (max = 300) => {
    let still = 0;
    for (let i = 0; i < max; i++) {
      const a = await frame();
      const p = frames[frames.length - 2];
      const same = p && Math.abs(p.x - a.x) < 1e-6 && Math.abs(p.d - a.d) < 1e-6;
      still = a.awake === 0 && (a.cover === 1 || a.cover === 0) && same ? still + 1 : 0;
      if (still >= 3) return i + 1;
    }
    return max;
  };
  const state = () => page.evaluate(() => (window as unknown as { __book: any }).__book.debug.state()) as Promise<{ page: number }>;
  const count = () => page.evaluate(() => (window as unknown as { __state: { count: number } }).__state.count) as Promise<number>;
  const call = (fn: "next" | "prev") => page.evaluate((k) => (window as unknown as { __book: any }).__book[k](), fn);
  const motion = async (label: string, run: () => Promise<void>) => {
    ph = label;
    const f0 = f;
    await run();
    const n = await settle();
    motions.push({ ph: label, frames: f - f0 });
    ph = "rest";
    return n;
  };
  /** A drag along y = H·0.52 from fx0 to fx1 (fractions of the width) over n frames; `back`: then to fx2 over m frames */
  const drag = async (fx0: number, fx1: number, n: number, back?: [number, number]) => {
    const y = H * 0.52;
    let x = W * fx0;
    await ptr("down", x, y);
    await frame();
    for (let i = 1; i <= n; i++) {
      x = W * (fx0 + ((fx1 - fx0) * i) / n);
      await ptr("move", x, y);
      await frame();
    }
    if (back)
      for (let i = 1; i <= back[1]; i++) {
        x = W * (fx1 + ((back[0] - fx1) * i) / back[1]);
        await ptr("move", x, y);
        await frame();
      }
    await ptr("up", x, y);
  };
  for (let i = 0; i < 10; i++) await frame();
  const pages = await count();
  // keys / buttons: every page forward, then back
  for (let m = 0; m + 1 < pages; m++) await motion(`next ${m}→${m + 1}`, () => call("next"));
  for (let m = pages - 1; m > 0; m--) await motion(`prev ${m}→${m - 1}`, () => call("prev"));
  // a quick double press each way
  if (pages > 2) {
    await motion("next×2", async () => {
      await call("next");
      for (let i = 0; i < 8; i++) await frame();
      await call("next");
    });
    await motion("prev×2", async () => {
      await call("prev");
      for (let i = 0; i < 8; i++) await frame();
      await call("prev");
    });
  }
  // by hand, forward
  for (let guard = 0; guard < 12; guard++) {
    const m = (await state()).page;
    if (m % 2 === 0) {
      if (m + 1 >= pages) break;
      await motion(`reverse @${m}`, () => drag(0.8, 0.45, 22, [0.86, 18]));
      await motion(`turn drag ${m}→${m + 1}`, () => drag(0.82, 0.12, 50));
      await motion(`drag back ${m + 1}→${m}`, () => drag(0.18, 0.9, 40));
      await motion(`fling ${m}→${m + 1}`, () => drag(0.8, 0.55, 4));
    } else {
      if (m + 1 >= pages) break;
      await motion(`pan ${m}→${m + 1}`, () => drag(0.62, 0.12, 32));
    }
  }
  // at the last page: a drag with nowhere to go (on a right page to the left; on a left page to the left, too)
  await motion(`end drag @${(await state()).page}`, () => drag(0.75, 0.2, 30));
  // by hand, back
  for (let guard = 0; guard < 12; guard++) {
    const m = (await state()).page;
    if (m === 0) break;
    if (m % 2 === 0) await motion(`pan back ${m}→${m - 1}`, () => drag(0.3, 0.85, 30));
    else await motion(`fling back ${m}→${m - 1}`, () => drag(0.2, 0.5, 4));
  }
  // at the first page: a cover drag let go early (it falls back open), then one that closes it, and the cover opened again
  await motion("cover peek @0", () => drag(0.3, 0.37, 24));
  await motion("cover close drag @0", () => drag(0.3, 0.75, 14));
  await motion("open", async () => {
    await page.evaluate(() => (window as unknown as { __book: any }).__book.toggleCover());
  });
  return { frames, motions };
}

function report(name: string, frames: F[], motions: { ph: string; frames: number }[], W: number, H: number) {
  const vis = (r: R) => Math.max(0, Math.min(W, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(H, r.bottom) - Math.max(0, r.top));
  // at rest: the cover open, the pages still, the camera as the frame before (on either page)
  const rests = frames.filter((x, i) => i > 0 && x.cover === 1 && !x.finger && x.awake === 0 && Math.abs(frames[i - 1]!.x - x.x) < 1e-7 && Math.abs(frames[i - 1]!.d - x.d) < 1e-7);
  const restVis = Math.min(...rests.map((x) => vis(x.front) + vis(x.back)));
  const restH = Math.max(...rests.map((x) => x.back.bottom - x.back.top));
  // the board under the page the camera frames (its target right of the spine: the back board, else the front board), against that
  // board at rest on its page. Information only: with the camera half way between the pages (over the spine) each page is about half
  // in view, whatever the camera does (a pull-back makes both smaller) — the check is on the open book, front + back (minVisible)
  const restBack = Math.min(...rests.filter((x) => x.x >= 0).map((x) => vis(x.back)));
  const restFront = Math.min(...rests.filter((x) => x.x < 0).map((x) => vis(x.front)));
  let worstVis = Infinity;
  let worstH = Infinity;
  let worstBoard = Infinity;
  let worstCam = 0;
  let worstCamFinger = 0;
  let over = 0;
  let worstAt = "";
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const x = frames[i]!;
    if (x.cover < 1) continue;
    worstVis = Math.min(worstVis, (vis(x.front) + vis(x.back)) / restVis);
    worstH = Math.min(worstH, (x.back.bottom - x.back.top) / restH);
    worstBoard = Math.min(worstBoard, x.x >= 0 ? vis(x.back) / restBack : vis(x.front) / restFront);
    if (a.cover < 1) continue;
    const c = Math.max(Math.abs(x.x - a.x) / (2 * x.d * TAN * (W / H)), Math.abs(x.d - a.d) / a.d);
    if (x.finger || a.finger) worstCamFinger = Math.max(worstCamFinger, c);
    else {
      if (c > worstCam) worstAt = `${x.ph} #${i}`;
      worstCam = Math.max(worstCam, c);
      if (c > 0.02) over++;
    }
  }
  const swing = frames.filter((x) => x.cover < 1);
  const out = {
    name,
    frames: frames.length,
    restH: +restH.toFixed(1),
    minVisible: +worstVis.toFixed(3),
    minHeight: +worstH.toFixed(3),
    minFramedBoard: +worstBoard.toFixed(3),
    maxCamStep: +(100 * worstCam).toFixed(2),
    maxCamStepAt: worstAt,
    camStepsOver2: over,
    maxCamStepFinger: +(100 * worstCamFinger).toFixed(2),
    swingFrames: swing.length,
    swingMinHeight: swing.length ? +Math.min(...swing.map((x) => (x.back.bottom - x.back.top) / restH)).toFixed(3) : null,
    motions: Object.fromEntries(motions.map((m) => [m.ph, m.frames])),
  };
  const ok = worstVis >= 0.6 && worstH >= 0.85 && worstCam <= 0.02;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out));
  return out;
}
