/*
 * Generate the raw sound-effect candidates with the ElevenLabs Sound Effects API (POST /v1/sound-generation).
 *
 *   ELEVENLABS_API_KEY=... bun scripts/sounds/generate.ts [--only tab-a,zip-a] [--raw <dir>] [--cap 60] [--dry]
 *   bun scripts/sounds/generate.ts --env-file ../somewhere/.env.local          # or read the key from a dotenv file
 *
 * Re-runnable and billing-safe: a candidate whose file already exists is skipped, every request (ok or not) is appended to
 * <raw>/log.json, the run refuses to go past --cap requests in total (default 60), and it stops at the first failure
 * instead of retrying. The key is never printed or written anywhere.
 *
 * Short events (ticks, taps, drops) are asked for as "several separate ..., silence between" in one 2-3 s clip and cut
 * apart by process.ts: one request gives several natural variants. Continuous gestures get one clip per request.
 * Raw files are not shipped; scripts/sounds/picks.ts names the ones that were, so a regeneration means a re-pick.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Prompt = {
  /** Candidate id prefix: files are <id>-<n>.mp3 */
  id: string;
  text: string;
  /** Seconds, 0.5 - 30 */
  duration: number;
  /** 0..1: higher follows the text more literally (less variety between takes) */
  influence: number;
  /** Takes to request */
  takes: number;
};

// The recording situation leads every prompt; the object and the gesture follow.
const DRY = "Close-miked studio foley, completely dry, no room reverb, no music, no voice, quiet, realistic.";

export const PROMPTS: Prompt[] = [
  { id: "tab-a", text: `${DRY} Five separate tiny soft clicks of a small quality paper-covered button being pressed, one at a time, with silence between each click.`, duration: 2.5, influence: 0.7, takes: 2 },
  { id: "copy-a", text: `${DRY} Two tiny soft clicks in quick succession, like a small paper latch snapping shut on a desk, then silence.`, duration: 0.6, influence: 0.7, takes: 2 },
  { id: "pageTurn-a", text: `${DRY} Turning one page of a clear plastic sleeve in a ring binder on a wooden desk: the soft PVC sheet flexes with a gentle crinkle and a quick light swish, a card inside it. One single page turn.`, duration: 1, influence: 0.6, takes: 5 },
  { id: "pageLand-a", text: `${DRY} A clear plastic sleeve page settling flat onto a stack of pages in a ring binder, a soft light flap. Four separate ones with silence between.`, duration: 2.5, influence: 0.6, takes: 2 },
  { id: "coverOpen-a", text: `${DRY} Opening a hardcover leather ring binder on a wooden desk: the stiff cover swings open and lands with a soft muted thump.`, duration: 1.2, influence: 0.6, takes: 3 },
  { id: "coverClose-a", text: `${DRY} Closing a hardcover leather ring binder on a wooden desk: the cover swings shut with a soft padded thump.`, duration: 1, influence: 0.6, takes: 3 },
  { id: "zip-a", text: `${DRY} One short quick pull of a small zipper on a clear plastic PVC pouch, a single smooth zip.`, duration: 1, influence: 0.6, takes: 3 },
  { id: "pickUp-a", text: `${DRY} Picking a stiff business card up off a sheet of clear plastic film, a light papery lift with a tiny tick. Four separate pick-ups with silence between.`, duration: 2.5, influence: 0.6, takes: 2 },
  { id: "drop-a", text: `${DRY} A business card dropped from a few centimetres onto clear plastic film on a desk, a light flat slap. Four separate drops with silence between.`, duration: 2.5, influence: 0.6, takes: 2 },
  { id: "cardUnfold-a", text: `${DRY} Unfolding a thick folded cotton paper business card, a soft crisp crease opening.`, duration: 1, influence: 0.6, takes: 3 },
  { id: "paperRustle-a", text: `${DRY} Briefly handling a single sheet of thick premium paper, a short soft rustle.`, duration: 1, influence: 0.6, takes: 3 },
  { id: "shake-a", text: `${DRY} Gently shaking a clear plastic pouch with a few paper cards inside, soft crinkly plastic and cards shuffling, one short shake.`, duration: 1.2, influence: 0.6, takes: 3 },
  { id: "impactPaper-a", text: `${DRY} A folded sheet of paper tapping onto clear plastic film on a desk: six separate taps from very light to firm, with silence between each.`, duration: 3, influence: 0.6, takes: 3 },
  { id: "impactCard-a", text: `${DRY} A stiff business card tapping onto clear plastic film on a desk: six separate taps from very light to firm, with silence between each.`, duration: 3, influence: 0.6, takes: 3 },
  // Second round, for the slots the first one missed: pageLand came back as riffles, drop/pickUp as one or two events,
  // copy's two clicks were 220 ms apart, and every pageTurn swished for 600 ms from the first sample.
  { id: "pageTurn-b", text: `${DRY} Turning one page of a clear plastic sheet protector in a ring binder: a short soft swish with a gentle plastic crinkle as it flips over, about half a second, then silence.`, duration: 0.8, influence: 0.7, takes: 3 },
  { id: "pageLand-b", text: `${DRY} A single clear plastic sheet protector page flopping down flat onto a stack of pages in an open ring binder, one soft flat slap, then silence.`, duration: 1, influence: 0.7, takes: 3 },
  { id: "drop-b", text: `${DRY} Four separate times: a stiff business card dropped flat from a few centimetres onto a clear plastic sheet on a wooden desk, a soft light slap, silence between each.`, duration: 3, influence: 0.7, takes: 2 },
  { id: "pickUp-b", text: `${DRY} Four separate times: fingers picking a stiff paper card up off a smooth clear plastic sheet, a tiny soft papery lift, silence between each.`, duration: 3, influence: 0.7, takes: 2 },
  { id: "copy-b", text: `${DRY} Two very short soft ticks in quick succession, the second a little higher, like a quality ballpoint pen click, then silence.`, duration: 0.5, influence: 0.7, takes: 2 },
];

export const DEFAULT_RAW = "node_modules/.cache/sasshi-sounds";
const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";
const FORMAT = "mp3_44100_128";

export type LogEntry = { id: string; file: string; text: string; duration: number; influence: number; status: number; bytes: number; ms: number; at: string; headers: Record<string, string>; error?: string };

/** Read one KEY from a dotenv file: `KEY=v`, `export KEY=v`, quoted values, trailing ` # comments`. */
function fromEnvFile(path: string, key: string): string | undefined {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== key) continue;
    let v = m[2]!.trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) v = v.slice(1, v.indexOf(q, 1));
    else v = v.replace(/\s+#.*$/, "");
    return v || undefined;
  }
  return undefined;
}

export function readLog(raw: string): LogEntry[] {
  const p = join(raw, "log.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
}

const isMp3 = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0);

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const raw = resolve(opt("--raw") ?? DEFAULT_RAW);
  const cap = Number(opt("--cap") ?? 60);
  const only = opt("--only")?.split(",");
  const dry = args.includes("--dry");
  mkdirSync(raw, { recursive: true });

  const todo: { p: Prompt; n: number; file: string }[] = [];
  for (const p of PROMPTS) {
    if (only && !only.includes(p.id)) continue;
    for (let n = 1; n <= p.takes; n++) {
      const file = join(raw, `${p.id}-${n}.mp3`);
      if (!existsSync(file)) todo.push({ p, n, file });
    }
  }
  const used = readLog(raw).length;
  console.log(`${todo.length} to generate, ${used} requests made so far, cap ${cap}`);
  if (used + todo.length > cap) throw new Error(`would exceed the cap (${used} + ${todo.length} > ${cap}); narrow --only or raise --cap`);
  if (dry || !todo.length) {
    for (const t of todo) console.log(`  ${t.p.id}-${t.n}  ${t.p.duration}s  pi ${t.p.influence}`);
    return;
  }

  const envFile = opt("--env-file");
  const key = process.env.ELEVENLABS_API_KEY || (envFile ? fromEnvFile(envFile, "ELEVENLABS_API_KEY") : undefined);
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set (environment or --env-file)");

  for (const { p, n, file } of todo) {
    const t0 = performance.now();
    const res = await fetch(`${ENDPOINT}?output_format=${FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: p.text, duration_seconds: p.duration, prompt_influence: p.influence, model_id: "eleven_text_to_sound_v2" }),
    });
    const body = new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k !== "set-cookie") headers[k] = v;
    });
    const ok = res.ok && isMp3(body);
    const entry: LogEntry = {
      id: p.id,
      file: `${p.id}-${n}.mp3`,
      text: p.text,
      duration: p.duration,
      influence: p.influence,
      status: res.status,
      bytes: body.length,
      ms: Math.round(performance.now() - t0),
      at: new Date().toISOString(),
      headers,
      ...(ok ? {} : { error: new TextDecoder().decode(body.slice(0, 400)) }),
    };
    appendFileSync(join(raw, "log.jsonl"), JSON.stringify(entry) + "\n");
    if (!ok) {
      console.error(`FAILED ${entry.file}: HTTP ${res.status} ${entry.error}`);
      process.exit(1);
    }
    writeFileSync(file, body);
    const cost = Object.entries(headers).filter(([k]) => /cost|character|credit|request-id/i.test(k));
    console.log(`  ${entry.file}  ${(body.length / 1024).toFixed(1)} KB  ${entry.ms} ms  ${cost.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
}

if (import.meta.main) await main();
