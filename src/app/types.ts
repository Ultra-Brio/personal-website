import type { ComponentType } from "react";
import type { CoverMaterial } from "../book/cover";
import type { BookLabels } from "../book/labels";
import type { Profile } from "../profile/schema";
import type { Insets } from "./layout";

/** The desk holds the résumé folio (the two albums stay in the code for when their pictures are chosen). */
export type Tab = "cards" | "postcards" | "resume";
export const TAB_IDS: readonly Tab[] = ["resume"];
/** ?view= : the 3D desk (default), the text version, or the machine-readable JSON. */
export type View = "folio" | "text" | "json";
export const DEFAULT_TAB: Tab = "resume";

/** Device-motion state of the résumé folio's Tilt control (touch devices only). */
export type MotionUi = "off" | "asking" | "on" | "denied" | "unsupported";

/** Which face of a pouch object a still is rendered from; `shadow`: with its lift shadow baked in, on a transparent margin. */
export type SnapshotOptions = { side?: "front" | "back"; shadow?: boolean };
/**
 * A still of a pouch object: the image, and the transparent margin round the object on every side as a fraction of the image's
 * width (the same in px top and bottom). `shadow`: the margin holds the object's own baked shadow (the page adds none).
 */
export type Still = { url: string; pad: number; shadow: boolean };
export type Snapshot = (id: string, px: number, o?: SnapshotOptions) => Promise<Still | null>;

/**
 * What a live stage tells the shell, so the printed controls, the handling line and the keyboard can drive it.
 * `page`: an album's pages; `shake` / `motion`: the résumé folio's. `flat`: the stage drew its DOM fallback (no WebGL); the
 * shell's controls still drive it.
 */
export type StageApi = {
  ready: boolean;
  open: boolean;
  flat?: boolean;
  /** albums: page `index` of `count` (0-based) */
  page?: { index: number; count: number };
  prev?(): void;
  next?(): void;
  toggle?(): void;
  /** résumé folio */
  shake?(): void;
  motion?: { state: MotionUi; toggle(): void };
  /** A pouch object alone, rendered by the stage renderer: a PNG data URL (null when it cannot). */
  snapshot?: Snapshot;
};

/** Props every 3D stage (book / pouch) receives from the shell. */
export type StageProps = {
  profile: Profile;
  /** The case material the visitor picked for this booklet. */
  material: CoverMaterial;
  /** Where the book lies: the camera insets of the full-bleed canvas (layout.ts). */
  insets: Insets;
  /**
   * One page at a time (true): the phone structure (phones and the tablet portrait), where the open spread would be width-bound and
   * small. Left out: the engine decides from the canvas's shape.
   */
  narrow?: boolean;
  /** The booklet's local title for the 題簽 slip inside cloth and leather albums, and its Han language. */
  slip?: { title: string; han: "ja" | "zh-Hans" | "zh-Hant" };
  /** Labels of the book's own (hidden) controls, its keyboard links and its accessible region, in the page's language. */
  labels?: Partial<BookLabels>;
  /** A pouch object was tapped / activated: open its detail. */
  onPickItem(id: string): void;
  /** An album card or postcard was tapped: open its detail. */
  onPickCard(kind: "cards" | "postcards", id: string): void;
  /** True while this booklet is the visible one. */
  active: boolean;
  /**
   * The scene's ambient motion (the twig's sway in the window light) may run: false while a dialog is up or the tab is hidden, so
   * nothing re-renders behind a held thing (App useAmbient).
   */
  ambient: boolean;
  /** The stage cannot render (no WebGL, context lost for good...): the shell swaps this booklet to the printed version. */
  onUnsupported(): void;
  /** The stage's live state and actions (null when it unmounts). Optional: a stage without it simply has no controls. */
  onStage?(api: StageApi | null): void;
};

export type StageMap = Record<Tab, ComponentType<StageProps>>;

/**
 * The folio's languages (brief r4 E1): their tags (src/profile/folio.ts; the primary first), the one on view, and the switch, which
 * changes it in place. Only passed when there are two or more.
 */
export type Langs = { list: readonly string[]; current: string; set(lang: string): void };

/** What the detail view is currently holding. */
export type Detail = { type: "item"; id: string } | { type: "album"; kind: "cards" | "postcards"; id: string } | null;
