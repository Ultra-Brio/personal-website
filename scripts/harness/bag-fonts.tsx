/*
 * Font check for src/fonts: every role × Han language, painted to a canvas after ensureFonts() with the exact strings, and the same
 * strings in the DOM with stack(). window.__stats lists the woff2 files the page fetched (so a run only pulls the slices it needs),
 * and the canvas ascent / descent of each role and Han language (the typesetter's metrics).
 *   ?only=en   only the English sample's strings (checks the first-paint budget: no SC slice beyond 林文)
 */
import { canvasFont, ensureFonts, hanLangOf, stack, type FontRun, type Role } from "../../src/fonts";

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: Record<string, unknown>;
  }
}

const q = new URLSearchParams(location.search);
const LINES: { text: string; lang?: string }[] =
  q.get("only") === "en"
    ? [{ text: "Lin Wen — isn’t “quoted” 林文", lang: "en" }]
    : [
        { text: "Lin Wen — isn’t “quoted” · 2024 林文", lang: "en" },
        { text: "雪の龍安寺 · Ryōan-ji", lang: "en" },
        { text: "设计工程师，简历「会动的纸」：140 ms → 38 ms。", lang: "zh-CN" },
        { text: "履歴書 カード帖 一筆箋", lang: "ja" },
        { text: "郵便はがき 林文之印", lang: "en" },
      ];
const ROLES: [Role, number][] = [
  ["serif", 500],
  ["sans", 400],
  ["hand", 600],
];

const runs: FontRun[] = [];
for (const l of LINES) for (const [role, weight] of ROLES) runs.push({ role, weight, text: l.text, han: hanLangOf(l.text, l.lang) });
const t0 = performance.now();
await ensureFonts(runs);
const ms = Math.round(performance.now() - t0);

const W = 1100;
const c = document.createElement("canvas");
const dpr = window.devicePixelRatio || 1;
c.width = W * dpr;
c.height = LINES.length * ROLES.length * 44 * dpr + 20 * dpr;
c.style.width = `${W}px`;
document.body.appendChild(c);
const g = c.getContext("2d")!;
g.scale(dpr, dpr);
g.fillStyle = "#f8f9f7";
g.fillRect(0, 0, W, c.height);
g.fillStyle = "#1c232b";
let y = 34;
const metrics: Record<string, string> = {};
for (const l of LINES)
  for (const [role, weight] of ROLES) {
    const han = hanLangOf(l.text, l.lang);
    g.font = canvasFont(role, weight, 26, han);
    g.fillText(`${role}/${han}: ${l.text}`, 16, y);
    const m = g.measureText("Hg林");
    metrics[`${role}/${han}`] = `${(m.fontBoundingBoxAscent / 26).toFixed(3)} ${(m.fontBoundingBoxDescent / 26).toFixed(3)}`;
    y += 44;
  }
for (const l of LINES) {
  const p = document.createElement("p");
  p.textContent = l.text;
  p.style.fontFamily = stack("serif", hanLangOf(l.text, l.lang));
  document.body.appendChild(p);
}
const files = performance
  .getEntriesByType("resource")
  .filter((e) => /\.woff2/.test(e.name))
  .map((e) => {
    const r = e as PerformanceResourceTiming;
    return `${decodeURIComponent(r.name.split("/").pop() ?? "").replace(/\?.*$/, "")} ${Math.round((r.encodedBodySize || r.transferSize) / 1024)}K`;
  });
window.__stats = { ms, files, metrics };
window.__ready = true;
