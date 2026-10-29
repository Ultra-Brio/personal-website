import type { Profile } from "./schema";

/*
 * A folio in one or more languages (brief r4 E1): the same person and the same things, written once per language. The primary
 * profile ships in the entry chunk; every other language is a function that imports its module the first time a visitor asks for it.
 *
 *   export const folio: Folio = {
 *     primary: "en",
 *     profiles: { en: profile, zh: () => import("./profile.zh").then((m) => m.profileZh) },
 *   };
 *
 * Keys are the tags a visitor sees in the URL (`?lang=zh`): BCP 47, usually just the language ("en", "zh", "ja"; "zh-TW" when a folio
 * carries both Chinese scripts). Each profile's own `lang` still says how its text is set (zh-CN → the SC faces). The languages must
 * describe the same things — the same pouch items (ids and kinds, in order), the same album cards and postcards (ids, colours,
 * pictures) — and differ only in their words: then a language switch repaints the print in place instead of rebuilding the books
 * (`shapeDiff` names what differs; the sample's test holds its two languages to it).
 */

/** A profile loaded on demand: a dynamic import of its module (its default export or a named one). */
export type ProfileLoader = () => Promise<Profile | { default: Profile }>;

export type Folio = {
  /** The language shown when nothing else decides (no ?lang=, no stored choice). */
  primary: string;
  /** One profile per language, keyed by tag; every key other than `primary` may be a loader. */
  profiles: Readonly<Record<string, Profile | ProfileLoader>>;
};

const isProfile = (v: Profile | ProfileLoader | undefined): v is Profile => !!v && typeof v === "object";

/** The key a profile files under: its language's primary subtag ("zh-CN" → "zh"), "en" when it names none. */
export function langKey(tag: string | undefined): string {
  const t = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return t || "en";
}

/** A folio from a plain profile (one language, keyed by its own `lang`) or a folio as it is. */
export function toFolio(p: Profile | Folio): Folio {
  if ("profiles" in p && "primary" in p) return p;
  const key = langKey(p.lang);
  return { primary: key, profiles: { [key]: p } };
}

/** The folio's languages: the primary first, then the others in the order they are written. */
export function folioLangs(f: Folio): string[] {
  const keys = Object.keys(f.profiles);
  return keys.includes(f.primary) ? [f.primary, ...keys.filter((k) => k !== f.primary)] : keys;
}

/**
 * The folio's language for a tag, or null: the exact key (any case), else the first key with the same primary subtag — so
 * `zh-CN`, `zh-Hans` and `zh-TW` all reach a folio's "zh", and `zh` reaches a folio keyed "zh-CN".
 */
export function matchLang(f: Folio, tag: string | null | undefined): string | null {
  const t = (tag ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!t) return null;
  const langs = folioLangs(f);
  const exact = langs.find((k) => k.toLowerCase() === t);
  if (exact) return exact;
  const head = langKey(t);
  return langs.find((k) => langKey(k) === head) ?? null;
}

/**
 * The language to show first (brief r4 E1): `?lang=` (also the old `?sample=zh`, passed in as `param`), else the visitor's stored
 * choice, else the folio's primary. The browser's languages are not asked (owner 2026-10-23: the page opens in its primary language
 * until the visitor picks another). Pure: the caller reads the URL and storage.
 */
export function pickLang(f: Folio, from: { param?: string | null; stored?: string | null } = {}): string {
  return matchLang(f, from.param) ?? matchLang(f, from.stored) ?? f.primary;
}

/** The profile of a language already in memory (the primary, or one loaded before), or null. */
export function loadedProfile(f: Folio, lang: string): Profile | null {
  const v = f.profiles[lang];
  if (isProfile(v)) return v;
  return cache.get(f)?.get(lang)?.value ?? null;
}

type Entry = { p: Promise<Profile>; value: Profile | null };
const cache = new WeakMap<Folio, Map<string, Entry>>();

/**
 * The profile of a language (`lang` as folioLangs gives it, or any tag matchLang accepts), loaded once per folio. Rejects for a
 * language the folio does not have, or when its module fails to load — not cached then, so a later call tries again.
 */
export function loadProfile(f: Folio, lang: string): Promise<Profile> {
  const key = matchLang(f, lang);
  const v = key ? f.profiles[key] : undefined;
  if (!key || !v) return Promise.reject(new Error(`[sasshi] this folio has no "${lang}" profile`));
  if (isProfile(v)) return Promise.resolve(v);
  let byLang = cache.get(f);
  if (!byLang) cache.set(f, (byLang = new Map()));
  let e = byLang.get(key);
  if (!e) {
    const entry: Entry = { p: Promise.resolve(null as unknown as Profile), value: null };
    entry.p = Promise.resolve()
      .then(v)
      .then((m) => {
        const p = m && "default" in m ? m.default : m;
        if (!p || typeof p !== "object" || !Array.isArray(p.items)) throw new Error(`[sasshi] the "${key}" profile module gave no profile`);
        entry.value = p;
        return p;
      })
      .catch((err: unknown) => {
        if (byLang!.get(key) === entry) byLang!.delete(key);
        throw err;
      });
    byLang.set(key, (e = entry));
  }
  return e.p;
}

/** Each language's own name, as its speakers write it (the switch shows these: "English · 中文"). */
const AUTONYMS: Record<string, string> = { en: "English", zh: "中文", ja: "日本語", ko: "한국어", fr: "Français", de: "Deutsch", es: "Español", it: "Italiano", pt: "Português" };
export function langName(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "zh-tw" || t === "zh-hk" || t === "zh-hant") return "繁體中文";
  const known = AUTONYMS[langKey(t)];
  if (known) return known;
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * What differs between two languages' profiles beyond their words, or [] when one can replace the other in place: the pouch items
 * (ids and kinds, in order; the polaroid's picture), the album cards (ids, colours, pictures) and postcards (ids, pictures, colours).
 */
export function shapeDiff(a: Profile, b: Profile): string[] {
  const out: string[] = [];
  const list = (name: string, x: readonly { id: string }[], y: readonly { id: string }[], same: (i: number) => string | null) => {
    if (x.length !== y.length) return void out.push(`${name}: ${x.length} vs ${y.length}`);
    for (let i = 0; i < x.length; i++) {
      if (x[i]!.id !== y[i]!.id) out.push(`${name}[${i}]: id ${x[i]!.id} vs ${y[i]!.id}`);
      else {
        const d = same(i);
        if (d) out.push(`${name}[${i}] ${x[i]!.id}: ${d}`);
      }
    }
  };
  const diff = (k: string, x: unknown, y: unknown) => (x === y ? null : `${k} ${String(x)} vs ${String(y)}`);
  list("items", a.items, b.items, (i) => {
    const x = a.items[i]!, y = b.items[i]!;
    if (x.kind !== y.kind) return `kind ${x.kind} vs ${y.kind}`;
    return x.kind === "polaroid" && y.kind === "polaroid" ? diff("image", x.image, y.image) : null;
  });
  list("cards", a.albums.cards, b.albums.cards, (i) => {
    const x = a.albums.cards[i]!, y = b.albums.cards[i]!;
    return diff("color", x.color, y.color) ?? diff("src", x.src, y.src);
  });
  list("postcards", a.albums.postcards, b.albums.postcards, (i) => {
    const x = a.albums.postcards[i]!, y = b.albums.postcards[i]!;
    return diff("src", x.src, y.src) ?? diff("color", x.color, y.color);
  });
  return out;
}
