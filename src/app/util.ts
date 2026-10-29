import { hanLangOf } from "../fonts";
import type { PocketItem, Profile, Spec } from "../profile/schema";
import type { Dict } from "./i18n";

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** A handwritten signature: a Chinese message is signed with the double dash (—— 林), anything else with one (— Lin); as the 3D postcards. */
export function signature(message: string, from: string): string {
  return /\p{Script=Han}/u.test(message) && hanLangOf(message) !== "ja" ? `—— ${from}` : `— ${from}`;
}

/** Everything a detail caption / the text view shows as spec rows: the kind's own fields, then the author's rows. */
export function specRows(item: PocketItem, t: Dict): Spec[] {
  const rows: Spec[] = [];
  const s = t.spec;
  switch (item.kind) {
    case "card":
      rows.push({ k: s.name, v: item.front.name }, { k: s.role, v: item.front.role });
      rows.push(...item.inside);
      break;
    case "ticket":
      rows.push({ k: s.event, v: item.event });
      if (item.talk) rows.push({ k: s.talk, v: item.talk });
      rows.push({ k: s.date, v: t.date(item.date) });
      if (item.time) rows.push({ k: s.time, v: item.time });
      if (item.venue) rows.push({ k: s.venue, v: item.venue });
      if (item.city) rows.push({ k: s.city, v: item.city });
      if (item.seat) rows.push({ k: s.seat, v: item.seat });
      if (item.serial) rows.push({ k: s.serial, v: item.serial });
      break;
    case "polaroid":
      rows.push({ k: s.caption, v: item.caption });
      if (item.place) rows.push({ k: s.place, v: item.place });
      if (item.date) rows.push({ k: s.date, v: t.date(item.date) });
      break;
    case "note":
      rows.push({ k: s.from, v: item.from });
      if (item.date) rows.push({ k: s.date, v: t.date(item.date) });
      break;
    case "resume":
      break;
  }
  // Kind fields first (they describe the object itself), then the author's own rows.
  return [...rows, ...(item.specs ?? [])];
}

/** "mailto:a@b.c" -> "a@b.c"; "https://github.com/x/" -> "github.com/x". Used for display and as the copied text. */
export function linkText(href: string): string {
  if (href.startsWith("mailto:")) return href.slice(7).split("?")[0] ?? href;
  if (href.startsWith("tel:")) return href.slice(4);
  return href.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** The last path segment of a URL, for a short colophon value ("github.com/example/sasshi" → "sasshi"). */
export function shortLink(href: string): string {
  const t = linkText(href);
  const parts = t.split("/").filter(Boolean);
  return parts.length > 2 ? parts[parts.length - 1]! : t;
}

/** The language the URL asks for: ?lang=, or the older ?sample=zh (the Chinese sample's link before the switch existed). */
export function urlLang(search = typeof window === "undefined" ? "" : window.location.search): string | null {
  const q = new URLSearchParams(search);
  return q.get("lang") || q.get("sample") || null;
}

/**
 * A link to one of the page's own views (the desk, ?view=text, ?view=json) in the language on view (?lang=, `lang` when given), so a
 * visitor reading the Chinese folio stays in it.
 */
export function pageUrl(o: { view?: "text" | "json"; tab?: string; lang?: string } = {}): string {
  const q = new URLSearchParams();
  try {
    const lang = o.lang ?? urlLang();
    if (lang) q.set("lang", lang);
  } catch {
    /* no window: a plain link */
  }
  if (o.view) q.set("view", o.view);
  const search = q.toString();
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  return `${path}${search ? `?${search}` : ""}${o.tab ? `#${o.tab}` : ""}`;
}

/** The address bar in another language (?lang=, replacing the old ?sample=): the view, ?debug and the booklet's hash stay. */
export function writeUrlLang(lang: string): void {
  try {
    const q = new URLSearchParams(window.location.search);
    q.delete("sample");
    q.set("lang", lang);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q.toString()}${window.location.hash}`);
  } catch {
    /* a sandboxed frame: the language still changes, only the address does not */
  }
}

const LANG_KEY = "sasshi:lang";
/** The language the visitor picked last time (null: never, or storage is blocked). */
export function storedLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}
export function storeLang(lang: string): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private window / blocked storage */
  }
}
/** The new-tab arrow. U+FE0E asks for the text glyph: iOS draws a bare ↗ as the emoji whatever the font stack says. */
export const NE_ARROW = "\u2197\uFE0E";

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** HH:mm in the profile zone plus a short offset label, e.g. "14:32" and "GMT+8". Never throws on a bad zone. */
export function zonedClock(timezone: string | undefined, now: Date): { time: string; zone: string } {
  try {
    const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false, ...(timezone ? { timeZone: timezone } : {}) };
    const time = new Intl.DateTimeFormat("en-GB", opts).format(now);
    const zone = new Intl.DateTimeFormat("en-GB", { ...(timezone ? { timeZone: timezone } : {}), timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
    return { time, zone };
  } catch {
    return { time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now), zone: "" };
  }
}

export function findItem(profile: Profile, id: string): { item: PocketItem; index: number } | null {
  const index = profile.items.findIndex((i) => i.id === id);
  const item = profile.items[index];
  return item ? { item, index } : null;
}

const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};
export const prefersReducedMotion = () => mq("(prefers-reduced-motion: reduce)");
export const prefersReducedTransparency = () => mq("(prefers-reduced-transparency: reduce)");
/** A mouse or trackpad that can hover (tooltips, pointer tilt). */
export const finePointer = () => mq("(hover: hover) and (pointer: fine)");
export const coarsePointer = () => mq("(pointer: coarse)");

/** Cool, fixed fallback tint for album pictures that have neither src nor colour. */
export const FALLBACK_TINT = "#c9d3da";

/** Ignore single-key shortcuts while typing. */
export function typingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

/** "Asia/Shanghai" -> "GMT+8" (empty on a bad zone). */
export function zoneShort(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
