/*
 * The room's ambience (src/sound/ambient.ts): a morning breeze in the leaves outside the window, looped, and a few distant bird
 * phrases dropped in now and then. Generated with the ElevenLabs Sound Effects API like the foley (generate.ts), then filtered,
 * levelled and encoded here into public/sounds/ambient-*.m4a and public/sounds/ambient.json.
 *
 *   bun scripts/sounds/ambient.ts generate --env-file ../somewhere/.env.local [--raw <dir>]   # the takes (billing: 6 requests)
 *   bun scripts/sounds/ambient.ts build [--raw <dir>]                                         # the files, from the picks below
 *
 * The takes were judged by ear and on spectrograms (owner 2026-10-23: "你来选吧"): the leaves take with slow swells and no
 * high whine, the birds take with irregular phrases (the other one chirped on a 4 s beat). The key is never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOM = "High quality stereo field recording, early morning ambience heard through a slightly open window of a quiet house in a small Japanese town.";
const NOT = "No music, no voice, no traffic, no insects, no electrical hum or whine, no clicks. Natural and calm, recorded at a normal level, seamless loop.";
export const PROMPTS = [
  { id: "birds", text: `${ROOM} Small birds singing in the distance: a few clear chirps and short phrases every few seconds with quiet between, and a faint soft breeze in the trees. ${NOT}` },
  { id: "leaves", text: `${ROOM} A gentle breeze moving through the leaves of a nearby tree: soft continuous leaf rustle that slowly swells and fades, with one or two very distant birds now and then. ${NOT}` },
  { id: "room", text: `${ROOM} Quiet room tone: a soft steady airy hush of the outdoor air beyond the window, very still, no distinct events. ${NOT}` },
];
/** Takes per prompt, 30 s each (the API's longest), asked for as loops */
const TAKES = 2;

/**
 * The bed: the leaves take up to `end` s (its last 5 s are a gust 7 dB over the rest, and every pass would end on it). p50: its
 * median moment after the playback trim (the kit's master takes 2 dB more). The first cut's trim never reached the mix, so the bed
 * played some 30 dB over its design, at a median of -21 LUFS; the owner asked for it 5 dB quieter (2026-10-23) and heard no birds,
 * then for the whole room 35 % (3.75 dB) quieter again.
 */
const BED = { src: "leaves-2.mp3", end: 24.4, lufs: -20, p50: -28.75 };
/**
 * Bird phrases cut from the birds take (s), each faded in and out; the breeze under them is left to the bed (high-pass). m50: their
 * loudest moment after the trim, 9 dB over the bed's median.
 */
const BIRDS = { src: "birds-2.mp3", cuts: [[0.55, 3.45], [5.45, 7.9], [10.4, 12.4], [13.9, 16.2], [21.5, 25.1]] as const, m50: -19.75 };

const PUBLIC = "public/sounds";
const DEFAULT_RAW = "node_modules/.cache/sasshi-sounds/ambient";

function ffmpeg(args: string[]): string {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr}`);
  return r.stderr;
}
/** Integrated loudness (LUFS), and the loudest and the median 400 ms momentary loudness of a file */
function loudness(file: string): { i: number; m: number; p50: number } {
  const log = ffmpeg(["-i", file, "-af", "ebur128", "-f", "null", "-"]);
  const i = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary:")))?.[1]);
  const ms = [...log.matchAll(/ M:\s*(-?[\d.]+)/g)].map((x) => Number(x[1])).filter((v) => Number.isFinite(v) && v > -70).sort((a, b) => a - b);
  return { i, m: ms[ms.length - 1]!, p50: ms[ms.length >> 1]! };
}
const duration = (file: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);

async function generate(raw: string, envFile: string | undefined) {
  const env = envFile ? readFileSync(envFile, "utf8") : "";
  const key = process.env.ELEVENLABS_API_KEY || /^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*["']?([^"'\s#]+)/m.exec(env)?.[1];
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set (environment or --env-file)");
  for (const p of PROMPTS)
    for (let n = 1; n <= TAKES; n++) {
      const file = join(raw, `${p.id}-${n}.mp3`);
      if (existsSync(file)) continue;
      const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192", {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: p.text, duration_seconds: 30, prompt_influence: 0.5, model_id: "eleven_text_to_sound_v2", loop: true }),
      });
      const body = new Uint8Array(await res.arrayBuffer());
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status} ${new TextDecoder().decode(body.slice(0, 300))}`);
      writeFileSync(file, body);
      console.log(`  ${file}  ${(body.length / 1024).toFixed(0)} KB`);
    }
}

function build(raw: string) {
  // the bed: rumble and the hiss above 11 kHz out, levelled to BED.lufs, stereo AAC
  const bed = join(PUBLIC, "ambient-leaves.m4a");
  ffmpeg(["-y", "-t", String(BED.end), "-i", join(raw, BED.src), "-af", `highpass=f=90,highpass=f=90,lowpass=f=11000,loudnorm=I=${BED.lufs}:TP=-2:LRA=20`, "-ar", "44100", "-c:a", "aac", "-b:a", "112k", bed]);
  const birds = BIRDS.cuts.map(([a, b], i) => {
    const file = join(PUBLIC, `ambient-bird-${i + 1}.m4a`);
    const len = b - a;
    ffmpeg(["-y", "-ss", String(a), "-t", String(len), "-i", join(raw, BIRDS.src), "-ac", "1", "-af", `highpass=f=700,highpass=f=700,lowpass=f=11000,afade=t=in:d=0.06,afade=t=out:st=${(len - 0.35).toFixed(2)}:d=0.35,loudnorm=I=-24:TP=-3`, "-ar", "44100", "-c:a", "aac", "-b:a", "64k", file]);
    // the playback trim that brings each phrase's loudest moment to BIRDS.m50
    return { file: `ambient-bird-${i + 1}.m4a`, gainDb: Math.round((BIRDS.m50 - loudness(file).m) * 100) / 100, duration: Math.round(duration(file) * 1000) / 1000, bytes: statSync(file).size };
  });
  const manifest = {
    about: "The room's ambience for src/sound/ambient.ts, made by scripts/sounds/ambient.ts from ElevenLabs takes (eleven_text_to_sound_v2): the bed loops with crossfades, the birds are dropped in now and then. gainDb is the playback trim.",
    bed: { file: "ambient-leaves.m4a", gainDb: Math.round((BED.p50 - loudness(bed).p50) * 100) / 100, duration: Math.round(duration(bed) * 1000) / 1000, bytes: statSync(bed).size, src: `${BED.src} 0-${BED.end} s` },
    birds: birds.map((b, i) => ({ ...b, src: `${BIRDS.src} ${BIRDS.cuts[i]![0]}-${BIRDS.cuts[i]![1]} s` })),
  };
  writeFileSync(join(PUBLIC, "ambient.json"), JSON.stringify(manifest, null, 1) + "\n");
  console.log(JSON.stringify(manifest, null, 1));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const raw = resolve(opt("--raw") ?? DEFAULT_RAW);
  mkdirSync(raw, { recursive: true });
  if (args[0] === "generate") await generate(raw, opt("--env-file"));
  else if (args[0] === "build") build(raw);
  else console.log("bun scripts/sounds/ambient.ts generate|build [--raw <dir>] [--env-file <dotenv>]");
}
