import type { CoverColor, CoverMaterial } from "../../src/book/cover";
import { COVER_HEX } from "../../src/book/cover-style";
import { drawFolioLiner, linerFontRuns, linerLookFor, type LinerSpec } from "../../src/book/liner";
import { drawLiner, type LinerSlip } from "../../src/book/textures";
import { ensureFonts } from "../../src/fonts";
import { profile as sample } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";
import { photo } from "./folio.photo";

/*
 * Liner proofs (2D, no three): the résumé folio's printed liner (unryū endpaper, 蔵書票 bookplate, 藍 seal) for the booklet cases and
 * for an English and a Simplified Chinese profile, then the albums' inside boards with their 題簽 slip — at about their on-screen size
 * and at full texture resolution, in the src/fonts faces (loaded for the exact strings first). ?full=1 shows the full-resolution
 * canvases; ?portrait=1 adds a tipped-in photo; ?height=1 adds the height maps. Sets window.__ready when painted.
 */

const q = new URLSearchParams(location.search);
const specOf = (p: typeof sample, withPhoto: boolean): LinerSpec => ({
  title: p.name,
  ...(p.nameLocal && { subtitle: p.nameLocal }),
  role: p.role,
  place: p.location,
  ...(p.lang && { lang: p.lang }),
  ...(withPhoto && { portrait: { src: "x" } }),
});
const withPhoto = q.get("portrait") === "1";
const cases: [CoverMaterial, CoverColor, LinerSpec][] = [
  ["leather", "aitetsu", specOf(sample, withPhoto)],
  ["cloth", "ginnezu", specOf(sample, withPhoto)],
  ["frost", "aitetsu", specOf(sample, withPhoto)],
  ["leather", "aitetsu", specOf(sampleZh, withPhoto)],
];
const slips: [CoverColor, LinerSlip][] = [
  ["ginnezu", { title: "絵葉書", han: "ja" }],
  ["seiji", { title: "カード帖", han: "ja" }],
  ["ginnezu", { title: "明信片", han: "zh-Hans" }],
  ["seiji", { title: "卡册", han: "zh-Hans" }],
];
await ensureFonts([...cases.flatMap(([, , s]) => linerFontRuns(s)), ...slips.map(([, s]) => ({ role: "serif" as const, weight: 500, text: s.title, han: s.han }))]);

const root = document.getElementById("root")!;
const full = q.get("full") === "1";
const fig = (label: string, ...canvases: HTMLCanvasElement[]) => {
  const f = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  if (!full)
    for (const c of canvases) {
      c.style.width = "420px";
      c.style.height = "auto";
    }
  f.append(cap, ...canvases);
  root.append(f);
};
const t0 = performance.now();
for (const [m, col, spec] of cases) {
  const wMm = m === "frost" ? 248 : 255;
  const hMm = m === "frost" ? 338 : 345;
  const { color, height } = drawFolioLiner(1536, wMm, hMm, linerLookFor(m, col), spec, withPhoto ? photo() : null);
  fig(`${m} · ${col} · ${spec.lang ?? "en"}`, color, ...(q.get("height") === "1" ? [height] : []));
}
console.log("liner ms", Math.round((performance.now() - t0) / cases.length));
for (const [col, slip] of slips) fig(`slip · ${col} · ${slip.title}`, drawLiner(1024, 255, 345, COVER_HEX[col].liner, slip));
(window as unknown as { __ready: boolean }).__ready = true;
