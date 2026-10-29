/*
 * The one content model. Everything the visitor can see comes from a Profile:
 *   - the 3D pouch (src/bag) builds its objects from `items`,
 *   - the DOM fallback / detail panels / a machine-readable view read the same data,
 *   - the albums (src/book) read `albums`.
 * Keep it plain JSON-serialisable so a person can edit one file (profile.ts or profile.json) and ship.
 * A folio in several languages is one Profile per language (folio.ts: `Folio`), the extra ones loaded on demand.
 */

export type Link = { label: string; href: string };

/** One "label: value" line of a spec sheet (detail panels, business-card back, ticket stub). */
export type Spec = { k: string; v: string };

type ItemBase = {
  id: string;
  /** Short name; used for tooltips, aria-labels, the DOM fallback. */
  label: string;
  /** One human sentence, ideally with a real number in it ("37 episodes, 1K+ followers"). */
  anecdote?: string;
  /** The story behind the object, two to four sentences, read in the detail view under the anecdote. */
  story?: string;
  /** Spec-sheet rows shown in the detail panel. */
  specs?: Spec[];
  href?: string;
  /** Extra links offered as actions in the detail view (slides, a recording, a repository). */
  links?: Link[];
};

export type BusinessCardItem = ItemBase & {
  kind: "card";
  front: { name: string; role: string; tagline?: string };
  /** Contact rows printed on the inside of the folded card. */
  inside: Spec[];
  /** One or two printed lines on the inside left panel, facing the contact rows. */
  insideNote?: string;
};

export type ResumeEntry = { org: string; role: string; from: string; to: string; bullets: string[] };
export type ResumeItem = ItemBase & {
  kind: "resume";
  summary: string;
  experience: ResumeEntry[];
  education: { school: string; degree: string; from: string; to: string }[];
  skills: string[];
  languages?: string[];
  /** Optional PDF the visitor can download. */
  pdf?: string;
};

export type TicketItem = ItemBase & {
  kind: "ticket";
  event: string;
  date: string;
  seat?: string;
  color?: string;
  /** Doors time, e.g. "09:30". */
  time?: string;
  venue?: string;
  city?: string;
  /** The talk given, when the ticket is a speaker pass. */
  talk?: string;
  /** Printed ticket number, e.g. "No. 0142". */
  serial?: string;
};
export type PolaroidItem = ItemBase & {
  kind: "polaroid";
  image?: string;
  caption: string;
  tint?: string;
  place?: string;
  /** When the photo was taken, e.g. "2025-11-03". */
  date?: string;
  /** Handwritten note on the back of the print. */
  back?: string;
};
/** 一筆箋: a narrow letter sheet with a short handwritten note to whoever opens the folio. */
export type NoteItem = ItemBase & { kind: "note"; text: string; from: string; date?: string };

export type PocketItem = BusinessCardItem | ResumeItem | TicketItem | PolaroidItem | NoteItem;
export type ItemKind = PocketItem["kind"];

/** A card in the card album: a photo or a flat colour, plus the label read aloud / shown in the panel. */
export type AlbumCard = { id: string; label: string; /** Native-script name, e.g. "瓶覗". */ nameLocal?: string; src?: string; color?: string; note?: string; href?: string };

/** A postcard: picture side + message side. */
export type Postcard = {
  id: string;
  label: string;
  src?: string;
  color?: string;
  message: string;
  from: string;
  place: string;
  /** The place in its own script, e.g. "雪の龍安寺". */
  placeLocal?: string;
  /** Photo credit, e.g. "Photo: Leongsan / Unsplash". */
  credit?: string;
  stamp?: string;
  /** Postmark date, e.g. "2024-05-02". */
  date?: string;
};

/**
 * The name seal in small seal script (小篆), as `bun run seal` writes it into profile/seal.ts: `name` is the Han name it was cut from,
 * `glyphs` the seal's characters in reading order (src/print/seal.ts), each an SVG path in its own units with its box [x, y, w, h].
 */
export type SealArt = { name: string; glyphs: { char: string; d: string; box: [number, number, number, number] }[] };

export type Profile = {
  /**
   * BCP 47 language of the person's own text (bio, anecdotes, résumé), e.g. "en", "zh-CN", "ja". Defaults to "en".
   * It picks the page chrome's language (English or Simplified Chinese) and the face for Han characters:
   * zh → Noto Serif SC / Noto Sans SC, ja (or any string with kana) → Shippori Mincho / Zen Kaku Gothic New.
   */
  lang?: string;
  name: string;
  /** Native-script name, shown beside `name` when present. */
  nameLocal?: string;
  handle?: string;
  role: string;
  location?: string;
  /** IANA zone for the live local-time label. */
  timezone?: string;
  bio: string;
  links: Link[];
  /** Cover title stamped on the folio. */
  coverTitle: string;
  /**
   * The bookplate's name seal in small seal script (profile/seal.ts, written by `bun run seal`). It is used while its `name` is
   * still this profile's Han name; otherwise, or when null, the seal is cut in the serif.
   */
  seal?: SealArt | null;
  /**
   * Public URL of this site's source code (your fork). The page links to it in the footer —
   * the AGPL-3.0 asks you to offer the source of what you deploy, and a link to a public fork does that.
   */
  source?: string;
  /** What lives in the clear pouch: a business card, the résumé, and a few things that tell your story (ticket, polaroid, a note). */
  items: PocketItem[];
  albums: { cards: AlbumCard[]; postcards: Postcard[] };
};
