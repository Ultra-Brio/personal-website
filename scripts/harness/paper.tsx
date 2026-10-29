/*
 * Paper viewer harness: /scripts/harness/paper.html?item=resume|card[&sample=zh][&open=1][&hud=0][&host=WxH][&top=Y][&bg=veil|desk][&long=1]
 *  - host=WxH sizes the viewer's host box (centred), like the detail view's object area; default fills the window. top=Y places it Y
 *    px from the top instead of centring it vertically (the phone detail view).
 *  - bg=veil paints the detail view's veil colour behind the host (the desk under the frosted veil), bg=desk the plain desk.
 *  - sample=zh: the Simplified Chinese sample (lang zh-CN); open=1: the card opens (next()) once it is up.
 * Exposes window.__paper for headless runs: manual(true) stops the loop, advance(dt) steps physics + camera and renders one frame;
 * sounds: the onSound cues ({ f: frames advanced so far, t: ms, name, gain?, pan? }).
 * setLang("en" | "zh"): the same item in the other sample's language, in place (PaperViewer.setContent; sets <html lang> first, as the
 * app does). maxPx=N: PaperViewerOptions.maxPxPerMm.
 */
import { createPaperViewer, type PaperViewer } from "../../src/paper";
import { profile as sampleEn } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";
import type { BusinessCardItem, Profile, ResumeItem } from "../../src/profile/schema";

declare global {
  interface Window {
    __paper?: {
      ready: boolean;
      error?: string;
      viewer?: PaperViewer;
      manual(on: boolean): void;
      advance(dt: number, frames?: number): void;
      stats(): { frameMax: number; max: number; progress: number[] };
      frames: number;
      sounds: { f: number; t: number; name: string; gain?: number; pan?: number }[];
      setLang(lang: "en" | "zh"): Promise<boolean>;
    };
  }
}

const q = new URLSearchParams(location.search);
const kind = q.get("item") === "card" ? "card" : "resume";
const sample = q.get("sample") === "zh" ? sampleZh : sampleEn;
// a Chinese page, as the app marks it (src/fonts registers the 500 sans file for Chinese pages only)
if (sample.lang) document.documentElement.lang = sample.lang;
const bg = q.get("bg");
if (bg === "scrim" || bg === "veil" || bg === "desk") document.documentElement.dataset.bg = bg;
const hud = document.getElementById("hud")!;
if (q.get("hud") === "0") hud.hidden = true;
const host = document.getElementById("host")!;
const box = /^(\d+)x(\d+)$/.exec(q.get("host") ?? "");
if (box) {
  const top = q.get("top");
  Object.assign(host.style, { inset: "auto", left: "50%", top: top ? `${top}px` : "50%", width: `${box[1]}px`, height: `${box[2]}px`, translate: top ? "-50% 0" : "-50% -50%" });
  if (q.get("outline") === "1") host.style.outline = "1px dashed rgb(255 0 0 / .5)";
}

/** long=1: a longer résumé (harness only), so a wide host has more than one spread to turn */
const itemOf = (p: Profile): ResumeItem | BusinessCardItem => {
  const found = p.items.find((i) => i.kind === kind) as ResumeItem | BusinessCardItem;
  return found.kind === "resume" && q.get("long") === "1"
    ? {
        ...found,
        experience: [
          ...found.experience,
          ...found.experience.map((e, i) => ({ ...e, org: `${e.org} (${["Berlin", "Tokyo", "Lisbon"][i % 3]})`, from: String(Number(e.from) - 6), to: String(Number(e.from) - 2) })),
          ...found.experience.map((e) => ({ ...e, org: `${e.org} Labs`, bullets: [...e.bullets, ...e.bullets] })),
        ],
      }
    : found;
};
const item = itemOf(sample);
const ownerOf = (p: Profile) => ({ name: p.name, ...(p.nameLocal ? { nameLocal: p.nameLocal } : {}), role: p.role, ...(p.location ? { location: p.location } : {}), ...(p.handle ? { handle: p.handle } : {}), links: p.links });
const api: NonNullable<Window["__paper"]> = {
  ready: false,
  manual: (on) => api.viewer?.debug.manual(on),
  advance: (dt, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      api.frames++;
      api.viewer?.debug.advance(dt);
    }
  },
  stats: () => api.viewer?.debug.stats() ?? { frameMax: 0, max: 0, progress: [] },
  frames: 0,
  sounds: [],
  setLang(lang) {
    const p = lang === "zh" ? sampleZh : sampleEn;
    document.documentElement.lang = p.lang ?? "en";
    return api.viewer?.setContent({ item: itemOf(p), owner: ownerOf(p), ...(p.lang ? { lang: p.lang } : {}) }) ?? Promise.resolve(false);
  },
};
window.__paper = api;

createPaperViewer(host, {
  item,
  ...(sample.lang ? { lang: sample.lang } : {}),
  owner: ownerOf(sample),
  ...(q.get("maxPx") ? { maxPxPerMm: Number(q.get("maxPx")) } : {}),
  onChange: (s) => {
    hud.textContent = kind === "resume" ? `page ${s.page + 1} / ${s.count}` : s.page ? "open" : "closed";
  },
  onSound: (name, o) => api.sounds.push({ f: api.frames, t: performance.now(), name, ...o }),
})
  .then((v) => {
    api.viewer = v;
    if (q.get("open") === "1") v.next();
    api.ready = true;
    v.debug.renderer.domElement.focus({ preventScroll: true });
  })
  .catch((e: unknown) => {
    api.error = String(e);
    api.ready = true;
    const fb = document.createElement("div");
    fb.id = "fallback";
    fb.textContent = `3D unavailable (${String(e)}): the dialog would show its DOM version here.`;
    document.body.appendChild(fb);
  });
