/*
 * Public surface of the book engine. Importing this module never pulls three or the scene in: createBook below loads ./scene on
 * first use (a dynamic import, the same chunk BookView loads), and everything else from the scene side is exported as types only.
 */
import type { Book, BookOptions } from "./scene";

/** Creates a 3D book in `host`. Loads three and the scene on first use. Rejects when WebGL cannot start. */
export async function createBook(host: HTMLElement, opts: BookOptions): Promise<Book> {
  const m = await import("./scene");
  return m.createBook(host, opts);
}

export type { Book, BookOptions, BookCard, BookState, BookTheme, BookQuality, BookSoundName, BookSoundOptions, Insets, ScreenRect } from "./scene";
export type { SceneAddon, AddonAnchor, AddonContext } from "./addon";
export type { CaseSpec, CaseDims } from "./binder";
export type { LinerSpec } from "./liner";
export type { LinerSlip } from "./textures";
export { canRender3d } from "./support";
export { BookView, type BookViewHandle, type BookViewProps } from "./BookView";
export { LAYOUTS, resolveLayout, type BookLayout, type LayoutPreset, type LayoutSpec } from "./layout";
export { physicsFor } from "./physics-profile";
export {
  createCardContent,
  createPocketGrid,
  createPostcardContent,
  paintAlbumCard,
  paintPlainCard,
  paintPostcard,
  type ContentItem,
  type ContentSource,
  type PaintEnv,
  type PocketItem,
  type PostcardItem,
  type SlotCell,
  type SlotFace,
  type SlotPainter,
} from "./content";
export { FlatBook } from "./FlatBook";
export { DEFAULT_LABELS, type BookLabelItem, type BookLabels } from "./labels";
export { BOOKLET_COVERS, COVER_COLORS, COVER_FOILS, COVER_MATERIALS, DEFAULT_COVER, parseCover, type CoverColor, type CoverFoil, type CoverMaterial, type CoverSpec } from "./cover";
export { COVER_HEX, FOIL_HEX } from "./cover-style";
