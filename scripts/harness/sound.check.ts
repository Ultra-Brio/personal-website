/*
 * Headless check of the recorded sound kit, on the audition page (scripts/harness/sound.html). Never opens a window.
 *   # from the repo root: bunx vite --port 5252 --host 127.0.0.1 --strictPort &
 *   bun scripts/harness/sound.check.ts <outDir> [--base http://127.0.0.1:5252]
 *
 * Asserts: every file in the manifest decodes in Chrome, starts where it should (no decoder priming left in playback) and
 * is as long as the manifest says; the audition engine and the shipped kit play every slot without a console error; levels
 * through the real engine stay inside the budget (single sounds under -12 dBFS peak at centre, ticks well under page turns,
 * stress bursts under -1 dBFS). Saves the page and one waveform PNG per slot, plus levels.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const bi = args.indexOf("--base");
const base = bi >= 0 ? args[bi + 1]! : "http://127.0.0.1:5252";
const out = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base") ?? "./sound-out";
mkdirSync(join(out, "png"), { recursive: true });

type Audition = {
  ready: Promise<void>;
  start(): Promise<void>;
  decodeReport(): { key: string; file: string; ok: boolean; offsetMs: number; durationMs: number; bufferMs: number; leadMs: number; manifestMs: number; peakDb: number }[];
  playEverything(): Promise<{ key: string; file: string | null }[]>;
  renderOffline(): Promise<{ levels: { name: string; peakDb: number; rmsDb: number; audibleMs: number }[]; bursts: { name: string; peakDb: number; rmsDb: number; audibleMs: number }[] }>;
  makeKit(): boolean;
  kitPlayAll(): void;
};
type W = { __audition: Audition; __voices: number };

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const fails: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok) fails.push(msg);
};
try {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    // Count the voices anything on the page starts (every voice is one buffer source).
    await ctx.addInitScript(() => {
      const w = window as unknown as { __voices: number };
      w.__voices = 0;
      const orig = BaseAudioContext.prototype.createBufferSource;
      BaseAudioContext.prototype.createBufferSource = function (this: BaseAudioContext) {
        w.__voices++;
        return orig.call(this);
      };
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/scripts/harness/sound.html`);
    await page.evaluate(() => (window as unknown as W).__audition.ready);
    if (scheme === "dark") {
      await page.click("#start");
      await page.waitForSelector("html[data-loaded]", { state: "attached", timeout: 20000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(out, "audition-dark.png"), fullPage: true, scale: "css" });
      check(errors.length === 0, `dark: ${errors.slice(0, 3).join(" | ")}`);
      await ctx.close();
      continue;
    }

    // 1. the shipped kit, as the app uses it: created first, unlocked by a real click, then every sound and contact
    const kitMuted = await page.evaluate(() => (window as unknown as W).__audition.makeKit());
    check(!kitMuted, "kit starts muted on a fine pointer");
    await page.mouse.click(4, 4);
    await page.waitForTimeout(1200);
    const v0 = await page.evaluate(() => (window as unknown as W).__voices);
    await page.mouse.click(4, 4);
    await page.evaluate(() => (window as unknown as W).__audition.kitPlayAll());
    const v1 = await page.evaluate(() => (window as unknown as W).__voices);
    // 12 sounds (keyJingle has no recordings) and at least one contact per material bank
    check(v1 - v0 >= 14, `kit: played ${v1 - v0} voices for 12 sounds and 15 contacts`);

    // 2. the audition engine: decode report, then every slot
    await page.click("#start");
    await page.waitForSelector("html[data-loaded]", { state: "attached", timeout: 20000 });
    const rows = await page.evaluate(() => (window as unknown as W).__audition.decodeReport());
    for (const r of rows) {
      check(r.ok, `${r.file}: did not decode`);
      // Playback starts at the sound (its file's silent lead skipped, give or take the encoder's 1 ms of pre-echo and a long
      // fade-in's first inaudible samples), every sample of it decoded, and it ends within one AAC frame (23 ms) of its own end:
      // codec noise at -80 dB may trail it, a long fade-out's last inaudible samples may be cut.
      check(r.offsetMs >= r.leadMs - 2 && r.offsetMs <= r.leadMs + 5, `${r.file}: playback starts ${r.offsetMs.toFixed(1)} ms into the buffer, the sound at ${r.leadMs.toFixed(1)}`);
      check(r.bufferMs >= r.leadMs + r.manifestMs - 1, `${r.file}: decoded ${r.bufferMs.toFixed(1)} ms, shorter than lead + sound`);
      check(Math.abs(r.durationMs - r.manifestMs) <= 25, `${r.file}: plays ${r.durationMs.toFixed(1)} ms of ${r.manifestMs.toFixed(1)}`);
      check(r.peakDb > -2 && r.peakDb < 0, `${r.file}: decoded peak ${r.peakDb.toFixed(1)} dBFS (expected about -1)`);
    }
    const played = await page.evaluate(() => (window as unknown as W).__audition.playEverything());
    for (const p of played) check(p.file !== null, `audition: ${p.key} played nothing`);
    await page.waitForTimeout(400);
    // the picked takes are outlined
    check((await page.locator(".tile.picked").count()) >= played.length, "audition: picked takes are not outlined");

    // 3. levels through the real engine (offline, settled, centred, default volume)
    const { levels, bursts } = await page.evaluate(() => (window as unknown as W).__audition.renderOffline());
    const by = (n: string) => levels.find((l) => l.name === n)!;
    for (const l of levels) {
      check(l.peakDb < -12, `${l.name}: peak ${l.peakDb.toFixed(1)} dBFS at centre (budget -12; a hard pan adds 3)`);
      check(l.rmsDb < -28, `${l.name}: RMS ${l.rmsDb.toFixed(1)} dBFS (budget -28)`);
    }
    for (const n of ["tab", "copy"]) check(by(n).rmsDb <= by("pageTurn").rmsDb - 8, `${n}: not well under the page turn (${by(n).rmsDb.toFixed(1)} vs ${by("pageTurn").rmsDb.toFixed(1)})`);
    for (const n of ["tab", "copy"]) check(by(n).audibleMs < (n === "tab" ? 70 : 200), `${n}: ${by(n).audibleMs.toFixed(0)} ms`);
    check(by("pageTurn").audibleMs >= 250 && by("pageTurn").audibleMs <= 2600, `pageTurn row: ${by("pageTurn").audibleMs.toFixed(0)} ms`);
    for (const b of bursts) check(b.peakDb < -1, `${b.name}: peak ${b.peakDb.toFixed(1)} dBFS`);
    writeFileSync(join(out, "levels.json"), JSON.stringify({ decode: rows, levels, bursts, played }, null, 1));
    console.log(levels.map((l) => `${l.name.padEnd(20)} peak ${l.peakDb.toFixed(1).padStart(6)}  rms ${l.rmsDb.toFixed(1).padStart(6)}`).join("\n"));
    console.log(bursts.map((l) => `${l.name.padEnd(20)} peak ${l.peakDb.toFixed(1).padStart(6)}  rms ${l.rmsDb.toFixed(1).padStart(6)}`).join("\n"));
    const lead = rows.map((r) => r.offsetMs - r.leadMs);
    console.log(`decoded ${rows.filter((r) => r.ok).length}/${rows.length}; playback starts ${Math.min(...lead).toFixed(2)} to ${Math.max(...lead).toFixed(2)} ms from the sound's own start`);

    // 4. pictures: the whole page, and one waveform strip per slot
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(out, "audition-light.png"), fullPage: true, scale: "css" });
    for (const id of await page.$$eval(".slot", (els) => els.map((e) => e.id))) await page.locator(`[id="${id}"]`).screenshot({ path: join(out, "png", `${id.replace(/^slot-/, "")}.png`) });
    check(errors.length === 0, `console: ${errors.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\nFAIL (${fails.length}):\n  ${fails.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nPASS: sound kit -> ${out}`);
