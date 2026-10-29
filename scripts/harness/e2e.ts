/*
 * End-to-end check of the real page (index.html → src/app) with the 3D stages wired in: screenshots + assertions.
 *   bun scripts/harness/e2e.ts http://127.0.0.1:5191 [outDir] [--only=layout,large,calm,sizes,chrome,folio,dialogs,paper,albums,swipe,caption,case,keys,i18n,lang,sound,loading,views,nogl]
 * Works against `vite` (dev) and `vite preview` (a production build). Serves nothing itself. Headless Chrome only (channel
 * "chrome", Metal ANGLE), never a visible window. Screenshots go to outDir (default: the OS temp dir), never the repo.
 * Internals (the live pouch, screen points of its objects) come from the résumé stage's ?debug handle.
 *
 * The page it checks (spec §1, direction C 朝の光): a full-bleed transparent canvas over the desk, the words column (.words:
 * identity, bio, the booklet list .toc, handling, the colophon .oku and prefs), the hashira (.hashira), the hands row (.hands: the
 * case switch .case, the printed-word controls .ctl), the phone's bottom row and Profile sheet (dialog.sheet), and the detail view
 * (dialog.lb: the caption .lb-cap, the held object .lb-obj, its controls .lb-hands) for pouch objects, album cards and postcards.
 * No dark mode and no ⌘K palette by design: their checks became the language (i18n, ?sample=zh) and keyboard (keys) sections.
 * Round 4: the language switch English · 中文 (lang: in place, no reload, ?lang=, the default from the stored choice, else English,
 * ten toggles without a leak), the large desk scaled as one (large: 1920 … 3440 wide) and the opened résumé's size (paper).
 * Every context runs with an English browser (locale en-US) unless a check asks for another (the page never picks its language from it).
 * The room (brief r3 D2, D4) is one static layer under the canvas: nothing over the canvas blends or animates, no animation runs
 * for ever, the detail veil is plain colour and the page behind it stands still (calm); the albums are large enough (sizes).
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:5191").replace(/\/$/, "");
const out = args.find((a) => a.startsWith("/")) ?? join(tmpdir(), "sasshi-e2e");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (s: string) => !only || only.includes(s);
mkdirSync(out, { recursive: true });

const results: { name: string; ok: boolean; note?: string }[] = [];
function check(name: string, ok: boolean, note?: string) {
  results.push({ name, ok, ...(note ? { note } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
}
/**
 * A check that waits on another area's part (named in `on`): printed, listed at the end, not counted as a failure while it fails —
 * it turns into a plain PASS as soon as that part lands.
 */
const pendings: string[] = [];
function pending(name: string, ok: boolean, on: string, note?: string) {
  if (ok) return check(name, ok, note);
  pendings.push(`${name} — waits on ${on}`);
  console.log(`PEND  ${name}  (waits on ${on}${note ? `; ${note}` : ""})`);
}
const errors: string[] = [];
const shots: string[] = [];

/** How many things the demo profile's pouch holds (business card, résumé, ticket, polaroid, note). */
const OBJECTS = 5;

type Vp = "desktop" | "laptop" | "tablet" | "tabletLand" | "phone" | "phone360" | "landscape";
const VIEWPORTS: Record<Vp, Parameters<Browser["newContext"]>[0]> = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  tablet: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  // a tablet-sized window held landscape: the tablet's structure, the open spread
  tabletLand: { viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone360: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
type Tab = "resume" | "cards" | "postcards";
const TABS: Tab[] = ["resume", "cards", "postcards"];
const DESK = [0xe3, 0xe8, 0xeb];

async function newCtx(browser: Browser, vp: Vp | { width: number; height: number }, o: { noGl?: boolean; reducedMotion?: boolean; audioSpy?: boolean; clipboard?: boolean; dark?: boolean; glSpy?: boolean; locale?: string } = {}): Promise<BrowserContext> {
  const size = typeof vp === "string" ? VIEWPORTS[vp] : { viewport: vp, deviceScaleFactor: 1 };
  const c = await browser.newContext({ ...size, locale: o.locale ?? "en-US", colorScheme: o.dark ? "dark" : "light", reducedMotion: o.reducedMotion ? "reduce" : "no-preference" });
  if (o.clipboard) await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  if (o.audioSpy)
    await c.addInitScript(() => {
      // count the voices the sound kit starts (every sample plays through a buffer source)
      const w = window as unknown as { __voices: number };
      w.__voices = 0;
      for (const name of ["createBufferSource", "createOscillator"] as const) {
        const orig = BaseAudioContext.prototype[name] as (this: BaseAudioContext) => AudioNode;
        (BaseAudioContext.prototype as unknown as Record<string, unknown>)[name] = function (this: BaseAudioContext) {
          w.__voices++;
          return orig.call(this);
        };
      }
    });
  if (o.glSpy)
    await c.addInitScript(() => {
      // count WebGL draw calls (every context: the stage, a paper viewer)
      const w = window as unknown as { __draws: number };
      w.__draws = 0;
      for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype] as unknown as Record<string, (...a: unknown[]) => unknown>[])
        for (const k of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
          const f = P[k];
          if (!f) continue;
          P[k] = function (this: unknown, ...a: unknown[]) {
            w.__draws++;
            return f.apply(this, a);
          };
        }
    });
  if (o.noGl)
    await c.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      // WebGL off: every 3D context request fails, 2D still works
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
        if (/webgl/i.test(id)) return null;
        return (orig as (this: HTMLCanvasElement, id: string, ...r: unknown[]) => RenderingContext | null).call(this, id, ...rest);
      } as typeof orig;
    });
  const tag = typeof vp === "string" ? vp : `${vp.width}x${vp.height}`;
  c.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(`[${tag}] pageerror ${e.message.slice(0, 200)}`));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${tag}] console ${m.text().slice(0, 200)}`);
    });
    p.on("response", (r) => {
      if (r.status() >= 400) errors.push(`[${tag}] ${r.status()} ${r.url()}`);
    });
  });
  return c;
}

async function shot(page: Page, name: string) {
  // JPEG: a full run takes ~80 shots
  const path = join(out, `${name}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 80 });
  shots.push(path);
}

async function ready(page: Page, timeout = 25000) {
  await page.waitForSelector(".stage-host[data-ready]", { timeout });
}

/**
 * The colour of one CSS pixel on screen, read from a whole-viewport screenshot at CSS scale. (A clipped screenshot under mobile
 * emulation leaves the visual viewport resized, which pushes bottom-fixed elements out of every later screenshot.)
 */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const buf = await page.screenshot({ scale: "css" });
  return page.evaluate(
    async ([b64, px, py]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d")!;
      g.drawImage(img, -Math.round(px), -Math.round(py));
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    [buf.toString("base64"), x, y] as const,
  );
}
/** The mean luminance of a 5 × 5 patch at each point, from one screenshot. */
async function luma(page: Page, pts: [number, number][]): Promise<number[]> {
  const buf = await page.screenshot({ scale: "css" });
  return page.evaluate(
    async ([b64, pts]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return pts.map(([x, y]) => {
        const d = g.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
        return s / (d.length / 4);
      });
    },
    [buf.toString("base64"), pts] as const,
  );
}
const near = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

/**
 * The room and what moves (brief r3 D2, D4): the room's layers (each must lie under the stage's canvas), any element outside the
 * desk that blends or filters its backdrop, a leaf layer anywhere (the old .sun / .lift / .cast / .over / .sway), and every
 * animation that never ends.
 */
function calm(page: Page) {
  return page.evaluate(() => {
    const z = (el: Element | null) => (el ? Number(getComputedStyle(el).zIndex) || 0 : 0);
    const stageZ = z(document.querySelector(".stage"));
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
    const room = [...document.querySelectorAll(".room > *")].map((el) => ({ el: name(el), z: z(el), under: z(el) < stageZ }));
    const blend: string[] = [];
    const backdrop: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".desk")) continue;
      const s = getComputedStyle(el);
      // the postmark is struck in ink on the DOM postcard (a small still element on its own paper, not over the canvas)
      if (s.mixBlendMode !== "normal" && !el.matches(".hagaki .pm")) blend.push(name(el));
      const r = el.getBoundingClientRect();
      if (s.backdropFilter !== "none" && s.display !== "none" && r.width * r.height > 0.25 * innerWidth * innerHeight) backdrop.push(name(el));
    }
    for (const d of document.querySelectorAll("dialog[open]")) if (getComputedStyle(d, "::backdrop").backdropFilter !== "none") backdrop.push(`${name(d)}::backdrop`);
    const leaves = [...document.querySelectorAll(".sun, .lift, .cast, .over, .sway")].filter((el) => !el.closest(".desk") || el.matches(".sway, .over")).map(name);
    const forever = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
      .map((a) => `${(a.effect as KeyframeEffect | null)?.target?.getAttribute("class") ?? "?"} ${(a as CSSAnimation).animationName ?? ""}`);
    return { stageZ, room, blend, backdrop, leaves, forever };
  });
}
/** Compositor frames over `ms` (a screencast frame comes only when the page's pixels change) and WebGL draws per second (glSpy). */
async function stillness(page: Page, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", (f: { sessionId: number }) => {
    n++;
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 10, maxWidth: 320, everyNthFrame: 1 });
  await page.waitForTimeout(400);
  n = 0;
  const d0 = await page.evaluate(() => (window as unknown as { __draws?: number }).__draws ?? 0);
  await page.waitForTimeout(ms);
  const d1 = await page.evaluate(() => (window as unknown as { __draws?: number }).__draws ?? 0);
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
  return { fps: n / (ms / 1000), draws: (d1 - d0) / (ms / 1000) };
}

/**
 * The faces that actually set the text of each element matching `sel` (DevTools' "Rendered fonts"), once the fonts have settled:
 * "Family[PostScriptName]:glyphs", system faces marked. A string nobody registered falls to a system face; this catches it.
 */
async function renderedFonts(page: Page, sel: string): Promise<{ text: string; fonts: string[]; system: boolean }[]> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: sel });
    const out: { text: string; fonts: string[]; system: boolean }[] = [];
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId });
      const used = fonts.filter((f) => f.glyphCount > 0);
      out.push({ text: outerHTML.replace(/<[^>]+>/g, "").trim().slice(0, 24), fonts: used.map((f) => `${f.familyName}[${f.postScriptName}]${f.isCustomFont ? "" : "(system)"}:${f.glyphCount}`), system: used.some((f) => !f.isCustomFont) });
    }
    return out;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Layout facts: the canvas, the book box, the frame's printed words and whether any of them overlap or leave the screen. */
function layout(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0;
    };
    const root = getComputedStyle(document.documentElement);
    const px = (k: string) => parseFloat(root.getPropertyValue(k));
    const box = { left: px("--box-l"), top: px("--box-t"), right: px("--box-r"), bottom: px("--box-b") };
    const canvas = document.querySelector<HTMLCanvasElement>(".stage .folio-stage > canvas")?.getBoundingClientRect() ?? null;
    // every leaf of printed chrome: the text boxes that must neither overlap one another nor leave the screen
    const leaves = [...document.querySelectorAll(".words .id-name, .words .id-role, .words .id-where, .words .jo, .toc a, .handling p, .oku .row, .prefs .pw, .words .lang a, .hashira .hs, .hands .cs, .hands .case-l, .hands .w, .hands .ct, .hands .pf, .hint")]
      .filter((el) => visible(el) && !el.closest(".xf-i[data-out]"))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { s: `${el.className || el.tagName}`.slice(0, 24), l: r.left, t: r.top, r: r.right, b: r.bottom };
      });
    const overlaps: string[] = [];
    for (let i = 0; i < leaves.length; i++)
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i]!;
        const b = leaves[j]!;
        const ix = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const iy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ix > 1 && iy > 1) overlaps.push(`${a.s} × ${b.s}`);
      }
    const offscreen = leaves.filter((r) => r.l < -1 || r.t < -1 || r.r > innerWidth + 1 || r.b > innerHeight + 1).map((r) => r.s);
    // F1: nothing at the page foot has a container (background, border, radius or shadow)
    const containers = [...document.querySelectorAll(".hands, .hands *, .prefs, .prefs *")]
      .filter((el) => {
        if (el.matches(".sw, .sw *, .av, .led, .sep, .toc-disc")) return false;
        const s = getComputedStyle(el);
        const bg = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
        return bg || s.boxShadow !== "none" || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderTopLeftRadius) > 0 || s.backdropFilter !== "none";
      })
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
    const cls = (performance.getEntriesByType("layout-shift") as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]).filter((e) => !e.hadRecentInput).reduce((a, e) => a + e.value, 0);
    const words = document.querySelector(".words")?.getBoundingClientRect() ?? null;
    const hashira = document.querySelector(".page > .hashira");
    const hands = document.querySelector(".hands")?.getBoundingClientRect() ?? null;
    return {
      layout: document.documentElement.dataset.layout ?? "",
      m: px("--m"),
      box,
      canvas: canvas ? { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom } : null,
      canvases: document.querySelectorAll(".stage canvas").length,
      mode: document.querySelector(".folio-book")?.getAttribute("data-mode") ?? null,
      words: words ? { right: words.right, bottom: words.bottom } : null,
      hashira: hashira && visible(hashira) ? hashira.getBoundingClientRect().left : null,
      hands: hands ? { left: hands.left, right: hands.right, bottom: hands.bottom } : null,
      overlaps,
      offscreen,
      containers,
      overflow: document.documentElement.scrollWidth - innerWidth,
      cls,
      W: innerWidth,
      H: innerHeight,
    };
  });
}

/**
 * F2 / §1.6.5: every colophon, spec and action row keeps its descenders: each value's glyph box (its text range) sits inside its
 * row and inside every clipping ancestor, with no ellipsis anywhere. Returns the rows that fail.
 */
function descenders(page: Page, scope: string) {
  return page.evaluate((scope) => {
    const bad: string[] = [];
    const rows = [...document.querySelectorAll(`${scope} .oku .row, ${scope} .lb-specs .sr, ${scope} .lb-act-rows .sr, ${scope} .lt-specs .sr`)];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(row).visibility === "hidden") continue;
      for (const el of row.querySelectorAll("dt, dd")) {
        const s = getComputedStyle(el);
        if (s.textOverflow === "ellipsis") bad.push(`${el.textContent} ellipsis`);
        const range = document.createRange();
        range.selectNodeContents(el);
        const g = range.getBoundingClientRect();
        if (!g.height || !el.textContent?.trim()) continue;
        if (g.bottom > r.bottom + 0.5 || g.top < r.top - 0.5) bad.push(`"${el.textContent?.trim()}" glyphs ${g.top.toFixed(1)}–${g.bottom.toFixed(1)} outside row ${r.top.toFixed(1)}–${r.bottom.toFixed(1)}`);
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (ps.overflow === "visible" && ps.overflowY === "visible") continue;
          const pr = p.getBoundingClientRect();
          // a scrolling caption may scroll a row away; only a row that is shown cut is a defect
          const shown = g.top < pr.bottom && g.bottom > pr.top;
          if (shown && !p.matches(".lb-cap, .panel, .sheet") && (g.bottom > pr.bottom + 0.5 || g.top < pr.top - 0.5)) bad.push(`"${el.textContent?.trim()}" clipped by ${p.className}`);
          // a scroller (the caption, the printed version, the sheet) may scroll a row away or cut it at its edge: that is scrolling
          if (p.matches(".lb-cap, .panel, .sheet")) break;
        }
      }
    }
    return { rows: rows.length, bad };
  }, scope);
}

/**
 * Where the held object itself lies, from the pixels: the veil turned magenta, the stage and the leaves hidden, so paper (light,
 * R and G > 110) stands apart from the veil, from every shadow (dark magenta) and from ink. Searched round the held rect, clear of
 * the caption column and the hashira on a desk and of the identity and the caption on a phone. Also the caption's top.
 */
async function heldBox(page: Page) {
  const at = await page.evaluate(() => {
    const d = document.querySelector("dialog.lb[open]");
    const r = (s: string) => {
      const b = d?.querySelector(s)?.getBoundingClientRect();
      return b ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null;
    };
    const s = getComputedStyle(document.documentElement);
    return { obj: r(".lb-obj"), col: r(".lb-col"), id: r(".lb-col > .id"), cap: r(".lb-cap"), hashira: r(".lb-frame > .hashira"), desk: ["d", "s"].includes(document.documentElement.dataset.layout ?? ""), boxT: parseFloat(s.getPropertyValue("--box-t")), W: innerWidth, H: innerHeight };
  });
  if (!at.obj || !at.cap) return null;
  const L = at.obj;
  const region = at.desk
    ? { l: Math.max(L.l - 80, (at.col?.r ?? 0) + 1), t: L.t - 60, r: Math.min(L.r + 80, at.hashira ? at.hashira.l - 1 : at.W), b: Math.min(L.b + 60, at.H - 100) }
    : { l: 0, t: Math.max(L.t - 60, (at.id?.b ?? 0) + 4), r: at.W, b: Math.min(L.b + 60, at.cap.t - 1) };
  await page.addStyleTag({ content: "dialog.lb::backdrop{background:#ff00ff !important;-webkit-backdrop-filter:none !important;backdrop-filter:none !important;animation:none !important} .stage{visibility:hidden !important} .room{display:none !important} html,body{background:#ff00ff !important}" });
  await page.waitForTimeout(250);
  const buf = await page.screenshot({ scale: "css" });
  const box = await page.evaluate(
    async ([b64, R]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const l = Math.max(0, Math.floor(R.l)), t = Math.max(0, Math.floor(R.t)), w = Math.min(img.width, Math.ceil(R.r)) - l, h = Math.min(img.height, Math.ceil(R.b)) - t;
      const d = g.getImageData(l, t, w, h).data;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i]! > 110 && d[i + 1]! > 110) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      return x0 === Infinity ? null : { l: l + x0, t: t + y0, r: l + x1 + 1, b: t + y1 + 1 };
    },
    [buf.toString("base64"), region] as const,
  );
  await page.evaluate(() => document.querySelectorAll("style").forEach((s) => s.textContent?.includes("#ff00ff") && s.remove()));
  return box ? { ...box, top: box.t - at.boxT, gap: at.cap.t - box.b } : null;
}

type Debug = { targets(): Promise<Record<string, [number, number] | null>> };
const targets = (page: Page) => page.evaluate(() => (window as unknown as { __folio: Debug }).__folio.targets());
const simState = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __folio: { pouch(): { debug: { sim: { state(): readonly { id: string; x: number; y: number }[] } } } | null } }).__folio.pouch();
    return p ? p.debug.sim.state().map((s) => ({ id: s.id, x: s.x, y: s.y })) : [];
  });
/** What the open detail view shows. */
const detail = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector("dialog.lb[open]");
    return d
      ? {
          kind: d.getAttribute("data-kind"),
          title: d.querySelector(".cap-title")?.textContent ?? "",
          count: d.querySelector(".cap-count span[aria-hidden]")?.textContent?.replace(/\s/g, "") ?? "",
          local: d.querySelector(".cap-local")?.textContent ?? "",
          hashira: d.querySelector(".hashira .xf-i:not([data-out]) .jp")?.textContent ?? "",
          words: [...d.querySelectorAll(".lb-hands .w")].map((w) => w.textContent?.trim() ?? ""),
          pager: d.querySelector(".lb-hands .ct span[aria-hidden]")?.textContent ?? "",
          rows: [...d.querySelectorAll(".lb-specs dt")].map((x) => x.textContent ?? ""),
          paper: !!d.querySelector(".paper-host[data-ready]"),
          flat: !!d.querySelector(".paper-flat"),
          snap: !!d.querySelector(".still[data-snap] img.still-img"),
          turned: !!d.querySelector(".flip[data-turned]"),
          focusOnDialog: document.activeElement === d,
          ringShown: !!d.querySelector(":focus-visible") && document.activeElement !== d,
          canvases: document.querySelectorAll("canvas").length,
          obj: (() => {
            const r = d.querySelector(".lb-obj")?.getBoundingClientRect();
            return r ? { w: r.width, h: r.height, l: r.left, t: r.top } : null;
          })(),
        }
      : null;
  });
/**
 * r3 (the owner: "flickers, shifts"): what the detail view shows on every frame from now until `frames` is read — the held still,
 * a DOM stand-in for it (front / back), the held object's opacity, whether the flip is turned, the veil, and the room behind it (the
 * stage's blur, the words' opacity).
 */
type FrameSample = { t: number; open: boolean; closing: boolean; still: boolean; dom: boolean; domBack: boolean; turned: boolean; op: number; veil: number; blur: number; words: number };
const sampleFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __fs?: { on: boolean; t0: number; s: unknown[] } };
    if (w.__fs) w.__fs.on = false;
    const fs = (w.__fs = { on: true, t0: performance.now(), s: [] as unknown[] });
    const tick = () => {
      if (!fs.on) return;
      const d = document.querySelector<HTMLDialogElement>("dialog.lb");
      const o = d?.querySelector(".lb-obj");
      const st = document.querySelector(".stage .folio-stage");
      const words = document.querySelector(".page .words");
      fs.s.push({
        t: Math.round(performance.now() - fs.t0),
        open: !!d?.open,
        closing: !!d?.hasAttribute("data-closing"),
        still: !!o?.querySelector(".flip-face.front img.still-img, .still > .still-tilt > img.still-img"),
        dom: !!o?.querySelector(".tk:not(.tk-back), .pol:not(.pol-back), .note"),
        domBack: !!o?.querySelector(".tk-back, .pol-back"),
        turned: !!o?.querySelector(".flip[data-turned]"),
        op: o ? Number(getComputedStyle(o).opacity) : 0,
        veil: d?.open ? Number(getComputedStyle(d, "::backdrop").opacity) : 0,
        blur: st ? Number(/blur\(([\d.]+)px\)/.exec(getComputedStyle(st).filter)?.[1] ?? 0) : 0,
        words: words ? Number(getComputedStyle(words).opacity) : 0,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const frames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __fs?: { on: boolean; s: unknown[] } };
    if (w.__fs) w.__fs.on = false;
    return (w.__fs?.s ?? []) as FrameSample[];
  });
async function closeDetail(page: Page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("dialog.lb[open]"), null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(350);
}
const tap = (page: Page, touch: boolean, p: [number, number]) => (touch ? page.touchscreen.tap(p[0], p[1]) : page.mouse.click(p[0], p[1]));
/** A printed control word in the hands row (or the detail view's) by its text or aria-label. */
const word = (page: Page, name: RegExp, scope = ".hands .ctl") => page.locator(`${scope} button.w`).filter({ hasText: name }).or(page.locator(`${scope} button.w`).and(page.getByRole("button", { name })));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  /* ── every booklet at every size: one full-bleed canvas, the frame's words never overlap, no container at the foot, the desk shows through ── */
  if (want("layout")) {
    for (const vp of ["desktop", "laptop", "tablet", "tabletLand", "phone", "phone360", "landscape"] as Vp[]) {
      const c = await newCtx(browser, vp);
      const page = await c.newPage();
      for (const tab of TABS) {
        await page.goto(`${base}/${vp === "tabletLand" ? "?debug" : ""}#${tab}`);
        await ready(page);
        await page.waitForTimeout(2600);
        const L = await layout(page);
        const tag = `${tab}-${vp}`;
        const full = !!L.canvas && Math.abs(L.canvas.left) <= 1 && Math.abs(L.canvas.top) <= 1 && Math.abs(L.canvas.right - L.W) <= 1 && Math.abs(L.canvas.bottom - L.H) <= 1;
        check(`${tag}: one full-bleed 3D canvas`, L.canvases === 1 && L.mode === "3d" && full, `${L.canvases} canvas, ${L.mode}, ${JSON.stringify(L.canvas)}`);
        check(`${tag}: no printed words overlap or leave the screen`, L.overlaps.length === 0 && L.offscreen.length === 0, [...L.overlaps, ...L.offscreen.map((s) => `${s} off screen`)].slice(0, 4).join(" | "));
        check(`${tag}: no container at the page foot (F1)`, L.containers.length === 0, L.containers.slice(0, 4).join(" | "));
        check(`${tag}: no horizontal overflow, no layout shift`, L.overflow <= 0 && L.cls < 0.01, `overflow ${L.overflow}, CLS ${L.cls.toFixed(4)}`);
        if (vp === "desktop" || vp === "laptop") {
          // the grid (§1.5): words column | 間 | book box; the hashira in the outer margin; the hands row on the bottom line
          const m = vp === "desktop" ? 48 : 40;
          const boxL = vp === "desktop" ? 390 : 370;
          const grid = L.layout === (vp === "desktop" ? "d" : "s") && Math.abs(L.box.left - boxL) <= 1 && L.box.top === m && Math.abs(L.box.right - (L.W - m)) <= 1 && !!L.words && L.words.right <= L.box.left - 100 && !!L.hands && Math.abs(L.hands.bottom - (L.H - m)) <= 1 && L.hashira !== null && L.hashira > L.box.right;
          check(`${tag}: the grid (words, 間, book box ${boxL}–${L.W - m}, hashira, one bottom line)`, grid, JSON.stringify({ layout: L.layout, box: L.box, words: L.words, hands: L.hands, hashira: L.hashira }));
        }
        if (vp === "tablet" || vp === "tabletLand") {
          // task 4: one page at a time only in portrait; a tablet-sized window held landscape shows the open spread
          const narrow = await page.evaluate(() => document.querySelector(".folio-book")?.hasAttribute("data-narrow") ?? null);
          check(`${tag}: ${vp === "tablet" ? "one page at a time (portrait)" : "the open spread (landscape)"}`, narrow === (vp === "tablet"), `data-narrow ${narrow}`);
          if (vp === "tabletLand" && tab === "resume") {
            // both boards of the open folio side by side on screen: the front board at the left, the pouch board at the right
            const sb = await page.evaluate(() => (window as unknown as { __folio: { book(): { debug: { screenBox(): Record<"all" | "front" | "back", { left: number; right: number; top: number; bottom: number }> } } | null } }).__folio.book()?.debug.screenBox() ?? null);
            const two = !!sb && sb.front.left >= -1 && sb.back.right <= L.W + 1 && sb.front.right <= sb.back.left + 40 && sb.front.right - sb.front.left > 0.3 * (sb.all.right - sb.all.left);
            check(`${tag}: two boards on screen`, two, JSON.stringify(sb && { front: [sb.front.left, sb.front.right].map(Math.round), back: [sb.back.left, sb.back.right].map(Math.round) }));
          }
        }
        const d = await descenders(page, ".page");
        check(`${tag}: colophon rows keep their descenders (F2)`, d.bad.length === 0, d.bad.slice(0, 3).join(" | ") || `${d.rows} rows`);
        // r3 D2 / D4: the room is one layer under the canvas; nothing above it blends, filters its backdrop or animates for ever
        const q = await calm(page);
        check(`${tag}: the room lies under the canvas, nothing over it blends, no animation for ever`, q.room.length === 1 && q.room.every((r) => r.under) && q.blend.length === 0 && q.backdrop.length === 0 && q.leaves.length === 0 && q.forever.length === 0, JSON.stringify(q));
        if (tab === "resume" || vp === "desktop" || vp === "tabletLand") await shot(page, `layout-${tag}`);
      }
      await c.close();
    }
    // the desk is the canvas's background: with the room's light and fibres off, a bare desk pixel at the hands row is 朝霧 #e3e8eb
    // (the clear is transparent, and the engine's window light keeps off the hands row: layout.ts lightFade)
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    await page.goto(`${base}/#cards`);
    await ready(page);
    await page.waitForTimeout(2200);
    await page.addStyleTag({ content: ".desk > * { display: none !important; }" });
    await page.waitForTimeout(200);
    const at = await pixel(page, 700, 860);
    check("layout: the bare desk shows through the transparent canvas (#e3e8eb)", near(at, DESK, 2), at.join(","));
    await c.close();
  }

  /* ── r3 D2 / D4: the page at rest is still (the twig may sway at ≤ 8 renders a second); behind a detail view nothing moves ── */
  if (want("calm")) {
    type Frames = { book(): { debug: { tilt(): { frames: number } } } | null };
    const renders = (page: Page, handle: "__folio" | "__album") => page.evaluate((h) => (window as unknown as Record<string, Frames | undefined>)[h]?.book()?.debug.tilt().frames ?? 0, handle);
    const c = await newCtx(browser, "desktop", { glSpy: true });
    const page = await c.newPage();
    for (const [tab, handle] of [["resume", "__folio"], ["cards", "__album"]] as const) {
      await page.goto(`${base}/?debug#${tab}`);
      await ready(page);
      await page.waitForTimeout(4500);
      const r0 = await renders(page, handle);
      const desk = await stillness(page, 3000);
      const rps = ((await renders(page, handle)) - r0) / 3.4;
      check(`calm-${tab}: at rest ≤ 8 compositor frames and ≤ 8 renders a second`, desk.fps <= 8.5 && rps <= 8.5, `${desk.fps.toFixed(1)} frames/s, ${rps.toFixed(1)} renders/s, ${desk.draws.toFixed(0)} draws/s`);
      // a detail view: the stage is paused under a plain veil, so after the lift nothing changes on screen and nothing renders
      if (tab === "resume") await page.locator(".pouch-index li:nth-child(3) button").evaluate((b) => (b as HTMLButtonElement).click());
      else await page.locator(".folio-links button").first().evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1800);
      const r1 = await renders(page, handle);
      const held = await stillness(page, 2500);
      const hr = (await renders(page, handle)) - r1;
      const q = await calm(page);
      check(`calm-${tab}: a detail view up — the veil painted once (≤ 2 frames in 2.5 s), the stage renders nothing`, held.fps * 2.5 <= 2 && hr === 0 && held.draws === 0 && q.backdrop.length === 0, `${(held.fps * 2.5).toFixed(0)} frames, ${hr} renders, ${held.draws.toFixed(0)} draws/s, backdrop ${q.backdrop.join(",") || "none"}`);
      await shot(page, `calm-${tab}-detail`);
      await closeDetail(page);
      await page.waitForTimeout(1200);
      const r2 = await renders(page, handle);
      const after = await stillness(page, 2000);
      const ar = ((await renders(page, handle)) - r2) / 2.4;
      check(`calm-${tab}: closed again, the page comes to rest (≤ 8 renders a second)`, ar <= 8.5 && after.fps <= 10, `${ar.toFixed(1)} renders/s, ${after.fps.toFixed(1)} frames/s`);
    }
    await c.close();
    // the Profile sheet is a dialog too: the twig stands still while it is up
    const cp = await newCtx(browser, "phone");
    const pp = await cp.newPage();
    await pp.goto(`${base}/?debug#resume`);
    await ready(pp);
    await pp.waitForTimeout(4000);
    await pp.locator(".hands .pf").click();
    await pp.waitForSelector("dialog.sheet[open]", { timeout: 4000 }).catch(() => {});
    await pp.waitForTimeout(1000);
    const s0 = await renders(pp, "__folio");
    await pp.waitForTimeout(2000);
    const up = (await renders(pp, "__folio")) - s0;
    check("calm-phone: the Profile sheet up — the stage renders nothing", up === 0, `${up} renders in 2 s`);
    await cp.close();
  }

  /* ── r3 D3: the albums are large enough (1440 × 900: open card album ≥ 555 px tall, postcard album ≥ 500), nothing clipped ── */
  if (want("sizes")) {
    // cards: 561 px in the frosted case, 558 in leather (its default since 2026-10-23; the same 1071 px wide)
    const TARGET: Record<"cards" | "postcards", number> = { cards: 555, postcards: 500 };
    const notes: string[] = [];
    for (const vp of ["desktop", "laptop", "phone"] as Vp[]) {
      const c = await newCtx(browser, vp);
      const page = await c.newPage();
      for (const tab of ["cards", "postcards"] as const) {
        await page.goto(`${base}/?debug#${tab}`);
        await ready(page);
        type Box = { left: number; top: number; right: number; bottom: number };
        type AlbumDebug = { __album?: { book(): { debug: { screenBox(): { all: Box }; state(): { cover: number } } } | null } };
        const read = () => page.evaluate(() => (window as unknown as AlbumDebug).__album?.book()?.debug.screenBox().all ?? null);
        // the cover at rest (fully open / shut) and the box unchanged for a moment: a loaded machine takes its time
        const settle = async (open: boolean) => {
          let last = "";
          for (let i = 0; i < 40; i++) {
            const now = await page.evaluate(() => {
              const b = (window as unknown as AlbumDebug).__album?.book();
              const r = b?.debug.screenBox().all;
              return JSON.stringify([b?.debug.state().cover ?? -1, ...(r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : [])]);
            });
            const cover = (JSON.parse(now) as number[])[0]!;
            if (now === last && (open ? cover > 0.999 : cover >= 0 && cover < 0.001)) return;
            last = now;
            await page.waitForTimeout(700);
          }
        };
        await settle(true);
        const open = await read();
        const L = await layout(page);
        await word(page, /^close$/i).click();
        await settle(false);
        const closed = await read();
        const h = (b: Box | null) => (b ? Math.round(b.bottom - b.top) : 0);
        notes.push(`${vp} ${tab} ${h(open)} open / ${h(closed)} closed`);
        if (vp === "phone") continue;
        // the open spread on screen, a margin (間) clear of the words column, clear of the hashira and the hands row; the closed album
        // the same board
        const clear = !!open && !!L.words && !!L.hands && open.left >= L.words.right + L.m && open.right <= L.W && open.top >= 0 && open.bottom <= L.hands.bottom - 40;
        check(`sizes-${tab}-${vp}: the open album on screen, a margin clear of the words, clear of the hands row`, clear, JSON.stringify({ open: open && [open.left, open.top, open.right, open.bottom].map(Math.round), words: L.words?.right, m: L.m, handsTop: L.hands && L.hands.bottom - 40 }));
        check(`sizes-${tab}-${vp}: the open album keeps off the hashira (≥ 16 px)`, !!open && L.hashira !== null && open.right <= L.hashira - 16, `album right ${open ? Math.round(open.right) : "?"}, hashira left ${L.hashira === null ? "?" : Math.round(L.hashira)}`);
        check(`sizes-${tab}-${vp}: the closed album is the same board (height within 15 % of the open spread)`, !!open && !!closed && Math.abs(h(closed) - h(open)) <= 0.15 * h(open), `${h(open)} open, ${h(closed)} closed`);
        if (vp === "desktop") {
          check(`sizes-${tab}-desktop: the open album ≥ ${TARGET[tab]} px tall at 1440 × 900`, h(open) >= TARGET[tab], `${h(open)} × ${open ? Math.round(open.right - open.left) : 0}`);
          await shot(page, `sizes-${tab}-closed`);
        }
      }
      await c.close();
    }
    console.log(`      album heights: ${notes.join(" · ")}`);
  }

  /* ── a large desk (r4 E3, the owner's 2026-10-20 note): the type, the rows and the controls keep their 1440 size, the book box
     reaches the right margin where the hashira stands (no empty band), the books fill it and lean to the middle of the screen;
     wider than 2.1 : 1 the composition stops at 2.1 H and stands centred ── */
  if (want("large")) {
    type Box = { left: number; top: number; right: number; bottom: number };
    type Dbg = Record<string, { book(): { debug: { screenBox(): Box & { all?: Box }; state(): { cover: number } } } | null } | undefined>;
    /** The open book's screen box, once its cover is fully open and the box has held still for a moment. */
    const openBox = async (page: Page, h: "__folio" | "__album") => {
      let last = "";
      for (let i = 0; i < 40; i++) {
        const now = await page.evaluate((h) => {
          const b = (window as unknown as Dbg)[h]?.book();
          const s = b?.debug.screenBox();
          const r = s?.all ?? s;
          return JSON.stringify([b?.debug.state().cover ?? -1, ...(r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : [])]);
        }, h);
        if (now === last && (JSON.parse(now) as number[])[0]! > 0.999) break;
        last = now;
        await page.waitForTimeout(600);
      }
      const [, left, top, right, bottom] = JSON.parse(last) as number[];
      return { left: left!, top: top!, right: right!, bottom: bottom! };
    };
    const notes: string[] = [];
    for (const [W, H] of [[1920, 1080], [1680, 1050], [2560, 1257], [2512, 1233], [2560, 1440], [3440, 1440]] as const) {
      const c = await newCtx(browser, { width: W, height: H });
      const page = await c.newPage();
      // the words and rows keep their 1440 size on every desk (layout.ts K_MAX = 1); only the book grows, leaning to the middle
      const k = 1;
      const x0 = Math.round((W - Math.min(W, Math.round(2.1 * H))) / 2);
      const tag = `large-${W}x${H}`;
      const h: Record<Tab, number> = { resume: 0, cards: 0, postcards: 0 };
      for (const tab of TABS) {
        await page.goto(`${base}/?debug#${tab}`);
        await ready(page);
        const open = await openBox(page, tab === "resume" ? "__folio" : "__album");
        h[tab] = Math.round(open.bottom - open.top);
        const L = await layout(page);
        if (tab === "resume") {
          const t = await page.evaluate(() => {
            const fs = (s: string) => {
              const el = document.querySelector(s);
              return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
            };
            const hs = document.querySelector(".page > .hashira .hs")?.getBoundingClientRect();
            return { k: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--k")), bio: fs(".words .jo"), toc: fs(".toc .nm"), w: fs(".hands .w"), hsRight: hs ? hs.right : 0 };
          });
          check(`${tag}: the words column keeps its 1440 type (bio 14, toc 20, hands 12.5 px; k = 1)`, Math.abs(t.k - k) < 0.001 && Math.abs(t.bio - 14 * k) < 0.1 && Math.abs(t.toc - 20 * k) < 0.1 && Math.abs(t.w - 12.5 * k) < 0.1, JSON.stringify(t));
          // the grid spans the composition: the box ends a margin short of its right edge, the hashira stands in that margin
          const right = W - x0;
          check(`${tag}: the box reaches the right margin, the hashira ≤ 1.5 m from the edge${x0 ? ` (21:9: centred, ${x0} px of desk each side)` : ""}`, Math.abs(L.box.right - (right - L.m)) <= 1 && L.hashira !== null && L.hashira > L.box.right && right - t.hsRight <= 1.5 * L.m && Math.abs((L.words ? L.words.right - 204 * k : 0) - (x0 + L.m)) <= 1.5, JSON.stringify({ box: L.box, m: L.m, hashira: [L.hashira, t.hsRight], words: L.words }));
          await shot(page, tag);
        }
        check(`${tag}-${tab}: no printed words overlap or leave the screen`, L.overlaps.length === 0 && L.offscreen.length === 0 && L.overflow <= 0, [...L.overlaps, ...L.offscreen].slice(0, 3).join(" | "));
        // the open book leans to the middle of the screen as far as the room beside the words lets it keep its size: in the middle,
        // or a margin clear of the words column
        {
          const mid = (open.left + open.right) / 2;
          const lean = !!L.words && open.left >= L.words.right + L.m - 1 && (Math.abs(mid - W / 2) <= 24 || open.left <= L.words.right + L.m + 40);
          check(`${tag}-${tab}: the open book in the middle of the screen, or as near as the words column allows`, lean, JSON.stringify({ left: open.left, right: open.right, mid: Math.round(mid), half: W / 2, words: L.words?.right }));
        }
        if (tab !== "resume") {
          const clear = !!L.words && !!L.hands && open.left >= L.words.right + L.m - 1 && L.hashira !== null && open.right <= L.hashira - 16 && open.top >= 0 && open.bottom <= L.hands.bottom - 40 * k;
          check(`${tag}-${tab}: the open album a margin clear of the words, the hashira and the hands row`, clear, JSON.stringify({ open, words: L.words?.right, hashira: L.hashira, hands: L.hands?.bottom }));
          if (W === 2560 && H === 1440) await shot(page, `${tag}-${tab}`);
        }
      }
      notes.push(`${W}×${H} k ${k.toFixed(3)}: résumé ${h.resume} · cards ${h.cards} · postcards ${h.postcards}`);
      if (W === 2560 && H === 1257) check("large-2560x1257 (the owner's screen): open résumé ≥ 850, card album ≥ 760, postcard album ≥ 680 px tall", h.resume >= 850 && h.cards >= 760 && h.postcards >= 680, JSON.stringify(h));
      await c.close();
    }
    console.log(`      open heights: ${notes.join(" · ")}`);
  }

  /* ── r4 E4: the opened résumé fills the stage — the spread ≥ 82 % of the space between the top margin and the foot row on every
     desk; on a phone one page across the screen less its margins ── */
  if (want("paper")) {
    for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1257 }, "phone"] as const) {
      const c = await newCtx(browser, size);
      const page = await c.newPage();
      const W = typeof size === "string" ? 390 : size.width;
      const H = typeof size === "string" ? 844 : size.height;
      await page.goto(`${base}/?debug#resume`);
      await ready(page);
      await page.waitForTimeout(2600);
      await page.locator(".pouch-index li:nth-child(2) button").evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector("dialog.lb[open] .paper-host[data-ready]", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2400);
      const m = await page.evaluate(() => ({ m: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m")), k: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--k")) }));
      const b = await heldBox(page);
      const tag = typeof size === "string" ? "paper-phone" : `paper-${W}x${H}`;
      if (typeof size === "string") {
        const w = b ? b.r - b.l : 0;
        check(`${tag}: one page across the screen less its margins (≥ 94 % of ${W - 2 * m.m})`, !!b && w >= 0.94 * (W - 2 * m.m), JSON.stringify(b && { w, t: b.t, b: b.b }));
      } else {
        const stage = H - 2 * m.m - 40 * m.k;
        const frac = b ? (b.b - b.t) / stage : 0;
        check(`${tag}: the open spread ≥ 82 % of the stage's height (${Math.round(0.82 * stage)} of ${Math.round(stage)} px)`, frac >= 0.82, JSON.stringify(b && { w: b.r - b.l, h: b.b - b.t, frac: Number(frac.toFixed(3)) }));
      }
      await shot(page, tag);
      await c.close();
    }
  }

  /* ── the words column: faces, the booklet list, the colophon (copy, links), no capitals / italics / ✦ / dark mode anywhere ── */
  if (want("chrome")) {
    const c = await newCtx(browser, "desktop", { clipboard: true });
    const page = await c.newPage();
    await page.goto(`${base}/#resume`);
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    const faces = await page.evaluate(() => {
      const loaded = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")));
      const fam = (s: string) => getComputedStyle(document.querySelector(s)!).fontFamily.split(",").map((x) => x.trim().replace(/["']/g, ""));
      return { loaded: [...loaded], name: fam(".id-name"), toc: fam(".toc .nm"), handling: fam(".handling p") };
    });
    check("chrome: Latin from the Japanese faces (Folio Serif / Sans Latin loaded and first in the stacks)", faces.loaded.includes("Folio Serif Latin") && faces.loaded.includes("Folio Sans Latin") && faces.name[0] === "Folio Serif Latin" && faces.toc[0] === "Folio Serif Latin" && faces.handling[0] === "Folio Sans Latin", JSON.stringify(faces));
    const banned = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        const s = getComputedStyle(el);
        if (s.textTransform !== "none") out.push(`${el.className} text-transform ${s.textTransform}`);
        if (s.fontStyle === "italic" && el.textContent?.trim()) out.push(`${el.className} italic`);
      }
      if (document.body.textContent?.includes("✦")) out.push("✦");
      return out.slice(0, 5);
    });
    check("chrome: no capitals, no italics, no ✦ in the DOM", banned.length === 0, banned.join(" | "));
    const fonts = await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => (l as HTMLLinkElement).href.split("/").pop()));
    check("chrome: exactly the two Latin files are preloaded", fonts.length === 2 && fonts.some((f) => /shippori-mincho-latin-500/.test(f ?? "")) && fonts.some((f) => /zen-kaku-gothic-new-latin-400/.test(f ?? "")), fonts.join(", "));
    // the booklet list: a click switches (hash, aria-current, the hashira); key 3 comes back
    await page.click(".toc a[href='#cards']");
    await page.waitForFunction(() => location.hash === "#cards", null, { timeout: 3000 }).catch(() => {});
    await ready(page);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ cur: document.querySelector(".toc a[aria-current='page']")?.getAttribute("href"), hashira: document.querySelector(".page > .hashira .xf-i:not([data-out]) .jp")?.textContent, stage: document.getElementById("stage")?.getAttribute("aria-label") }));
    check("chrome: the booklet list switches booklets (and the hashira)", after.cur === "#cards" && after.hashira === "カード帖" && after.stage === "Cards", JSON.stringify(after));
    await page.keyboard.press("3");
    await page.waitForFunction(() => location.hash === "#resume", null, { timeout: 3000 }).catch(() => {});
    await ready(page);
    check("chrome: key 3 switches to the résumé", (await page.evaluate(() => location.hash)) === "#resume");
    // the colophon: Email copies the address and says so (a 藍 disc, "Copied", announced)
    await page.click(".oku button.copy");
    await page.waitForTimeout(250);
    const copied = await page.evaluate(async () => ({ status: document.querySelector(".oku [data-testid='copy-status']")?.textContent ?? "", label: document.querySelector(".oku button.copy")?.textContent ?? "", disc: !!document.querySelector(".oku button.copy .cdot"), clip: await navigator.clipboard.readText().catch(() => "") }));
    check("chrome: Email copies the address (reads Copied with a disc, announced)", copied.status === "Email copied" && /Copied/.test(copied.label) && copied.disc && copied.clip.includes("@"), JSON.stringify(copied));
    await shot(page, "chrome-copied");
    const links = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>(".oku a")].map((a) => ({ text: a.textContent, rel: a.rel, target: a.target, label: a.getAttribute("aria-label") })));
    check("chrome: the colophon links open a new tab with rel=me noopener (Source included)", links.length >= 3 && links.every((l) => l.rel === "me noopener" && l.target === "_blank" && /opens a new tab/.test(l.label ?? "")) && links.some((l) => /^Source:/.test(l.label ?? "")), JSON.stringify(links));
    await c.close();
    // light only: a dark system preference changes nothing
    const cd = await newCtx(browser, "desktop", { dark: true });
    const pd = await cd.newPage();
    await pd.goto(`${base}/#cards`);
    await ready(pd);
    await pd.waitForTimeout(1500);
    const meta = await pd.evaluate(() => ({ theme: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")), bg: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme }));
    check("chrome: light only (dark preference ignored, one theme-color #e3e8eb)", meta.theme.length === 1 && meta.theme[0] === "#e3e8eb" && meta.bg === "rgb(227, 232, 235)" && meta.scheme === "light", JSON.stringify(meta));
    await cd.close();
  }

  /* ── the résumé folio: 5 objects, Shake moves them, a desk drag tilts, the phone's Tilt settles ── */
  if (want("folio") || want("dialogs")) {
    for (const vp of ["desktop", "phone"] as Vp[]) {
      const touch = vp === "phone";
      const c = await newCtx(browser, vp, { clipboard: true });
      const page = await c.newPage();
      await page.goto(`${base}/?debug#resume`);
      await ready(page);
      await page.waitForTimeout(2600);
      const t = await targets(page);
      const ids = Object.keys(t);
      check(`folio-${vp}: ${OBJECTS} objects in the pouch, each visible and clickable`, ids.length === OBJECTS && ids.every((id) => t[id]), JSON.stringify(Object.fromEntries(ids.map((id) => [id, t[id] ? "ok" : "covered"]))));
      const words = await page.locator(".hands .ctl .w").allTextContents();
      check(`folio-${vp}: the controls read ${touch ? "○ Tilt │ Shake │ Close" : "Shake │ Close folio"}`, touch ? words.join("|") === "Tilt|Shake|Close" : words.join("|") === "Shake|Close folio", words.join(" | "));

      if (want("folio")) {
        const before = await simState(page);
        await word(page, /^shake$/i).click();
        await page.waitForTimeout(260);
        await shot(page, `folio-${vp}-shake-mid`);
        await page.waitForTimeout(1900);
        const after = await simState(page);
        const moved = after.map((a) => {
          const b = before.find((x) => x.id === a.id)!;
          return { id: a.id, mm: Math.hypot(a.x - b.x, a.y - b.y) * 1000 };
        });
        const n = moved.filter((m) => m.mm > 5).length;
        check(`folio-${vp}: Shake moves the objects`, n >= 2, moved.map((m) => `${m.id} ${m.mm.toFixed(0)}mm`).join(", "));
        if (!touch) {
          // a drag on the desk (left of the book box, under the light) tilts the folio
          // (between the words column and the book: the open résumé reaches to a margin after the words)
          const sx = 276;
          const sy = 450;
          await page.mouse.move(sx, sy);
          await page.mouse.down();
          for (let i = 1; i <= 12; i++) await page.mouse.move(sx + i * 6, sy - i * 12, { steps: 2 });
          await page.waitForTimeout(120);
          const tilt = await page.evaluate(() => (window as unknown as { __folio: { book(): { debug: { tilt(): { x: number; y: number } } } | null } }).__folio.book()?.debug.tilt() ?? null);
          await page.mouse.up();
          check(`folio-${vp}: a desk drag tilts the folio`, !!tilt && Math.hypot(tilt.x, tilt.y) > 0.05, tilt ? `${tilt.x.toFixed(3)}, ${tilt.y.toFixed(3)}` : "no book");
          await page.waitForTimeout(1500);
        } else {
          // Tilt: headless Chrome has no sensor → it settles (on, or "Tilt off" then greyed), never hangs on asking
          const m = word(page, /tilt/i).first();
          await m.click();
          await page.waitForTimeout(1800);
          const st = await m.evaluate((el) => ({ text: el.textContent ?? "", pressed: el.getAttribute("aria-pressed"), disabled: el.getAttribute("aria-disabled") }));
          check(`folio-${vp}: the Tilt word handles a missing sensor`, /tilt/i.test(st.text), JSON.stringify(st));
        }
      }

      if (want("dialogs")) {
        const t2 = await targets(page);
        const items = await page.evaluate(() => (window as unknown as { __folio: { items: { id: string; kind: string; label: string }[] } }).__folio.items);
        const LOCAL: Record<string, string> = { card: "名刺", resume: "履歴書", ticket: "入場券", polaroid: "写真", note: "一筆箋" };
        // a click (a tap) on the object in the pouch lifts it out: the first one by pointer, the rest from the keyboard list
        // (a put-back object lands on top of the others, so points taken at rest go stale)
        for (const [i, { id, kind, label }] of items.entries()) {
          const p = i === 0 ? (await targets(page))[id] : null;
          if (i === 0 && !p) check(`detail-${vp}-${id}: clickable`, false, "covered");
          await sampleFrames(page);
          if (p) await tap(page, touch, p);
          else await page.locator(`.pouch-index li:nth-child(${i + 1}) button`).evaluate((b) => (b as HTMLButtonElement).click());
          await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(kind === "resume" || kind === "card" ? 1800 : 1200);
          const d = await detail(page);
          check(`detail-${vp}-${id}: the caption names it (count, title, local name, the hashira)`, !!d && d.kind === kind && d.title === label && d.count === `0${i + 1}/0${items.length}` && d.hashira === LOCAL[kind] && (d.local === LOCAL[kind] || d.local === ""), JSON.stringify(d && { kind: d.kind, title: d.title, count: d.count, local: d.local, hashira: d.hashira }));
          check(`detail-${vp}-${id}: focus on the dialog itself, no ring on open`, !!d && d.focusOnDialog && !d.ringShown);
          const hidden = await page.evaluate(() => [".page .words", ".page .hands"].every((s) => getComputedStyle(document.querySelector(s)!).visibility === "hidden"));
          check(`detail-${vp}-${id}: the page's own words step back behind the veil`, hidden);
          // r3 D2: the veil is plain colour and no leaf layer lies over the held thing; nothing animates for ever
          const q = await calm(page);
          check(`detail-${vp}-${id}: a plain veil, no leaves over the object, no animation for ever`, q.backdrop.length === 0 && q.leaves.length === 0 && q.blend.length === 0 && q.forever.length === 0, JSON.stringify({ backdrop: q.backdrop, leaves: q.leaves, blend: q.blend, forever: q.forever }));
          if (!touch && kind === "ticket") {
            // the veil hides the room: the book behind it goes soft and half transparent, so no dark spine or object reads through
            // (measured above the held ticket)
            const st = await page.evaluate(() => {
              const s = getComputedStyle(document.querySelector(".stage .folio-stage")!);
              return { filter: s.filter, opacity: s.opacity };
            });
            const row = await luma(page, Array.from({ length: 31 }, (_, i) => [600 + i * 20, 120] as [number, number]));
            const spread = Math.max(...row) - Math.min(...row);
            check(`detail-${vp}: nothing of the book reads through the veil (soft, half faded; residue ≤ 12 levels)`, /blur\(\d+px\)/.test(st.filter) && Number(st.opacity) <= 0.55 && spread <= 12, `${st.filter} ${st.opacity}, residue ${spread.toFixed(1)}`);
          }
          const secondary = kind === "card" ? "Open it" : kind === "ticket" || kind === "polaroid" ? "Turn over" : null;
          const want = [...(secondary ? [secondary] : []), touch ? "Put back" : "Put it back"];
          check(`detail-${vp}-${id}: the controls (‹ n › │ ${want.join(" │ ")})`, !!d && want.every((w) => d.words.includes(w)) && d.words.includes("‹") && d.words.includes("›"), d?.words.join(" | "));
          const desc = await descenders(page, "dialog.lb[open]");
          check(`detail-${vp}-${id}: spec rows keep their descenders`, desc.bad.length === 0 && desc.rows >= 1, desc.bad.slice(0, 2).join(" | ") || `${desc.rows} rows`);
          if (d && (kind === "resume" || kind === "card")) {
            check(`detail-${vp}-${id}: the 3D paper viewer (stage + one paper canvas)`, d.paper && d.canvases === 2, `paper=${d.paper} canvases=${d.canvases}`);
            if (touch && kind === "card") {
              // phone (task 5): the paper's top 24 px under the book box's top, the caption 14 px under it (no dead gap)
              const b = await heldBox(page);
              check(`detail-${vp}-${id}: lies 24 px under the box top, the caption 14 px under it`, !!b && Math.abs(b.top - 24) <= 4 && b.gap >= 9 && b.gap <= 20, JSON.stringify(b && { top: b.top, gap: b.gap }));
            } else if (touch) {
              // r4 E4: the résumé's page as wide as the screen less its margins (20), right under the identity (m + 64), the caption 14 px under it
              const b = await heldBox(page);
              const w = b ? b.r - b.l : 0;
              check(`detail-${vp}-${id}: one page across the screen (≥ 97 % of W − 2m) under the identity, the caption 14 px under it`, !!b && w >= 0.97 * (390 - 40) && w <= 390 - 40 + 6 && Math.abs(b.t - 84) <= 4 && b.gap >= 9 && b.gap <= 20, JSON.stringify(b && { w, t: b.t, gap: b.gap }));
            }
            await shot(page, `detail-${vp}-${id}`);
            if (kind === "card") {
              await word(page, /^open it$/i, "dialog.lb[open] .lb-hands").click();
              await page.waitForTimeout(1600);
              const d2 = await detail(page);
              check(`detail-${vp}-card: Open it unfolds (the word reads Fold it)`, !!d2 && d2.words.includes("Fold it"), d2?.words.join(" | "));
              if (touch) {
                // the opened card takes its full height: the caption moves down under it
                const b = await heldBox(page);
                check(`detail-${vp}-card: opened, the caption follows it down`, !!b && Math.abs(b.top - 24) <= 6 && b.gap >= 6 && b.gap <= 24, JSON.stringify(b && { top: b.top, gap: b.gap, h: b.b - b.t }));
              }
              await shot(page, `detail-${vp}-card-open`);
            }
            await closeDetail(page);
            const left = await page.evaluate(() => document.querySelectorAll("canvas").length);
            check(`detail-${vp}-${id}: closing disposes the paper viewer`, left === 1, `${left} canvases`);
            continue;
          }
          // the ticket, polaroid and note: the pouch's own object, rendered by the stage (not a drawing of it)
          await page.waitForFunction(() => !!document.querySelector("dialog.lb[open] .still[data-snap] img.still-img"), null, { timeout: 5000 }).catch(() => {});
          const snap = await page.evaluate(() => {
            const img = document.querySelector<HTMLImageElement>("dialog.lb[open] .still[data-snap] .front img.still-img, dialog.lb[open] .still[data-snap] > .still-tilt > img.still-img");
            return img ? { w: img.naturalWidth, h: img.naturalHeight, png: img.src.startsWith("data:image/png"), src: img.src.length } : null;
          });
          check(`detail-${vp}-${id}: shows the same 3D object (stage snapshot)`, !!snap && snap.png && snap.w > 200, JSON.stringify(snap && { w: snap.w, h: snap.h, png: snap.png }));
          {
            // r3: the thing that rises is the still: no DOM stand-in on the way up (swapped for the still mid-lift), the object unseen
            // until its still is there
            const f = await frames(page);
            const stand = f.filter((x) => x.dom).length;
            const early = f.filter((x) => x.op > 0.02 && !x.still).length;
            check(`detail-${vp}-${id}: rises as its still, never a stand-in swapped mid-lift`, f.length > 10 && stand === 0 && early === 0, `${f.length} frames, ${stand} with a stand-in, ${early} shown before the still (still at ${f.find((x) => x.still)?.t ?? "—"} ms)`);
          }
          // contract (a): the pouch bakes the still's lift shadow from its own silhouette; the page puts no CSS shadow on it
          const baked = await page.evaluate(() => {
            const img = document.querySelector<HTMLImageElement>("dialog.lb[open] .still[data-snap] .front img.still-img, dialog.lb[open] .still[data-snap] > .still-tilt > img.still-img");
            return img ? { shadow: img.hasAttribute("data-shadow"), pad: Number(img.dataset.pad), filter: getComputedStyle(img).filter } : null;
          });
          check(`detail-${vp}-${id}: its shadow is baked into the still (no CSS filter)`, !!baked && baked.shadow && baked.pad > 0 && baked.filter === "none", JSON.stringify(baked));
          await page.mouse.move(4, 4);
          await page.waitForTimeout(600);
          // (read again: the lift waits for the still, so it may have risen only now)
          const dl = await detail(page);
          if (!touch && dl?.obj) {
            // brief O2 at 1440: ticket ≈ 780, polaroid ≈ 420, note ≈ 300 wide
            const target = { ticket: 780, polaroid: 420, note: 300 }[kind as "ticket" | "polaroid" | "note"];
            check(`detail-${vp}-${id}: held large (≈ ${target} px wide)`, Math.abs(dl.obj.w - target) <= 12, `${Math.round(dl.obj.w)} × ${Math.round(dl.obj.h)}`);
            // the object itself (not its shadow margin) keeps the size and place a still without a margin had: the held rect, centred
            const b = await heldBox(page);
            const rot = kind === "polaroid" ? (2 * Math.PI) / 180 : 0;
            const ew = dl.obj.w * Math.cos(rot) + (kind === "polaroid" ? dl.obj.h * Math.sin(rot) : 0);
            const cx = dl.obj.l + dl.obj.w / 2;
            check(`detail-${vp}-${id}: the object keeps its size and place (≈ ${Math.round(ew)} wide, centred in its rect)`, !!b && Math.abs(b.r - b.l - ew) <= 6 && Math.abs((b.l + b.r) / 2 - cx) <= 3, JSON.stringify(b));
          }
          if (!touch && kind === "ticket") {
            // the round punch went through the ticket: through it, the desk (not the shadow's grey). PUNCH in src/bag/objects/ticket.ts:
            // (103, 47.5) mm on the 150 × 58 mm ticket; the desk measured 40 px outside the ticket, clear of its shadow
            const tk = await page.evaluate(() => {
              const img = document.querySelector<HTMLImageElement>("dialog.lb[open] .front img.still-img")!;
              const r = img.getBoundingClientRect();
              const m = Number(img.dataset.pad) * r.width;
              return { l: r.left + m, t: r.top + m, w: r.width - 2 * m, h: r.height - 2 * m };
            });
            const punch: [number, number] = [tk.l + (103 / 150) * tk.w, tk.t + (47.5 / 58) * tk.h];
            const [hole, ...around] = await luma(page, [punch, [punch[0], tk.t - 40], [tk.l - 40, punch[1]], [tk.l + tk.w + 40, punch[1]]]);
            // (the held thing leans to the middle of the screen, so a sample may lie over the veiled book: the brightest is the desk)
            const desk = Math.max(...around);
            check(`detail-${vp}: the ticket's punch shows the desk, not grey (luma within 12)`, hole !== undefined && Math.abs(hole - desk) <= 12, `hole ${hole?.toFixed(1)} at ${punch.map((v) => v.toFixed(0)).join(",")}, desk ${around.map((v) => v.toFixed(1)).join(" / ")}`);
          }
          if (touch) {
            // phone (task 5): the object's top 24 px under the book box's top, the caption 14 px under its foot
            const b = await heldBox(page);
            check(`detail-${vp}-${id}: lies 24 px under the box top, the caption 14 px under it`, !!b && Math.abs(b.top - 24) <= 4 && b.gap >= 9 && b.gap <= 20, JSON.stringify(b && { top: b.top, gap: b.gap }));
          }
          await shot(page, `detail-${vp}-${id}`);
          if (kind === "ticket" || kind === "polaroid") {
            await sampleFrames(page);
            await page.keyboard.press("Space");
            await page.waitForTimeout(1400);
            const ft = await frames(page);
            check(`detail-${vp}-${id}: turns over to its printed back's still, never a stand-in on the way`, ft.some((x) => x.turned) && ft.every((x) => !x.domBack), `${ft.filter((x) => x.domBack).length} frames with a stand-in back; turned at ${ft.find((x) => x.turned)?.t ?? "—"} ms`);
            const back = await page.evaluate(() => {
              const b = document.querySelector<HTMLImageElement>("dialog.lb[open] .flip-face.back img.still-img");
              return { turned: !!document.querySelector("dialog.lb[open] .flip[data-turned]"), still: !!b, baked: !!b && b.hasAttribute("data-shadow") && getComputedStyle(b).filter === "none", dom: !!document.querySelector("dialog.lb[open] .flip-face.back .tk-back, dialog.lb[open] .flip-face.back .pol-back") };
            });
            const d3 = await detail(page);
            check(`detail-${vp}-${id}: Space turns it over to its printed back (its shadow baked in too)`, back.turned && back.still && back.baked && !!d3?.words.includes("Turn back"), JSON.stringify(back));
            await shot(page, `detail-${vp}-${id}-back`);
          }
          if (!touch && kind === "ticket") {
            // r3: the close is one movement — the room un-blurs and the words come back while the veil goes, no blurred, wordless beat
            // between them (the old close held one for 90–270 ms)
            await sampleFrames(page);
            await closeDetail(page);
            const fc = await frames(page);
            const beat = fc.filter((x) => x.veil < 0.1 && x.blur > 6 && x.words < 0.1);
            const back = fc.find((x) => x.blur < 0.05 && x.words > 0.99);
            const mid = fc.find((x) => x.closing && x.veil < 0.6);
            check(`detail-${vp}: closing un-blurs the room and brings the words back with the veil, in one movement`, beat.length === 0 && !!mid && mid.blur < 6 && mid.words > 0.3 && !!back && back.t <= 450, `${beat.length} blank frames; veil at ${mid?.veil.toFixed(2)}: blur ${mid?.blur.toFixed(1)}, words ${mid?.words.toFixed(2)}; room back at ${back?.t ?? "—"} ms`);
          } else await closeDetail(page);
        }
        // stepping inside the detail view: card (paper) → next object = résumé (paper) → past its last page = the ticket (a still)
        const pc = (await targets(page))["card"] ?? t2["card"];
        if (pc) {
          await tap(page, touch, pc);
          await page.waitForTimeout(1500);
          await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(1800);
          const d1 = await detail(page);
          let d2 = d1;
          for (let i = 0; i < 8 && d2?.kind === "resume"; i++) {
            await page.keyboard.press("ArrowRight");
            await page.waitForTimeout(1300);
            d2 = await detail(page);
          }
          await page.waitForTimeout(500);
          d2 = await detail(page);
          check(`detail-${vp}: stepping objects keeps one paper viewer, then frees it`, d1?.kind === "resume" && d1.canvases === 2 && d2?.kind === "ticket" && d2.canvases === 1, `${d1?.kind} ${d1?.canvases} → ${d2?.kind} ${d2?.canvases}`);
          await closeDetail(page);
        }
        // keyboard path: the pouch list (invisible until focused) opens the same detail view; focus comes back
        await page.focus(".pouch-index li:nth-child(3) button");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        const dk = await detail(page);
        check(`folio-${vp}: the keyboard list opens the detail view`, dk?.kind === "ticket", `${dk?.kind}`);
        await closeDetail(page);
        const back = await page.evaluate(() => document.activeElement?.closest(".pouch-index") !== null);
        check(`folio-${vp}: focus returns to the opener`, back);
      }
      await c.close();
    }
  }

  /* ── albums: postcards turn to their message sides; a card's detail copies its colour; a postcard turns to 郵便はがき ── */
  if (want("albums")) {
    for (const vp of ["desktop", "phone"] as Vp[]) {
      const touch = vp === "phone";
      const c = await newCtx(browser, vp, { clipboard: true });
      const page = await c.newPage();
      await page.goto(`${base}/#postcards`);
      await ready(page);
      await page.waitForTimeout(2600);
      const words = (await page.locator(".hands .ctl button.w").allTextContents()).join(" ");
      const ct = (await page.locator(".hands .ct span[aria-hidden]").first().textContent()) ?? "";
      check(`postcards-${vp}: the controls read ‹ 01 / 0n › │ Close`, words === "‹ › Close" && /^01 \/ 0\d$/.test(ct.trim()), `${words} · ${ct}`);
      const links0 = await page.locator(".folio-links button, .folio-links a").allTextContents();
      await page.locator(".hands button.w[aria-label='Next page']").click();
      await page.waitForTimeout(2000);
      const links1 = await page.locator(".folio-links button, .folio-links a").allTextContents();
      const count = (await page.locator(".hands .ct span[aria-hidden]").first().textContent()) ?? "";
      const shared = links1.filter((l) => links0.includes(l));
      check(`postcards-${vp}: a turn shows the message sides of the same postcards`, shared.length > 0 && /^02 /.test(count.trim()), `counter "${count.trim()}", back of: ${shared.join(" / ")}`);
      await shot(page, `postcards-${vp}-spread2`);

      await page.goto(`${base}/#cards`);
      await ready(page);
      await page.waitForTimeout(2600);
      // the first pocket of the right-hand page (desktop spread) / the page (phone), in the book box
      const box = await page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        const p = (k: string) => parseFloat(s.getPropertyValue(k));
        return { l: p("--box-l"), t: p("--box-t"), w: p("--box-w"), h: p("--box-h") };
      });
      const p: [number, number] = vp === "desktop" ? [box.l + box.w * 0.62, box.t + box.h * 0.32] : [box.l + box.w * 0.32, box.t + box.h * 0.3];
      await tap(page, touch, p);
      await page.waitForTimeout(1000);
      const d = await detail(page);
      check(`cards-${vp}: clicking a card opens its detail (colour row, 色見本 hashira)`, d?.kind === "cards" && d.rows.includes("Colour") && d.hashira === "色見本", JSON.stringify(d && { kind: d.kind, title: d.title, rows: d.rows, hashira: d.hashira }));
      // the Series value 色見本 is Japanese on an English page: set in Zen Kaku (a web face), never a system face
      const series = await renderedFonts(page, "dialog.lb[open] .lb-specs dd[lang='ja']");
      check(`cards-${vp}: 色見本 is set in the Japanese web face`, series.length === 1 && !series[0]!.system && series[0]!.fonts.some((f) => /^Zen Kaku Gothic New/.test(f)), JSON.stringify(series));
      const copyWord = page.locator("dialog.lb[open] .lb-hands button.w").filter({ hasText: /^Copy #/ });
      if (await copyWord.count()) {
        await copyWord.click();
        await page.waitForTimeout(250);
        const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
        check(`cards-${vp}: the secondary action copies the hex`, /^#[0-9a-f]{6}$/i.test(clip), clip);
      } else check(`cards-${vp}: the secondary action copies the hex`, false, "no Copy word");
      await shot(page, `cards-${vp}-detail`);
      await closeDetail(page);

      await page.goto(`${base}/#postcards`);
      await ready(page);
      await page.waitForTimeout(2600);
      await page.locator(".folio-links button").first().focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
      const dp = await detail(page);
      check(`postcards-${vp}: the keyboard link opens the postcard (place, postmark, from, photo credit)`, dp?.kind === "postcards" && ["Place", "Postmarked", "From", "Photo"].every((k) => dp.rows.includes(k)), JSON.stringify(dp?.rows));
      await page.keyboard.press("Space");
      await page.waitForTimeout(1100);
      const hagaki = await page.evaluate(() => ({ turned: !!document.querySelector("dialog.lb[open] .flip[data-turned]"), hd: document.querySelector("dialog.lb[open] .hagaki .hd")?.textContent, msg: !!document.querySelector("dialog.lb[open] .hagaki .msg"), word: [...document.querySelectorAll("dialog.lb[open] .lb-hands .w")].map((w) => w.textContent).includes("Turn back") }));
      check(`postcards-${vp}: Space turns the postcard over to 郵便はがき`, hagaki.turned && hagaki.hd === "郵便はがき" && hagaki.msg && hagaki.word, JSON.stringify(hagaki));
      // the cancelling postmark is struck over the stamp (in ink: multiply), as on the 3D back film
      const pm = await page.evaluate(() => {
        const z = (s: string) => Number(getComputedStyle(document.querySelector(`dialog.lb[open] .hagaki ${s}`)!).zIndex) || 0;
        return { pm: z(".pm"), stamp: z(".stamp"), blend: getComputedStyle(document.querySelector("dialog.lb[open] .hagaki .pm")!).mixBlendMode };
      });
      check(`postcards-${vp}: the postmark lies over the stamp`, pm.pm > pm.stamp && pm.blend === "multiply", JSON.stringify(pm));
      const desc = await descenders(page, "dialog.lb[open]");
      check(`postcards-${vp}: caption rows keep their descenders`, desc.bad.length === 0, desc.bad.slice(0, 2).join(" | "));
      await shot(page, `postcards-${vp}-detail-back`);
      await closeDetail(page);
      await c.close();
    }
  }

  /* ── phone gestures in the detail view (brief O2): swipe left / right between objects, down to put it back; the caption scrolls ── */
  if (want("swipe")) {
    const c = await newCtx(browser, "phone");
    const page = await c.newPage();
    const cdp = await c.newCDPSession(page);
    await page.goto(`${base}/?debug#resume`);
    await ready(page);
    await page.waitForTimeout(2400);
    // real touch input (a browser pan would cancel the pointer: the held thing keeps its touches, touch-action none)
    const swipe = async (x0: number, y0: number, x1: number, y1: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * i) / 6 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(1300);
    };
    const kind = () => page.evaluate(() => document.querySelector("dialog.lb[open]")?.getAttribute("data-kind") ?? null);
    await page.locator(".pouch-index li:nth-child(3) button").evaluate((b) => (b as HTMLButtonElement).click());
    await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1600);
    const seq = [await kind()];
    await swipe(330, 200, 120, 210);
    seq.push(await kind());
    await swipe(80, 200, 300, 205);
    seq.push(await kind());
    check("swipe: left steps to the next object, right back", seq.join(" → ") === "ticket → polaroid → ticket", seq.join(" → "));
    const cap = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("dialog.lb[open] .lb-cap")!;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, sh: el.scrollHeight, ch: el.clientHeight };
    });
    if (cap.sh > cap.ch + 4) {
      await swipe(cap.x, cap.y, cap.x + 4, cap.y - 160);
      const top = await page.evaluate(() => document.querySelector("dialog.lb[open] .lb-cap")?.scrollTop ?? 0);
      check("swipe: a vertical drag on the caption scrolls it (and keeps the object)", top > 20 && (await kind()) === "ticket", `scrollTop ${top}, ${await kind()}`);
    }
    await swipe(200, 150, 205, 400);
    check("swipe: down puts the object back", (await kind()) === null, `${await kind()}`);
    await c.close();
  }

  /* ── captions on a short desk; the phone's closed-booklet hint ── */
  if (want("caption")) {
    // 1280 × 720 (height ≤ 800): the story stays in the text version, the caption ends on the book box's foot (H − m − 40 − g),
    // never on the bottom line, and says when more lies below (a fade, data-more)
    const c = await newCtx(browser, "laptop");
    const page = await c.newPage();
    await page.goto(`${base}/?debug#resume`);
    await ready(page);
    await page.waitForTimeout(2400);
    for (const n of [1, 3]) {
      await page.locator(`.pouch-index li:nth-child(${n}) button`).evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1600);
      const cap = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("dialog.lb[open] .lb-cap")!;
        const story = el.querySelector(".cap-story");
        return { kind: document.querySelector("dialog.lb[open]")?.getAttribute("data-kind"), bottom: el.getBoundingClientRect().bottom, more: el.hasAttribute("data-more"), over: el.scrollHeight > el.clientHeight + 2, story: !!story && getComputedStyle(story).display !== "none" };
      });
      const foot = 720 - 40 - 40 - 24;
      check(`caption-laptop-${cap.kind}: ends on the book box's foot (${foot}), no story, a fade when more lies below`, cap.bottom <= foot + 1 && !cap.story && cap.more === cap.over, JSON.stringify(cap));
      await shot(page, `caption-laptop-${cap.kind}`);
      await closeDetail(page);
    }
    await c.close();
    // phone: a closed booklet says how to open it
    const cp = await newCtx(browser, "phone");
    const pp = await cp.newPage();
    await pp.goto(`${base}/#cards`);
    await ready(pp);
    await pp.waitForTimeout(2200);
    await word(pp, /^close$/i).click();
    await pp.waitForTimeout(2200);
    const hint = await pp.evaluate(() => {
      const h = document.querySelector<HTMLElement>(".page .hint");
      return { text: h?.textContent ?? "", color: h ? getComputedStyle(h).color : "" };
    });
    check("caption-phone: a closed booklet's hint (tap the cover), in tetsu", hint.text === "Tap the cover to open it." && hint.color === "rgb(54, 66, 78)", JSON.stringify(hint));
    await cp.close();
  }

  /* ── the case material: swapped in place (no rebuild), remembered per booklet ── */
  if (want("case")) {
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    await page.goto(`${base}/#resume`);
    await ready(page);
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      const w = window as unknown as { __drops: number; __canvas: Element | null };
      w.__drops = 0;
      w.__canvas = document.querySelector(".folio-stage > canvas");
      new MutationObserver(() => {
        if (!document.querySelector(".stage-host[data-ready]")) w.__drops++;
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-ready"] });
    });
    for (const m of ["Cloth", "Frost"]) {
      await page.locator(".case .cs").filter({ hasText: m }).click();
      await page.waitForTimeout(1500);
      await shot(page, `case-resume-${m.toLowerCase()}`);
    }
    const r = await page.evaluate(() => {
      const w = window as unknown as { __drops: number; __canvas: Element | null };
      return { drops: w.__drops, same: w.__canvas === document.querySelector(".folio-stage > canvas"), checked: document.querySelector(".case .cs[aria-checked='true']")?.textContent, stored: localStorage.getItem("sasshi:case:resume"), cards: localStorage.getItem("sasshi:case:cards") };
    });
    check("case: a swatch swaps the case in place (same canvas, stage never un-ready)", r.drops === 0 && r.same, JSON.stringify(r));
    check("case: the choice is stored for this booklet only", r.checked === "Frost" && r.stored === "frost" && r.cards === null, JSON.stringify(r));
    await page.focus(".case .cs[aria-checked='true']");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    const k = await page.evaluate(() => ({ checked: document.querySelector(".case .cs[aria-checked='true']")?.textContent, focused: document.activeElement?.textContent }));
    check("case: arrow keys move the selection", k.checked === "Cloth" && k.focused === "Cloth", JSON.stringify(k));
    await page.reload();
    await ready(page);
    check("case: remembered across reload", (await page.evaluate(() => document.querySelector(".case .cs[aria-checked='true']")?.textContent)) === "Cloth");
    await page.evaluate(() => localStorage.removeItem("sasshi:case:resume"));
    await c.close();
  }

  /* ── the keyboard (§1.8; the ⌘K palette is gone by design): 1 2 3, ← →, Space opens, S shakes, M sound ── */
  if (want("keys")) {
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    await page.goto(`${base}/?debug#resume`);
    await ready(page);
    await page.waitForTimeout(2400);
    const cmdk = await page.evaluate(() => !!document.querySelector("dialog.pal-dlg") || /⌘K|Ctrl K/.test(document.body.textContent ?? ""));
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(300);
    check("keys: no ⌘K palette", !cmdk && (await page.locator("dialog[open]").count()) === 0);
    const before = await simState(page);
    await page.keyboard.press("s");
    await page.waitForTimeout(1800);
    const after = await simState(page);
    const moved = after.filter((a) => {
      const b = before.find((x) => x.id === a.id)!;
      return Math.hypot(a.x - b.x, a.y - b.y) > 0.005;
    }).length;
    check("keys: S shakes the folio", moved >= 2, `${moved} moved`);
    const s0 = await page.locator("[data-testid='sound-toggle']").getAttribute("aria-pressed");
    await page.keyboard.press("m");
    await page.waitForTimeout(200);
    const s1 = await page.locator("[data-testid='sound-toggle']").getAttribute("aria-pressed");
    check("keys: M toggles the sound", s0 !== s1, `${s0} → ${s1}`);
    await page.keyboard.press("m");
    await page.keyboard.press("1");
    await page.waitForFunction(() => location.hash === "#cards", null, { timeout: 3000 }).catch(() => {});
    await ready(page);
    await page.waitForTimeout(2200);
    const p0 = await page.locator(".hands .ct span[aria-hidden]").first().textContent();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1800);
    const p1 = await page.locator(".hands .ct span[aria-hidden]").first().textContent();
    check("keys: 1 opens the cards, → turns a page", (p0 ?? "").startsWith("01") && (p1 ?? "").startsWith("02"), `${p0} → ${p1}`);
    await page.locator(".hands button.w").filter({ hasText: /^Close$/ }).click();
    await page.waitForTimeout(2000);
    const closed = await page.locator(".hands .ctl").innerText();
    await page.keyboard.press(" ");
    await page.waitForTimeout(2000);
    const reopened = await page.locator(".hands .ctl").innerText();
    check("keys: Close shows Open, Space opens the album again", /^Open$/.test(closed.trim()) && /Close/.test(reopened), `${closed.trim()} → ${reopened.replace(/\n/g, " ")}`);
    await c.close();
  }

  /* ── Simplified Chinese (brief O4; replaces the theme checks): ?sample=zh gets Chinese chrome, SC faces, lang attributes ── */
  if (want("i18n")) {
    for (const vp of ["desktop", "phone"] as Vp[]) {
      const c = await newCtx(browser, vp);
      const page = await c.newPage();
      await page.goto(`${base}/?sample=zh#resume`);
      await ready(page);
      await page.waitForTimeout(2500);
      await page.evaluate(() => document.fonts.ready);
      const zh = await page.evaluate(() => {
        const t = (s: string) => document.querySelector(s)?.textContent?.trim() ?? "";
        const fam = (s: string) => {
          const el = document.querySelector(s);
          return el ? getComputedStyle(el).fontFamily.split(",").map((x) => x.trim().replace(/["']/g, "")) : [];
        };
        return {
          lang: document.documentElement.lang,
          toc: [...document.querySelectorAll(".toc .nm")].map((x) => x.textContent),
          hashira: t(".page > .hashira .xf-i:not([data-out]) .jp"),
          words: [...document.querySelectorAll(".hands .w")].map((w) => w.textContent?.trim()),
          handling: t(".handling p") || t(".hint"),
          serif: fam(".toc .nm"),
          sans: fam(".hands .w"),
        };
      });
      check(`i18n-${vp}: Chinese chrome (lang, booklets, hashira, controls)`, zh.lang === "zh-CN" && zh.toc.join("") === "卡册明信片简历" && zh.hashira === "简历" && zh.words.some((w) => /晃一晃/.test(w ?? "")) && /[一-鿿]/.test(zh.handling), JSON.stringify(zh));
      check(`i18n-${vp}: Latin from the Japanese faces, Han from the SC faces`, zh.serif[0] === "Folio Serif Latin" && zh.serif[1] === "Noto Serif SC" && zh.sans[0] === "Folio Sans Latin" && zh.sans[1] === "Noto Sans SC", `${zh.serif.slice(0, 2).join(", ")} / ${zh.sans.slice(0, 2).join(", ")}`);
      // no mixed glyph shapes: every Han character on screen is in the SC face it is set in (nothing falls back to a system face)
      const mixed = await page.evaluate(async () => {
        const out: string[] = [];
        for (const el of document.querySelectorAll(".words *, .hands *, .page > .hashira *")) {
          if (el.children.length || !el.textContent?.trim() || getComputedStyle(el).display === "none") continue;
          const s = getComputedStyle(el);
          const han = [...el.textContent].filter((ch) => /[㐀-鿿]/.test(ch)).join("");
          if (!han) continue;
          const face = s.fontFamily.split(",")[1]?.trim().replace(/["']/g, "");
          const spec = `${s.fontWeight} 16px "${face}"`;
          await document.fonts.load(spec, han);
          if (!document.fonts.check(spec, han)) out.push(`${el.className}: ${han.slice(0, 8)} not in ${face} ${s.fontWeight}`);
        }
        return out.slice(0, 4);
      });
      check(`i18n-${vp}: no mixed glyph shapes (every Han glyph in its SC face)`, mixed.length === 0, mixed.join(" | "));
      if (vp === "desktop") {
        // the hashira pairs 简历 with the small Latin line on purpose: the Han line names it, the Latin line is decoration (lang en,
        // hidden from screen readers) set in the Latin alias face
        const hs = await page.evaluate(() => {
          const h = document.querySelector(".page > .hashira")!;
          const jp = h.querySelector(".xf-i:not([data-out]) .jp");
          const en = h.querySelector(".xf-i:not([data-out]) .en");
          return { hidden: h.getAttribute("aria-hidden"), jp: jp && { text: jp.textContent, lang: jp.getAttribute("lang"), hidden: jp.closest("[aria-hidden='true']") !== null }, en: en && { text: en.textContent, lang: en.getAttribute("lang"), hidden: en.getAttribute("aria-hidden") } };
        });
        // (the alias is registered from Zen Kaku Gothic New's latin files, so DevTools names the file's own family; the Chinese stack
        // holds no Zen Kaku but the alias, so that is where every glyph came from)
        const enFace = await renderedFonts(page, ".page > .hashira .xf-i:not([data-out]) .en");
        check("i18n: the Chinese hashira: 简历 is read, the Latin line is decoration in the Latin face", hs.hidden === null && hs.jp?.text === "简历" && !hs.jp.hidden && /^zh/.test(hs.jp.lang ?? "") && hs.en?.lang === "en" && hs.en.hidden === "true" && /^Résumé folio · \d\d$/.test(hs.en.text ?? "") && enFace.length === 1 && !enFace[0]!.system && enFace[0]!.fonts.length > 0 && enFace[0]!.fonts.every((f) => /^Zen Kaku Gothic New/.test(f)), JSON.stringify({ hs, enFace }));
      }
      await shot(page, `i18n-${vp}-resume`);
      if (vp === "desktop") {
        // the page's own links keep the Chinese sample: 文字版 → the Chinese text version, and back to the Chinese desk
        await page.locator(".prefs a.pw").click();
        await page.waitForSelector(".sheetwrap .letter", { timeout: 8000 }).catch(() => {});
        const tv = await page.evaluate(() => ({ url: location.search, k: document.querySelector(".lt-k")?.textContent }));
        check("i18n: 文字版 opens the Chinese text version (?sample=zh carried on as ?lang=zh)", /lang=zh/.test(tv.url) && tv.k === "简介", JSON.stringify(tv));
        await page.locator("a.back").click();
        await ready(page);
        const back = await page.evaluate(() => ({ url: location.search, lang: document.documentElement.lang }));
        check("i18n: ← 回到桌面 returns to the Chinese desk", /lang=zh/.test(back.url) && back.lang === "zh-CN", JSON.stringify(back));
        await page.waitForTimeout(1500);
      }
      // a held object in Chinese: the kind's Chinese name in the hashira, Chinese controls
      const t = await page.evaluate(() => document.querySelectorAll(".pouch-index button").length);
      if (t) {
        await page.focus(".pouch-index li:nth-child(1) button");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1800);
        const d = await detail(page);
        check(`i18n-${vp}: the business card's detail in Chinese (名片, 放回)`, d?.hashira === "名片" && d.words.some((w) => /^放回/.test(w)), JSON.stringify(d && { hashira: d.hashira, words: d.words }));
        await shot(page, `i18n-${vp}-card`);
        await closeDetail(page);
        // 大会门票 already says 门票: the local name is not repeated under it
        await page.focus(".pouch-index li:nth-child(3) button");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1500);
        const dt = await detail(page);
        check(`i18n-${vp}: the ticket's caption does not repeat its kind (大会门票, no 门票 line)`, dt?.kind === "ticket" && dt.title === "大会门票" && dt.local === "" && dt.hashira === "门票", JSON.stringify(dt && { title: dt.title, local: dt.local, hashira: dt.hashira }));
        await closeDetail(page);
      }
      if (vp === "phone") {
        // the bottom row's Chinese words (简介, 合上 …) are set in the SC web face, never a system face
        const row = await renderedFonts(page, ".page .hands .pf, .page .hands .ctl .w");
        const bad = row.filter((r) => /[一-鿿]/.test(r.text) && (r.system || !r.fonts.some((f) => /^Noto Sans SC/.test(f))));
        check("i18n-phone: the bottom row's Chinese in Noto Sans SC (no system face)", row.length > 0 && bad.length === 0, JSON.stringify(bad.length ? bad : row.map((r) => r.text)));
      }
      await c.close();
    }
    // the book's own keyboard links and page counter speak Chinese too; a Chinese colour card is titled by its colour name
    {
      const c = await newCtx(browser, "desktop");
      const page = await c.newPage();
      await page.goto(`${base}/?sample=zh#cards`);
      await ready(page);
      await page.waitForTimeout(2400);
      const book = await page.evaluate(() => ({
        links: [...document.querySelectorAll(".folio-links button")].map((b) => b.textContent?.trim() ?? ""),
        pager: document.querySelector(".hands .ct .sr-only")?.textContent ?? "",
        arrows: [...document.querySelectorAll(".hands button.w.ar")].map((b) => b.getAttribute("aria-label")),
      }));
      // contract (b): a colour card is named by its colour name (月白), as its caption is titled
      check("i18n: the book's links and counter in Chinese (细看「月白」, 第 1 页，共 n 页, 上一页 / 下一页)", book.links[0] === "细看「月白」" && book.links.every((l) => /^细看「.+」$/.test(l)) && /^第 1 页，共 \d+ 页$/.test(book.pager) && book.arrows.join() === "上一页,下一页", JSON.stringify({ ...book, links: book.links.slice(0, 2) }));
      await page.locator(".folio-links button").first().evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const cc = await page.evaluate(() => ({ title: document.querySelector("dialog.lb[open] .cap-title")?.textContent ?? "", sub: document.querySelector("dialog.lb[open] .cap-local.romaji")?.textContent ?? "" }));
      check("i18n: a Chinese colour card's title is its colour name, the romaji under it (月白 / Geppaku)", /^[一-鿿]+$/.test(cc.title) && /^[A-Za-zōū]+$/.test(cc.sub), JSON.stringify(cc));
      await closeDetail(page);
      await page.goto(`${base}/?sample=zh#postcards`);
      await ready(page);
      await page.waitForTimeout(2200);
      // a Chinese postcard is named by its Chinese title (龙安寺), not its Japanese caption (雪の龍安寺)
      const pcLink = (await page.locator(".folio-links button").first().textContent())?.trim() ?? "";
      check("i18n: a postcard's link reads 细看「龙安寺」", pcLink === "细看「龙安寺」", pcLink);
      await page.locator(".folio-links button").first().evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await page.keyboard.press("Space");
      await page.waitForTimeout(1100);
      const hg = await page.evaluate(() => ({ hd: document.querySelector("dialog.lb[open] .hagaki .hd")?.getAttribute("lang"), sig: document.querySelector("dialog.lb[open] .hagaki .sig")?.textContent ?? "" }));
      check("i18n: the Chinese 郵便はがき (lang ja), signed —— 林 as on the 3D back film", hg.hd === "ja" && hg.sig === "—— 林", JSON.stringify(hg));
      await closeDetail(page);
      // the text version: Chinese punctuation between a role and its organisation; a skills line never starts with ·
      await page.goto(`${base}/?sample=zh&view=text`);
      await page.waitForSelector(".sheetwrap .letter");
      const tx = await page.evaluate(() => ({
        jobs: [...document.querySelectorAll(".lt-job > span:not(.yr)")].map((s) => s.textContent ?? ""),
        items: [...document.querySelectorAll(".lt-li")].map((s) => ({ t: s.textContent ?? "", ws: getComputedStyle(s).whiteSpace })),
      }));
      check("i18n: the Chinese text version joins with ，and keeps each skill whole with its separator", tx.jobs.length > 0 && tx.jobs.every((j) => j.includes("，") && !/, /.test(j)) && tx.items.length > 0 && tx.items.every((i) => i.ws === "nowrap" && !/^·/.test(i.t)), JSON.stringify({ jobs: tx.jobs.slice(0, 2), items: tx.items.slice(0, 3) }));
      await c.close();
    }
    // the English sample: the nameplate 林文 is Han in an English page (zh-Hans faces), the hashira's Japanese is lang ja
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    await page.goto(`${base}/#cards`);
    await ready(page);
    const en = await page.evaluate(() => ({ html: document.documentElement.lang, plate: document.querySelector(".nameplate")?.getAttribute("lang"), jp: document.querySelector(".page > .hashira .jp")?.getAttribute("lang"), en: document.querySelector(".page > .hashira .en")?.getAttribute("lang"), hidden: document.querySelector(".page > .hashira")?.getAttribute("aria-hidden") }));
    check("i18n: the English page marks its Han text (nameplate zh-Hans, hashira ja); its hashira is decoration", en.html === "en" && en.plate === "zh-Hans" && en.jp === "ja" && en.en === "en" && en.hidden === "true", JSON.stringify(en));
    const enFace = await renderedFonts(page, ".page > .hashira .xf-i:not([data-out]) .en");
    check("i18n: the English hashira's Latin line in the Latin alias face (Zen Kaku's latin files)", enFace.length === 1 && !enFace[0]!.system && enFace[0]!.fonts.length > 0 && enFace[0]!.fonts.every((f) => /^Zen Kaku Gothic New/.test(f)), JSON.stringify(enFace));
    await c.close();
  }

  /* ── r4 E1: the language switch English · 中文 — printed like the prefs, in place (no reload, the booklet, its page and its cover
     stay), ?lang= in the address, remembered; the first language from ?lang= / ?sample=zh, the stored choice, the browser ── */
  if (want("lang")) {
    type Info = { textures: number; geometries: number };
    type Dbg = Record<string, { book(): { debug: { info(): Info } } | null } | undefined>;
    /** Click a language in the switch and wait for the page to be in it (and the words back in view). */
    const toLang = async (page: Page, zh: boolean, touch = false) => {
      const a = page.locator(`.lang a[lang^='${zh ? "zh" : "en"}']`).first();
      if (touch) {
        const r = (await a.boundingBox())!;
        await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
      } else await a.click();
      // (the page's language is set as the words step out; the switch marks the new one when they are in)
      await page.waitForFunction((zh) => document.documentElement.lang === (zh ? "zh-CN" : "en") && (document.querySelector(".lang a[aria-current]")?.getAttribute("lang") ?? "").startsWith(zh ? "zh" : "en") && !document.querySelector(".page[data-lang-out], .page[data-lang-in]"), zh, { timeout: 15000 }).catch(() => {});
    };
    /**
     * Watch the stage from now on, every frame: whether the page reloaded, whether the booklet was built again (another book), and
     * the least its cover was open (a rebuilt book comes up shut and swings open again; a rebuild happens within one long task, so
     * the ready flags never show it). And the words: frames where neither the identity (faded out for a switch) nor the booklet is on
     * view, and the longest stretch the identity was out.
     */
    type Watch = { __mark?: number; __drops?: number; __minCover?: number; __blank?: number; __out?: number; __outMs?: number; __book0?: unknown; __folio?: { book(): { debug: { state(): { cover: number } } } | null }; __album?: { book(): { debug: { state(): { cover: number } } } | null } };
    const watch = (page: Page) =>
      page.evaluate(() => {
        const w = window as unknown as Watch;
        w.__mark = 1;
        w.__drops = 0;
        w.__minCover = 1;
        w.__blank = 0;
        w.__out = 0;
        w.__outMs = 0;
        w.__book0 = (w.__folio ?? w.__album)?.book();
        const tick = (now: number) => {
          const b = (w.__folio ?? w.__album)?.book();
          const book = !!b && !!document.querySelector(".stage-host[data-ready]");
          if (!book) w.__drops!++;
          else w.__minCover = Math.min(w.__minCover!, b.debug.state().cover);
          const id = document.querySelector(".words > .id");
          const out = !!id && Number(getComputedStyle(id).opacity) < 0.05;
          if (out && !book) w.__blank!++;
          if (out) {
            w.__out ||= now;
            w.__outMs = Math.max(w.__outMs!, now - w.__out);
          } else w.__out = 0;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const watched = (page: Page) =>
      page.evaluate(() => {
        const w = window as unknown as Watch;
        return { reloaded: w.__mark !== 1, drops: w.__drops ?? -1, minCover: Number((w.__minCover ?? -1).toFixed(3)), sameBook: !!w.__book0 && w.__book0 === (w.__folio ?? w.__album)?.book(), blank: w.__blank ?? -1, outMs: Math.round(w.__outMs ?? -1) };
      });
    const state = (page: Page) =>
      page.evaluate(() => ({
        html: document.documentElement.lang,
        url: location.search + location.hash,
        stored: localStorage.getItem("sasshi:lang"),
        toc: [...document.querySelectorAll(".toc .nm")].map((x) => x.textContent).join(""),
        hashira: document.querySelector(".page > .hashira .xf-i:not([data-out]) .jp")?.textContent ?? "",
        current: document.querySelector(".lang a[aria-current]")?.textContent ?? "",
        pager: document.querySelector(".hands .ct span[aria-hidden]")?.textContent ?? "",
        open: !!document.querySelector(".hands .ctl button.w[aria-label='Close the album'], .hands .ctl button.w[aria-label='合上册子'], .hands .ctl button.w[aria-label='Close folio'], .hands .ctl button.w[aria-label='合上文件夹']"),
        dialogs: document.querySelectorAll("dialog[open]").length,
        words: Number(getComputedStyle(document.querySelector(".words") ?? document.body).opacity),
      }));

    // the desk: on the words column's bottom lines, over Sound and Text version
    {
      const c = await newCtx(browser, "desktop");
      const page = await c.newPage();
      await page.goto(`${base}/?debug#cards`);
      await ready(page);
      await page.waitForTimeout(2600);
      const sw = await page.evaluate(() => {
        const nav = document.querySelector(".words .foot > .lang");
        const r = nav?.getBoundingClientRect();
        const oku = document.querySelector(".oku")?.getBoundingClientRect();
        const prefs = document.querySelector(".prefs")?.getBoundingClientRect();
        const a = [...(nav?.querySelectorAll("a") ?? [])];
        return {
          text: nav?.textContent ?? "",
          label: nav?.getAttribute("aria-label"),
          between: !!r && !!oku && !!prefs && r.top >= oku.bottom && r.bottom <= prefs.top + 1,
          links: a.map((x) => ({ t: x.textContent, lang: x.getAttribute("lang"), href: x.getAttribute("href"), cur: x.getAttribute("aria-current"), color: getComputedStyle(x).color })),
        };
      });
      const [en, zh] = sw.links;
      check("lang-desktop: English · 中文 over Sound and Text version, English in ink (current), 中文 muted, each its own lang and link", sw.text === "English·中文" && sw.label === "Language" && sw.between && en?.cur === "true" && en.color === "rgb(28, 35, 43)" && zh?.cur === null && zh.color === "rgb(79, 93, 105)" && /^zh/.test(zh.lang ?? "") && /lang=zh/.test(zh.href ?? "") && /#cards$/.test(zh.href ?? ""), JSON.stringify(sw));
      const face = await renderedFonts(page, ".words .lang a[lang^='zh']");
      check("lang-desktop: 中文 in Noto Sans SC on the English page (no system face)", face.length === 1 && !face[0]!.system && face[0]!.fonts.some((f) => /^Noto Sans SC/.test(f)), JSON.stringify(face));
      // turn to the second page, then switch: the booklet, its page and its open cover stay
      await page.locator(".hands button.w[aria-label='Next page']").click();
      await page.waitForTimeout(1800);
      const before = await state(page);
      await watch(page);
      await toLang(page, true);
      await page.waitForTimeout(2500);
      const after = await state(page);
      const w = await watched(page);
      check("lang-desktop: 中文 switches in place (no reload): the chrome, ?lang=zh with the booklet's hash, remembered, the words back", !w.reloaded && after.html === "zh-CN" && after.toc === "卡册明信片简历" && after.hashira === "卡册" && after.current === "中文" && /[?&]lang=zh/.test(after.url) && /#cards$/.test(after.url) && after.stored === "zh" && after.words === 1 && after.dialogs === 0, JSON.stringify({ w, after }));
      // (r4 shell polish) the words that change cross over: out, then the new ones in at once — never a frame with neither the words
      // nor the booklet, the identity fully out for a moment only
      check("lang-desktop: no frame without both the words and the booklet; the words are out ≤ 200 ms", w.blank === 0 && w.outMs >= 0 && w.outMs <= 200, JSON.stringify({ blank: w.blank, outMs: w.outMs }));
      pending("lang-desktop: the album is not rebuilt — its page (02) and open cover stay, no frame without the booklet", w.sameBook && w.drops === 0 && w.minCover > 0.999 && after.pager === before.pager && after.open && before.pager.startsWith("02"), "engine: BookView repaints an album's words in place (items / slip) instead of rebuilding", JSON.stringify({ w, before: before.pager, after: after.pager, open: after.open }));
      await shot(page, "lang-desktop-cards-zh");
      // the text version follows, and switches back in place too
      await page.locator(".prefs a.pw").click();
      await page.waitForSelector(".sheetwrap .letter", { timeout: 8000 }).catch(() => {});
      const tv = await page.evaluate(() => ({ url: location.search, k: document.querySelector(".lt-k")?.textContent, sw: !!document.querySelector(".page > .lang a[aria-current]") }));
      await watch(page);
      await toLang(page, false);
      await page.waitForTimeout(600);
      const tv2 = await page.evaluate(() => ({ url: location.search, k: document.querySelector(".lt-k")?.textContent, html: document.documentElement.lang }));
      const tw = await watched(page);
      check("lang-desktop: the text version is in the chosen language, and switches in place (?lang=en&view=text)", /lang=zh/.test(tv.url) && tv.k === "简介" && tv.sw && !tw.reloaded && tv2.k === "Profile" && tv2.html === "en" && /lang=en/.test(tv2.url) && /view=text/.test(tv2.url), JSON.stringify({ tv, tv2, tw }));
      await c.close();
    }

    // ten toggles on the résumé: no error, nothing stuck, the GPU's textures and geometries back where one toggle left them
    {
      const c = await newCtx(browser, "desktop");
      const page = await c.newPage();
      await page.goto(`${base}/?debug#resume`);
      await ready(page);
      await page.waitForTimeout(3000);
      const info = () => page.evaluate(() => (window as unknown as Dbg).__folio?.book()?.debug.info() ?? { textures: -1, geometries: -1 });
      const seen: Info[] = [];
      const e0 = errors.length;
      await watch(page);
      for (let i = 1; i <= 10; i++) {
        await toLang(page, i % 2 === 1);
        await ready(page);
        await page.waitForTimeout(1800);
        seen.push(await info());
      }
      const end = await state(page);
      const w = await watched(page);
      const leak = (a: Info | undefined, b: Info | undefined) => !a || !b || b.textures > a.textures || b.geometries > a.geometries;
      check("lang-10: ten toggles — no reload, no error, no dialog left open, back in English with the words in view", !w.reloaded && errors.length === e0 && end.dialogs === 0 && end.html === "en" && end.current === "English" && end.words === 1, JSON.stringify({ w, end: { html: end.html, current: end.current, dialogs: end.dialogs }, errors: errors.slice(e0, e0 + 2) }));
      check("lang-10: no leak (textures and geometries after 10 toggles ≤ after 2, after 9 ≤ after 1)", seen.length === 10 && !leak(seen[1], seen[9]) && !leak(seen[0], seen[8]), JSON.stringify(seen.map((s) => `${s.textures}/${s.geometries}`)));
      pending("lang-10: the folio is not rebuilt by a toggle (the pouch reprints in place, the cover stays open)", w.sameBook && w.drops === 0 && w.minCover > 0.999, "engine: BookView repaints the case's liner in place instead of rebuilding", JSON.stringify(w));
      await c.close();
    }

    // the phone: in the header at the identity's right, one tap, clear of the booklet tabs
    {
      const c = await newCtx(browser, "phone");
      const page = await c.newPage();
      await page.goto(`${base}/?debug#postcards`);
      await ready(page);
      await page.waitForTimeout(2400);
      const hd = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
        const nav = r(".words > .lang");
        const toc = r(".toc");
        const hs = r(".page > .hashira");
        const id = r(".words .id-text");
        return { nav, clear: !!nav && !!toc && !!hs && !!id && nav.bottom <= toc.top && nav.right <= hs.left && nav.left >= id.right, links: [...document.querySelectorAll(".words > .lang a")].map((a) => a.getBoundingClientRect().height) };
      });
      const L = await layout(page);
      check("lang-phone: the switch in the header (over the tabs, beside the identity, clear of the hashira); nothing overlaps", hd.clear && L.overlaps.length === 0 && L.offscreen.length === 0, JSON.stringify({ hd, overlaps: L.overlaps }));
      // quieter than the name: set like the role (12 px, 400, .04em) on the role's own baseline, the language on view told by its ink
      // only; each word a 44 × 44 target; ≥ 24 px of air before the hashira
      const quiet = () =>
        page.evaluate(() => {
          const base = (el: Element | null) => {
            if (!el) return NaN;
            const s = document.createElement("span");
            s.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
            el.appendChild(s);
            const y = s.getBoundingClientRect().top;
            s.remove();
            return y;
          };
          const as = [...document.querySelectorAll(".words > .lang a")];
          const cs = as.map((a) => getComputedStyle(a));
          const text = as.map((a) => {
            const r = document.createRange();
            r.selectNodeContents(a);
            return r.getBoundingClientRect();
          });
          const hs = document.querySelector(".page > .hashira .xf-i:not([data-out]) .jp")?.getBoundingClientRect();
          return {
            set: cs.map((c) => `${c.fontSize} ${c.fontWeight} ${c.letterSpacing}`),
            weights: new Set(cs.map((c) => c.fontWeight)).size,
            baseline: as.map((a) => Math.round(base(a) - base(document.querySelector(".words .id-role")))),
            targets: as.map((a) => [Math.round(a.getBoundingClientRect().width), Math.round(a.getBoundingClientRect().height)]),
            air: hs ? Math.round(hs.left - Math.max(...text.map((r) => r.right))) : -1,
          };
        });
      const q1 = await quiet();
      const quietOk = (q: typeof q1) => q.set.every((x) => x === "12px 400 0.48px") && q.weights === 1 && q.baseline.every((d) => Math.abs(d) <= 1) && q.targets.every(([w, h]) => w! >= 44 && h! >= 44) && q.air >= 24;
      check("lang-phone: the switch set like the role (12 px, 400), on the role's baseline, each word a ≥ 44 × 44 target, ≥ 24 px before the hashira", quietOk(q1), JSON.stringify(q1));
      const hint1 = await page.evaluate(() => document.querySelector(".page .hint")?.textContent ?? "");
      check("lang-phone: the postcard album's hint speaks of postcards", hint1 === "Swipe to turn. Tap a postcard to lift it.", hint1);
      await watch(page);
      await toLang(page, true, true);
      await page.waitForTimeout(2200);
      const s = await state(page);
      const w = await watched(page);
      check("lang-phone: one tap on 中文 switches in place", !w.reloaded && s.html === "zh-CN" && s.toc === "卡册明信片简历" && /lang=zh#postcards$/.test(s.url), JSON.stringify({ w, s }));
      const q2 = await quiet();
      check("lang-phone: in Chinese (the name is the plate, the role the first line) the switch still sits on the role's baseline", quietOk(q2), JSON.stringify(q2));
      const hint2 = await page.evaluate(() => document.querySelector(".page .hint")?.textContent ?? "");
      check("lang-phone: …and the hint is 「滑动翻页，轻点明信片取出。」", hint2 === "滑动翻页，轻点明信片取出。", hint2);
      await shot(page, "lang-phone-zh");
      const L2 = await layout(page);
      check("lang-phone: in Chinese the header still fits (no overlap)", L2.overlaps.length === 0 && L2.offscreen.length === 0, L2.overlaps.join(" | "));
      await c.close();
      for (const vp of ["phone360", "landscape", "tablet"] as Vp[]) {
        const cv = await newCtx(browser, vp);
        const pv = await cv.newPage();
        await pv.goto(`${base}/#cards`);
        await ready(pv);
        await pv.waitForTimeout(2000);
        const Lv = await layout(pv);
        const has = await pv.evaluate(() => !!document.querySelector(".words > .lang a[aria-current]"));
        check(`lang-${vp}: the switch is in the words, one tap away, nothing overlaps`, has && Lv.overlaps.length === 0 && Lv.offscreen.length === 0, Lv.overlaps.slice(0, 3).join(" | "));
        if (vp === "phone360") {
          const hint = await pv.evaluate(() => document.querySelector(".page .hint")?.textContent ?? "");
          check("lang-phone360: the card album's hint speaks of cards", hint === "Swipe to turn. Tap a card to lift it.", hint);
        }
        await shot(pv, `lang-${vp}`);
        await cv.close();
      }
    }

    // the first language: ?lang= over the stored choice over English (never the browser's); ?sample=zh still works
    {
      const c = await newCtx(browser, "desktop", { locale: "zh-CN" });
      const page = await c.newPage();
      const first = async (url: string) => {
        await page.goto(`${base}${url}`);
        await page.waitForSelector(".words .toc", { timeout: 15000 });
        return page.evaluate(() => document.documentElement.lang);
      };
      // (each a new document: a hash-only change would not load the page again)
      const browserEn = await first("/?n=1#resume");
      await page.evaluate(() => localStorage.setItem("sasshi:lang", "zh"));
      const storedZh = await first("/?n=2#resume");
      await page.evaluate(() => localStorage.setItem("sasshi:lang", "en"));
      const urlZh = await first("/?lang=zh#resume");
      const sampleZh = await first("/?sample=zh#resume");
      const prefs = await page.evaluate(() => (document.querySelector(".prefs a.pw") as HTMLAnchorElement | null)?.getAttribute("href") ?? "");
      check("lang: a Chinese browser still opens in English; a stored 中文 picks it; ?lang=zh and ?sample=zh win over a stored English (links keep lang=zh)", browserEn === "en" && storedZh === "zh-CN" && urlZh === "zh-CN" && sampleZh === "zh-CN" && /lang=zh/.test(prefs), JSON.stringify({ browserEn, storedZh, urlZh, sampleZh, prefs }));
      await c.close();
      const ce = await newCtx(browser, "desktop");
      const pe = await ce.newPage();
      await pe.goto(`${base}/#resume`);
      await pe.waitForSelector(".words .toc");
      check("lang: an English browser with no choice gets the primary (English)", (await pe.evaluate(() => document.documentElement.lang)) === "en");
      await ce.close();
    }
  }

  /* ── sound: the toggle persists; the engines' cues reach the kit ── */
  if (want("sound")) {
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    await page.goto(`${base}/#cards`);
    await ready(page);
    const btn = page.locator("[data-testid='sound-toggle']");
    const a0 = await btn.getAttribute("aria-pressed");
    await btn.click();
    const a1 = await btn.getAttribute("aria-pressed");
    const stored = await page.evaluate(() => localStorage.getItem("sasshi:sound"));
    await page.reload();
    await ready(page);
    const a2 = await btn.getAttribute("aria-pressed");
    check("sound: Sound On|Off flips, persists across reload", a0 !== a1 && a1 === a2 && stored === (a1 === "true" ? "on" : "off"), `${a0} → ${a1} (stored ${stored}) → reload ${a2}`);
    if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
    await c.close();

    const ca = await newCtx(browser, "desktop", { audioSpy: true });
    const pa = await ca.newPage();
    await pa.goto(`${base}/?debug#cards`);
    await ready(pa);
    await pa.waitForTimeout(2200);
    const silent = await pa.evaluate(() => (window as unknown as { __voices: number }).__voices);
    check("sound: nothing plays before the first gesture", silent === 0, `${silent} voices`);
    await pa.mouse.click(700, 880);
    await pa.waitForTimeout(1500);
    const voices = () => pa.evaluate(() => (window as unknown as { __voices: number }).__voices);
    const v0a = await voices();
    await pa.click(".toc a[href='#postcards']");
    await pa.waitForFunction(() => location.hash === "#postcards", null, { timeout: 3000 }).catch(() => {});
    await ready(pa);
    await pa.waitForTimeout(2400);
    const v0 = await voices();
    check("sound: the booklet switch ticks", v0 > v0a, `${v0a} → ${v0} voices`);
    await pa.locator(".hands button.w[aria-label='Next page']").click();
    await pa.waitForTimeout(1600);
    const v1 = await voices();
    check("sound: a page turn plays (book onSound)", v1 > v0, `${v0} → ${v1}`);
    await pa.click(".toc a[href='#resume']");
    await pa.waitForFunction(() => location.hash === "#resume", null, { timeout: 3000 }).catch(() => {});
    await ready(pa);
    await pa.waitForTimeout(2600);
    const v2 = await voices();
    await word(pa, /^shake$/i).click();
    await pa.waitForTimeout(1600);
    const v3 = await voices();
    check("sound: Shake plays the shake and the knocks (pouch onSound / onImpact)", v3 - v2 >= 2, `${v2} → ${v3}`);
    await ca.close();
  }

  /* ── loading: daybreak — the desk and the words first, the line in the book box, then the booklet ── */
  if (want("loading")) {
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    const cdp = await c.newCDPSession(page);
    await page.goto(`${base}/#cards`);
    await ready(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024 });
    await page.goto(`${base}/#resume`);
    await page.waitForSelector(".words");
    await page.waitForTimeout(700);
    const early = await page.evaluate(() => {
      const d = document.querySelector(".dawn");
      const r = d?.getBoundingClientRect();
      const s = getComputedStyle(document.documentElement);
      const p = (k: string) => parseFloat(s.getPropertyValue(k));
      return { shown: !!d && !document.querySelector(".stage-host[data-ready]"), text: d?.textContent ?? "", cx: r ? r.left + r.width / 2 : 0, boxCx: p("--box-l") + p("--box-w") / 2, words: !!document.querySelector(".words .id-name") };
    });
    await shot(page, "loading-resume");
    check("loading: the words paint first; Opening the folio shows in the book box centre", early.shown && early.words && /Opening the folio/.test(early.text) && Math.abs(early.cx - early.boxCx) < 2, JSON.stringify(early));
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await ready(page, 60000);
    await page.waitForTimeout(1600);
    const done = await page.evaluate(() => ({ dawn: !!document.querySelector(".dawn"), day: getComputedStyle(document.querySelector(".room")!).getPropertyValue("--day").trim() }));
    const L = await layout(page);
    check("loading: the line leaves, the light is full, no layout shift", !done.dawn && Number(done.day) >= 0.99 && L.cls < 0.01, `${JSON.stringify(done)}, CLS ${L.cls.toFixed(4)}`);
    await c.close();
  }

  /* ── ?view=text and ?view=json ── */
  if (want("views")) {
    const c = await newCtx(browser, "desktop");
    const page = await c.newPage();
    await page.goto(`${base}/?view=text`);
    await page.waitForSelector(".sheetwrap .letter");
    const items = await page.locator(".letter .lt-items > li").count();
    const tv = await page.evaluate(() => ({ back: document.querySelector(".back")?.textContent?.trim(), hashira: document.querySelector(".hashira .jp")?.textContent, json: !!document.querySelector(".letter a[href$='view=json']"), note: !!document.querySelector(".lt-item[data-kind='note'] .lt-hand") }));
    check(`views: ?view=text lists the ${OBJECTS} objects (the note handwritten), no canvas, 本文 hashira, back link, JSON →`, items === OBJECTS && (await page.locator("canvas").count()) === 0 && tv.back === "← Back to the desk" && tv.hashira === "本文" && tv.json && tv.note, JSON.stringify({ items, ...tv }));
    const desc = await descenders(page, ".letter");
    check("views: the text version's rows keep their descenders", desc.bad.length === 0, desc.bad.slice(0, 2).join(" | "));
    // the kinds' local names (名刺 …) and the 和色 names: Japanese on an English page, each in its Japanese web face
    const ja = await renderedFonts(page, ".lt-kind, .lt-cj");
    const jaBad = ja.filter((r) => r.system || !r.fonts.some((f) => /^Shippori Mincho\[ShipporiMincho-Regular\]/.test(f)));
    check("views: 名刺 … and 月白 … in Shippori Mincho 400 (no system face, no SC face)", ja.length >= 6 && jaBad.length === 0, JSON.stringify(jaBad.slice(0, 3)));
    await shot(page, "view-text");
    await page.goto(`${base}/?view=json`);
    const txt = await page.locator(".letter.json pre").textContent();
    let ok = false;
    try {
      ok = (JSON.parse(txt ?? "") as { items: unknown[] }).items.length === OBJECTS;
    } catch {
      ok = false;
    }
    const mono = await page.evaluate(() => getComputedStyle(document.querySelector(".letter.json pre")!).fontFamily);
    check("views: ?view=json parses, in system mono only", ok && /^ui-monospace/.test(mono), mono);
    await shot(page, "view-json");
    await page.goto(`${base}/#resume`);
    const title = await page.title();
    const desc2 = await page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "");
    check("views: title + description from the profile", /—/.test(title) && desc2.length > 40, `"${title}" / ${desc2.slice(0, 60)}…`);
    await page.goto(`${base}/?sample=zh&view=text`);
    await page.waitForSelector(".sheetwrap .letter");
    const zt = await page.evaluate(() => ({ k: document.querySelector(".lt-k")?.textContent, back: document.querySelector(".back")?.textContent?.trim() }));
    check("views: the Chinese text version", zt.k === "简介" && zt.back === "← 回到桌面", JSON.stringify(zt));
    await c.close();
  }

  /* ── no WebGL: résumé → the printed version in the book box, albums → the flat book; details fall back to DOM objects ── */
  if (want("nogl")) {
    for (const mode of ["nogl"] as const) {
      const c = await newCtx(browser, "desktop", { noGl: true });
      const page = await c.newPage();
      await page.goto(`${base}/#resume`);
      await page.waitForSelector(".panel .letter", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      const st = await page.evaluate(() => {
        const panel = document.querySelector(".panel[data-fallback]")?.getBoundingClientRect();
        const s = getComputedStyle(document.documentElement);
        const p = (k: string) => parseFloat(s.getPropertyValue(k));
        return { letter: !!document.querySelector(".panel .letter"), handling: document.querySelector(".handling p")?.textContent ?? "", link: !!document.querySelector(".handling a[href*='view=text']"), inBox: !!panel && Math.abs(panel.left - p("--box-l")) < 1 && Math.abs(panel.width - p("--box-w")) < 1, canvases: document.querySelectorAll("canvas").length };
      });
      const line = /needs WebGL/;
      check(`${mode}: résumé shows the printed version in the book box, the line says why (with →)`, st.letter && st.inBox && st.canvases === 0 && line.test(st.handling) && st.link, JSON.stringify(st));
      // the fallback desk keeps a still window light under the printed version (r3 D2): no animation, nothing over the words
      const q = await calm(page);
      const still = await page.evaluate(() => !!document.querySelector(".desk .cast"));
      check(`${mode}: a still window light on the desk, under everything, nothing animating for ever`, still && q.room.every((r) => r.under) && q.blend.length === 0 && q.leaves.length === 0 && q.forever.length === 0, JSON.stringify({ still, ...q }));
      await shot(page, `${mode}-resume`);
      await page.locator(".panel .lt-item[data-kind='resume'] button").first().click();
      await page.waitForTimeout(800);
      const d = await detail(page);
      check(`${mode}: the résumé detail uses the DOM résumé`, !!d && d.flat && !d.paper && d.canvases === 0, JSON.stringify(d && { flat: d.flat, paper: d.paper, canvases: d.canvases }));
      await shot(page, `${mode}-detail-resume`);
      await closeDetail(page);
      for (const tab of ["cards", "postcards"] as Tab[]) {
        await page.click(`.toc a[href='#${tab}']`);
        await page.waitForFunction((t) => location.hash === `#${t}`, tab, { timeout: 3000 }).catch(() => {});
        await page.waitForSelector(".folio-book[data-mode='flat']", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(500);
        const flat = await page.locator(".folio-book[data-mode='flat']").count();
        const foot = await page.evaluate(() => [...document.querySelectorAll(".folio-foot, .folio-nav, .folio-loading")].filter((e) => getComputedStyle(e).display !== "none").length);
        const pager = await page.locator(".hands .ctl").innerText();
        check(`${mode}: ${tab} shows the flat book, driven by the page's own words`, flat === 1 && foot === 0 && (await page.locator(".folio-stage > canvas").count()) === 0 && /Close|Open/.test(pager), `${flat} flat, ${foot} book controls shown, "${pager.replace(/\n/g, " ")}"`);
        await shot(page, `${mode}-${tab}`);
      }
      await c.close();
    }
    /* ── reduced motion keeps the 3D: the folio opens at once (no swing), the détail is the paper viewer, the albums are books ── */
    {
      const c = await newCtx(browser, "desktop", { reducedMotion: true });
      const page = await c.newPage();
      await page.goto(`${base}/?debug#resume`);
      // the openness through the arrival, sampled until it is open (or 8 s)
      const seen = await page.evaluate(async () => {
        const out: number[] = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 8000) {
          const v = (window as unknown as { __folio?: { book(): { debug: { state(): { cover: number } } } | null } }).__folio?.book()?.debug.state().cover;
          if (typeof v === "number") out.push(Math.round(v * 1000) / 1000);
          if (v === 1) break;
          await new Promise((r) => setTimeout(r, 16));
        }
        return out;
      });
      const between = seen.filter((v) => v > 0.02 && v < 0.98);
      check("reduced: the résumé is the 3D folio, opened at once (no swing)", seen.at(-1) === 1 && between.length === 0 && (await page.locator(".panel .letter").count()) === 0, `${seen.length} samples, last ${seen.at(-1)}, ${between.length} in between`);
      await page.waitForTimeout(800);
      await shot(page, "reduced-resume");
      await page.locator(".pouch-index li:nth-child(2) button").evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector("dialog.lb[open]", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const d = await detail(page);
      check("reduced: the résumé detail is the paper viewer", !!d && d.paper && !d.flat, JSON.stringify(d && { flat: d.flat, paper: d.paper, canvases: d.canvases }));
      await closeDetail(page);
      await page.click(".toc a[href='#cards']");
      await page.waitForSelector(".folio-stage > canvas", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      check("reduced: the card album is the 3D book", (await page.locator(".folio-stage > canvas").count()) === 1 && (await page.locator(".folio-book[data-mode='flat']").count()) === 0);
      await c.close();
    }
    /* ── the résumé paper zooms with the wheel: the canvas covers just the host while zoomed, and what it did at rest after ── */
    {
      const c = await newCtx(browser, "desktop");
      const page = await c.newPage();
      await page.goto(`${base}/#resume`);
      await page.waitForSelector(".pouch-index li:nth-child(2) button", { state: "attached", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(4000);
      await page.locator(".pouch-index li:nth-child(2) button").evaluate((b) => (b as HTMLButtonElement).click());
      await page.waitForSelector(".paper-host[data-ready]", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const box = () => page.evaluate(() => { const h = document.querySelector(".paper-host")!.getBoundingClientRect(); const v = document.querySelector(".paper-host canvas")!.getBoundingClientRect(); return { host: [h.left, h.top, h.width, h.height].map(Math.round), canvas: [v.left, v.top, v.width, v.height].map(Math.round) }; });
      const rest = await box();
      const h = rest.host;
      await page.mouse.move(h[0]! + h[2]! * 0.3, h[1]! + h[3]! * 0.3);
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
      await page.waitForTimeout(900);
      const zoomed = await box();
      for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(30); }
      await page.waitForTimeout(900);
      const back = await box();
      check("zoom: the wheel zooms the résumé, its canvas covers just the host, and rests again after", zoomed.canvas.join() === h.join() && rest.canvas.join() !== h.join() && back.canvas.join() === rest.canvas.join(), JSON.stringify({ rest, zoomed: zoomed.canvas, back: back.canvas }));
      await c.close();
    }
  }
} finally {
  await browser.close();
}

check("no console errors, page errors or failed requests", errors.length === 0, errors.slice(0, 6).join(" | "));
const failed = results.filter((r) => !r.ok);
if (pendings.length) console.log(`\n${pendings.length} pending on other areas:\n  ${pendings.join("\n  ")}`);
console.log(`\n${results.length - failed.length}/${results.length} passed${pendings.length ? `, ${pendings.length} pending` : ""}; ${shots.length} screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
