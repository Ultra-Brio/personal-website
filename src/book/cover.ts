/*
 * The album cover's settings (the data model; no three, no styles).
 * - material: frost, translucent frosted PP (the default; shut, the first page's cards show faintly through it), cloth (a fine
 *   linen-weave book cloth), leather (soft, plain leather)
 * - color: a set of restrained colours, used by all three materials: cloth and leather in the colour itself; frosted PP as a faint
 *   tint (paper is the untinted milky white)
 * - foil: the foil stamp of the album's name: silver (silver foil), gold (gold foil), blind (a colourless deboss)
 * - title: the name stamped on the cover
 * - window: the picture in the clear display pocket on the cover (null / left out: none)
 * Derived from CardArt's album-cover.ts; the CardArt-only fields (cardId, sleeve) are gone and the cover now carries its own title and window.
 */

export const COVER_MATERIALS = ["frost", "cloth", "leather"] as const;
export type CoverMaterial = (typeof COVER_MATERIALS)[number];

/**
 * paper white, fog grey, sand, celadon, slate blue, moss, ochre, ink; sasshi: 藍鉄, 青磁, 銀鼠 (the morning-light booklets; the older
 * keys stay for compatibility)
 */
export const COVER_COLORS = ["paper", "fog", "sand", "sage", "slate", "moss", "clay", "ink", "aitetsu", "seiji", "ginnezu"] as const;
export type CoverColor = (typeof COVER_COLORS)[number];

export const COVER_FOILS = ["silver", "gold", "blind"] as const;
export type CoverFoil = (typeof COVER_FOILS)[number];

export type CoverSpec = {
  material: CoverMaterial;
  color: CoverColor;
  foil: CoverFoil;
  title: string;
  /** The picture shown in the clear display pocket on the front cover. */
  window?: { src: string; color?: string } | null;
};

/**
 * sasshi: the three booklets' own cases (morning light: 青磁 frosted PP, 銀鼠 cloth blind-stamped, 藍鉄 leather in silver). The
 * material is the visitor's to switch; the colour and the foil belong to the booklet and stay. Titles: "Cards", "Postcards", and the
 * profile's coverTitle for the résumé folio.
 */
export const BOOKLET_COVERS = {
  cards: { material: "frost", color: "seiji", foil: "silver" },
  postcards: { material: "cloth", color: "ginnezu", foil: "blind" },
  resume: { material: "leather", color: "aitetsu", foil: "silver" },
} as const satisfies Record<"cards" | "postcards" | "resume", Pick<CoverSpec, "material" | "color" | "foil">>;

export const DEFAULT_COVER: CoverSpec = Object.freeze({ material: "frost", color: "paper", foil: "silver", title: "", window: null });

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

/** Lenient parse: an object or a JSON string; unknown values fall back to the defaults, never throws */
export function parseCover(raw: unknown): CoverSpec {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const w = o.window && typeof o.window === "object" ? (o.window as Record<string, unknown>) : null;
  return {
    material: pick(COVER_MATERIALS, o.material, DEFAULT_COVER.material),
    color: pick(COVER_COLORS, o.color, DEFAULT_COVER.color),
    foil: pick(COVER_FOILS, o.foil, DEFAULT_COVER.foil),
    title: typeof o.title === "string" ? o.title : DEFAULT_COVER.title,
    window: w && typeof w.src === "string" ? { src: w.src, ...(typeof w.color === "string" && { color: w.color }) } : null,
  };
}
