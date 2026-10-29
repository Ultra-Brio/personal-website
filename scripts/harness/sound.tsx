/*
 * Sound audition page (scripts/harness/sound.html): every slot of the kit with every recorded variant, played through the
 * real engine (src/sound/engine.ts) on a live AudioContext. "Play" lets the engine choose like the app does (the chosen
 * take gets outlined); a waveform plays that exact take; the contact section has the speed slider the pouch drives.
 *
 * For scripts/harness/sound.check.ts (headless) it also exposes window.__audition: start(), decodeReport(),
 * playEverything(), renderOffline() and makeKit()/kitPlayAll() to drive the shipped kit itself.
 */

import { createSoundKit, type SoundKit } from "../../src/sound";
import { impactKey, loadBank, SOUND_NAMES, TIERS, tierOf, type Bank, type Clip, type ImpactBank, type SoundName, type Tier } from "../../src/sound/bank";
import { createEngine, mulberry32, WARMUP, type Engine } from "../../src/sound/engine";
import { impactAmount, impactLevel, MAX_SPEED, MIN_SPEED, type Material } from "../../src/sound/gate";

const BASE = `${import.meta.env.BASE_URL}sounds/`;

type Meta = { file: string; gainDb: number; lead: number; duration: number; bytes: number; peakDb: number; m50Db: number; centroid: number; src: string; note: string };
type FullManifest = { totalBytes: number; sounds: Partial<Record<SoundName, Meta[]>>; impacts: Record<ImpactBank, Record<Tier, Meta[]>> };

const GROUPS: { title: string; slots: [SoundName, string][] }[] = [
  {
    title: "Binders",
    slots: [
      ["pageTurn", "A sleeve page starts to turn: a click, a key, or a drag past 9°."],
      ["pageLand", "That page settling flat on the stack, in the frame its edge lands."],
      ["coverOpen", "The leather board leaving the stack."],
      ["coverClose", "The board falling shut onto the pages."],
    ],
  },
  {
    title: "Pouch",
    slots: [
      ["zip", "The clear pouch's zip."],
      ["pickUp", "Lifting a card off the film."],
      ["drop", "Letting it go onto the film."],
      ["shake", "Shaking the pouch."],
    ],
  },
  {
    title: "Paper",
    slots: [
      ["cardUnfold", "Opening the folded business card."],
      ["paperRustle", "Dragging a résumé sheet."],
    ],
  },
  {
    title: "Interface",
    slots: [
      ["tab", "Switching tabs, and the sound toggle itself."],
      ["copy", "Copying an address."],
    ],
  },
];
const TIER_SPEED: Record<Tier, number> = { soft: 0.3, medium: 0.9, hard: 2.2 };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmtDb = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} dB`;

let manifest: FullManifest | null = null;
let ac: AudioContext | null = null;
let bank: Bank | null = null;
let engine: Engine | null = null;
let forced: Clip | null = null;
/** key -> file -> tile */
const tiles = new Map<string, Map<string, HTMLButtonElement>>();
/** key -> longest take in the slot (s), so a slot's waveforms share one time scale */
const spans = new Map<string, number>();

function mark(clip: Clip | null) {
  if (!clip) return;
  for (const [file, t] of tiles.get(clip.key) ?? []) t.classList.toggle("picked", file === clip.file);
}

function drawWave(canvas: HTMLCanvasElement, clip: Clip | null, span: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, w, h);
  g.fillStyle = css.getPropertyValue("--wave-dim").trim();
  g.fillRect(0, Math.floor(h / 2), w, Math.max(1, Math.round(dpr / 2)));
  if (!clip) return;
  const x = clip.buffer.getChannelData(0);
  const sr = clip.buffer.sampleRate;
  const a = Math.round(clip.offset * sr);
  const n = Math.round(clip.duration * sr);
  const cols = Math.max(1, Math.round((w * clip.duration) / span));
  g.fillStyle = css.getPropertyValue("--wave").trim();
  for (let c = 0; c < cols; c++) {
    let lo = 0;
    let hi = 0;
    const s0 = a + Math.floor((c * n) / cols);
    const s1 = a + Math.floor(((c + 1) * n) / cols);
    for (let i = s0; i < s1; i++) {
      const v = x[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Square-root scale: quiet tails stay visible next to the transient.
    const y0 = h / 2 - Math.sqrt(hi) * (h / 2 - 1);
    const y1 = h / 2 + Math.sqrt(-lo) * (h / 2 - 1);
    g.fillRect(c, y0, 1, Math.max(1, y1 - y0));
  }
}

function tile(key: string, m: Meta, i: number, onPlay: () => void): HTMLButtonElement {
  const t = el("button", "tile");
  t.type = "button";
  t.title = `${m.file}\n${m.src}\n${m.note}`;
  t.dataset.file = m.file;
  const c = el("canvas");
  const meta = el("div", "meta");
  meta.append(el("b", undefined, `${i + 1}`), el("span", undefined, `${Math.round(m.duration * 1000)} ms`), el("span", undefined, fmtDb(m.gainDb)));
  t.append(c, meta, el("div", "note", m.note));
  t.addEventListener("click", onPlay);
  let row = tiles.get(key);
  if (!row) tiles.set(key, (row = new Map()));
  row.set(m.file, t);
  spans.set(key, Math.max(spans.get(key) ?? 0, m.duration));
  return t;
}

function slotRow(id: string, name: string, desc: string, metas: Meta[], onPlay: (() => void) | null, onTile: (i: number) => void, key: string) {
  const row = el("div", "slot");
  row.id = `slot-${id}`;
  const head = el("div", "slot-head");
  head.append(el("span", "slot-name", name), el("span", "slot-desc", desc));
  if (onPlay) {
    const b = el("button", "play", "Play");
    b.type = "button";
    b.addEventListener("click", onPlay);
    head.append(b);
  }
  const grid = el("div", "tiles");
  metas.forEach((m, i) => grid.append(tile(key, m, i, () => onTile(i))));
  row.append(head, grid);
  return row;
}

/** Play a slot the way the app does, or one exact take of it. */
function playSound(name: SoundName, take?: Meta) {
  if (!engine || !bank) return null;
  forced = take ? (bank.clips(name).find((c) => c.file === take.file) ?? null) : null;
  const clip = engine.play(name);
  forced = null;
  mark(clip);
  return clip;
}

function playImpact(material: Material, speed: number, take?: { key: string; file: string }) {
  if (!engine || !bank) return null;
  forced = take ? (bank.clips(take.key).find((c) => c.file === take.file) ?? null) : null;
  const clip = engine.impact(speed, material, 0);
  forced = null;
  mark(clip);
  return clip;
}

function build(m: FullManifest) {
  const root = $("#slots");
  const files = [...Object.values(m.sounds).flat(), ...Object.values(m.impacts).flatMap((t) => Object.values(t).flat())];
  $("#stats").innerHTML = `${files.length} recordings · ${(m.totalBytes / 1024).toFixed(0)} KB<br />AAC · mono · 44.1 kHz`;
  for (const g of GROUPS) {
    const sec = el("section");
    sec.append(el("h2", undefined, g.title));
    for (const [name, desc] of g.slots) {
      const metas = m.sounds[name] ?? [];
      sec.append(
        slotRow(
          name,
          name,
          desc,
          metas,
          () => playSound(name),
          (i) => playSound(name, metas[i]),
          name,
        ),
      );
    }
    root.append(sec);
  }
  // Contacts: the speed slider drives the gate (level) and the tier (which takes).
  const sec = el("section");
  sec.append(el("h2", undefined, "Contacts in the pouch"));
  const controls = el("div", "impact-controls");
  const label = el("label", undefined, "Speed");
  const range = el("input");
  range.type = "range";
  range.min = String(MIN_SPEED);
  range.max = String(MAX_SPEED);
  range.step = "0.01";
  range.value = "1.2";
  range.id = "speed";
  const readout = el("span", "readout");
  const update = () => {
    const s = Number(range.value);
    readout.textContent = `${s.toFixed(2)} m/s · ${fmtDb(20 * Math.log10(impactLevel(s)))} · ${tierOf(impactAmount(s))}`;
  };
  range.addEventListener("input", update);
  update();
  label.append(range);
  const tap = (mat: Material) => {
    const b = el("button", "play", `Tap ${mat}`);
    b.type = "button";
    b.addEventListener("click", () => playImpact(mat, Number(range.value)));
    return b;
  };
  const cluster = el("button", "play", "Cluster");
  cluster.type = "button";
  cluster.addEventListener("click", () => {
    if (!ac || !engine) return;
    const s = Number(range.value);
    const t = ac.currentTime + 0.01;
    // what a shaken pouch sends: alternating materials, decaying speeds, 40-90 ms apart
    [0, 0.05, 0.09, 0.16, 0.22, 0.31].forEach((dt, i) => mark(engine!.impact(s * (1 - i * 0.12), i % 2 ? "paper" : "card", (i % 3) - 1, t + dt)));
  });
  controls.append(label, readout, tap("card"), tap("paper"), cluster);
  sec.append(controls);
  for (const bk of ["card", "paper"] as ImpactBank[])
    for (const tier of TIERS) {
      const key = impactKey(bk, tier);
      const metas = m.impacts[bk]?.[tier] ?? [];
      const mat: Material = bk;
      sec.append(slotRow(`${bk}-${tier}`, `${bk} · ${tier}`, tier === "soft" ? "Slow contacts." : tier === "medium" ? "Ordinary knocks." : "Throws and hard landings.", metas, null, (i) => playImpact(mat, TIER_SPEED[tier], { key, file: metas[i]!.file }), key));
    }
  root.append(sec);
  for (const [key, row] of tiles) for (const t of row.values()) drawWave(t.querySelector("canvas")!, null, spans.get(key)!);
}

function redraw() {
  if (!bank) return;
  for (const [key, row] of tiles)
    for (const [file, t] of row) {
      const clip = bank.clips(key).find((c) => c.file === file) ?? null;
      t.classList.toggle("missing", !clip);
      drawWave(t.querySelector("canvas")!, clip, spans.get(key)!);
    }
}

const allKeys = () => [...tiles.keys()];

async function start() {
  if (ac) return;
  ac = new AudioContext({ latencyHint: "interactive" });
  bank = loadBank(ac, BASE, (u) => fetch(u));
  const b = bank;
  engine = createEngine(ac, { clips: (k) => (forced && forced.key === k ? [forced] : b.clips(k)) });
  $("#start").hidden = true;
  await Promise.all(allKeys().map((k) => b.loaded(k)));
  redraw();
  document.documentElement.dataset.loaded = "";
}

$("#start").addEventListener("click", () => void start());
window.addEventListener("resize", () => redraw());

// ---- headless hooks ----

type DecodeRow = { key: string; file: string; ok: boolean; offsetMs: number; durationMs: number; bufferMs: number; leadMs: number; manifestMs: number; peakDb: number };

/** Every file the manifest lists: decoded or not, where its audio starts in the decoded buffer, its length against the manifest. */
function decodeReport(): DecodeRow[] {
  const out: DecodeRow[] = [];
  for (const [key, row] of tiles)
    for (const file of row.keys()) {
      const meta = [...Object.values(manifest!.sounds).flat(), ...Object.values(manifest!.impacts).flatMap((t) => Object.values(t).flat())].find((m) => m.file === file)!;
      const clip = bank?.clips(key).find((c) => c.file === file);
      let peak = 0;
      if (clip) for (const v of clip.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
      out.push({
        key,
        file,
        ok: !!clip,
        offsetMs: clip ? clip.offset * 1000 : NaN,
        durationMs: clip ? clip.duration * 1000 : NaN,
        bufferMs: clip ? clip.buffer.duration * 1000 : NaN,
        leadMs: meta.lead * 1000,
        manifestMs: meta.duration * 1000,
        peakDb: 20 * Math.log10(peak || 1e-12),
      });
    }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Press every Play button, then (once those voices are over, so the pool has room) tap every tier; returns what the engine chose. */
async function playEverything(): Promise<{ key: string; file: string | null }[]> {
  const out: { key: string; file: string | null }[] = [];
  for (const g of GROUPS) for (const [name] of g.slots) out.push({ key: name, file: playSound(name)?.file ?? null });
  await sleep(900);
  for (const bk of ["card", "paper"] as const)
    for (const tier of TIERS) {
      out.push({ key: impactKey(bk, tier), file: playImpact(bk, TIER_SPEED[tier])?.file ?? null });
      await sleep(120);
    }
  return out;
}

type Level = { name: string; peakDb: number; rmsDb: number; audibleMs: number };

/**
 * Render through the real engine on an OfflineAudioContext (settled: past the compressor warm-up), centred, default volume:
 * one row per slot (every take of it in turn, so the row is the loudest take), plus two stress bursts.
 */
async function renderOffline(): Promise<{ levels: Level[]; bursts: Level[] }> {
  const SR = 48000;
  const pre = WARMUP + 0.15;
  const keys = allKeys();
  const slot = 1.0;
  const len = pre + keys.length * 3 * slot + 4;
  const off = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
  const ob = loadBank(off, BASE, (u) => fetch(u));
  await Promise.all(keys.map((k) => ob.loaded(k)));
  // every take in turn: the engine is handed exactly that take (for a contact, whatever tier the speed asks for)
  let take: Clip | null = null;
  const eng = createEngine(off, { clips: (k) => (take ? [take] : ob.clips(k)) }, { rnd: mulberry32(1) });
  // one take per second; impacts at full speed, so every take is heard at its loudest
  const takes: { name: string; t0: number }[] = [];
  let t = pre;
  for (const key of keys) {
    for (const clip of ob.clips(key)) {
      take = clip;
      if (key.startsWith("impact:")) eng.impact(MAX_SPEED, key.split(":")[1] as ImpactBank, 0, t);
      else eng.play(key as SoundName, {}, t);
      takes.push({ name: key, t0: t });
      t += slot;
    }
  }
  take = null;
  // bursts: a riffle of page turns with landings, and a pouch shaken hard (every contact at full speed, mixed materials)
  const b1 = t;
  for (let i = 0; i < 8; i++) {
    eng.play("pageTurn", { pan: 0.15 }, b1 + i * 0.07);
    eng.play("pageLand", { pan: 0.4 }, b1 + 0.3 + i * 0.07);
  }
  const b2 = b1 + 1.5;
  eng.play("shake", {}, b2);
  for (let i = 0; i < 30; i++) eng.impact(MAX_SPEED, (["card", "paper", "metal"] as Material[])[i % 3]!, ((i % 5) - 2) / 2, b2 + i * 0.011);
  eng.play("drop", { pan: -1 }, b2 + 0.05);
  const buf = await off.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const measure = (name: string, t0: number, t1: number): Level => {
    const a = Math.floor(t0 * SR);
    const b = Math.min(L.length, Math.floor(t1 * SR));
    let peak = 0;
    let first = -1;
    let last = -1;
    for (let i = a; i < b; i++) {
      const v = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
      if (v > peak) peak = v;
      if (v > 1e-3) {
        if (first < 0) first = i;
        last = i;
      }
    }
    let s = 0;
    for (let i = Math.max(a, first); i <= last; i++) s += L[i]! * L[i]!;
    const n = Math.max(1, last - first + 1);
    return { name, peakDb: 20 * Math.log10(peak || 1e-12), rmsDb: 10 * Math.log10(s / n || 1e-24), audibleMs: first < 0 ? 0 : (n / SR) * 1000 };
  };
  // per slot: the loudest and longest of its takes
  const levels = new Map<string, Level>();
  for (const k of takes) {
    const l = measure(k.name, k.t0, k.t0 + slot);
    const p = levels.get(k.name);
    levels.set(k.name, p ? { name: k.name, peakDb: Math.max(p.peakDb, l.peakDb), rmsDb: Math.max(p.rmsDb, l.rmsDb), audibleMs: Math.max(p.audibleMs, l.audibleMs) } : l);
  }
  return { levels: [...levels.values()], bursts: [measure("burst-riffle", b1, b1 + 1.4), measure("burst-shaken-pouch", b2, b2 + 1.2)] };
}

let kit: SoundKit | null = null;
const w = window as unknown as {
  __audition: {
    ready: Promise<void>;
    start: typeof start;
    decodeReport: typeof decodeReport;
    playEverything: typeof playEverything;
    renderOffline: typeof renderOffline;
    makeKit(): boolean;
    kitPlayAll(): void;
  };
};
w.__audition = {
  ready: fetch(`${BASE}manifest.json`)
    .then((r) => r.json() as Promise<FullManifest>)
    .then((m) => {
      manifest = m;
      build(m);
    }),
  start,
  decodeReport,
  playEverything,
  renderOffline,
  makeKit() {
    kit = createSoundKit({ base: BASE });
    return kit.muted;
  },
  kitPlayAll() {
    for (const n of SOUND_NAMES) kit?.play(n);
    for (const m of ["paper", "card", "plastic", "metal", "vinyl"] as Material[]) for (const s of [0.3, 1, 2.4]) kit?.impact(s, m, 0);
  },
};
