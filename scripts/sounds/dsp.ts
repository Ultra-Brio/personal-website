/*
 * Offline audio measurements shared by process.ts (choosing and building the sound files): ffmpeg decode/encode, a framewise
 * RMS envelope, event segmentation and per-event metrics. Mono float32 throughout.
 */
import { spawnSync } from "node:child_process";

export const SR = 44100;
/** Envelope: RMS over WIN seconds every HOP seconds. */
export const WIN = 0.01;
export const HOP = 0.0025;
/** Inaudible-rumble cut applied when decoding: two 2-pole high-passes (24 dB/oct). Nothing on PVC or card lives below it. */
export const HIGHPASS = "highpass=f=70,highpass=f=70";

export const dbOf = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200);
export const gainOf = (d: number) => Math.pow(10, d / 20);

/** Decode any file to mono float32 at SR through optional ffmpeg filters. */
export function decode(path: string, af = HIGHPASS): Float32Array {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(SR), ...(af ? ["-af", af] : []), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode ${path}: ${r.stderr.toString()}`);
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Framewise RMS in dBFS (frame i covers [i*HOP, i*HOP + WIN)). */
export function envelope(x: Float32Array, win = WIN, hop = HOP): Float32Array {
  const w = Math.round(win * SR);
  const h = Math.round(hop * SR);
  const n = Math.max(0, Math.floor((x.length - w) / h) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * h; j < i * h + w; j++) s += x[j]! * x[j]!;
    out[i] = dbOf(Math.sqrt(s / w));
  }
  return out;
}

export function peak(x: Float32Array): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

/** Loudness of a short event: the loudest 50 ms RMS window (dBFS). LUFS means little for a 60 ms tick. */
export function m50(x: Float32Array): number {
  const e = envelope(x, 0.05, HOP);
  return e.length ? Math.max(...e) : dbOf(Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length)));
}

export function percentile(a: ArrayLike<number>, p: number): number {
  const s = Array.from(a).sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : -200;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * c - im[i + k + len / 2]! * s;
        const vi = re[i + k + len / 2]! * s + im[i + k + len / 2]! * c;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
  }
}

/**
 * Energy-weighted spectral shape of a span: centroid (Hz), share of energy above 8 kHz, and spectral flatness
 * (0 = pure tone / music / voice, 1 = white noise; real foley transients sit around 0.1-0.5).
 */
export function spectrum(x: Float32Array): { centroid: number; hf: number; flatness: number } {
  const N = 1024;
  let wc = 0;
  let wsum = 0;
  let hfE = 0;
  let totE = 0;
  let flatW = 0;
  for (let o = 0; o + N <= x.length; o += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[o + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    let e = 0;
    let c = 0;
    let lg = 0;
    let cnt = 0;
    for (let k = 2; k < N / 2; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      const f = (k * SR) / N;
      e += p;
      c += p * f;
      if (f > 8000) hfE += p;
      // Flatness over 150 Hz - 14 kHz only: the high-pass and the source's MP3 low-pass leave both ends empty.
      if (f < 150 || f > 14000) continue;
      lg += Math.log(p + 1e-20);
      cnt++;
    }
    totE += e;
    if (e <= 0) continue;
    wc += c;
    wsum += e;
    let band = 0;
    for (let k = 2; k < N / 2; k++) {
      const f = (k * SR) / N;
      if (f >= 150 && f <= 14000) band += re[k]! * re[k]! + im[k]! * im[k]!;
    }
    if (band > 0) flatW += (Math.exp(lg / cnt) / (band / cnt)) * e;
  }
  return { centroid: wsum ? wc / wsum : 0, hf: totE ? hfE / totE : 0, flatness: wsum ? flatW / wsum : 0 };
}

export type Event = {
  i: number;
  start: number;
  end: number;
  dur: number;
  peakDb: number;
  envMaxDb: number;
  m50Db: number;
  /** onset -> loudest envelope frame (ms) */
  attackMs: number;
  /** loudest frame -> 40 dB below it (ms); null when it never gets there (a tail, room or floor) */
  decay40Ms: number | null;
  centroid: number;
  hf: number;
  flatness: number;
};

/** Split a clip into events: spans whose envelope rises 12 dB over the clip's floor and within 45 dB of its loudest frame. */
export function events(x: Float32Array): { floorDb: number; peakDb: number; events: Event[] } {
  const env = envelope(x);
  const floorDb = percentile(env, 0.1);
  const top = env.length ? Math.max(...env) : -200;
  const th = Math.max(floorDb + 12, top - 45);
  const spans: [number, number][] = [];
  for (let i = 0; i < env.length; i++) {
    if (env[i]! <= th) continue;
    let j = i;
    while (j + 1 < env.length && env[j + 1]! > th) j++;
    const last = spans.at(-1);
    if (last && (i - last[1]) * HOP < 0.04) last[1] = j;
    else spans.push([i, j]);
    i = j;
  }
  const out: Event[] = [];
  spans.forEach(([a, b], n) => {
    // Walk back to where the rise left the floor (at most 20 ms), forward until it is back near the floor (or the next event).
    let s = a;
    while (s > 0 && a - s < 0.02 / HOP && env[s - 1]! < env[s]! && env[s - 1]! > floorDb + 3) s--;
    let mx = a;
    for (let i = a; i <= b; i++) if (env[i]! > env[mx]!) mx = i;
    const stop = n + 1 < spans.length ? spans[n + 1]![0] : env.length;
    let e = b;
    while (e + 1 < stop && env[e + 1]! > Math.max(floorDb + 4, env[mx]! - 50)) e++;
    let d40: number | null = null;
    for (let i = mx; i < stop; i++)
      if (env[i]! <= env[mx]! - 40) {
        d40 = (i - mx) * HOP * 1000;
        break;
      }
    const t0 = s * HOP;
    const t1 = Math.min(x.length / SR, e * HOP + WIN);
    const seg = x.subarray(Math.floor(t0 * SR), Math.floor(t1 * SR));
    out.push({
      i: n,
      start: +t0.toFixed(4),
      end: +t1.toFixed(4),
      dur: +(t1 - t0).toFixed(4),
      peakDb: +dbOf(peak(seg)).toFixed(1),
      envMaxDb: +env[mx]!.toFixed(1),
      m50Db: +m50(seg).toFixed(1),
      attackMs: +((mx - s) * HOP * 1000).toFixed(1),
      decay40Ms: d40 === null ? null : +d40.toFixed(1),
      ...(() => {
        const sp = spectrum(seg);
        return { centroid: Math.round(sp.centroid), hf: +sp.hf.toFixed(3), flatness: +sp.flatness.toFixed(3) };
      })(),
    });
  });
  return { floorDb: +floorDb.toFixed(1), peakDb: +dbOf(peak(x)).toFixed(1), events: out };
}

/** Write mono float32 as a 32-bit float WAV. */
export function wav(x: Float32Array, sr = SR): Uint8Array {
  const b = new ArrayBuffer(44 + x.length * 4);
  const v = new DataView(b);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + x.length * 4, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 32, true);
  s(36, "data");
  v.setUint32(40, x.length * 4, true);
  new Float32Array(b, 44).set(x);
  return new Uint8Array(b);
}

export function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr.toString()}`);
}
