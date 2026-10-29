import type { CoverColor, CoverFoil, CoverMaterial } from "./cover";

/*
 * The cover's colours and surface parameters (plain data, shared by the 3D scene and the 2D preview CoverPreview; no three).
 * The colours are low-saturation 和色: paper white, fog grey, sand, celadon, slate blue, moss, ochre, ink; sasshi: 藍鉄, 青磁,
 * 銀鼠 (cool, for the morning light).
 * - cloth and leather use base, the colour itself; frosted PP uses frost (a very faint tint; paper is the untinted milky white, ink a
 *   smoke grey)
 * - liner: the liner paper inside the cover (cloth and leather only; a light cover gets a near-white liner, a dark cover a dark liner
 *   of the same hue)
 */
export const COVER_HEX: Record<CoverColor, { base: string; frost: string; liner: string; dark: boolean }> = {
  paper: { base: "#e8e5de", frost: "#e9edef", liner: "#f2f0eb", dark: false },
  fog: { base: "#bcc2c8", frost: "#dde2e6", liner: "#eceef0", dark: false },
  sand: { base: "#cbbca4", frost: "#efe6d6", liner: "#f1ece2", dark: false },
  sage: { base: "#98a895", frost: "#dce6d9", liner: "#e8ece5", dark: false },
  slate: { base: "#56667a", frost: "#ccd7e3", liner: "#39434f", dark: true },
  moss: { base: "#4a5946", frost: "#ccd6c5", liner: "#38423a", dark: true },
  clay: { base: "#9a5d49", frost: "#ecd5cb", liner: "#efe5dd", dark: true },
  ink: { base: "#23272e", frost: "#9ea4ac", liner: "#2b3037", dark: true },
  // sasshi: the résumé folio (a light liner in a dark case), the cards, the postcards
  aitetsu: { base: "#34485c", frost: "#d3dde6", liner: "#e8edf0", dark: true },
  seiji: { base: "#9fb8b0", frost: "#d8e6e2", liner: "#ebf1ef", dark: false },
  ginnezu: { base: "#aab3bb", frost: "#e0e6ea", liner: "#eff2f4", dark: false },
};

/**
 * Foil stamps: silver and champagne-gold foil are metallic colours; blind has no colour, only a deboss (shown as the cover colour, a
 * little darker)
 */
export const FOIL_HEX: Record<Exclude<CoverFoil, "blind">, string> = {
  silver: "#d6dbe0",
  gold: "#dcbc78",
};

/**
 * Each material's surface parameters (for 3D): roughness, clearcoat, sheen (frosted PP is a very diffuse satin clearcoat: as the case
 * opens and shuts the softbox's reflection slides across the boards, see frost.ts)
 */
export const MATERIAL_LOOK: Record<CoverMaterial, { roughness: number; clearcoat: number; sheen: number }> = {
  frost: { roughness: 0.5, clearcoat: 0.3, sheen: 0 },
  cloth: { roughness: 0.86, clearcoat: 0, sheen: 0.7 },
  leather: { roughness: 0.5, clearcoat: 0.25, sheen: 0.15 },
};
