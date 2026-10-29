/*
 * Headless proof of the shell's stage contract (src/app) without any WebGL: the stub stages of app-fallback.html.
 *   bun scripts/harness/app-shots.ts http://127.0.0.1:5191 [outDir]
 * Serves nothing itself: start `vite` first. Headless Chrome only (channel "chrome"), never a visible window. The full page with
 * the real 3D stages is checked by e2e.ts.
 *   - cards: a stub stage that picks a card → the shell opens the card's detail view
 *   - postcards: a stub stage that reports onUnsupported → the printed version in the book box, the no-WebGL line
 *   - résumé: a stub stage that throws while rendering → the boundary falls back to the printed version
 *   - ?stages=none: no stages at all → every booklet shows the printed version; ?pdf=1: the résumé detail offers the PDF
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? "http://127.0.0.1:5191").replace(/\/$/, "");
const out = args.find((a) => a.startsWith("/")) ?? join(tmpdir(), "sasshi-app");
mkdirSync(out, { recursive: true });

const results: { name: string; ok: boolean; note?: string }[] = [];
function check(name: string, ok: boolean, note?: string) {
  results.push({ name, ok, ...(note ? { note } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
}
const pageErrors: string[] = [];
const page0 = "/scripts/harness/app-fallback.html";

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
async function open(path: string): Promise<Page> {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  // the throwing stub logs its error on purpose: only unexpected page errors count
  p.on("pageerror", (e) => !/stub stage exploded/.test(e.message) && pageErrors.push(e.message.slice(0, 200)));
  await p.goto(base + path);
  await p.waitForSelector(".words", { timeout: 15000 });
  await p.waitForTimeout(600);
  return p;
}
const printed = (p: Page) =>
  p.evaluate(() => ({
    letter: !!document.querySelector(".panel[data-fallback] .letter"),
    line: document.querySelector(".handling p")?.textContent ?? "",
    canvases: document.querySelectorAll("canvas").length,
  }));

try {
  // cards: the stub picks a card, the shell opens its detail
  let p = await open(`${page0}#cards`);
  await p.locator("button", { hasText: "stub: pick card" }).click();
  await p.waitForSelector("dialog.lb[open]", { timeout: 3000 }).catch(() => {});
  const d = await p.evaluate(() => ({ kind: document.querySelector("dialog.lb[open]")?.getAttribute("data-kind"), title: document.querySelector("dialog.lb[open] .cap-title")?.textContent }));
  check("contract: onPickCard opens the card's detail", d.kind === "cards" && !!d.title, JSON.stringify(d));
  await p.screenshot({ path: join(out, "contract-cards-detail.png") });
  await p.context().close();

  // postcards: onUnsupported → the printed version in the box
  p = await open(`${page0}#postcards`);
  const u = await printed(p);
  check("contract: onUnsupported shows the printed version and says why", u.letter && /WebGL/.test(u.line), JSON.stringify(u));
  await p.screenshot({ path: join(out, "contract-unsupported.png") });
  await p.context().close();

  // résumé: a stage that throws → the boundary → the printed version
  p = await open(`${page0}#resume`);
  const t = await printed(p);
  check("contract: a stage that throws falls back to the printed version", t.letter, JSON.stringify(t));
  await p.context().close();

  // no stages at all, and a résumé with a PDF
  p = await open(`${page0}?stages=none&pdf=1#resume`);
  const n = await printed(p);
  check("contract: ?stages=none shows the printed version", n.letter && n.canvases === 0, JSON.stringify(n));
  await p.locator(".panel .lt-item[data-kind='resume'] button").first().click();
  await p.waitForTimeout(700);
  const pdf = await p.evaluate(() => [...document.querySelectorAll("dialog.lb[open] .lb-act-rows a")].map((a) => ({ text: a.textContent, href: a.getAttribute("href"), download: a.hasAttribute("download") })));
  check("contract: the résumé detail offers PDF Download ↓ and Read as text →", pdf.some((x) => x.download && x.href === "/resume.pdf") && pdf.some((x) => /Read as text/.test(x.text ?? "")), JSON.stringify(pdf));
  await p.screenshot({ path: join(out, "contract-resume-pdf.png") });
  await p.context().close();
} finally {
  await browser.close();
}

check("no unexpected page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
