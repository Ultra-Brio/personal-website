import { COVER_HEX } from "../book/cover-style";
import { COVER_MATERIALS, type CoverColor, type CoverFoil, type CoverMaterial } from "../book/cover";
import type { LayoutPreset } from "../book/layout";
import type { ItemKind, Profile } from "../profile/schema";
import type { Dict } from "./i18n";
import { TAB_IDS, type Tab } from "./types";

/*
 * The three booklets on the desk (spec §2.4): each case's colour and foil are fixed per booklet (the material is the visitor's
 * choice, remembered per booklet); the words for them (names, local titles, handling lines) live in i18n.ts.
 *   Cards      青磁 seiji,   silver foil, leather; 2 × 4 card pockets a side
 *   Postcards  銀鼠 ginnezu, blind stamp, cloth; 2 × 3 A6 pockets a side
 *   Résumé     藍鉄 aitetsu, silver foil, frosted PP (owner 2026-10-23: the résumé folio in frost, the albums in the others)
 * The albums' pages are tall (brief r3 D3): an open spread of 2 × 3 cards or 2 × 2 postcards is so wide that it is small on a desk.
 */

export type Booklet = {
  id: Tab;
  color: CoverColor;
  foil: CoverFoil;
  /** The material when the visitor has not picked one. */
  material: CoverMaterial;
  /** The Japanese local title (the English page's hashira and 題簽 slip); a Chinese page uses i18n's. */
  local: string;
  /** The albums' pocket grid (src/book/layout.ts). */
  layout?: LayoutPreset;
};

export const BOOKLETS: readonly Booklet[] = [
  { id: "cards", color: "seiji", foil: "silver", material: "leather", local: "カード帖", layout: "idCard2x4" },
  { id: "postcards", color: "ginnezu", foil: "blind", material: "cloth", local: "絵葉書", layout: "postcard2x3" },
  { id: "resume", color: "aitetsu", foil: "silver", material: "frost", local: "履歴書" },
];

/** The local name of each pouch kind (the English page's; a Chinese page uses i18n's `held`). */
export const LOCAL_KIND: Record<ItemKind, string> = { card: "名刺", resume: "履歴書", ticket: "入場券", polaroid: "写真", note: "一筆箋" };

export const booklet = (id: Tab): Booklet => BOOKLETS.find((b) => b.id === id) ?? BOOKLETS[2]!;

/** How many things a booklet holds (the count after its name). */
export function countOf(profile: Profile, id: Tab): number {
  return id === "resume" ? profile.items.length : profile.albums[id].length;
}

/** The local title of a booklet (hashira, 題簽 slip): カード帖 / 絵葉書 / 履歴書, or 卡册 / 明信片 / 简历 for a Chinese page. */
export const localTitle = (t: Dict, id: Tab) => t.booklet[id].local;

export { COVER_MATERIALS as MATERIALS };
/** The swatch colours of a booklet's case: base (cloth, leather) and frost tint. The UI never invents its own. */
export const caseHex = (b: Booklet) => COVER_HEX[b.color];

const KEY = (id: Tab) => `sasshi:case:${id}`;

/** The visitor's material for each booklet (localStorage, every access in try/catch; defaults when blocked). */
export function readMaterials(): Record<Tab, CoverMaterial> {
  const out = {} as Record<Tab, CoverMaterial>;
  for (const id of TAB_IDS) {
    let m: CoverMaterial = booklet(id).material;
    try {
      const v = localStorage.getItem(KEY(id));
      if (v && (COVER_MATERIALS as readonly string[]).includes(v)) m = v as CoverMaterial;
    } catch {
      /* private window / blocked storage */
    }
    out[id] = m;
  }
  return out;
}

export function writeMaterial(id: Tab, m: CoverMaterial): void {
  try {
    localStorage.setItem(KEY(id), m);
  } catch {
    /* ignore */
  }
}
