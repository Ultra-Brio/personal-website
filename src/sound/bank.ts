/*
 * The recorded sounds: public/sounds/manifest.json names the files (made by scripts/sounds/process.ts from ElevenLabs takes),
 * this module fetches and decodes them into AudioBuffers on a context, and picks a variant per play.
 *
 * Loading starts when the kit creates its AudioContext (inside the visitor's first gesture, never while muted). Every file
 * loads on its own: a missing or undecodable one is skipped silently and the rest still play. Decoders that keep the AAC
 * encoder's priming at the head of a buffer (or padding at its tail) are handled by measuring where the sound really
 * starts and ends: the files themselves start within 2 ms of their onset and end in an exact-zero fade.
 */

import type { Material } from "./gate";

export type SoundName =
  | "pageTurn"
  | "pageLand"
  | "coverOpen"
  | "coverClose"
  | "zip"
  | "pickUp"
  | "drop"
  | "cardUnfold"
  | "paperRustle"
  /** Kept for API compatibility; the pouch no longer holds keys, so the manifest has no files for it and it plays nothing. */
  | "keyJingle"
  | "shake"
  | "tab"
  | "copy";

export const SOUND_NAMES: readonly SoundName[] = [
  "pageTurn",
  "pageLand",
  "coverOpen",
  "coverClose",
  "zip",
  "pickUp",
  "drop",
  "cardUnfold",
  "paperRustle",
  "keyJingle",
  "shake",
  "tab",
  "copy",
];

/** Contact sounds come in two recorded families (paper and card on clear film); harder materials fall back to card. */
export type ImpactBank = "paper" | "card";
export type Tier = "soft" | "medium" | "hard";
export const TIERS: readonly Tier[] = ["soft", "medium", "hard"];
export const impactBankOf = (m: Material): ImpactBank => (m === "paper" ? "paper" : "card");

/** Tier for a position on the speed curve (gate.ts impactAmount, 0..1): the level comes from the gate, the tier sets the timbre. */
export const TIER_AT: Readonly<Record<Exclude<Tier, "soft">, number>> = { medium: 0.35, hard: 0.7 };
export const tierOf = (amount: number): Tier => (amount >= TIER_AT.hard ? "hard" : amount >= TIER_AT.medium ? "medium" : "soft");

export type ManifestVariant = { file: string; gainDb: number };
export type Manifest = {
  sounds: Partial<Record<SoundName, ManifestVariant[]>>;
  impacts?: Partial<Record<ImpactBank, Partial<Record<Tier, ManifestVariant[]>>>>;
};

/** One decoded variant, ready to schedule: play `buffer` from `offset` for `duration` seconds at `gain`. */
export type Clip = { key: string; file: string; buffer: AudioBuffer; gain: number; offset: number; duration: number };

export const soundKey = (name: SoundName) => name;
export const impactKey = (bank: ImpactBank, tier: Tier) => `impact:${bank}:${tier}`;

export type Bank = {
  /** The decoded variants of a slot (sound or impact key), in manifest order; empty until they have loaded. */
  clips(key: string): readonly Clip[];
  /** Settles once every file of the slot has loaded or failed (never rejects). */
  loaded(key: string): Promise<void>;
  dispose(): void;
};

/** Below this a sample counts as silence when looking for where a decoded file really starts and ends (-80 dBFS; files peak at -1). */
const SILENT = 1e-4;
/** A decoder's priming is a few thousand samples at most; never skip more than this (s). */
const MAX_LEAD = 0.1;

/** The audible span of a decoded file: decoders may prepend AAC priming or append padding as silence. */
export function audibleSpan(b: AudioBuffer): { offset: number; duration: number } {
  const x = b.getChannelData(0);
  const limit = Math.min(x.length, Math.round(MAX_LEAD * b.sampleRate));
  let i = 0;
  while (i < limit && Math.abs(x[i]!) < SILENT) i++;
  if (i === limit) i = 0;
  let j = x.length;
  while (j > i + 1 && Math.abs(x[j - 1]!) < SILENT) j--;
  return { offset: i / b.sampleRate, duration: (j - i) / b.sampleRate };
}

/** A random variant, never `last` when there is any other choice. */
export function pickVariant<T>(list: readonly T[], last: T | undefined, rnd: () => number): T | undefined {
  if (list.length < 2) return list[0];
  const from = last === undefined ? list : list.filter((c) => c !== last);
  return from[Math.min(from.length - 1, Math.floor(rnd() * from.length))];
}

type Fetch = (url: string) => Promise<Pick<Response, "ok" | "json" | "arrayBuffer">>;

function decode(ac: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Callback form too: older Safari returns undefined from decodeAudioData and only calls back.
  return new Promise((resolve, reject) => {
    const p = ac.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.then(resolve, reject);
  });
}

/** Fetch the manifest under `base` (a URL prefix ending in "/") and decode every file it names onto `ac`. */
export function loadBank(ac: BaseAudioContext, base: string, fetchFn: Fetch): Bank {
  let disposed = false;
  const lists = new Map<string, (Clip | undefined)[]>();
  const waits = new Map<string, Promise<void>>();

  const manifest: Promise<Manifest | null> = fetchFn(`${base}manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);

  const loadSlot = (key: string, variants: readonly ManifestVariant[]): Promise<void> => {
    const list: (Clip | undefined)[] = variants.map(() => undefined);
    lists.set(key, list);
    return Promise.all(
      variants.map((v, i) =>
        fetchFn(base + v.file)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(v.file)))))
          .then((data) => decode(ac, data))
          .then((buffer) => {
            if (disposed) return;
            const span = audibleSpan(buffer);
            list[i] = { key, file: v.file, buffer, gain: Math.pow(10, (Number(v.gainDb) || 0) / 20), ...span };
          })
          .catch(() => {
            // missing or undecodable: this variant stays silent, the others play
          }),
      ),
    ).then(() => {});
  };

  const all = manifest.then((m) => {
    const out = new Map<string, Promise<void>>();
    if (!m || disposed) return out;
    for (const [name, variants] of Object.entries(m.sounds ?? {})) if (Array.isArray(variants)) out.set(name, loadSlot(name, variants));
    for (const [bank, tiers] of Object.entries(m.impacts ?? {}))
      for (const [tier, variants] of Object.entries(tiers ?? {})) if (Array.isArray(variants)) out.set(impactKey(bank as ImpactBank, tier as Tier), loadSlot(impactKey(bank as ImpactBank, tier as Tier), variants));
    return out;
  });

  return {
    clips(key) {
      const list = lists.get(key);
      return list ? (list.filter(Boolean) as Clip[]) : [];
    },
    loaded(key) {
      let w = waits.get(key);
      if (!w) {
        w = all.then((m) => m.get(key));
        waits.set(key, w);
      }
      return w;
    },
    dispose() {
      disposed = true;
      lists.clear();
    },
  };
}
