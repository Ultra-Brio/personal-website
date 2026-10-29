/*
 * Turn the raw ElevenLabs candidates (generate.ts) into the shipped sound files.
 *
 *   bun scripts/sounds/process.ts analyse [--raw <dir>] --out <dir>   # every candidate: events, metrics, a waveform+spectrogram PNG
 *   bun scripts/sounds/process.ts build   [--raw <dir>]               # picks.ts -> public/sounds/<name>-<n>.m4a + manifest.json
 *
 * analyse splits each clip into events and measures them (length, peak, loudest 50 ms, attack, decay to -40 dB, noise
 * floor, spectral centroid, energy above 8 kHz, spectral flatness), so music, voice (low flatness), room tails (no -40 dB
 * decay) and hiss (high floor, high HF share) stand out before anyone listens. picks.ts then names a time span of a
 * candidate per shipped file, with the reason it won.
 *
 * build, per pick: decode to mono 44.1 kHz through a 70 Hz 24 dB/oct high-pass (+ the pick's own filters), cut the span,
 * trim to the onset (2 ms before it) and to where the tail falls under the floor, remove DC, raised-cosine fades (2 ms in,
 * 12-40 ms out; first and last samples exactly 0), normalise the file to -1 dBFS peak for the encoder, and store the
 * playback trim (gainDb) that brings its loudest 50 ms to the category target, capped so a voice never peaks above
 * PEAK_CAP. Encoded with ffmpeg's native AAC encoder, mono, 96 kbps, faststart.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DEFAULT_RAW } from "./generate";
import { dbOf, decode, envelope, events, ffmpeg, gainOf, HIGHPASS, HOP, m50, peak, percentile, spectrum, SR, wav, WIN } from "./dsp";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const RAW = resolve(opt("--raw") ?? DEFAULT_RAW);
const mode = args[0];

if (mode === "analyse") {
  const out = resolve(opt("--out") ?? join(RAW, "analysis"));
  mkdirSync(join(out, "png"), { recursive: true });
  const files = readdirSync(RAW).filter((f) => f.endsWith(".mp3")).sort();
  const report: Record<string, ReturnType<typeof events>> = {};
  const lines: string[] = [];
  for (const f of files) {
    const id = basename(f, ".mp3");
    const x = decode(join(RAW, f));
    const r = events(x);
    report[id] = r;
    lines.push(`${id}  ${(x.length / SR).toFixed(2)} s  peak ${r.peakDb}  floor ${r.floorDb}  ${r.events.length} events`);
    for (const e of r.events)
      lines.push(
        `   #${e.i} ${e.start.toFixed(3)}-${e.end.toFixed(3)} (${Math.round(e.dur * 1000)} ms)  peak ${e.peakDb}  m50 ${e.m50Db}  att ${e.attackMs} ms  d40 ${e.decay40Ms ?? "-"} ms  cent ${e.centroid}  hf ${e.hf}  flat ${e.flatness}`,
      );
    // Waveform (linear) over a spectrogram with axes: harmonic ladders = music/voice, smeared tails = room, flat floor = hiss.
    ffmpeg([
      "-i", join(RAW, f),
      "-filter_complex",
      // The spectrogram legend adds a 141 px margin each side of the 1400 px plot; the waveform is padded to line up with it.
      `[0:a]aformat=channel_layouts=mono,${HIGHPASS},asplit[a][b];[a]showwavespic=s=1400x140:colors=0xe8e8e3:scale=lin,pad=1682:140:141:0:black[w];[b]showspectrumpic=s=1400x300:legend=1:fscale=lin:scale=log:stop=16000:drange=90:color=magma[s];[w][s]vstack=inputs=2`,
      "-frames:v", "1", join(out, "png", `${id}.png`),
    ]);
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
  writeFileSync(join(out, "report.txt"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\n${files.length} candidates -> ${out}`);
  process.exit(0);
}

if (mode !== "build") {
  console.error("usage: bun scripts/sounds/process.ts analyse|build [--raw <dir>] [--out <dir>]");
  process.exit(2);
}

const { PICKS } = await import("./picks");
type Pick = import("./picks").Pick;

/** Loudest-50-ms target per slot (dBFS, file x gainDb), measured on the old synthesized set the page was balanced with. */
const TARGET: Record<string, number> = {
  pageTurn: -24.5,
  pageLand: -28,
  coverOpen: -26,
  coverClose: -25,
  zip: -29,
  pickUp: -31,
  drop: -28,
  cardUnfold: -29,
  paperRustle: -30,
  shake: -29,
  tab: -41,
  copy: -40,
  /** a full-speed contact; the kit scales it down with speed (gate.ts), so soft / medium / hard share one target and differ in timbre only */
  impact: -30,
};
/** No voice peaks above this (dBFS, file x gainDb): after the engine (-2.5 dB at centre) a sound peaks under -12.5 dBFS. */
const PEAK_CAP = -10;
const FILE_PEAK_DB = -1;
const ONSET_DB = 24;
const TAIL_DB = 50;
const PRE = 0.002;
const PAD = 1024;

const OUT = resolve("public/sounds");
const TMP = join(RAW, "build-tmp");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

export type Variant = { file: string; gainDb: number; lead: number; duration: number; bytes: number; peakDb: number; m50Db: number; centroid: number; src: string; note: string };

function cosFade(x: Float32Array, n: number, fromStart: boolean) {
  n = Math.min(n, x.length);
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    if (fromStart) x[i]! *= g;
    else x[x.length - 1 - i]! *= g;
  }
}

function build(p: Pick, slot: string, file: string): Variant {
  const x = decode(join(RAW, `${p.src}.mp3`), p.af ? `${HIGHPASS},${p.af}` : HIGHPASS);
  const seg = x.slice(Math.floor(p.at[0] * SR), Math.min(x.length, Math.floor(p.at[1] * SR)));
  const env = envelope(seg);
  const top = Math.max(...env);
  const floor = percentile(envelope(x), 0.1);
  const on = env.findIndex((v) => v > top - (p.onsetDb ?? ONSET_DB));
  let last = on;
  for (let i = on; i < env.length; i++) if (env[i]! > Math.max(floor + 6, top - TAIL_DB)) last = i;
  const a = Math.max(0, Math.round((on * HOP - PRE) * SR));
  let b = Math.min(seg.length, Math.round((last * HOP + WIN) * SR));
  if (p.maxDur) b = Math.min(b, a + Math.round(p.maxDur * SR));
  const y = seg.slice(a, b);
  let mean = 0;
  for (const v of y) mean += v;
  mean /= y.length;
  for (let i = 0; i < y.length; i++) y[i]! -= mean;
  cosFade(y, Math.round((p.fadeIn ?? 0.002) * SR), true);
  cosFade(y, Math.round((p.fadeOut ?? Math.min(0.04, Math.max(0.012, (0.25 * y.length) / SR))) * SR), false);
  y[0] = 0;
  y[y.length - 1] = 0;
  const k = gainOf(FILE_PEAK_DB) / peak(y);
  for (let i = 0; i < y.length; i++) y[i]! *= k;
  // ffmpeg's AAC encoder mangles a transient in the stream's first frame (measured: 3 dB SNR, +5 dB overshoot on a paper
  // tap), so every file gets PAD samples of silence on both ends; the kit finds where the sound starts (bank.ts audibleSpan).
  const padded = new Float32Array(PAD + y.length + PAD);
  padded.set(y, PAD);
  const wavPath = join(TMP, file.replace(/\.m4a$/, ".wav"));
  writeFileSync(wavPath, wav(padded));
  ffmpeg(["-i", wavPath, "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-ar", String(SR), "-movflags", "+faststart", join(OUT, file)]);
  // Level from what a browser will decode, not from what went in.
  const dec = decode(join(OUT, file), "");
  const truePeak = dbOf(peak(dec));
  const loud = m50(dec);
  const gainDb = Math.min(TARGET[slot]! - loud, PEAK_CAP - truePeak);
  return {
    file,
    gainDb: +gainDb.toFixed(2),
    lead: +(PAD / SR).toFixed(4),
    duration: +(y.length / SR).toFixed(4),
    bytes: statSync(join(OUT, file)).size,
    peakDb: +(truePeak + gainDb).toFixed(1),
    m50Db: +(loud + gainDb).toFixed(1),
    centroid: Math.round(spectrum(y).centroid),
    src: `${p.src}.mp3 ${p.at[0].toFixed(3)}-${p.at[1].toFixed(3)} s`,
    note: p.note,
  };
}

const sounds: Record<string, Variant[]> = {};
for (const [name, picks] of Object.entries(PICKS.sounds)) sounds[name] = picks!.map((p, i) => build(p, name, `${name}-${i + 1}.m4a`));
const impacts: Record<string, Record<string, Variant[]>> = {};
for (const [mat, tiers] of Object.entries(PICKS.impacts)) {
  impacts[mat] = {};
  for (const [tier, picks] of Object.entries(tiers)) impacts[mat]![tier] = picks.map((p, i) => build(p, "impact", `impact-${mat}-${tier}-${i + 1}.m4a`));
}
rmSync(TMP, { recursive: true, force: true });

const all = [...Object.values(sounds).flat(), ...Object.values(impacts).flatMap((t) => Object.values(t).flat())];
const total = all.reduce((s, v) => s + v.bytes, 0);
const manifest = {
  about:
    "Sound effects for the sasshi sound kit (src/sound). Generated with the ElevenLabs Sound Effects API (eleven_text_to_sound_v2) by scripts/sounds/generate.ts, cut, levelled and encoded by scripts/sounds/process.ts from the takes named in scripts/sounds/picks.ts. Files peak at -1 dBFS; gainDb is the playback trim that sets each one's level (from the decoded file); each sound starts \"lead\" seconds into its file (silence that keeps the AAC encoder clean) and lasts \"duration\". AAC-LC, mono, 44.1 kHz, 96 kb/s.",
  totalBytes: total,
  sounds,
  impacts,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
for (const v of all) console.log(`${v.file.padEnd(28)} ${String(Math.round(v.duration * 1000)).padStart(4)} ms  ${String(v.bytes).padStart(6)} B  gain ${v.gainDb.toFixed(1).padStart(6)}  peak ${v.peakDb.toFixed(1).padStart(6)}  m50 ${v.m50Db.toFixed(1).padStart(6)}  cent ${String(v.centroid).padStart(5)}  <- ${v.src}`);
console.log(`\n${all.length} files, ${(total / 1024).toFixed(1)} KB -> ${OUT}`);
