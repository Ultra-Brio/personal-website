import * as THREE from "three";
import type { AddonContext, SceneAddon } from "./addon";
import { COVER_MATERIALS, type CoverSpec } from "./cover";
import { ensureFonts, fontsLoadedFor } from "../fonts";
import { caseFontRuns, createBinder, hingeAngles, prepaintSteps, type Binder, type BinderOptions, type BoardRect, type CaseSpec } from "./binder";
import { DESK_LAYER, FROST, FROST_LAYER, FROST_SHADOW, createFrost, createFrostShadow, frostCaster, type FrostPass } from "./frost";
import { createPocketGrid, sameGrid, type ContentSource, type PaintEnv } from "./content/grid";
import { resolveLayout, spreadOfPage, type LayoutPreset, type LayoutSpec } from "./layout";
import { carryPage, createPage, freePage, grabPage, grabPoint, holeAngle, pageKnotsInto, pageProgress, posePage, pullPage, restPage, seamFold, stepPage, turnPage, type PageBody, type PageEnv, type Physics } from "./physics";
import { physicsFor } from "./physics-profile";
import { GLOSS_ROUGHNESS, MM, PITCH, SLAB, panelRoot, restPhi, segOf, sheetGeometry, sheetMaterials, type SheetUniforms } from "./sheet";
import { DEFAULT_FONT, PALETTE, drawPockets, drawSheetNormal, pocketSteps, sideCanvas } from "./textures";
import { OCCLUDER_HEIGHT, createWindowLight } from "./window-light";

/*
 * The album's 3D scene: a ring binder (the case, the metal rings on the spine, a stack of clear pocket sheets) on a desk, the camera
 * above it at an angle.
 *
 * A sheet is a PVC pocket sheet holding cards: a column with a card in it is a stiff board, the heat seal between the columns is a soft
 * hinge, and the holes hang on the rings and slide along them (shape in sheet.ts).
 * Turning is a real physics simulation (physics.ts): every moving sheet is a chain of rigid bodies (inner column, seam, outer column)
 * under gravity, air drag, joint springs and damping, with contact and friction where it lands on the left and right stacks. A click /
 * key turn is a palm under the middle of the page carrying it over the top and letting go; a drag is a hand that holds the point pressed
 * and follows the pointer, and when the release counts as a turn the hand still holds that point and carries it on over the top (not
 * switched to a push from the spine).
 * Turning has a speed limit (PHYSICS.cap, soft saturation): in a slow drag the grabbed point stays right under the pointer, in a quick
 * fling the page lags and catches up smoothly; a page takes at least a few tenths of a second.
 * When pointer events come less often than frames (a 120 Hz screen with 60 Hz touch, a main-thread hitch), the hand's target is
 * interpolated by frame number between two successive pointer events, so it does not move one frame and stop the next.
 * Light: studio environment light (a softbox at the top left) + the key's soft VSM shadows (sasshi: the key is at the top right,
 * the window side; the canvas is transparent, the desk is the page's own); the pockets' clearcoat makes highlights slide across a lifted
 * page, and a lifted page casts a moving shadow on what lies under it.
 * sasshi (round 3): the window light is two lights from one direction — the key (the book's own sharp shadows) and the sun
 * (soft; the window's bars and a twig hang in the world above the desk and cast into its map only, window-light.ts) — and the desk's
 * shadow catcher shows both, the sun's kept off the page's words in screen space.
 *
 * The case and the metal are in binder.ts: closed it is a whole box (the rings inside), opened and closed by drag, click or button; when
 * it closes the left stack of sheets turns back with the front board.
 * The frosted PP case is translucent: each frame first draws everything but the case and blurs it level by level, and the case reads the
 * level that matches how far it is from what lies behind it (frost.ts).
 * Frames are rendered only while something animates; the shadow map is updated only when the picture changes; side textures are
 * composed only for the two spreads either side of the current one.
 */

/**
 * What of the canvas the page keeps for itself (px from each edge): the book is framed in the box the insets leave (sasshi: the
 * DOM's book box on a full-bleed canvas). left / right default to 0; negative values count as 0. The canvas is never clipped: while
 * the cover swings, the camera moves once between the two resting framings and the standing board may reach into the insets for a
 * moment, never past the canvas edge — except on a short landscape phone, where it may pass the physical screen edge.
 * sasshi: `anchor` (client px, optional) is the x the book's middle leans toward: the book is sized for the box as before, then
 * slides toward the anchor as far as the room its open spread leaves in the box allows (LEAN_CLEAR px kept at the near side), in both
 * resting framings and the swing between them; never in narrow mode. Without it the book stands in the middle of the box.
 */
export type Insets = { top: number; bottom: number; right?: number; left?: number; anchor?: number };

/**
 * One item of the album. `src` is the picture (omit it for a flat-colour card), `color` the placeholder / fallback colour.
 * `label` and `href` do not reach the canvas; BookView / FlatBook use them for the accessible link list and the DOM fallback.
 */
export type BookCard = { id: string; src?: string; color?: string | null; label?: string; href?: string };

/** Scene colours and font that used to be read from the host page (`--bg`, `--font-ui`). */
export type BookTheme = {
  /**
   * CSS colour of the page behind the book. sasshi: the canvas clears transparent (the page's own desk shows through it), so
   * this only tells the frosted cover what lies behind it. A function is read when the book is built. Default: the desk 朝霧 #e3e8eb.
   */
  background?: string | (() => string);
  /** CSS font-family list for the text stamped on the cover. Default: the system UI stack. */
  font?: string;
  /**
   * sasshi: the page's book serif (the stamped cover title, the folio liner's name, the album painters' serif) and its mono
   * (the liner's small capitals, the painters' mono). Give the same stacks as the page so the 3D print matches it. Without `serif`
   * the cover stamp keeps the original sans stamp; without either the painters use their system stacks.
   */
  serif?: string;
  mono?: string;
};

/** "auto" picks the low profile (quarter-res frost, 1024 shadow map and textures) when the shorter screen side is under 600 px. */
export type BookQuality = "auto" | "low" | "high";

/** sasshi: what the book can sound like (BookOptions.onSound). The engine only reports; the host owns the audio. */
export type BookSoundName = "pageTurn" | "pageLand" | "coverOpen" | "coverClose";
/** gain 0 … 1 (1 = a full-size event), pan −1 (left) … 1 (right) */
export type BookSoundOptions = { gain?: number; pan?: number };

export type BookState = {
  /** Wide (desktop): the current spread (0 … sheets); narrow: the current page (0 … pages − 1) */
  index: number;
  count: number;
  narrow: boolean;
  /** The cover is closed (or closing) */
  closed: boolean;
};

export type BookOptions = {
  /**
   * sasshi: what the pockets hold (content/grid.ts). Default: a pocket grid of `cards` (today's card binder behaviour).
   * Its `layout` is used unless BookOptions.layout is given.
   */
  content?: ContentSource;
  /** sasshi: the pocket grid (layout.ts): a preset name or a LayoutSpec. Default: the content's layout, else idCard2x3. */
  layout?: LayoutPreset | LayoutSpec;
  /** The card binder's items (shorthand for content: createPocketGrid({ items: cards })) */
  cards?: BookCard[];
  /**
   * sasshi: number of sheets, overriding the count derived from the content. 0 is a real state: no pages at all
   * (spreads 0 … 0, the cover still opens and closes) — the résumé folio.
   */
  sheets?: number;
  /** sasshi: the case — board size, spine depth, rings, the printed liner inside the front board. Default: the card binder. */
  case?: CaseSpec;
  /** sasshi: live things parented to the inside of a board (see addon.ts). The book adopts them and disposes them with itself. */
  addons?: SceneAddon[];
  /**
   * sasshi: drags that start on the desk (or that no page / cover / addon claims) tilt the whole book around its centre,
   * springing back when released; quick back-and-forth drags shake it. Also enables Book.shake / Book.setTilt.
   */
  tilt?: boolean;
  /** sasshi: open the cover by itself once the first spread is painted (default true). */
  autoOpen?: boolean;
  /** Material, colour, foil, the title stamped on it and the picture in its display pocket (`cover.window`). */
  cover: CoverSpec;
  theme?: BookTheme;
  quality?: BookQuality;
  narrow: boolean;
  /** What of each canvas edge is left to the page (px): the book goes in the box in the middle (sasshi: the DOM's book box, see Insets) */
  insets: Insets;
  onState: (s: BookState) => void;
  /** A card was clicked (its index); newTab: ⌘ / Ctrl held, or the middle button */
  onOpenCard: (index: number, newTab: boolean) => void;
  /** The first screen's card-face textures are ready and the first frame is drawn */
  onReady: () => void;
  /** Loading progress of the first screen's textures, 0–1 */
  onProgress?: (f: number) => void;
  /**
   * The WebGL context is lost: the host switches to the flat version. sasshi: only a context that stays lost — a lost one is
   * waited for (RESTORE_WAIT ms of a visible page) and, when the browser gives it back, the book rebuilds its GPU side and goes on;
   * onLost comes when it does not.
   */
  onLost: () => void;
  /**
   * sasshi: sound cues, reported when they happen (never on build, resize, theme changes or the debug poses):
   *  - "pageTurn": a page starts a turn the visitor asked for — a click / key / button turn when its page actually starts moving
   *    (staggered turns one after another), a drag once the page has been lifted past TURN_SOUND.drag of a turn, or a fling
   *    released before that. At most one per page motion. gain 1 for clicks, from the page's speed for drags; pan ±0.15 (the side it
   *    leaves).
   *  - "pageLand": that page coming down flat on a stack (once per motion; every pageTurn is followed by one), in the frame its free
   *    edge meets the stack. gain from the landing speed (quiet for slow drops); pan −0.4 on the left stack, +0.4 on the right. A page
   *    whose edge a drag lifted at least LAND_SOUND.lift (0.15 rad) without reaching the turn threshold falls back with a quiet
   *    pageLand and no pageTurn; one lifted less makes no sound at all.
   *  - "coverOpen" / "coverClose": the cover starts opening / closing (click, keys, buttons, the automatic opening, a cover drag on
   *    release — also the cover falling back after a drag that did not commit); gain from how far it has to go.
   * Pages carried by the front board while it closes, or brought back by it, make no sound of their own (the cover's sound covers it).
   */
  onSound?: (name: BookSoundName, o?: BookSoundOptions) => void;
};

export type Book = {
  next(): void;
  prev(): void;
  /** Close / open the cover */
  toggleCover(): void;
  /**
   * sasshi: swap the case in place (material, colour, foil, title, window) — only the case and its frosted pass are rebuilt; the
   * pages, the camera, the physics, the addons (re-hung on the new boards, their state untouched) and the open / closed state stay.
   * The old frame cross-fades into the new one (no new WebGL context). Not to be confused with debug.setCover(t), the opening pose.
   * Round 4 (E1): given `kase`, its print too — the liner, the 題簽 slip (another language) — in the same swap; its shape (board, depth,
   * rings) stays the book's (a new shape is a new book). It goes up once the faces it prints in have loaded (at most ~0.6 s; later ones
   * paint it again when they arrive), built a step at a time so that no frame waits on it.
   */
  setCover(cover: CoverSpec, kase?: CaseSpec): void;
  /**
   * sasshi (round 4, E1): what the pockets hold, swapped in place — the same album in another language. Taken only when it fits
   * the sheets as built (content/grid.ts sameGrid: the same layout, the same items in the same pockets, the same pictures): every side
   * is printed again from it — the pages in view under a short cross-fade once its faces have loaded (with a setCover asked for in the
   * same task, in the same fade), the rest in idle time — and the page, the cover, the camera and the addons stay. Returns false, and
   * changes nothing, when it does not fit: that needs a new book.
   */
  setContent(content: ContentSource): boolean;
  setNarrow(narrow: boolean): void;
  setInsets(insets: Insets): void;
  /**
   * sasshi (round 3): the window light's ambient motion — the twig sways (Room.tsx's ≤ 1.2° over 13 s each way), re-drawing
   * the sun's map and the frame at most 8 times a second, only while the page is visible and motion is not reduced. On by default.
   * The page turns it off while a dialog is up (the stage behind then stays still: no frame at all once nothing else moves) and on
   * again after; the book stops it by itself while the tab is hidden. A stopped twig holds its pose and sways on from there (its clock
   * runs only while it sways): no jump when it starts again, nor after a relayout or a lost context. Off, an idle book renders nothing — provided its addons are at
   * rest too (an addon whose update() still returns true keeps frames coming).
   */
  setAmbient(on: boolean): void;
  /**
   * sasshi (round 3): where the window light on the desk keeps off the page's words. Per edge of the view: px from that edge up
   * to which the sun and its shadows on the desk are gone (from) and from which they are whole (to; from === to: no fade). Screen
   * space, so it never drifts while the camera moves; the pattern itself belongs to the desk. On the book itself the light is never
   * faded (the book is never under the words). Default: no fade.
   */
  setLightFade(fade: LightFade): void;
  /** sasshi: a short damped jiggle of the whole book (strength 1 ≈ a firm shake). Needs `tilt`. */
  shake(strength?: number): void;
  /**
   * sasshi: tilt the whole book, e.g. from device orientation (radians, added to any drag tilt; smoothed; clamped to ±25°).
   * x turns it about the desk's x axis (positive lifts the far edge, lowers the near one), y about the desk's y axis (positive
   * lowers the right side). Needs `tilt`.
   */
  setTilt(x: number, y: number): void;
  dispose(): void;
  /** Always present (zero cost). Development only: hold a page turn or the cover at a given progress for screenshots */
  debug: {
    /** strip, seam: also hold the punched strip's deflection and the seam's fold at a value (rad), to look at the crease */
    setProgress(p: number, dir?: 1 | -1, bend?: { strip?: number; seam?: number }): void;
    setCover(t: number): void;
    release(): void;
    /** Stop the book's own frame loop; each call advances dt seconds by hand and draws one frame (deterministic frame-by-frame screenshots) */
    advance(dt: number): void;
    /**
     * grab: where the point the hand holds in a drag projects on screen (client px), to see how far it is from the pointer; ptr: the
     * pointer position the hand uses this frame (interpolated); goal: the direction angle the hand pulls the grabbed point to (rad, from
     * the pointer); closeAsked: close was pressed during a turn and waits for the pages to come down
     */
    state(): {
      spread: number;
      page: number;
      cover: number;
      grab: [number, number] | null;
      ptr: [number, number] | null;
      goal: number | null;
      closeAsked: boolean;
      sheets: { i: number; p: number; awake: boolean; finger: boolean; hand: boolean; carry: boolean; angles: number[]; seam: number; peak: number }[];
    };
    info(): { textures: number; geometries: number; sides: number; sheets: number; calls: number };
    /**
     * Physics parameters (may be changed directly; sheets built afterwards take the new values) — sasshi: this book's own copy
     * (physics-profile.ts), never the module-level PHYSICS
     */
    physics: Physics;
    /** sasshi: whole-book tilt (radians, as applied this frame), its lift off the desk (scene units), rendered frames so far, the camera's x and its distance from the world origin */
    tilt(): { x: number; y: number; lift: number; frames: number; dragging: boolean; cam: [x: number, distance: number] };
    /** sasshi: paint the printed parts again (liner, cover stamp, pages) — the web fonts arrived after the book was built */
    repaintPrint(): void;
    /**
     * sasshi: where the case is on screen as last rendered: the client-px bounds of each board's eight corners (front, spine,
     * back; the board thickness, the cover's pose and the whole-book tilt included) and of all three, with the canvas rect. The
     * framing checks read it (a frosted board is too close to the desk in colour to find by pixels).
     */
    screenBox(): { all: ScreenRect; front: ScreenRect; spine: ScreenRect; back: ScreenRect; canvas: ScreenRect };
  };
};

/** sasshi (round 3): Book.setLightFade — per view edge, px from it: the window light is gone up to `from`, whole from `to` */
export type LightFade = Record<"left" | "right" | "top" | "bottom", { from: number; to: number }>;

/** sasshi: a rectangle in client px (Book.debug.screenBox) */
export type ScreenRect = { left: number; top: number; right: number; bottom: number };


/* ── Turning feel ─────────────────────────────────────────────────── */
/** Turning several pages in a row: the soonest a page starts after the one before it started (s) */
const STAGGER = 0.11;
/** The least angle between the inner columns of two neighbouring sheets in flight (rad; the lower one may not pass through the upper one) */
const GAP = 0.2;
/** Drag: how many page widths of sideways travel make a whole turn (wide (desktop), narrow) */
const SPAN_WIDE = 1.35;
const SPAN_NARROW = 0.85;
/** On release: the progress and the speed (progress / s) that count as turned */
const COMMIT_P = 0.22;
const COMMIT_V = 0.9;
/** How many px the pointer must move to count as a drag (mouse, touch) */
const SLOP_FINE = 5;
const SLOP_TOUCH = 9;
/**
 * Hovering near a page edge: how far a finger gently lifts the edge (rad) and the hand's strength; hovering over the closed cover: how far
 * the cover lifts
 */
const HOVER_LIFT = 0.05;
const HOVER_SOFT = 1;
const HOVER_COVER = 0.025;
/**
 * When a sheet carried by the closing front board is let go to the physics: the sheet (a straight board swinging with the front board) is
 * released [0] rad past vertical and topples onto the right stack by itself; each one lower in the stack (nearer the front board) [1] rad
 * later — the top one falls first, then one after another
 */
const CARRY_RELEASE: [number, number] = [0.03, 0.07];
/**
 * sasshi: framing (placeCamera). At rest every board stays inside the canvas less EDGE of each side, however far that takes the
 * camera. While the cover swings the camera goes once from the resting framing at one end to the one at the other (see swingCam): the
 * standing front board leans toward the camera and, in perspective, reaches up to a third of the book's height past its resting
 * outline (at the top) — into the page's margin and header, which is fine inside the canvas; where a pose would leave the canvas the
 * camera's ease waits for it, and the shut framing keeps whatever room a one-way swing still needs (fitSwing, shutRoom: the camera
 * never steps back and comes again). On a short landscape phone (tight) the standing board
 * may pass the physical top and bottom edges for a moment (brief O3) rather than the whole book shrinking by a third.
 */
const EDGE = 0.0075;
/**
 * sasshi: the swing's ease (fitSwing): poses sampled across the swing, rounds of smoothing its pace; the most room the shut
 * framing may keep for a one-way swing (shutRoom, on its distance)
 */
const SWING_SAMPLES = 48;
const SWING_SOFT = 6;
const SHUT_ROOM_MAX = 1.6;
const SHUT_DROP = 0.5;
/** sasshi: narrow (phone) folio: px between the pouch's board area and the canvas edge (16 px plus the near edge's perspective) */
const NARROW_GUTTER = 20;
/** sasshi: narrow (phone): px left on each side of the closed cover (the page's 20 px margin; the swing blends to the open framing) */
const CLOSED_GUTTER = 20;
/** sasshi: narrow (phone) album, open: px between the outer edge of the board under the page in view and the canvas edge */
const BOARD_GUTTER = 8;
/**
 * sasshi (round 4, E2): the phone's page camera (narrow, open album; stepPageCam). Each page has one resting framing (pageFrame);
 * between two of them the camera goes along one line in (1 / distance, x / distance), so every point of the desk slides straight
 * across the screen and the page keeps its size. What moves it: the turning sheet (its progress through turnEase), a finger panning
 * the spread (followed directly), else the camera by itself. speed: the most it moves the picture, in canvas widths a second (1.85 %
 * of the width a frame at 60 Hz; a change of distance counts as that share of it); accel: how fast it gets up to that speed and
 * down again (widths / s²) — so it sets off and comes to rest softly, and a fling or a quick turn makes it trail the sheet a little.
 */
const PAGE_CAM = { speed: 1.11, accel: 4 };
/**
 * sasshi: how long a lost WebGL context is waited for (ms the page is visible) before the book gives up (onLost). Chrome gives a
 * context back within a second or so after a GPU reset, and the one it took to make room for a newer one when that is released.
 */
const RESTORE_WAIT = 5000;
/** sasshi: the longest step a rendered frame takes (s); see tick */
const DT_MAX = 1 / 30;
/**
 * sasshi (round 3, D4): the highest pixel ratio a moving book is drawn at (setRatio); null: always the full one. Off: measured at
 * 1440 × 900 (ratio 1.75 → 1.5, M-series, headless Chrome on Metal), a frame with the switch costs 21–28 ms against 6–9 ms for one
 * without — three re-sizes the canvas's (multisampled) drawing buffer each way — while the lighter frames saved under 1 ms. Turn it
 * on (≈ 1.25 … 1.5) for a target whose frames are bound by fill rate.
 */
const MOVING_RATIO: number | null = null;
/**
 * sasshi (round 4, E7): the most device pixels the canvas is drawn at (its backing store, the frosted pass's targets follow it).
 * On a large screen the pixel ratio comes down so that width × height × ratio² stays within it: 2512 × 1233 CSS px at DPR 2 is drawn
 * at ≈ 1.6 (8 Mpx) instead of 1.75 (9.5 Mpx); up to ≈ 2.6 M CSS px (2150 × 1210) nothing changes. Round 4 had 6.5 Mpx (≈ 1.45 there: the edges
 * kept 81–94 % of their contrast on 1:1 crops, a frame cost the GPU ≈ 15 % less); the owner found the print a little soft at that, so
 * it sits between the two.
 */
const PIXEL_BUDGET = 8e6;
/** sasshi: the px a book leaning toward Insets.anchor keeps clear of the box's edge on that side */
const LEAN_CLEAR = 16;
/** How long the cover takes to open, to close (s) */
const OPEN_TIME = 1.6;
const CLOSE_TIME = 1.35;
/** The metal's roughness and clearcoat roughness at rest (as in binder.ts), and the equivalent shutter of the highlights' motion blur (s) */
const STEEL_ROUGH = 0.3;
const STEEL_COAT = 0.25;
const STEEL_SHUTTER = 0.05;
/** A cover flung from a drag: the most starting speed carried into the open / close tween (openness / s) */
const COVER_FLING = 1.6;
/**
 * Drag: the least radius used to turn the pointer into the hand's direction (scene units): held near the rings, a small pointer move does
 * not swing the page round a long way (physically the hand still holds that point)
 */
const DRAG_R = 0.4;
/**
 * A drag started on the rings or the punched strip: the grabbed point is taken this far out from the plate root (scene units), not at
 * the page edge
 */
const GRAB_ROOT = 0.15;
/** Drag, pointer to direction: within [0] rad of lying flat the plane solution (monotonic), by [1] rad the intersection with the circle */
const DRAG_FLAT: [number, number] = [0.3, 0.65];

/* ── sasshi: sound cues (BookOptions.onSound) ─────────────── */
/**
 * pageTurn. drag: progress (0 … 1 of a turn) a dragged page must reach before it sounds (0.05 ≈ 9°: a twitch makes no pageTurn);
 * gap: a page that turned less than this ago (s) does not sound again (a quick reversal is one swoosh); riffle: turns of different
 * pages closer than this (s) are a riffle, each one a little softer (riffleGain).
 */
const TURN_SOUND = { drag: 0.05, gap: 0.15, riffle: 0.2, riffleGain: 0.7 };
/**
 * pageLand. band: every link within this of lying flat (rad) counts as landed — the frame the free edge meets the stack (measured: a
 * click turn's speed halves in the frame it enters 0.12 rad; 0.05 would sound two frames late); lift: without a pageTurn, a motion must
 * have lifted some link at least this far (rad) to land with a sound (a page that made its pageTurn always does); hold: decay of the
 * speed peak (s);
 * speeds (rad/s of the fastest link): quiet at or below slow (gain floor), full at full; riffle: landings closer than this (s) soften.
 */
const LAND_SOUND = { band: 0.12, lift: 0.15, hold: 0.15, slow: 0.6, full: 8.5, floor: 0.12, riffle: 0.06, riffleGain: 0.6 };

/* ── sasshi: whole-book tilt (BookOptions.tilt) ─────────────── */
/**
 * max: largest tilt (rad). span: a drag of this fraction of the canvas's shorter side reaches about 76 % of max (tanh).
 * hz: the tilt spring's natural frequency (critically damped, so it springs back without overshoot).
 * jolt: the book also slides a little with the pointer's velocity — k scene units per (shorter side / s), at most max, on a stiffer
 * spring (hz); a quick back-and-forth drag shakes it. velTau: low-pass on the pointer velocity (s).
 * device: smoothing of setTilt (s). shake: one jiggle — frequency (Hz), decay (s), lifetime (s), slide amplitude (scene units),
 * turn about the vertical (rad) and tilt (rad) at strength 1.
 */
const TILT_FEEL = {
  max: THREE.MathUtils.degToRad(25),
  span: 0.35,
  hz: 2.6,
  jolt: { k: 0.07, max: 0.2, hz: 5 },
  velTau: 0.04,
  device: 0.12,
  shake: { hz: 5.5, tau: 0.2, life: 1.1, move: 0.1, turn: 0.05, tilt: 0.035 },
};

/* ── Easing ───────────────────────────────────────────────────────── */
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const approach = (cur: number, target: number, tau: number, dt: number) => target + (cur - target) * Math.exp(-dt / tau);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/**
 * sasshi (round 4, E2): where the phone's camera is between two pages (0 … 1) while a sheet turns from one to the other — where
 * the middle of the turning sheet is over the desk (its inner column at progress q: (1 − cos πq) / 2), so the sheet stays in the
 * middle of the view and the camera starts and arrives with it
 */
const turnEase = (q: number) => (1 - Math.cos(Math.PI * clamp(q, 0, 1))) / 2;
/** sasshi: the camera's ease over the openness (placeCamera's swingEase): the share of each end it eases in / out over, and its table */
const SWING_EDGE = 0.08;
const SWING_TABLE: Float32Array = (() => {
  const n = 256;
  const out = new Float32Array(n + 1);
  // the cover tween's speed at openness c (progress per unit of time, the Hermite 3x² − 2x³ inverted), eased in / out at the ends
  const w = (c: number) => {
    const x = 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
    const v = 6 * x * (1 - x);
    const r = smooth(clamp(c / SWING_EDGE, 0, 1)) * smooth(clamp((1 - c) / SWING_EDGE, 0, 1));
    return v > 1e-6 ? r / v : 0;
  };
  let acc = 0;
  let prev = w(0);
  for (let i = 1; i <= n; i++) {
    const cur = w(i / n);
    acc += (prev + cur) / (2 * n);
    out[i] = acc;
    prev = cur;
  }
  for (let i = 0; i <= n; i++) out[i]! /= acc;
  return out;
})();
/** The front board's angle at openness c (π lying flat on the left … 0 shut on top; as binder.pose's front) */
const frontOf = (c: number) => {
  const [a1, a2] = hingeAngles(c);
  return Math.PI - a1 - a2;
};

/**
 * sasshi (round 3, D1): `t` is the time the tween has run (s), advanced by each frame's clamped step (tick's DT_MAX) — never read
 * off the wall clock, so a long frame on a loaded machine moves the cover one ordinary step, not to where it would be by now.
 */
type Tween = { from: number; to: number; t: number; dur: number; v0: number; v1: number };
/** Cubic Hermite: start and end progress and start and end speed (progress / s) all match, so the speed at release carries on */
function tweenAt(tw: Tween) {
  const x = clamp(tw.t / tw.dur, 0, 1);
  const x2 = x * x;
  const x3 = x2 * x;
  return (2 * x3 - 3 * x2 + 1) * tw.from + (x3 - 2 * x2 + x) * tw.dur * tw.v0 + (-2 * x3 + 3 * x2) * tw.to + (x3 - x2) * tw.dur * tw.v1;
}

/**
 * sasshi (round 4, E2): one move of the phone's page camera, from where it was (a0, b0 = 1 / distance, x / distance) to the
 * framing of page `to` (a1, b1); u is how far along (it may run a little past either end while it turns round), v its rate (1 / s).
 * span: the most the picture moves (canvas widths, or the share of the distance) per unit of u; shift: how far the view's middle
 * slides (canvas widths) per unit of u — a finger's pan is mapped through it. A move tied to a sheet follows its progress toward `to`
 * ((p − base) · sign through turnEase); a pan follows `fu` while a finger holds it, then goes to `goal`.
 */
type PageMove = { a0: number; b0: number; a1: number; b1: number; to: number; u: number; v: number; ut: number; span: number; shift: number; sheet: Sheet | null; base: number; sign: 1 | -1; finger: boolean; fu: number; goal: 0 | 1 };

type Sheet = {
  index: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  depth: THREE.MeshDepthMaterial;
  u: SheetUniforms;
  /** 0 lying flat on the right, 1 lying flat on the left (the inner column's angle / π) */
  p: number;
  /** Physics: this sheet's chain of rigid bodies */
  body: PageBody;
  /** Hovered: a finger gently lifts the page edge */
  hovering: boolean;
  /** Posed for a development screenshot: the hole angle is not refreshed from the rest position */
  pinned: boolean;
  /** Angular speed (rad / s) while carried by the closing front board (no physics, posed directly): the highlights' motion blur needs it */
  wKin: number;
  /** While closing: already let go from the front board to the physics (toppling onto the right by itself) */
  loose: boolean;
  /** sasshi: the page motion followed for sound cues (pageTurn / pageLand) */
  snd: SheetSound;
};

/**
 * sasshi: one page motion the visitor started, followed until the page lands. motion: being followed; lift: how far it left
 * a flat rest so far (rad, the worst link); peak: the fastest link lately (rad/s, decaying over LAND_SOUND.hold); turnAt: a click turn
 * waiting for its staggered start (sim clock, NaN: none); turnT: when this page last made a pageTurn (sim clock); dir: 1 forward, −1 back;
 * turned: this motion made its pageTurn (so it will land with a pageLand)
 */
type SheetSound = { motion: boolean; lift: number; peak: number; turnAt: number; turnT: number; dir: 1 | -1; turned: boolean };

type SideTex = { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; loaded: boolean; gen: number };

/** A point on a page: u is the distance from the plate root (the end of the punched strip) (scene units, −1 when not on a page) */
type Pick = { kind: "cover" } | { kind: "page"; side: "L" | "R"; card: number; v: number; u: number } | null;

/** Card pictures: each URL is downloaded once; at most this many are kept */
const IMAGE_CACHE = 96;

/**
 * sasshi: the one studio (a cool room at six in the morning, the window at the top right of the page): the window's light —
 * the sun a touch warm, the key (the rest of it) a touch cool, together the old neutral 0xfaf9f6 (linear, by SUN.share) — so what
 * lies in the sun's shade keeps the cool of the sky (round 3); the hemisphere light's sky and ground, and the ink every shadow darkens
 * toward (never black, never warm).
 */
const STUDIO = { key: 0xf4fbff, sun: 0xfff7ec, sky: 0xeef3f8, ground: 0xd2dbe3, shadow: 0x15233a };
/**
 * sasshi (round 3): the canvas's exposure. With the page's light layers gone from above the canvas (their colour-dodged sunlit
 * patch used to lift the book), the book is drawn at round 2's brightness by itself (1.22 before).
 */
const EXPOSURE = 1.36;
/**
 * sasshi (round 3, D2): the window's light. share: the sun's part of it (the rest is the key's, see the lights); map: the sun's
 * shadow map (desktop, phone); radius / samples: its VSM blur (texels; 2 × radius = samples − 1 — whole-texel taps over an even
 * span, so the window bars' 2 × 2 screen averages out exactly, window-light.ts; a phone's map spans its shut framing too, which is
 * farther off than the open one, so its texels are larger and its blur fewer of them); desk: the desk catcher's darkness under a full leaf
 * (desktop, phone): a leaf's shade on the desk as deep as on pale paper in the book (≈ 12 % at 1440, round 3; the bars ≈ 8 %);
 * swayMs: the twig's frame interval (6 a second: a sway frame costs about as much as any frame, and at 1.2° in 13 s the leaf tips move
 * ≈ 0.25 px a step).
 */
const SUN = { share: 0.53, map: [2048, 1024] as const, radius: [3.5, 1.5] as const, samples: [8, 4] as const, desk: [0.135, 0.13] as const, swayMs: 160 };

/** Page background used when BookOptions.theme.background is not given: the desk, 朝霧. */
const BG = "#e3e8eb";

/** sasshi: the theme's families the album painters set their print in (PaintEnv) */
type PageFonts = { sans: string; serif?: string; mono?: string };

export async function createBook(host: HTMLElement, opts: BookOptions): Promise<Book> {
  // the text printed on the book waits for its fonts first (at most 600ms): sasshi: the case's print (stamped title, liner, slip)
  // in its src/fonts faces, loaded for the exact strings it prints; the album painters' theme families. When they arrive later than
  // that, the print (liner, stamp, slip, pages) is painted again once they are in.
  const font = opts.theme?.font?.trim() || DEFAULT_FONT;
  const fonts: PageFonts = { sans: font, serif: opts.theme?.serif?.trim() || undefined, mono: opts.theme?.mono?.trim() || undefined };
  const faces = [`600 48px ${font}`, fonts.serif && `500 48px ${fonts.serif}`, fonts.serif && `400 48px ${fonts.serif}`, fonts.mono && `400 48px ${fonts.mono}`].filter((f): f is string => !!f);
  const all = Promise.all([...faces.map((f) => document.fonts.load(f).catch(() => [])), ensureFonts(caseFontRuns(opts.cover.title, opts.case ?? {}))]);
  const late = await Promise.race([all.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 600))]);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  try {
    const book = buildBook(host, opts, renderer, fonts);
    if (late) void all.then(() => book.debug.repaintPrint());
    return book;
  } catch (e) {
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    renderer.domElement.remove();
    throw e;
  }
}

function buildBook(host: HTMLElement, opts: BookOptions, renderer: THREE.WebGLRenderer, fonts: PageFonts): Book {
  const font = fonts.sans;
  // sasshi: the content and its pocket-grid layout; the sheet's segments, page size and physics all follow the layout. The content
  // may be swapped for one with the same grid (setContent: another language); its items, layout and pictures stay those of the build
  let content = opts.content ?? createPocketGrid({ items: opts.cards ?? [] });
  const COUNT = content.items.length;
  const layout = resolveLayout(opts.layout ?? content.layout ?? "idCard2x3");
  const SEG = segOf(layout);
  const PW = SEG.w;
  const PAGE_W = layout.pageW;
  const PAGE_H = layout.pageH;
  /** The sheet's two lengths (root → seam centre line → page edge) and its height */
  const GEOM = { inner: (SEG.a2 + SEG.b2) / 2 - SEG.b1, outer: SEG.w - (SEG.a2 + SEG.b2) / 2, height: SEG.h };
  /** The least progress between two neighbouring sheets carried by the closing front board: the angle of one pocket's thickness */
  const CARRY_GAP = (1.2 * PITCH) / ((SEG.w - SEG.b1) * Math.PI);
  /** This book's physics (a scaled copy of PHYSICS) */
  const P = physicsFor(layout);
  const SHEETS = Math.max(0, Math.floor(opts.sheets ?? layout.sheetCount(COUNT)));
  const PAGES = SHEETS === 0 ? 1 : layout.pageCount(COUNT);
  const addons = opts.addons ?? [];

  const theme: BookTheme = opts.theme ?? {};
  let narrow = opts.narrow;
  let insets = opts.insets;
  const pal = PALETTE;
  let disposed = false;

  // sasshi: the canvas clears transparent — the page's desk (its washi fibres) shows through, the shadows land on it, the book
  // covers it. bg is still the desk's colour: the frosted cover's background pass draws what lies behind the boards in it (bgBehind).
  const bg = new THREE.Color();
  const readBg = () => {
    const want = typeof theme.background === "function" ? theme.background() : theme.background;
    bg.set(cssColor(want?.trim() || BG, BG));
    renderer.setClearColor(bg, 0);
  };
  // phone: a smaller shadow map and smaller page textures (a small screen; saves GPU memory and the blur every frame)
  const small = opts.quality === "low" || (opts.quality !== "high" && Math.min(screen.width, screen.height) < 600);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  // VSM: soft shadows, evenly soft all over (a lifted page is some way above the page under it; its shadow should be blurred)
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const canvasEl = renderer.domElement;
  // Inline styles replace CardArt's `.ab-gl` class: fill the host, no browser pan / zoom while dragging pages, fade in once the first frame is ready.
  const fadeMs = matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 420;
  Object.assign(canvasEl.style, { display: "block", width: "100%", height: "100%", touchAction: "none", opacity: "0", transition: `opacity ${fadeMs}ms cubic-bezier(0.22, 1, 0.36, 1)` });
  canvasEl.setAttribute("aria-hidden", "true");
  host.appendChild(canvasEl);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  readBg();
  /** The studio's prefiltered environment: a render target (made again when a lost context comes back, see `restored`) */
  const studioEnv = () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = studioScene();
    const rt = pmrem.fromScene(studio, 0.02);
    studio.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    pmrem.dispose();
    return rt;
  };
  let envRT = studioEnv();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 40);
  // layer 1 is the frosted case (drawn by the main render, not by the background seen through it); layer 2 is the desk (fully open,
  // the frost background draws only it)
  camera.layers.enable(FROST_LAYER);
  camera.layers.enable(DESK_LAYER);
  /** The camera's tilt (from straight above, leaning toward the viewer) */
  const TILT = THREE.MathUtils.degToRad(9);

  /* ── Case and metal ── */
  /** sasshi: the case is rebuilt in place by setCover(): `binder` and `dims` follow it (only CT, drop and spineInset differ by material) */
  let curCover: CoverSpec = opts.cover;
  /**
   * sasshi (round 4, E1): the case's print as built (the liner, the 題簽 slip); setCover with a case swaps it. Its shape (board,
   * depth, rings) is always the build's: the frame, the rings and the pages are made for it (caseOf)
   */
  const caseOf = (k: CaseSpec): CaseSpec => ({ ...k, board: opts.case?.board, depth: opts.case?.depth, rings: opts.case?.rings });
  let curCase: CaseSpec = caseOf(opts.case ?? {});
  const binderOpts = (c: CoverSpec, k: CaseSpec = curCase): BinderOptions => ({ sheets: SHEETS, cover: c, title: c.title, windowCard: c.window ? { color: c.window.color ?? null } : null, maxAniso, linerPx: small ? 1024 : 1536, case: k, seg: SEG, layout });
  const makeBinder = (c: CoverSpec, k: CaseSpec = curCase): Binder => createBinder(binderOpts(c, k));
  let binder = makeBinder(curCover);
  let dims = binder.dims;
  /** sasshi: how far the ring stack reaches past the plate root on the spine side (scene units; 0.26 for the card binder's 13 mm rings); narrow framing keeps it in view */
  const RING_SIDE = opts.case?.rings === false ? 0 : 2 * dims.R;
  /**
   * sasshi: everything that belongs to the book (case, metal, sheets) hangs off one group, so the whole book can be tilted;
   * the desk, its contact shadows, the lights and the camera stay in the world. Identity unless tilted.
   */
  const bookGroup = new THREE.Group();
  bookGroup.matrixAutoUpdate = false;
  scene.add(bookGroup);
  bookGroup.add(binder.group);
  let HALF_W = dims.xb + dims.B;
  /**
   * The frosted case's screen-space translucency (cloth and soft leather skip it). sasshi: created when a frosted case is first
   * shown, dropped when it goes
   */
  let frost = binder.frost ? createFrost(renderer, small ? 0.25 : 0.5, SHEETS * PITCH) : null;
  if (frost) frost.patch(binder.caseMaterial);
  /**
   * The frosted boards' soft translucent shadow: the desk, the sheets, both stacks and the case all take it (frost.ts). sasshi:
   * always present (at strength 0 under cloth / leather it leaves the light exactly as it was), so a swap to frost needs no recompiles of
   * the desk and the sheets
   */
  const frostShadow = createFrostShadow();
  frostShadow.patch(binder.caseMaterial);
  /**
   * The base colour for the background seen through the frost: worked back through the tone mapping, so the desk seen through the frost
   * matches the desk seen directly beside it
   */
  const bgBehind = new THREE.Color();
  const bgLit = new THREE.Color();
  const keyDir = new THREE.Vector3();
  const bgInside = new THREE.Color();
  /**
   * How many times deeper the desk's shadows are drawn in the frost background: the background is linear light before tone mapping, a
   * pale desk falls in the highlight compression, and the same share of occlusion maps out much lighter — while the desk's shadows seen
   * directly are laid over in sRGB on the canvas. A factor worked back through the tone curve makes the desk's shadows seen through the
   * frost (of the pages, the rings, the frosted boards themselves) as deep as those seen directly beside them
   */
  let deskGain = 1;

  /*
   * ── Lights: the key (soft shadows) + a very faint sky light. sasshi: the key comes from the window side, the top right of the page ──
   * Round 3 (D2): the window's light is split in two lights from the same direction. `key` (1 − SUN.share of it) keeps its tight,
   * sharp shadow map of the book alone, exactly as before; `sun` (SUN.share) has a wide, soft map of the book AND of the window's
   * occluders (the bars and the twig, window-light.ts) — so the leaves take away the sun's share wherever they fall, the book's own
   * shadows take away both. The key's shadow intensity is raised so a page's shadow on the page under it is as deep as before.
   * Order matters: the key is added before the sun, so in every shader directionalShadowMap[0] is the key's and [1] the sun's (three
   * sorts shadow-casting lights stably, in scene order) — the desk catcher reads them apart.
   */
  const key = new THREE.DirectionalLight(STUDIO.key, 1.35 * (1 - SUN.share));
  key.position.set(2.9, 0.75, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 10;
  key.shadow.radius = small ? 8 : 14;
  key.shadow.blurSamples = small ? 10 : 16;
  // no slanted self-shadow stripes on the face the key grazes (an outer column just lifted): the depth is pushed out a little along the
  // normal (scene units), plus a small constant offset
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.015;
  // sasshi: what a page's shadow leaves of the whole window light stays 0.3 (the key alone used to be 1.35 at 0.7)
  key.shadow.intensity = 1 - 0.3 / (1 - SUN.share);
  scene.add(key, key.target);
  // both maps are drawn only when asked (keyMap / the sun in render), never by three on every frame
  key.shadow.autoUpdate = false;
  const sun = new THREE.DirectionalLight(STUDIO.sun, 1.35 * SUN.share);
  sun.name = "sun";
  sun.castShadow = true;
  sun.shadow.autoUpdate = false;
  sun.shadow.mapSize.set(small ? SUN.map[1] : SUN.map[0], small ? SUN.map[1] : SUN.map[0]);
  sun.shadow.radius = small ? SUN.radius[1] : SUN.radius[0];
  sun.shadow.blurSamples = small ? SUN.samples[1] : SUN.samples[0];
  sun.shadow.normalBias = 0.02;
  sun.shadow.intensity = 1;
  scene.add(sun, sun.target);
  /** The direction toward the window (unit), shared by key and sun */
  const sunDir = new THREE.Vector3(2.9, 0.75, 4.2).normalize();
  const hemi = new THREE.HemisphereLight(STUDIO.sky, STUDIO.ground, 0.18);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  // the lights are on the desk layer too: drawn alone, the desk still has its light and shadows
  key.layers.enable(DESK_LAYER);
  sun.layers.enable(DESK_LAYER);
  hemi.layers.enable(DESK_LAYER);
  /** sasshi: the window's occluders (world-level: a tilted book never turns the window) */
  const windowLight = createWindowLight();
  scene.add(windowLight.group);

  /* ── Desk: only receives shadows + a pre-blurred contact shadow under the book ── */
  /*
   * sasshi (D2): the desk catcher takes the two lights apart. The key's shadow (the book's own, sharp) fades out a little way off
   * the case and is exactly round 2's (GROUND_KEY: its depth with the frosted boards' analytic shadow, whatever the key's share of the
   * light now is); the sun's (the window bars, the leaves) is the window light on the desk, kept off the
   * page's words by a screen-space fade (setLightFade: px from each edge of the view, in NDC here — the frosted pass draws this plane
   * at another resolution with the same camera, and a world-space fade would drift over the words while the camera moves).
   */
  const groundU = {
    uSunOpacity: { value: small ? SUN.desk[1] : (SUN.desk[0] as number) },
    uFadeFrom: { value: new THREE.Vector4() },
    uFadeTo: { value: new THREE.Vector4() },
  };
  /** The desk's key shadow as in round 2: the catcher's opacity and the key's old shadow intensity (the book's shade = opacity × key) */
  const GROUND_KEY = { opacity: 0.16, key: 0.7 };
  const groundMat = new THREE.ShadowMaterial({ color: STUDIO.shadow, opacity: GROUND_KEY.opacity });
  // shadows on the desk fade with distance from the book: the part a lifted page casts beyond the book is not one big hard-edged patch
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, groundU);
    sh.vertexShader =
      "varying vec2 vGround;\nvarying vec3 vClip;\n" +
      sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = position.xy;").replace("#include <project_vertex>", "#include <project_vertex>\nvClip = gl_Position.xyw;");
    sh.fragmentShader =
      "varying vec2 vGround;\nvarying vec3 vClip;\nuniform float uSunOpacity;\nuniform vec4 uFadeFrom;\nuniform vec4 uFadeTo;\n" +
      sh.fragmentShader.replace(
        "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );",
        `float keyS = 1.0;
        float sunS = 1.0;
        // the book's own shadow on the desk is the key's alone (round 2's soft band): where the key's map says the book shades the
        // desk, the sun's map (which has the book too) adds nothing more there — only the window's bars and leaves around it
        float bookS = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          keyS = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
          bookS = 1.0 - ( 1.0 - keyS ) / max( 1e-3, directionalLightShadows[ 0 ].shadowIntensity );
        #endif
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
          sunS = getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
        #endif
        // the frosted boards' analytic shadow (frost.ts) darkens the desk with the key (at the key's old intensity: round 2's depth)
        keyS = ( 1.0 - ${GROUND_KEY.key.toFixed(2)} * ( 1.0 - bookS ) ) * frostShadow( vFsW, uFsA * uFsG );
        vec2 out2 = max(abs(vGround) - vec2(${HALF_W.toFixed(4)}, ${(dims.H / 2).toFixed(4)}), 0.0);
        float aKey = opacity * ( 1.0 - keyS ) * (1.0 - smoothstep(0.0, 0.16, length(out2)));
        // distances to the view's edges in NDC: left, right, top, bottom; each edge fades the window light from uFadeFrom to uFadeTo
        vec2 ndc = vClip.xy / vClip.z;
        vec4 edge = vec4(ndc.x + 1.0, 1.0 - ndc.x, 1.0 - ndc.y, ndc.y + 1.0);
        vec4 f = mix(vec4(1.0), smoothstep(uFadeFrom, max(uFadeTo, uFadeFrom + 1e-5), edge), step(uFadeFrom + 1e-5, uFadeTo));
        float aSun = uSunOpacity * ( 1.0 - sunS ) * f.x * f.y * f.z * f.w * bookS;
        gl_FragColor = vec4( color, 1.0 - ( 1.0 - aKey ) * ( 1.0 - aSun ) );`,
      );
  };
  // sasshi: the case's footprint is baked into the shader; a swapped case with another footprint needs its own program
  groundMat.customProgramCacheKey = () => `ground2|${HALF_W.toFixed(4)}|${(dims.H / 2).toFixed(4)}`;
  frostShadow.patch(groundMat);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), groundMat);
  ground.receiveShadow = true;
  ground.layers.enable(DESK_LAYER);
  scene.add(ground);
  const contactTex = new THREE.CanvasTexture(contactShadow(binder.frost));
  /** sasshi: repaint a contact-shadow canvas for another material (a case swap) */
  const drawContact = (c: HTMLCanvasElement, tight: boolean) => c.getContext("2d")!.drawImage(contactShadow(tight), 0, 0);
  /** sasshi: the contact shadows' opacity; a tilted (lifted) book fades it */
  const CONTACT = 0.32;
  const contactMat = new THREE.MeshBasicMaterial({ color: STUDIO.shadow, alphaMap: contactTex, transparent: true, depthWrite: false, opacity: CONTACT });
  const contactGeo = new THREE.PlaneGeometry(1, 1);
  const contactR = new THREE.Mesh(contactGeo, contactMat);
  const contactL = new THREE.Mesh(contactGeo, contactMat.clone());
  for (const m of [contactR, contactL]) {
    m.renderOrder = -1;
    m.layers.enable(DESK_LAYER);
    scene.add(m);
  }
  /**
   * sasshi: everything on the desk that follows the case's size and thickness — the key light's shadow frustum, the desk's height
   * (under the spine: a flat-open frosted case sinks its spine `drop` below the boards) and the contact shadows. Run at build and after
   * a case swap.
   */
  function layoutDesk() {
    const before = groundMat.customProgramCacheKey();
    HALF_W = dims.xb + dims.B;
    if (groundMat.customProgramCacheKey() !== before) groundMat.needsUpdate = true;
    key.shadow.camera.left = -(HALF_W + 0.5);
    key.shadow.camera.right = HALF_W + 0.5;
    key.shadow.camera.top = Math.max(2.2, dims.H / 2 + 0.6);
    key.shadow.camera.bottom = -Math.max(2.2, dims.H / 2 + 0.6);
    key.shadow.camera.updateProjectionMatrix();
    // the desk is under the spine (a frosted case lying flat open has its spine drop below the two boards, resting on the desk)
    ground.position.z = -dims.CT - dims.drop - 0.02 * MM;
    for (const [m, sx] of [
      [contactR, 1],
      [contactL, -1],
    ] as const) {
      m.scale.set(HALF_W * 1.16, dims.H * 1.14, 1);
      // a hair down and away from the key light (sasshi: the key is on the right, so to the left)
      m.position.set((sx * HALF_W) / 2 - 0.04, -0.05, -dims.CT - dims.drop - 0.01 * MM);
      m.userData.base = m.position.clone();
    }
  }
  layoutDesk();

  /* ── Sheets ── */
  const sheetGeo = sheetGeometry(layout);
  const normalTex = new THREE.CanvasTexture(drawSheetNormal(768, layout));
  normalTex.anisotropy = maxAniso;
  const texWidth = Math.min(small ? layout.texture.width[1] : layout.texture.width[0], renderer.capabilities.maxTextureSize);
  const blank = { front: sideTexture(false), back: sideTexture(true) };
  function sideTexture(mirrored: boolean): THREE.CanvasTexture {
    const c = sideCanvas(512, layout);
    drawPockets(c, layout, mirrored, pal, null);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  }
  const edgeColor = new THREE.Color(0xe3e6e9);

  const sheets = new Map<number, Sheet>();
  /** sasshi: the sheets in index order (built again only when the set changes: step() walks it every frame) */
  let sorted: Sheet[] = [];
  let sortedFor = -1;
  let sheetsChanged = 0;
  function sheetList(): Sheet[] {
    if (sortedFor !== sheetsChanged) {
      sorted = [...sheets.values()].sort((a, b) => a.index - b.index);
      sortedFor = sheetsChanged;
    }
    return sorted;
  }
  /**
   * The height of a pocket plate's mid-plane at rest: the right stack, bottom up, is the last sheet … sheet spread, the left one sheet
   * 0 …; plus how far the rings lift the whole stack (stackLift)
   */
  const restZ = (i: number, left: boolean) => (left ? (i + 0.5) * PITCH : (SHEETS - i - 0.5) * PITCH) + stackLift(ring);
  /**
   * In the part of the opening / closing where the spine turns over, the ring centre rises and the bottom of the rings sits higher than
   * the lowest few sheets: their holes hang on the rings, so the rings hold those sheets up — the whole stack is lifted with them (a mm
   * or two at most); otherwise the lowest few all catch at the same spot at the bottom of the rings, at the same height, and pass through
   * one another (on screen the picture suddenly switches to the sheet below)
   */
  let liftKey = "";
  let liftVal = 0;
  function stackLift(r: [number, number]) {
    const key = r[0] + "," + r[1];
    if (key !== liftKey) {
      const lo = -Math.PI / 2 + 0.02;
      const zmin = panelRoot(r[0] + dims.R * Math.cos(lo), r[1] + dims.R * Math.sin(lo), lo, 0, SEG)[1];
      liftKey = key;
      liftVal = Math.max(0, zmin + 0.05 * MM - 0.5 * PITCH);
    }
    return liftVal;
  }

  function makeSheet(i: number): Sheet {
    const u: SheetUniforms = {
      uHole: { value: new THREE.Vector2() },
      uPhi: { value: 0 },
      uIn: { value: new THREE.Vector4() },
      uOut: { value: new THREE.Vector4() },
      uStack: { value: new THREE.Vector4() },
      uBackMap: { value: blank.back },
      uEdge: { value: edgeColor },
    };
    const { mat, depth } = sheetMaterials(u, normalTex, blank.front, layout);
    frostShadow.patch(mat);
    const mesh = new THREE.Mesh(sheetGeo, mat);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    bookGroup.add(mesh);
    const [cin, cout] = columnCards(i);
    const body = createPage(GEOM, cin, cout, P);
    restPage(body, i < spread ? 1 : 0, envOf(i));
    const s: Sheet = { index: i, mesh, mat, depth, u, p: i < spread ? 1 : 0, body, hovering: false, pinned: false, wKin: 0, loose: false, snd: { motion: false, lift: 0, peak: 0, turnAt: Number.NaN, turnT: -Infinity, dir: 1, turned: false } };
    applyTextures(s);
    return s;
  }

  /**
   * How many cards a sheet's inner / outer column holds (both faces together): the front's column by the spine is the back's column away
   * from the spine (the same column of pockets). sasshi: from the layout (a double-sided item counts once)
   */
  const columnCards = (i: number) => layout.columnLoad(i, COUNT);

  /**
   * Sheet i's physics surroundings: the root position, the holes' rest angle on the ring, the tops of the left and right stacks (they
   * change with the ring centre; cached by it)
   */
  const envs = new Map<number, { cx: number; cz: number; env: PageEnv }>();
  function envOf(i: number): PageEnv {
    const [cx, cz] = ring;
    const e = envs.get(i);
    if (e && e.cx === cx && e.cz === cz) return e.env;
    const R = dims.R;
    const zR = restZ(i, false);
    const zL = restZ(i, true);
    const env: PageEnv = {
      root: (phi, th) => panelRoot(cx + R * Math.cos(phi), cz + R * Math.sin(phi), phi, th, SEG),
      phR: restPhi(cx, cz, R, zR, SEG),
      phL: Math.PI - restPhi(cx, cz, R, zL, SEG),
      zR,
      zL,
      axisX: cx,
    };
    envs.set(i, { cx, cz, env });
    return env;
  }

  function dropSheet(s: Sheet) {
    bookGroup.remove(s.mesh);
    s.mat.dispose();
    s.depth.dispose();
    sheets.delete(s.index);
    sheetsChanged++;
    envs.delete(s.index);
  }

  /* ── Side textures: two spreads either side of the current one ── */
  const sides = new Map<number, SideTex>();
  /**
   * sasshi (round 4, E1): sides still printed from the content before the last setContent — painted again in idle time, or at
   * once when a frame is about to show one (freshen)
   */
  const stale = new Set<number>();
  const images = new Map<string, Promise<HTMLImageElement | null>>();
  const loaded = new Map<string, HTMLImageElement>();

  function loadImage(src: string): Promise<HTMLImageElement | null> {
    let p = images.get(src);
    if (!p) {
      p = new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          img.decode().then(
            () => resolve(img),
            () => resolve(img),
          );
        };
        img.onerror = () => resolve(null);
        img.src = src;
      }).then((img) => {
        if (img) {
          loaded.set(src, img);
          // the oldest loaded goes first (only the reference: the bytes stay in the browser's cache)
          if (loaded.size > IMAGE_CACHE) {
            const first = loaded.keys().next().value!;
            loaded.delete(first);
            images.delete(first);
          }
        }
        return img;
      });
      images.set(src, p);
    }
    return p;
  }

  /**
   * sasshi: paints one side from the content: the layout's chrome, then content.paintSlot for every filled pocket (the item's face
   * that this side shows; a double-sided item's back lies mirrored in the same physical pocket), then the film's haze and the pocket mouths
   */
  const paintEnv = (k: number): PaintEnv => ({ layout, pxPerMm: k, font, ...(fonts.serif && { serif: fonts.serif }), ...(fonts.mono && { mono: fonts.mono }), image: (src) => loaded.get(src) ?? null });
  /** sasshi (round 4, E1): one side as steps (textures.ts pocketSteps: the chrome, a step a pocket, the seams), from the content up or `c` */
  function sideSteps(canvas: HTMLCanvasElement, side: number, c: ContentSource = content) {
    const mirrored = side % 2 === 1;
    const face = layout.faceOf(side);
    return pocketSteps(canvas, layout, mirrored, pal, (ctx, slot, k) => {
      const index = layout.itemIndex(side, slot, COUNT);
      if (index < 0) return;
      const at = layout.itemRect(slot, mirrored, index + 1, face === "back");
      c.paintSlot(ctx, { side, slot, index, face, mirrored, pocket: layout.pocketRect(slot, mirrored), place: { ...at, r: layout.item.r }, seed: index + 1 }, paintEnv(k));
    });
  }
  function paintSide(canvas: HTMLCanvasElement, side: number) {
    for (const step of sideSteps(canvas, side)) step();
  }
  /** Picture URLs the items on a side need (of the content up, or of `c`) */
  function sideSources(side: number, c: ContentSource = content): string[] {
    const face = layout.faceOf(side);
    const out: string[] = [];
    for (let slot = 0; slot < layout.perSide; slot++) {
      const index = layout.itemIndex(side, slot, COUNT);
      if (index >= 0) for (const src of c.sources(index, face)) if (src) out.push(src);
    }
    return out;
  }

  function ensureSide(side: number) {
    let st = sides.get(side);
    if (st) return st;
    const c = sideCanvas(texWidth, layout);
    paintSide(c, side);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    st = { canvas: c, tex, loaded: false, gen: 0 };
    sides.set(side, st);
    const gen = st.gen;
    void Promise.all(sideSources(side).map(loadImage)).then(() => {
      const cur = sides.get(side);
      if (disposed || !cur || cur.gen !== gen) return;
      paintSide(cur.canvas, side);
      cur.tex.needsUpdate = true;
      cur.loaded = true;
      invalidate();
      firstSpreadCheck();
    });
    return st;
  }
  /*
   * sasshi: the faces the content prints (content.ready: 郵便はがき, the 和色 kanji, the handwriting, for the exact strings) may
   * arrive after a side has had its second paint (its pictures were in first). Canvas text never redraws by itself, so every side
   * painted so far is painted once more when they are in; a side made after that already paints with them. The pictures alone decide
   * when the first spread counts as loaded (a slow font slice must not hold the cover shut).
   */
  function lateFaces(c: ContentSource) {
    void c.ready?.then(() => {
      // (another content since: its own swap waits for its faces)
      if (disposed || content !== c) return;
      for (const [side, st] of sides) {
        paintSide(st.canvas, side);
        st.tex.needsUpdate = true;
        stale.delete(side);
      }
      invalidate();
    });
  }
  lateFaces(content);

  function applyTextures(s: Sheet) {
    s.mat.map = sides.get(2 * s.index)?.tex ?? blank.front;
    s.u.uBackMap.value = sides.get(2 * s.index + 1)?.tex ?? blank.back;
  }

  /**
   * A mesh is built for every sheet (a shared geometry; sleeping sheets run no physics and nothing is redrawn at rest): the thickness of
   * both stacks and the pile of punched strips by the rings are all real sheets, and the left stack grows thicker the further one turns.
   * Textures are loaded only for ±2 spreads around the current position (every sheet in flight is within them); the rest use blank
   * pockets (they lie underneath, only their edges and punched strips show)
   */
  function syncWindow() {
    let lo = spread;
    let hi = spread;
    for (const s of sheets.values()) {
      if (!s.body.asleep || s.body.hand || s === drag?.sheet || (s.p > 0 && s.p < 1)) {
        lo = Math.min(lo, s.index);
        hi = Math.max(hi, s.index + 1);
      }
    }
    for (let i = 0; i < SHEETS; i++)
      if (!sheets.has(i)) {
        sheets.set(i, makeSheet(i));
        sheetsChanged++;
      }
    // sasshi: the layout says how many spreads either side keep their textures (card binder: 2)
    const W = layout.texture.window;
    const fLo = Math.max(0, 2 * (lo - W) - 1);
    const fHi = Math.min(2 * SHEETS - 1, 2 * (hi + W));
    for (const [k, st] of sides) {
      if (k < fLo - 1 || k > fHi + 1) {
        st.tex.dispose();
        st.gen++;
        sides.delete(k);
        stale.delete(k);
      }
    }
    for (let k = fLo; k <= fHi; k++) ensureSide(k);
    for (const s of sheets.values()) applyTextures(s);
  }

  /** The x where sheet i's pocket plate starts at rest (left / right) */
  function restRoot(ring: [number, number], i: number, left: boolean) {
    const [cx, cz] = ring;
    const R = dims.R;
    const m = restPhi(cx, cz, R, restZ(i, left), SEG);
    if (!left) return panelRoot(cx + R * Math.cos(m), cz + R * Math.sin(m), m, 0, SEG)[0];
    const phi = Math.PI - m;
    return panelRoot(cx + R * Math.cos(phi), cz + R * Math.sin(phi), phi, Math.PI, SEG)[0];
  }

  /* ── State ── */
  /** Sheets already turned to the left = the current spread (wide (desktop)); narrow also keeps the current page */
  let spread = 0;
  let page = 0;
  /** The cover's openness (0 shut, 1 open) and its target; the number of sheets turning back with the front board while it closes */
  let cover = 0;
  let coverTarget = 0;
  let coverTween: Tween | null = null;
  let carry = 0;
  /** The automatic opening on arrival has not started yet: meanwhile it counts as "open", so the UI does not flash its "closed" look */
  let autoOpen = opts.autoOpen !== false;
  let ring: [number, number] = binder.pose(0).ring;
  let frontAngle = 0;
  /** The spine's angular speed (rad / s) */
  let spineW = 0;
  let camX = 0;
  /** sasshi (round 4, E2): the phone's page camera as placed (1 / distance, x / distance), its move, the pages' framings */
  const pcam = { a: 1, b: 0 };
  let pmove: PageMove | null = null;
  const pageFrames = new Map<number, { a: number; b: number }>();
  let ready = false;
  let frozen = false;
  /** Frame number (one more every frame stepped): pointer events are stamped with it when they arrive */
  let frameNo = 0;
  /** "Close" was pressed during a turn: close once every sheet in flight has come down */
  let closeAsked = false;
  /** Development: time advanced by hand (frame-by-frame screenshots); the physics clock and its substep remainder */
  let manual: number | null = null;
  let simT = 0;
  let simAcc = 0;
  /** sasshi: the book's own clock (s): every rendered step adds its clamped dt (the cover tween, the shake's jiggles) */
  let bookT = 0;
  const clockNow = () => (manual ?? performance.now() / 1000);

  type Drag = {
    sheet: Sheet | null;
    /** turn: turning a page; pan: narrow, looking left / right within one spread; cover: opening / closing the cover */
    mode: "turn" | "pan" | "cover";
    sign: 1 | -1;
    base: number;
    targetP: number;
    spanPx: number;
    samples: { t: number; x: number }[];
    /** Turn: the pointer position the hand uses now (client px, interpolated by frame), the grabbed point's y on the page (scene units) */
    px: number;
    py: number;
    gy: number;
    /** The last few pointer events (f: frame number on arrival; only the last in a frame is kept), the average frames per pointer event */
    trail: { f: number; x: number; y: number }[];
    cad: number;
    /**
     * How far the lever point (the point toward the grabbed point at least DRAG_R from the root) was from the pointer on screen at press
     * (px); the pointer the last frame's conversion used (offset included)
     */
    off: [number, number];
    last: [number, number] | null;
    /** The grabbed point is within DRAG_R of the root: the pointer stands for the lever point, not for the grabbed point itself */
    lever: boolean;
    /** sasshi: this drag's page already sounded its pageTurn */
    turned?: boolean;
  };
  let drag: Drag | null = null;
  let down: { id: number; x: number; y: number; t: number; pick: Pick; touch: boolean; button: number; meta: boolean } | null = null;
  let hover: { sheet: number } | { cover: true } | null = null;

  const isClosed = () => coverTarget === 0 && !autoOpen;
  function emit() {
    const closed = isClosed();
    opts.onState(narrow ? { index: page, count: PAGES, narrow, closed } : { index: spread, count: SHEETS + 1, narrow, closed });
  }

  /** Narrow: whether the current page lies on the left or the right, which decides the side the camera looks at */
  const pageSide = () => (page % 2 === 1 ? -1 : 1);

  function setSpread(k: number) {
    k = clamp(k, 0, SHEETS);
    if (k === spread) return;
    const forward = k > spread;
    // physics clock: turning several pages in a row, each one starts STAGGER s after the one before
    let start = simT;
    let last = -Infinity;
    for (const s of sheets.values()) if (s.body.finger) last = Math.max(last, s.body.finger.start);
    const from = spread;
    spread = k;
    syncWindow();
    const order = forward ? range(from, k) : range(k, from).reverse();
    for (const i of order) {
      const s = sheets.get(i);
      if (!s) continue;
      start = Math.max(start, last + STAGGER);
      last = start;
      flipSheet(s, forward ? 1 : 0, start);
      // sasshi: a turn the visitor asked for; it sounds when the page actually starts (staggered pages one after another)
      followTurn(s, forward ? 1 : -1, start);
    }
    emit();
    invalidate();
  }

  /**
   * Turn a sheet to side `to`: a finger lifts its inner column over the top at `start` (physics clock); one already past the top is just
   * let go to fall
   */
  function flipSheet(s: Sheet, to: 0 | 1, start: number) {
    s.hovering = false;
    s.pinned = false;
    turnPage(s.body, to, start);
  }

  function next() {
    closeAsked = false;
    if (isClosed() || autoOpen) return openCover();
    if (narrow) setPage(page + 1);
    else setSpread(spread + 1);
  }
  function prev() {
    if (isClosed() || cover < 1) return;
    closeAsked = false;
    // back at the start: while pages are in flight (← held down, turning back page after page) it does not close — closing would flatten
    // them in one frame
    if (narrow ? page === 0 : spread === 0) return pagesBusy() ? undefined : closeCover();
    if (narrow) setPage(page - 1);
    else setSpread(spread - 1);
  }
  /** A sheet is still moving (the one a hover gently lifts does not count) */
  function pagesBusy() {
    for (const s of sheets.values()) if (!s.hovering && (!s.body.asleep || (s.p > 1e-3 && s.p < 1 - 1e-3))) return true;
    return false;
  }
  function setPage(m: number) {
    m = clamp(m, 0, PAGES - 1);
    if (m === page) return;
    const from = page;
    page = m;
    setSpread(spreadOfPage(m));
    pageTo(from, m);
    emit();
    invalidate();
  }

  /**
   * Sheet i carried by the closing front board: the furthest it can be turned (progress) with the whole sheet (a straight board from root
   * to page edge) inside the front board, the thickness of the sheets below it apart. The further left a sheet turns the nearer it comes
   * to the front board; bisection finds the limit. The left stack lying flat on the open front board just meets it
   */
  function underBoard(i: number, bp: { front: number; hinge: [number, number] }) {
    const env = envOf(i);
    const nx = Math.sin(bp.front);
    const nz = -Math.cos(bp.front);
    const need = dims.CT / 2 + (i + 0.5) * PITCH - 0.2 * MM;
    const len = PW - SEG.b1;
    const clear = (th: number) => {
      const [rx, rz] = env.root(holeAngle(th, env), th);
      const tx = rx + len * Math.cos(th);
      const tz = rz + len * Math.sin(th);
      return Math.min((rx - bp.hinge[0]) * nx + (rz - bp.hinge[1]) * nz, (tx - bp.hinge[0]) * nx + (tz - bp.hinge[1]) * nz);
    };
    if (clear(Math.PI) >= need) return 1;
    let lo = 0;
    let hi = Math.PI;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (clear(mid) >= need) lo = mid;
      else hi = mid;
    }
    return lo / Math.PI;
  }

  function restSheet(s: Sheet, side: 0 | 1) {
    restPage(s.body, side, envOf(s.index));
    s.p = side;
    s.hovering = false;
    s.loose = false;
    // sasshi: put down by the book itself (the cover closed / opened): no landing sound
    quiet(s);
  }
  /** While closing: a sheet still on the front board, posed directly with it (no physics) */
  const riding = (s: Sheet) => carry > 0 && s.index < carry && !s.loose;

  /*
   * ── sasshi: sound cues (BookOptions.onSound) ──
   * Only reports: no state of the book changes here, nothing is invalidated (sound hooks never change a rendered frame).
   * A page motion the visitor started (setSpread's turns, a drag) is followed per sheet (Sheet.snd) until the page lands.
   */
  /** Sim-clock time of the last pageTurn / pageLand of any page (riffles of several pages soften) */
  let lastTurnAny = -Infinity;
  let lastLandAny = -Infinity;
  function sound(name: BookSoundName, o?: BookSoundOptions) {
    const cb = opts.onSound;
    if (!cb || disposed) return;
    try {
      cb(name, o);
    } catch (e) {
      console.error("[sasshi] onSound failed", e);
    }
  }
  /** Stop following a page (put down by the book itself, posed for a screenshot): it will not sound */
  function quiet(s: Sheet) {
    s.snd.motion = false;
    s.snd.turnAt = Number.NaN;
  }
  /** Follow a page motion the visitor started: it lands with a sound; a click turn also sounds when it starts at `turnAt` */
  function follow(s: Sheet, dir: 1 | -1) {
    const k = s.snd;
    // a page already in the air (a reversal) keeps what it has lifted so far
    if (!k.motion) {
      k.lift = 0;
      k.peak = 0;
      k.turned = false;
    }
    k.motion = true;
    k.dir = dir;
  }
  function followTurn(s: Sheet, dir: 1 | -1, at: number) {
    follow(s, dir);
    s.snd.turnAt = at;
  }
  function turnSound(s: Sheet, gain: number) {
    const k = s.snd;
    k.turnAt = Number.NaN;
    k.turned = true;
    if (simT - k.turnT < TURN_SOUND.gap) return;
    k.turnT = simT;
    const riffle = simT - lastTurnAny < TURN_SOUND.riffle;
    lastTurnAny = simT;
    sound("pageTurn", { gain: gain * (riffle ? TURN_SOUND.riffleGain : 1), pan: k.dir === 1 ? 0.15 : -0.15 });
  }
  /** Per rendered step, after the physics: due click-turn sounds, the drag's turn threshold, landings */
  function followSounds(dt: number) {
    const d = drag?.mode === "turn" ? drag : null;
    if (d?.sheet && !d.turned && (d.sheet.p - d.base) * d.sign > TURN_SOUND.drag) {
      d.turned = true;
      // a slow, careful drag swooshes softly; a quick one at full strength
      const w = Math.abs(d.sheet.body.w[0]!);
      const q = clamp(w / 3, 0, 1);
      turnSound(d.sheet, 0.5 + 0.5 * smooth(q));
    }
    for (const s of sheets.values()) {
      const k = s.snd;
      if (!k.motion) continue;
      // the cover took the page over (closing), or a debug pose froze it: not the visitor's page motion any more
      if (riding(s) || s.loose || s.pinned) {
        quiet(s);
        continue;
      }
      if (!Number.isNaN(k.turnAt)) {
        if (simT < k.turnAt) continue; // a staggered turn that has not started yet
        turnSound(s, 1);
      }
      const b = s.body;
      let d0 = 0;
      let d1 = 0;
      let w = 0;
      for (let i = 0; i < b.n; i++) {
        d0 = Math.max(d0, Math.abs(b.a[i]!));
        d1 = Math.max(d1, Math.abs(b.a[i]! - Math.PI));
        w = Math.max(w, Math.abs(b.w[i]!));
      }
      const dev = Math.min(d0, d1);
      k.peak = Math.max(w, k.peak * Math.exp(-dt / LAND_SOUND.hold));
      k.lift = Math.max(k.lift, dev);
      // held in the hand: it lands once let go
      if (d?.sheet === s || dev > LAND_SOUND.band) continue;
      // lifted far enough to be heard coming down; a page that made its pageTurn always lands with one (once it left the band)
      if (k.lift >= LAND_SOUND.lift || (k.turned && k.lift > LAND_SOUND.band)) {
        const q = clamp((k.peak - LAND_SOUND.slow) / (LAND_SOUND.full - LAND_SOUND.slow), 0, 1);
        const riffle = simT - lastLandAny < LAND_SOUND.riffle;
        lastLandAny = simT;
        const gain = (LAND_SOUND.floor + (1 - LAND_SOUND.floor) * smooth(q)) * (riffle ? LAND_SOUND.riffleGain : 1);
        sound("pageLand", { gain, pan: d1 < d0 ? -0.4 : 0.4 });
        quiet(s);
      } else if (b.asleep) quiet(s); // lifted a hair and put back: nothing to hear
    }
  }

  function coverTo(to: 0 | 1, v0 = 0) {
    const d = to - cover;
    coverTarget = to;
    if (Math.abs(d) < 1e-4) {
      cover = to;
      coverTween = null;
    } else {
      const dur = (to === 1 ? OPEN_TIME : CLOSE_TIME) * Math.pow(Math.abs(d), 0.6);
      coverTween = { from: cover, to, t: 0, dur, v0, v1: 0 };
      // sasshi: the cover starts to move (every open / close goes through here; the debug poses and the hover peek do not)
      if (Math.abs(d) >= 0.02) sound(to === 1 ? "coverOpen" : "coverClose", { gain: Math.min(1, 0.3 + 1.4 * Math.abs(d)) });
    }
    emit();
    invalidate();
  }
  function openCover() {
    closeAsked = false;
    // opened again halfway through closing: sheets still on the front board swing back with it; sheets already let go and falling right
    // are lifted back left by a finger, the front board's inside still their ceiling (they never pass through a front board not yet
    // flat). carry is dropped only once the front board is fully open (in step)
    if (carry > 0) {
      for (const s of sheets.values()) if (s.index < carry && s.loose) flipSheet(s, 1, simT);
    }
    autoOpen = false;
    coverTo(1);
  }
  /** sasshi: the arrival's opening with reduced motion: open at once, no swing (the camera at its open framing, the addons told) */
  function openNow() {
    closeAsked = false;
    autoOpen = false;
    coverTween = null;
    cover = coverTarget = 1;
    snapFrame();
    placeCamera(camW);
    bookDirty = true;
    emit();
    invalidate();
  }
  function closeCover() {
    closeAsked = false;
    autoOpen = false;
    hover = null;
    // the left stack (the sheets already turned) turns back with the front board (closed again after opening halfway: sheets a finger is
    // lifting back left are let go and fall right)
    carry = spread;
    for (const s of sheets.values())
      if (s.index < carry && s.loose) {
        freePage(s.body);
        s.body.goal = 0;
      }
    // the ones on the right lie there already (sheets in flight come down before this is reached); the one a hover lifts is let go and
    // falls back by itself, not flattened in one frame
    for (const s of sheets.values()) if (s.index >= spread && s.body.asleep) restSheet(s, 0);
    coverTo(0);
  }
  /**
   * The close button: with sheets in flight it waits for them to come down, then closes. Pressing again still means "close" (not a
   * cancel — someone who presses again because nothing happened wants it closed); turning or dragging cancels
   */
  function askClose() {
    if (!pagesBusy()) return closeCover();
    closeAsked = true;
    invalidate();
  }

  /* ── Camera ── */
  let width = 1;
  let height = 1;
  /**
   * A phone held sideways (short): only a thin margin round the book, which fills the view (the turn buttons are at the left and right,
   * see AlbumBook SHORT)
   */
  const tight = () => width > height && height < 520;
  /** Framing: open, the whole book spread out (narrow: one page); shut, the box; in between, blended by openness */
  const frame = () => frameAt(cover, ring);
  /**
   * sasshi: the framing at openness c (0 shut … 1 open) with the rings at rg (narrow: the page's rest position follows them;
   * side: the page in view, right 1 or left −1, on spread sp)
   */
  function frameAt(c: number, rg: [number, number], side = pageSide(), sp = spread) {
    const o = smooth(clamp(c, 0, 1));
    const [c0, c1] = binder.closedSpan;
    if (!narrow) return { x: ((c0 + c1) / 2) * (1 - o), w: HALF_W * 2 + (tight() ? 0.1 : 0.24) };
    /*
     * sasshi: narrow, the closed cover is framed CLOSED_GUTTER px in from each side (the page's margin), not edge to edge, and
     * centred on its front board — what is seen of a shut case (the spine's outer face is turned away): the middle of closedSpan lies
     * half a spine to the left of it, which left the cover a few px right of centre. Shut, the front board lies flat (its x axis is the
     * world's), so its world centre is its centre on screen.
     */
    const shut = binder.boards(0)[0]!;
    const closedC = shut.o[0];
    const closedW = 2 * shut.hw;
    const ins = insetsNow();
    const avail = Math.max(1, width - ins.left - ins.right);
    const closedFit = closedW / Math.max(0.5, 1 - (2 * CLOSED_GUTTER) / avail);
    if (SHEETS === 0) {
      // sasshi: a folio with no pages — open, the back board (where the addons live) fills the screen; the front board may go off it.
      // What lies on the board (its inner area: the pouch) keeps NARROW_GUTTER px from the canvas edges.
      const center = dims.xb + dims.B / 2;
      const inner = opts.case?.board ? opts.case.board.w * MM : dims.B;
      const openW = Math.max(dims.B + 0.12, inner / Math.max(0.5, 1 - (2 * NARROW_GUTTER) / avail));
      return { x: closedC + (center - closedC) * o, w: closedFit + (openW - closedFit) * o };
    }
    // sasshi: the rings stick out past the plate root on the spine side; frame them too (shift toward the spine by half of RING_SIDE, widen by all of it).
    // On the outer side the board the page lies on is framed whole, BOARD_GUTTER px in from the canvas edge (it used to run past it):
    // its overhang past the page is wider than the page's margin, so the picture gets a little smaller and moves toward the spine.
    const pageW = PW + 0.16 + RING_SIDE;
    const inner = side * (Math.abs(restRoot(rg, side === 1 ? sp : sp - 1, side === -1)) + (PW - SEG.b1) / 2 - RING_SIDE / 2) - (side * pageW) / 2;
    const openW = Math.max(pageW, Math.abs(side * HALF_W - inner) / Math.max(0.5, 1 - BOARD_GUTTER / avail));
    const center = inner + (side * openW) / 2;
    return { x: closedC + (center - closedC) * o, w: closedFit + (openW - closedFit) * o };
  }
  const corner = new THREE.Vector3();
  /** sasshi: the eight corners of a board (its mid-plane rect ± half the board's thickness), in book coordinates */
  const boardCorner = (b: BoardRect, sx: number, sy: number, sz: number) =>
    corner.set(b.o[0] + b.x[0] * b.hw * sx + b.n[0] * sz * dims.CT * 0.5, b.o[1] + sy * b.hh, b.o[2] + b.x[2] * b.hw * sx + b.n[2] * sz * dims.CT * 0.5);
  /** The insets as used: never negative; left and right together leave at least 40 % of the width */
  function insetsNow() {
    const left = Math.min(Math.max(0, insets.left ?? 0), width * 0.6);
    const right = Math.min(Math.max(0, insets.right ?? 0), width * 0.6 - left);
    return { left, right, top: Math.max(0, insets.top), bottom: Math.max(0, insets.bottom) };
  }
  /**
   * sasshi: the view offset (client px) that centres the picture in the box the insets leave (set by placeCamera); y less a
   * shift for the shut framing (shutRoom: the closed book sits lower in the box) and, during a swing, part of it
   */
  let viewX = 0;
  let viewY = 0;
  /** The view offset's y that centres the picture in the box */
  const centreY = () => {
    const { top, bottom } = insetsNow();
    return (bottom - top) / 2;
  };
  const TAN = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  /** The last put (distance, target x): a framing worked out between frames puts the camera back where it was (pageFrame) */
  let putD = 1;
  let putX = 0;
  /**
   * The camera `dist` from its target (camX, 0) on the desk, looking down at TILT. sasshi (round 4): the far plane always lies
   * well behind the desk (a phone's framing is 14 … 21 units away: the old fixed 40 cut the whole book off when a framing went wrong)
   */
  function put(dist: number, x: number) {
    putD = dist;
    putX = x;
    camera.position.set(x, -Math.sin(TILT) * dist, Math.cos(TILT) * dist + 0.04);
    camera.lookAt(x, 0, 0.04);
    camera.far = Math.max(40, dist + 20);
    camera.setViewOffset(width, height, viewX, viewY, width, height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  /** The case's client-px bounds for the camera as it is (reused: no allocation per call) */
  const bb = { x0: 0, x1: 0, y0: 0, y1: 0 };
  /** The case as last placed, in client px: the eight corners of each board given (thickness, pose and, with `withTilt`, the tilt included) */
  function bounds(boards: BoardRect[], withTilt: boolean) {
    bb.x0 = bb.y0 = Infinity;
    bb.x1 = bb.y1 = -Infinity;
    for (const b of boards)
      for (let sx = -1; sx <= 1; sx += 2)
        for (let sy = -1; sy <= 1; sy += 2)
          for (let sz = -1; sz <= 1; sz += 2) {
            boardCorner(b, sx, sy, sz);
            if (tilted && withTilt) corner.applyMatrix4(bookGroup.matrix);
            corner.project(camera);
            if (corner.z > 1) continue;
            const px = ((corner.x + 1) / 2) * width;
            const py = ((1 - corner.y) / 2) * height;
            bb.x0 = Math.min(bb.x0, px);
            bb.x1 = Math.max(bb.x1, px);
            bb.y0 = Math.min(bb.y0, py);
            bb.y1 = Math.max(bb.y1, py);
          }
    return bb;
  }
  /** How much smaller (about c) a span [a, b] must get to sit within [lo, hi] */
  const need = (a: number, b: number, c: number, lo: number, hi: number) => Math.max(1, (c - a) / Math.max(1, c - lo), (b - c) / Math.max(1, hi - c));
  /**
   * sasshi: the resting camera distance for a frame `w` wide centred on x, with the case at openness c (0 or 1; the narrow
   * corrections blend between the two for anything else) and, with `withTilt`, the whole-book tilt: the distance that fits w in the box,
   * then on a phone the narrow corrections, then every board inside the canvas less EDGE however far that takes the camera. The camera
   * is left there.
   */
  /** The shut case's front board alone (restDist, narrow), per case */
  let shutFor: typeof binder | null = null;
  let shutBoards: BoardRect[] = [];
  function shutFront() {
    if (shutFor !== binder) {
      shutFor = binder;
      shutBoards = binder.boards(0).slice(0, 1);
    }
    return shutBoards;
  }
  function restDist(c: number, w: number, x: number, withTilt: boolean, room = true, side = pageSide()): number {
    const aspect = width / height;
    viewY = centreY();
    // sasshi: four-sided insets — the book is framed in the box they leave, centred in it (view offset)
    const { left, right, top: insetTop, bottom: insetBottom } = insetsNow();
    const usable = Math.max(0.3, (height - insetTop - insetBottom) / height);
    const usableW = Math.max(0.4, (width - right - left) / width);
    const h = dims.H + (tight() ? 0.1 : 0.3);
    let dist = Math.max(w / 2 / (TAN * aspect * usableW), h / 2 / (TAN * usable));
    // sasshi: a tilted book is lifted off the desk toward the camera; back off by as much so it keeps its size on screen
    if (tilted && withTilt) dist += tilt.lift;
    put(dist, x);
    const ex = EDGE * width;
    const ey = EDGE * height;
    const cx = left + (width - left - right) / 2;
    const cy = insetTop + (height - insetTop - insetBottom) / 2;
    if (narrow) {
      /*
       * sasshi: narrow, the case keeps its outer edge on the side of the page in view inside the canvas: the closed cover
       * CLOSED_GUTTER px in on both sides (frame() centres it), the open board BOARD_GUTTER px in. frame() plans for it; this takes up
       * what perspective and the boards' thickness add (a few px). It is measured on the two resting poses (closed, open), never on a
       * swinging board, and never with the tilt: a tilted board may reach past the edge for a moment rather than the book breathing.
       */
      const o = smooth(clamp(c, 0, 1));
      // shut: the front board, both sides (frame() centres it); open: every board, on the side of the page in view
      const shut = shutFront();
      const open = binder.boards(1);
      /** How much smaller the picture must get for the outermost corner of a pose (any board given) to sit g px in from the edge */
      const edge = (boards: BoardRect[], g: number, both = false) => {
        const r = bounds(boards, false);
        if (both) return need(r.x0, r.x1, cx, g, width - g);
        return side === 1 ? need(cx, r.x1, cx, 0, width - g) : need(r.x0, cx, cx, g, width);
      };
      for (let it = 0; it < 3; it++) {
        const k = (1 - o) * (o < 1 ? edge(shut, CLOSED_GUTTER, true) : 1) + o * (o > 0 ? edge(open, BOARD_GUTTER) : 1);
        if (k < 1.002) break;
        dist *= k;
        put(dist, x);
      }
    }
    /*
     * At rest (a tilted or shaken book too): every board stays inside the canvas less EDGE, however far that takes the camera. Pulling
     * back shrinks the picture about the box's centre (the camera's target), so the limits are measured from it. In narrow mode only
     * vertically: there the open front board lies off the left edge on purpose.
     */
    const boards = binder.boards(c);
    for (let it = 0; it < 4; it++) {
      const r = bounds(boards, withTilt);
      const k = Math.max(need(r.y0, r.y1, cy, ey, height - ey), narrow ? 1 : need(r.x0, r.x1, cx, ex, width - ex));
      if (k < 1.002) break;
      dist *= k;
      put(dist, x);
    }
    // open, on a desk: the room the landing board needs (openRoom); shut: the room the standing board needs (shutRoom)
    const k = !room ? 1 : c === 1 && !narrow ? openRoom() : c === 0 ? shutRoom() : 1;
    // (put again either way: working a room out the first time moves the camera); shut, lower in the box by shutY
    dist *= Math.max(1, k);
    viewY = centreY() - (room && c === 0 ? shutY : 0);
    put(dist, x);
    return dist;
  }
  /*
   * sasshi: the open framing's room for the landing. Coming down, the front board is a little nearer the camera and farther out
   * than lying flat, while the swing's camera is still on its way from the closed framing: over the last quarter of an opening its outer
   * edge passes its resting place by up to ~2 % of the canvas. Where that would leave the canvas (a portrait tablet: width-limited) the
   * open framing keeps that room (the factor here, ≥ 1), so the swing needs neither a step back nor a cut for it. Computed once per
   * layout (resize, insets, narrow, a case swap), on the swing's own camera (swingEase between the resting framings).
   */
  let roomK = 0;
  function openRoom(): number {
    if (roomK) return roomK;
    const r0 = binder.pose(0).ring;
    const r1 = binder.pose(1).ring;
    const f0 = frameAt(0, r0);
    const f1 = frameAt(1, r1);
    const d0 = restDist(0, f0.w, f0.x, false, false);
    const d1 = restDist(1, f1.w, f1.x, false, false);
    const { left, right } = insetsNow();
    const cx = left + (width - left - right) / 2;
    let k = 1;
    for (let it = 0; it < 6; it++) {
      let worst = 1;
      for (let i = 0; i < 12; i++) {
        const c = 0.75 + (i / 12) * 0.25;
        const e = swingEase(c);
        const inv = 1 / d0 + (1 / (d1 * k) - 1 / d0) * e;
        put(1 / inv, (f0.x / d0 + (f1.x / (d1 * k) - f0.x / d0) * e) / inv);
        const r = bounds(binder.boards(c), false);
        worst = Math.max(worst, need(r.x0, r.x1, cx, 0, width));
      }
      if (worst < 1.001) break;
      k *= worst;
    }
    roomK = k;
    return k;
  }
  /**
   * sasshi (round 3, D1): the camera of a swing. While the cover is between its two resting poses the camera is a function of the
   * openness alone: it moves once, one way, from the resting framing at 0 to the one at 1, the view offset fixed. Its distance goes
   * along one ease (e: 1 / dist linear in it), its target with it so that x / dist follows a second one (w): with w = e every point on
   * the desk moves along a straight line on screen; the pan may also go its own way while the zoom waits, as long as every corner of
   * the back board still moves one way (its screen x is x_p / dist − x / dist: one way whenever the two terms push the same way, else
   * w = e) — then it is paced so that the board's far edge, which both push, moves at an even pace (swingEase): the pan slows while the
   * zoom hurries and makes up for it before and after. No per-frame refit, no slide, no step back: the back board (it never moves) only ever moves one way. The
   * standing board may rise above the book box into the page's margins; where a pose would still leave the canvas, the zoom's ease
   * waits for it (fitSwing: at each openness the camera keeps to the stretch of its way where that pose fits — still one way only),
   * and where no one-way path fits at all, the shut framing keeps the room for it (shutRoom: the closed book a little smaller, never a
   * camera that backs off and comes back). The top and bottom on a tight landscape phone and the sides on a phone are not held: there the board may pass the physical
   * edge. A swing that starts while the camera is still easing (a phone's pan) starts from where the camera is (restCam).
   * Computed when a swing starts and again when the layout changes during one (resize, insets, narrow, a case swap); dropped when the
   * cover comes to rest.
   */
  /** The ends (distance, target) and whether the target keeps the zoom's ease (w = e: fitSwing decides) */
  type SwingCam = { d0: number; x0: number; y0: number; d1: number; x1: number; y1: number; tied?: boolean };
  let swingCam: SwingCam | null = null;
  /** The swing's ease at SWING_SAMPLES + 1 even steps of the openness (fitSwing), and the bounds it keeps to there */
  const swingE = new Float32Array(SWING_SAMPLES + 1);
  const swingW = new Float32Array(SWING_SAMPLES + 1);
  const swingLo = new Float32Array(SWING_SAMPLES + 1);
  const swingHi = new Float32Array(SWING_SAMPLES + 1);
  const swingTmp = new Float32Array(SWING_SAMPLES + 1);
  /** The camera as last placed at rest: distance (the tilt's lift taken off), target, shift (px down), at which end; ok: placed since the last swing / relayout */
  const restCam = { d: 0, x: 0, y: 0, at: 0, ok: false };
  /*
   * The swing's pace over the openness (before fitSwing bounds it): the camera covers its way at an even pace in time while the cover
   * tween (a cubic Hermite in time) speeds up and slows down — its speed against the openness is the inverse of the tween's
   * (SWING_TABLE), eased in and out over SWING_EDGE of the openness so that a cover only peeking (the hover lift) barely moves it. Top
   * speed ≈ 1.25× the swing's mean (the plain openness: 1.5×; smoothstep of it: 2.25×).
   */
  const swingEase = (c: number) => {
    const t = clamp(c, 0, 1) * (SWING_TABLE.length - 1);
    const i = Math.min(SWING_TABLE.length - 2, Math.floor(t));
    return SWING_TABLE[i]! + (SWING_TABLE[i + 1]! - SWING_TABLE[i]!) * (t - i);
  };
  /**
   * The swing's camera between the ends of s, the zoom at ease e and the pan at w: distance (before the tilt's lift) into swingAt.d,
   * target into swingAt.x, the picture's shift down (px, with the zoom) into swingAt.y
   */
  const swingAt = { d: 0, x: 0, y: 0 };
  function poseAt(s: SwingCam, e: number, w: number) {
    const inv = 1 / s.d0 + (1 / s.d1 - 1 / s.d0) * e;
    swingAt.d = 1 / inv;
    swingAt.x = (s.x0 / s.d0 + (s.x1 / s.d1 - s.x0 / s.d0) * (s.tied ? e : w)) / inv;
    swingAt.y = s.y0 + (s.y1 - s.y0) * e;
    return swingAt;
  }
  function swingPose(c: number) {
    const t = clamp(c, 0, 1) * SWING_SAMPLES;
    const i = Math.min(SWING_SAMPLES - 1, Math.floor(t));
    return poseAt(swingCam!, swingE[i]! + (swingE[i + 1]! - swingE[i]!) * (t - i), swingW[i]! + (swingW[i + 1]! - swingW[i]!) * (t - i));
  }
  /**
   * Fills swingE for a swing between the ends of s: at each step of the openness the stretch [lo, hi] of the distance's way where that
   * pose fits the canvas (the target where the pan has it then) (a px of air; brief r3 D1: the standing board may reach into every margin of the page, the controls' row below
   * the box too), narrowed so one ease can keep to all of them going one way (lo never falls, hi never rises along the openness); the
   * pace (swingEase) clamped into it and smoothed there. Returns whether every pose fits (false: the ease keeps as close as it can).
   */
  function fitSwing(s: SwingCam, passes = 2): boolean {
    const N = SWING_SAMPLES;
    const { left, right, top: insetTop, bottom: insetBottom } = insetsNow();
    const cx = left + (width - left - right) / 2;
    const cy = insetTop + (height - insetTop - insetBottom) / 2;
    const cY = centreY();
    const G = 12;
    // the pan keeps its own pace only where every corner of the back board moves one way whatever the zoom does
    const dA = 1 / s.d1 - 1 / s.d0;
    const dB = s.x1 / s.d1 - s.x0 / s.d0;
    const back = binder.boards(0)[2]!;
    s.tied = false;
    /** The back board's edge both push (the larger |x_p dA|) */
    let far = 0;
    for (const sx of [-1, 1]) {
      const xp = back.o[0] + back.x[0] * back.hw * sx;
      if (xp * dA * -dB < -1e-9) s.tied = true;
      if (Math.abs(xp) > Math.abs(far)) far = xp;
    }
    // the pan's pace: even at first (refined once the zoom's ease is known)
    for (let i = 0; i <= N; i++) swingW[i] = swingEase(i / N);
    let boards: BoardRect[] = [];
    let u = 0;
    const fits = (e: number) => {
      const p = poseAt(s, e, u);
      viewY = cY - p.y;
      put(p.d, p.x);
      const r = bounds(boards, false);
      return Math.max(tight() ? 1 : need(r.y0, r.y1, cy, 1, height - 1), narrow ? 1 : need(r.x0, r.x1, cx, 1, width - 1)) <= 1.0005;
    };
    // two passes: the zoom's bounds on the even pan, the pan paced on that zoom, the bounds again on that pan (the zoom kept within them)
    let ok = true;
    for (let pass = 0; pass < passes; pass++) {
      swingLo[0] = swingHi[0] = 0;
      swingLo[N] = swingHi[N] = 1;
      for (let i = 1; i < N; i++) {
        boards = binder.boards(i / N);
        u = swingW[i]!;
        let first = -1;
        let last = -1;
        for (let j = 0; j <= G; j++)
          if (fits(j / G)) {
            if (first < 0) first = j;
            last = j;
          }
        if (first < 0) {
          // nothing fits: an empty stretch (the bounds cross below)
          swingLo[i] = 1;
          swingHi[i] = 0;
          continue;
        }
        // the stretch's ends between the grid's last miss and first fit (the fitting part is taken to be one stretch)
        let a = (first - 1) / G;
        let b = first / G;
        if (first > 0)
          for (let k = 0; k < 5; k++) {
            const m = (a + b) / 2;
            if (fits(m)) b = m;
            else a = m;
          }
        swingLo[i] = b;
        a = last / G;
        b = (last + 1) / G;
        if (last < G)
          for (let k = 0; k < 5; k++) {
            const m = (a + b) / 2;
            if (fits(m)) a = m;
            else b = m;
          }
        swingHi[i] = a;
      }
      for (let i = 1; i <= N; i++) swingLo[i] = Math.max(swingLo[i]!, swingLo[i - 1]!);
      for (let i = N - 1; i >= 0; i--) swingHi[i] = Math.min(swingHi[i]!, swingHi[i + 1]!);
      ok = true;
      for (let i = 0; i <= N; i++) {
        if (swingLo[i]! > swingHi[i]! + 1e-6) ok = false;
        swingHi[i] = Math.max(swingHi[i]!, swingLo[i]!);
        swingE[i] = clamp(swingEase(i / N), swingLo[i]!, swingHi[i]!);
      }
      // smoothed: SWING_SOFT rounds of [1 2 1] / 4 within the bounds (a one-way sequence stays one way), then one way for sure
      for (let round = 0; round < SWING_SOFT; round++) {
        swingTmp.set(swingE);
        for (let i = 1; i < N; i++) swingE[i] = clamp((swingTmp[i - 1]! + 2 * swingTmp[i]! + swingTmp[i + 1]!) / 4, swingLo[i]!, swingHi[i]!);
      }
      for (let i = 1; i <= N; i++) swingE[i] = Math.max(swingE[i]!, swingE[i - 1]!);
      // the pan: the far edge (far dA e − dB w) at an even pace, w one way within 0 … 1 (it waits while the zoom hurries)
      if (pass > 0 || s.tied || Math.abs(dB) <= 1e-9) break;
      const dq = far * dA - dB;
      for (let i = 0; i <= N; i++) swingW[i] = clamp((far * dA * swingE[i]! - dq * swingEase(i / N)) / dB, 0, 1);
      swingW[0] = 0;
      swingW[N] = 1;
      for (let i = 1; i <= N; i++) swingW[i] = Math.max(swingW[i]!, swingW[i - 1]!);
      for (let round = 0; round < SWING_SOFT; round++) {
        swingTmp.set(swingW);
        for (let i = 1; i < N; i++) swingW[i] = (swingTmp[i - 1]! + 2 * swingTmp[i]! + swingTmp[i + 1]!) / 4;
      }
    }
    return ok;
  }
  /**
   * The shut framing's room: a factor on its distance (≥ 1) and a shift down in the box (px, shutY) — just enough that a one-way swing
   * fits the canvas (fitSwing), none when it already does (or when no room up to SHUT_ROOM_MAX would do). The standing board rises
   * far above the book and hardly below it, so the closed book first goes down into the room the box has under it (SHUT_DROP of it),
   * and gets only as much smaller as is still needed. Computed once per layout, on the resting framings.
   */
  let shutK = 0;
  let shutY = 0;
  function shutRoom(): number {
    if (shutK) return shutK;
    shutK = 1;
    shutY = 0;
    const f0 = frameAt(0, binder.pose(0).ring);
    const f1 = frameAt(1, binder.pose(1).ring);
    const d0 = restDist(0, f0.w, f0.x, false, false);
    const shut = binder.boards(0);
    const bottom = height - insetsNow().bottom;
    const s: SwingCam = { d0, x0: f0.x, y0: 0, d1: restDist(1, f1.w, f1.x, false), x1: f1.x, y1: 0 };
    if (fitSwing(s, 1)) return shutK;
    /** The shut framing at k: its distance and its shift (the room under the closed book in the box, SHUT_DROP of it) */
    const at = (k: number) => {
      s.d0 = d0 * k;
      viewY = centreY();
      put(s.d0, s.x0);
      s.y0 = Math.max(0, bottom - bounds(shut, false).y1) * SHUT_DROP;
      return fitSwing(s, 1);
    };
    if (!at(SHUT_ROOM_MAX)) return shutK;
    let a = 1;
    let b = SHUT_ROOM_MAX;
    if (at(1)) b = 1;
    else
      for (let it = 0; it < 8; it++) {
        const m = (a + b) / 2;
        if (at(m)) b = m;
        else a = m;
      }
    at(b);
    shutK = b;
    shutY = s.y0;
    return shutK;
  }
  /**
   * sasshi: how far (px, + to the right) the picture stands from the middle of the box: toward Insets.anchor, by as much as the
   * open spread leaves free in the box (LEAN_CLEAR kept at the near side). Worked out once per layout on the open resting framing, so
   * both resting framings and the swing between them share it: the view offset never moves during a swing. Null: not worked out yet.
   */
  let lean: number | null = null;
  function leanNow(): number {
    if (lean !== null) return lean;
    const anchor = insets.anchor;
    if (anchor === undefined || narrow) return (lean = 0);
    const { left, right } = insetsNow();
    const f1 = frameAt(1, binder.pose(1).ring);
    restDist(1, f1.w, f1.x, false, false);
    const r = bounds(binder.boards(1), false);
    const free = Math.max(0, (width - left - right - (r.x1 - r.x0)) / 2 - LEAN_CLEAR);
    lean = clamp(anchor - (left + (width - left - right) / 2), -free, free);
    return lean;
  }
  function computeSwing() {
    const f0 = frameAt(0, binder.pose(0).ring);
    const f1 = frameAt(1, binder.pose(1).ring);
    const s: SwingCam = { d0: restDist(0, f0.w, f0.x, false), x0: f0.x, y0: shutY, d1: restDist(1, f1.w, f1.x, false), x1: f1.x, y1: 0 };
    // from where the camera is: a phone's pan (or anything else at rest) may still be easing toward its framing
    if (restCam.ok) {
      if (restCam.at === 0) {
        s.d0 = restCam.d;
        s.x0 = restCam.x;
        s.y0 = restCam.y;
      } else {
        s.d1 = restCam.d;
        s.x1 = restCam.x;
        s.y1 = restCam.y;
      }
    }
    restCam.ok = false;
    swingCam = s;
    fitSwing(s);
  }
  function placeCamera(w: number) {
    camera.aspect = width / height;
    const { left, right } = insetsNow();
    viewX = (right - left) / 2 - leanNow();
    viewY = centreY();
    // sasshi (D2): the window's pattern is planned once per layout (the sun's frustum with it) and laid under the camera as placed
    if (!sunLaid) layoutSun();
    if (cover > 0 && cover < 1) {
      if (!swingCam) computeSwing();
      const p = swingPose(cover);
      camX = p.x;
      viewY = centreY() - p.y;
      put(tilted ? p.d + tilt.lift : p.d, camX);
    } else if (pageCam()) {
      // sasshi (round 4, E2): a phone's open album is framed by its page camera (no refit per frame; a tilt only lifts it)
      swingCam = null;
      const d = 1 / pcam.a;
      camX = pcam.b / pcam.a;
      put(tilted ? d + tilt.lift : d, camX);
      restCam.d = d;
      restCam.x = camX;
      restCam.y = 0;
      restCam.at = 1;
      restCam.ok = true;
    } else {
      swingCam = null;
      const d = restDist(cover, w, camX, true);
      restCam.d = tilted ? d - tilt.lift : d;
      restCam.x = camX;
      restCam.y = centreY() - viewY;
      restCam.at = cover;
      restCam.ok = true;
    }
    placeSun();
  }

  /*
   * ── sasshi (round 4, E2): the phone's page camera ──
   * Round 3 framed a phone's open album anew every frame: restDist kept the outer edge of the board under the page in view inside the
   * canvas from wherever the camera's x was — so while the camera eased from one page to the other (or a finger panned it away), it
   * pulled back to keep the far page's edge in view: the book zoomed out, slid, and once the distance passed the far plane (40) it
   * was gone for a moment (the owner's video). Now each page has one framing, worked out at rest (pageFrame), and the camera moves
   * between two of them along one line (PageMove), tied to whatever moves the view: the sheet that turns (turnEase of its progress,
   * under a finger or by itself, back the same way when it falls back), a finger panning the spread, or by itself at PAGE_CAM's pace.
   */
  /** The phone's page camera is in charge: narrow, an album with pages, the cover open and at rest */
  const pageCam = () => narrow && SHEETS > 0 && cover >= 1;
  /** Page m's resting framing (1 / distance, x / distance), per layout; the camera is put back where it was */
  function pageFrame(m: number) {
    let f = pageFrames.get(m);
    if (f) return f;
    const side = m % 2 === 1 ? -1 : 1;
    const fr = frameAt(1, binder.pose(1).ring, side, spreadOfPage(m));
    const vy = viewY;
    const d0 = putD;
    const x0 = putX;
    const d = restDist(1, fr.w, fr.x, false, true, side);
    viewY = vy;
    put(d0, x0);
    f = { a: 1 / d, b: fr.x / d };
    pageFrames.set(m, f);
    return f;
  }
  /** How far the view's middle slides (canvas widths) and the most the picture changes per unit of u, from (a0, b0) to (a1, b1) */
  function measureMove(m: PageMove) {
    const k = 2 * TAN * Math.max(0.1, width / height);
    const da = m.a1 - m.a0;
    const db = m.b1 - m.b0;
    // the desk points under the view's middle at either end (x = b / a): straight lines across the screen, their slide per unit of u
    const s0 = Math.abs((m.b0 / m.a0) * da - db) / k;
    const s1 = Math.abs((m.b1 / m.a1) * da - db) / k;
    m.shift = Math.max(s0, s1);
    m.span = Math.max(1e-4, m.shift, Math.abs(da) / Math.min(m.a0, m.a1));
  }
  /**
   * A new move from where the camera is to page `to` (tied to a turning sheet, or under a finger). A move under way hands on its pace:
   * its slide across the screen, projected on the new way (backwards when the new way goes back: it slows down and turns round).
   */
  function startMove(to: number, sheet: Sheet | null, base: number, sign: 1 | -1, finger: boolean) {
    const f = pageFrame(to);
    const m: PageMove = { a0: pcam.a, b0: pcam.b, a1: f.a, b1: f.b, to, u: 0, v: 0, ut: 0, span: 1, shift: 1, sheet, base, sign, finger, fu: 0, goal: 1 };
    measureMove(m);
    const old = pmove;
    if (old && old.v !== 0) {
      const xc = pcam.b / pcam.a;
      const was = old.v * (xc * (old.a1 - old.a0) - (old.b1 - old.b0));
      const per = xc * (m.a1 - m.a0) - (m.b1 - m.b0);
      if (Math.abs(per) > 1e-9) m.v = clamp(was / per, -PAGE_CAM.speed / m.span, PAGE_CAM.speed / m.span);
    }
    pmove = m;
    return m;
  }
  /** setPage: the camera follows to page `to` (one page on across a turn: tied to the sheet that turns) */
  function pageTo(from: number, to: number) {
    if (!pageCam()) return;
    // a pan the finger has just let go of, committed: the same move goes on
    if (pmove && pmove.to === to && !pmove.sheet) {
      pmove.finger = false;
      pmove.goal = 1;
      return;
    }
    const turn = Math.abs(to - from) === 1 && spreadOfPage(to) !== spreadOfPage(from);
    const s = turn ? sheets.get(spreadOfPage(Math.min(from, to))) ?? null : null;
    startMove(to, s, to > from ? 0 : 1, to > from ? 1 : -1, false);
  }
  /** The page camera straight onto page `page` (a new layout, a case swap, the swing just ended) */
  function snapPage() {
    pmove = null;
    if (!narrow || SHEETS === 0) return;
    const f = pageFrame(page);
    pcam.a = f.a;
    pcam.b = f.b;
  }
  /** Advances the page camera one frame; true while it moves */
  function stepPageCam(dt: number): boolean {
    let m = pmove;
    if (!m) {
      // at rest on its page (or sent there: the page changed under it, a move fell back short of a framing)
      const f = pageFrame(page);
      const k = 2 * TAN * Math.max(0.1, width / height);
      if (Math.abs(f.a - pcam.a) / f.a < 2e-4 && Math.abs((pcam.b / pcam.a) * (f.a - pcam.a) - (f.b - pcam.b)) / k < 2e-4) {
        pcam.a = f.a;
        pcam.b = f.b;
        return false;
      }
      m = startMove(page, null, 0, 1, false);
    }
    const ut = m.sheet ? turnEase((m.sheet.p - m.base) * m.sign) : m.finger ? m.fu : m.goal;
    const vt = (ut - m.ut) / Math.max(dt, 1e-3);
    m.ut = ut;
    if (m.finger) {
      // under a finger: right with it (its pace kept, for the hand-over when it lets go)
      m.v += ((ut - m.u) / Math.max(dt, 1e-3) - m.v) * (1 - Math.exp(-dt / 0.05));
      m.u = ut;
    } else {
      // by itself: toward ut at most PAGE_CAM.speed, speeding up and slowing down at PAGE_CAM.accel (it stops on ut), keeping up with
      // ut's own pace (a sheet turning) as far as the speed allows
      const vmax = PAGE_CAM.speed / m.span;
      const amax = PAGE_CAM.accel / m.span;
      // (a finger that let go faster than that: from here on at most that)
      m.v = clamp(m.v, -vmax, vmax);
      const e = ut - m.u;
      const want = clamp(clamp(vt, -vmax, vmax) + Math.sign(e) * Math.sqrt(2 * amax * Math.abs(e)), -vmax, vmax);
      m.v += clamp(want - m.v, -amax * dt, amax * dt);
      m.u += m.v * dt;
      // (on ut or just past it while slowing down onto it: on it)
      const e2 = ut - m.u;
      if ((e2 * e < 0 || Math.abs(e2) < 1e-4) && Math.abs(m.v) <= amax * dt * 2) {
        m.u = ut;
        m.v = 0;
      }
    }
    pcam.a = m.a0 + (m.a1 - m.a0) * m.u;
    pcam.b = m.b0 + (m.b1 - m.b0) * m.u;
    // arrived at an end, and what it followed is at rest there too
    if (!m.finger && Math.abs(m.u - ut) < 1e-4 && m.v === 0 && (ut < 1e-4 || ut > 1 - 1e-4) && (!m.sheet || m.sheet.body.asleep)) {
      const end = ut > 0.5;
      pcam.a = end ? m.a1 : m.a0;
      pcam.b = end ? m.b1 : m.b0;
      pmove = null;
    }
    return true;
  }
  let camW = HALF_W * 2;
  /**
   * sasshi (round 3, D4): the pixel ratio at rest (fullRatio) and the one in use. While the book moves (anything step() animates:
   * the cover, pages, the camera, the tilt, a settling pouch) it is drawn at MOVING_RATIO at most (when set: off by default, see there);
   * the frame after it settles, once more at the full ratio. The frosted pass keeps its targets at the full size (only its screen
   * mapping follows, frost.setScreen).
   */
  let fullRatio = 1;
  let ratioNow = 1;
  const bufSize = new THREE.Vector2();
  function setRatio(r: number) {
    if (r === ratioNow) return;
    ratioNow = r;
    renderer.setPixelRatio(r);
    renderer.setSize(width, height, false);
    if (frost) {
      renderer.getDrawingBufferSize(bufSize);
      frost.setScreen(bufSize.x, bufSize.y);
    }
  }
  function resize() {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    // sasshi (round 4, E7): and never more than PIXEL_BUDGET device pixels in all (a 2512 × 1233 window at 1.75 was 9.5 Mpx a frame)
    fullRatio = Math.min(window.devicePixelRatio || 1, width * height > 1_100_000 ? 1.75 : 2, Math.sqrt(PIXEL_BUDGET / (width * height)));
    ratioNow = fullRatio;
    renderer.setPixelRatio(fullRatio);
    renderer.setSize(width, height, false);
    if (frost) {
      renderer.getDrawingBufferSize(bufSize);
      frost.setSize(bufSize.x, bufSize.y);
    }
    relayout();
    // sasshi (D1): a new layout is framed at once (the narrow framings follow the width): the camera never eases from a framing
    // made for another size (the first one is made before the canvas has one) into a swing that starts from the new one
    snapFrame();
    placeCamera(camW);
    invalidate();
  }
  /** The camera's target and frame width straight onto the framing (no ease); the phone's page camera onto its page */
  function snapFrame() {
    const t = frame();
    camX = t.x;
    camW = t.w;
    snapPage();
  }

  /*
   * ── sasshi (round 3, D2): the sun's shadow map and the window's occluders ──
   * The pattern is planned once per layout (relayout: resize, insets, narrow, a case swap) in view px and laid on the desk under the
   * camera as placed (placeSun, whenever the camera moved): the page's desk is the DOM's and never moves, so the window's light on it
   * keeps its place on screen through a swing or a phone's pan, and the book moves under the leaves. The sun's frustum is fixed per
   * layout (never refitted per frame): the pattern under every resting camera the book can come to (a swing's camera lies between two
   * of them, and its pattern between theirs), on the desk and up in the air, and the book open, standing and shut. The sun's map is
   * drawn in the main pass (all the camera's layers: the book, the desk, the occluders) on frames where the book itself changed, the
   * camera moved or the twig swayed; the frosted pass before it uses the last one, as it does the key's when the case lies open.
   */
  let sunLaid = false;
  /** The sun's map is out of date (the twig swayed, the pattern was laid again, the context came back) */
  let sunDirty = true;
  const sunV = new THREE.Vector3();
  const sunRay = new THREE.Raycaster();
  const sunNdc = new THREE.Vector2();
  const deskPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  /** The camera the pattern was last laid under (its world matrix and its view: size and offset; "" to lay it again) */
  const sunCam = new THREE.Matrix4();
  let sunView = "";
  /** Everything the camera framing depends on changed: the swing's framings, the resting framings' room, the window's pattern */
  function relayout() {
    swingCam = null;
    pageFrames.clear();
    roomK = 0;
    shutK = 0;
    shutY = 0;
    lean = null;
    restCam.ok = false;
    sunLaid = false;
  }
  /** The desk plane's point under view px (x, y) for the camera as it is */
  const toDesk = (x: number, y: number, out: THREE.Vector3) => {
    sunNdc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
    sunRay.setFromCamera(sunNdc, camera);
    if (!sunRay.ray.intersectPlane(deskPlane, out)) out.set(0, 0, -deskPlane.constant);
    return out;
  };
  /** Lays the window's pattern under the camera when it moved since (the sun's map is drawn again) */
  function placeSun() {
    const view = `${width}|${height}|${viewX}|${viewY}`;
    if (view === sunView && sunCam.equals(camera.matrixWorld)) return;
    sunView = view;
    sunCam.copy(camera.matrixWorld);
    windowLight.place(toDesk, sunDir);
    sunDirty = true;
  }
  function layoutSun() {
    sunLaid = true;
    sunView = "";
    windowLight.layout(width, height);
    const deskZ = ground.position.z;
    deskPlane.constant = -deskZ;
    // the pattern under the shut and the open resting cameras (on a phone the open one with the page on either side); placeCamera
    // puts the real camera back right after
    const desk: THREE.Vector3[] = [];
    const f0 = frameAt(0, binder.pose(0).ring);
    restDist(0, f0.w, f0.x, false);
    windowLight.corners(toDesk, desk);
    for (const side of narrow ? [1, -1] : [1]) {
      const f1 = frameAt(1, binder.pose(1).ring, side);
      restDist(1, f1.w, f1.x, false, true, side);
      windowLight.corners(toDesk, desk);
    }
    // the sun's frustum: the pattern on the desk and up in the air, the case open and shut with a standing board over it
    const lift = sunDir.clone().multiplyScalar(OCCLUDER_HEIGHT / sunDir.z);
    const pts: THREE.Vector3[] = [];
    for (const p of desk) pts.push(p.clone(), p.clone().add(lift));
    const x0 = Math.min(binder.closedSpan[0], -HALF_W) - 0.5;
    const x1 = HALF_W + 0.5;
    const yh = dims.H / 2 + 0.5;
    const top = Math.max(dims.B, dims.H / 2) + 0.5;
    for (const x of [x0, x1]) for (const y of [-yh, yh]) for (const z of [deskZ, top]) pts.push(new THREE.Vector3(x, y, z));
    const c = new THREE.Vector3();
    for (const p of pts) c.add(p);
    c.divideScalar(pts.length).setZ(deskZ);
    let along = 0;
    for (const p of pts) along = Math.max(along, sunV.copy(p).sub(c).dot(sunDir));
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(sunDir, along + 1);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    let l = Infinity;
    let r = -Infinity;
    let b = Infinity;
    let t = -Infinity;
    let n = Infinity;
    let f = -Infinity;
    for (const p of pts) {
      sunV.copy(p).applyMatrix4(cam.matrixWorldInverse);
      l = Math.min(l, sunV.x);
      r = Math.max(r, sunV.x);
      b = Math.min(b, sunV.y);
      t = Math.max(t, sunV.y);
      n = Math.min(n, -sunV.z);
      f = Math.max(f, -sunV.z);
    }
    cam.left = l - 0.2;
    cam.right = r + 0.2;
    cam.bottom = b - 0.2;
    cam.top = t + 0.2;
    cam.near = Math.max(0.05, n - 0.5);
    cam.far = f + 0.5;
    cam.updateProjectionMatrix();
    // the key's bias in world units (≈ 0.7 mm) over this map's depth range: the moments are half floats
    sun.shadow.bias = -0.0072 / (cam.far - cam.near);
    sunDirty = true;
    applyFade();
  }
  /**
   * Addon meshes that receive shadows stay out of every shadow map (VSM draws receivers): a mesh without a depth material of its own
   * gets one that writes nothing. three copies alphaTest / map / alphaMap from the mesh's material onto it before every draw, and an
   * alphaTest crossing 0 bumps its version (a program switch per draw): those are pinned.
   */
  const receiveOnly = frostCaster();
  for (const k of ["alphaTest", "map", "alphaMap", "displacementMap"] as const) {
    const v = k === "alphaTest" ? 0 : null;
    Object.defineProperty(receiveOnly, k, { get: () => v, set: () => {}, configurable: true });
  }
  const guardReceiver = (ob: THREE.Object3D) => {
    const m = ob as THREE.Mesh;
    if (m.isMesh && m.receiveShadow && !m.customDepthMaterial) m.customDepthMaterial = receiveOnly;
  };
  /** The key's map is to be drawn in the next pass that renders the scene (the frosted background or the main one) */
  function keyMap() {
    key.shadow.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
  }
  /** setLightFade: px from each edge of the view (the shell's layout), turned into NDC for the desk catcher */
  let lightFade: LightFade | null = null;
  function applyFade() {
    const f = lightFade;
    const w = 2 / Math.max(1, width);
    const h = 2 / Math.max(1, height);
    groundU.uFadeFrom.value.set(f ? f.left.from * w : 0, f ? f.right.from * w : 0, f ? f.top.from * h : 0, f ? f.bottom.from * h : 0);
    groundU.uFadeTo.value.set(f ? f.left.to * w : 0, f ? f.right.to * w : 0, f ? f.top.to * h : 0, f ? f.bottom.to * h : 0);
  }
  /*
   * The twig's sway (setAmbient): one frame every SUN.swayMs at most, only while the page is visible, the motion is not reduced and the
   * book runs on its own clock; each tick turns the twig and re-draws the sun's map and the frame (the key's map stays).
   * The sway has a clock of its own (swayT) that runs only while it sways: each tick adds the time since the one before (at most two
   * intervals), and a stop forgets the last tick — so a dialog, a hidden tab or a lost context holds the twig where it is and it goes
   * on from that pose, never a jump to where the wall clock would have it by now (a relayout keeps the pose too, window-light.ts).
   */
  let ambient = true;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let swayTimer = 0;
  let swayT = 0;
  /** performance.now() of the last tick that swayed (0: the sway is starting again; the next tick adds nothing) */
  let swayLast = 0;
  function swayTick() {
    swayTimer = 0;
    if (disposed || !ambient || reducedMotion || !visible || glLost || manual !== null || frozen || !ready) {
      swayLast = 0;
      return;
    }
    const t = performance.now();
    if (swayLast) swayT += Math.min(t - swayLast, 2 * SUN.swayMs) / 1000;
    swayLast = t;
    if (windowLight.sway(swayT)) {
      sunDirty = true;
      needsFrame = true;
      schedule();
    }
    swayTimer = window.setTimeout(swayTick, SUN.swayMs);
  }
  function startSway() {
    if (!swayTimer) swayTimer = window.setTimeout(swayTick, SUN.swayMs);
  }
  function stopSway() {
    clearTimeout(swayTimer);
    swayTimer = 0;
    swayLast = 0;
  }

  /*
   * ── sasshi: whole-book tilt / shake (BookOptions.tilt) ──
   * bookGroup carries the case, its metal and the sheets; the desk, its contact shadows, the lights and the camera stay put. Its matrix is
   * T(pivot + jolt + lift) · R(tilt) · T(−pivot): tilted about the camera's target on the desk (so on a phone the framed board turns about
   * its own middle), slid a little with the pointer's velocity, and lifted so the lowest corner of the case stays on the desk.
   * Everything that works in book coordinates (page picking, the drag plane, the frosted cover's distance and its analytic shadow) maps
   * world → book through bookInv. With `tilt` off the matrix stays the identity and none of this runs.
   */
  const tiltOn = !!opts.tilt;
  /** The applied pose: tilt (rad) about the desk's x / y axes and its rate, the jolt slide (scene units) and its rate, the turn about z, the lift */
  const tilt = { x: 0, y: 0, vx: 0, vy: 0, ox: 0, oy: 0, vox: 0, voy: 0, rz: 0, lift: 0 };
  /** What the drag asks for: tilt (rad) and jolt (scene units) */
  const tiltGoal = { x: 0, y: 0, ox: 0, oy: 0 };
  /** setTilt: target and smoothed value (rad) */
  const devTilt = { tx: 0, ty: 0, x: 0, y: 0 };
  /** A tilt drag: pointer id, where it went down, its last sample and the low-passed velocity (px / s) */
  let tiltDrag: { id: number; x0: number; y0: number; t: number; x: number; y: number; vx: number; vy: number } | null = null;
  /** shake(): damped sinusoids (start on the book's clamped clock bookT, strength, direction in the desk plane) */
  const jiggles: { t0: number; amp: number; dir: number }[] = [];
  let jiggleDir = 0.35;
  let tilted = false;
  const bookInv = new THREE.Matrix4();
  const tiltRot = new THREE.Matrix4();
  const tiltTmp = new THREE.Matrix4();
  const tiltEuler = new THREE.Euler();
  const tiltV = new THREE.Vector3();
  /** Critically damped spring, sub-stepped (stable for any frame time): advances tilt[k] and its rate tilt[vk] */
  function spring(k: "x" | "y" | "ox" | "oy", vk: "vx" | "vy" | "vox" | "voy", goal: number, hz: number, dt: number) {
    const w = 2 * Math.PI * hz;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    let x = tilt[k];
    let v = tilt[vk];
    for (let i = 0; i < n; i++) {
      v += (w * w * (goal - x) - 2 * w * v) * h;
      x += v * h;
    }
    tilt[k] = x;
    tilt[vk] = v;
  }
  /** Advances the tilt; true while it moves */
  function stepTilt(now: number, dt: number): boolean {
    if (!tiltOn) return false;
    const F = TILT_FEEL;
    devTilt.x = approach(devTilt.x, devTilt.tx, F.device, dt);
    devTilt.y = approach(devTilt.y, devTilt.ty, F.device, dt);
    if (Math.abs(devTilt.x - devTilt.tx) < 1e-5) devTilt.x = devTilt.tx;
    if (Math.abs(devTilt.y - devTilt.ty) < 1e-5) devTilt.y = devTilt.ty;
    // the pointer's velocity decays when it stops sending events
    if (tiltDrag) {
      const k = Math.exp(-dt / 0.08);
      tiltDrag.vx *= k;
      tiltDrag.vy *= k;
      const size = Math.max(1, Math.min(width, height));
      const jx = clamp((tiltDrag.vx / size) * F.jolt.k, -F.jolt.max, F.jolt.max);
      const jy = clamp((-tiltDrag.vy / size) * F.jolt.k, -F.jolt.max, F.jolt.max);
      tiltGoal.ox = jx;
      tiltGoal.oy = jy;
    }
    const gx = clamp(tiltGoal.x + devTilt.x, -F.max, F.max);
    const gy = clamp(tiltGoal.y + devTilt.y, -F.max, F.max);
    spring("x", "vx", gx, F.hz, dt);
    spring("y", "vy", gy, F.hz, dt);
    spring("ox", "vox", tiltGoal.ox, F.jolt.hz, dt);
    spring("oy", "voy", tiltGoal.oy, F.jolt.hz, dt);
    // shake(): damped sinusoids on top (slide along their direction, a turn about the vertical, a little tilt)
    let sx = 0;
    let sy = 0;
    let rz = 0;
    let tx = 0;
    let ty = 0;
    const S = F.shake;
    for (let i = jiggles.length - 1; i >= 0; i--) {
      const j = jiggles[i]!;
      const e = now - j.t0;
      if (e > S.life) {
        jiggles.splice(i, 1);
        continue;
      }
      if (e < 0) continue;
      const a = j.amp * Math.exp(-e / S.tau);
      const s = a * Math.sin(2 * Math.PI * S.hz * e);
      const c = a * Math.sin(2 * Math.PI * S.hz * e + 1.3);
      sx += Math.cos(j.dir) * s * S.move;
      sy += Math.sin(j.dir) * s * S.move;
      rz += c * S.turn;
      tx += -Math.sin(j.dir) * c * S.tilt;
      ty += Math.cos(j.dir) * c * S.tilt;
    }
    const rest = (x: number) => Math.abs(x) < 1e-5;
    const moving =
      !!tiltDrag ||
      jiggles.length > 0 ||
      devTilt.x !== devTilt.tx ||
      devTilt.y !== devTilt.ty ||
      !rest(tilt.x - gx) ||
      !rest(tilt.y - gy) ||
      !rest(tilt.vx) ||
      !rest(tilt.vy) ||
      !rest(tilt.ox - tiltGoal.ox) ||
      !rest(tilt.oy - tiltGoal.oy) ||
      !rest(tilt.vox) ||
      !rest(tilt.voy);
    if (!moving) {
      // settle exactly on the goal (no endless sub-pixel creep)
      tilt.x = gx;
      tilt.y = gy;
      tilt.ox = tiltGoal.ox;
      tilt.oy = tiltGoal.oy;
      tilt.vx = tilt.vy = tilt.vox = tilt.voy = 0;
    }
    tilt.rz = rz;
    const ax = tilt.x + tx;
    const ay = tilt.y + ty;
    const ox = tilt.ox + sx;
    const oy = tilt.oy + sy;
    const was = tilted;
    tilted = !(ax === 0 && ay === 0 && ox === 0 && oy === 0 && rz === 0);
    if (!tilted) {
      tilt.lift = 0;
      if (was) {
        bookGroup.matrix.identity();
        bookGroup.matrixWorldNeedsUpdate = true;
        bookInv.identity();
        placeContact(0, 0);
      }
      return moving || was;
    }
    // pivot: the camera's target on the desk
    const px = camX;
    tiltRot.makeRotationFromEuler(tiltEuler.set(ax, ay, rz, "XYZ"));
    // lift: the lowest of the four bottom corners of the case stays on the desk
    const zb = -dims.CT - dims.drop;
    const [c0] = binder.closedSpan;
    const xa = cover >= 0.5 ? -HALF_W : c0;
    let minZ = Infinity;
    for (const cx of [xa, HALF_W])
      for (const cy of [-dims.H / 2, dims.H / 2]) {
        tiltV.set(cx - px, cy, zb).applyMatrix4(tiltRot);
        minZ = Math.min(minZ, tiltV.z);
      }
    tilt.lift = Math.max(0, zb - minZ);
    bookGroup.matrix.makeTranslation(-px, 0, 0).premultiply(tiltRot).premultiply(tiltTmp.makeTranslation(px + ox, oy, tilt.lift));
    bookGroup.matrixWorldNeedsUpdate = true;
    bookInv.copy(bookGroup.matrix).invert();
    placeContact(ox, oy);
    return true;
  }
  /** The contact shadows follow the jolt slide */
  function placeContact(ox: number, oy: number) {
    for (const m of [contactR, contactL]) {
      const b = m.userData.base as THREE.Vector3;
      m.position.set(b.x + ox, b.y + oy, b.z);
    }
  }
  /** A world ray in book coordinates (the same ray when the book is not tilted) */
  const bookRay = new THREE.Ray();
  function toBook(r: THREE.Ray): THREE.Ray {
    if (!tilted) return r;
    return bookRay.copy(r).applyMatrix4(bookInv);
  }
  /** A point in book coordinates → normalised device coordinates */
  function projectBook(v: THREE.Vector3): THREE.Vector3 {
    if (tilted) v.applyMatrix4(bookGroup.matrix);
    return v.project(camera);
  }
  function tiltDown(e: PointerEvent): boolean {
    if (!tiltOn) return false;
    tiltDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t: e.timeStamp, x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
    canvasEl.style.cursor = "grabbing";
    invalidate();
    return true;
  }
  function tiltMove(e: PointerEvent) {
    const d = tiltDrag!;
    const F = TILT_FEEL;
    const dtp = Math.max(1, e.timeStamp - d.t) / 1000;
    const k = 1 - Math.exp(-dtp / F.velTau);
    d.vx += ((e.clientX - d.x) / dtp - d.vx) * k;
    d.vy += ((e.clientY - d.y) / dtp - d.vy) * k;
    d.x = e.clientX;
    d.y = e.clientY;
    d.t = e.timeStamp;
    const span = Math.max(1, Math.min(width, height) * F.span);
    // drag right → the right side goes down (about +y); drag down (toward the viewer) → the near edge goes down (about +x)
    tiltGoal.y = F.max * Math.tanh((e.clientX - d.x0) / span);
    tiltGoal.x = F.max * Math.tanh((e.clientY - d.y0) / span);
    invalidate();
  }
  function tiltUp() {
    tiltDrag = null;
    tiltGoal.x = tiltGoal.y = tiltGoal.ox = tiltGoal.oy = 0;
    canvasEl.style.cursor = "";
    invalidate();
  }

  /*
   * ── sasshi: scene addons (addon.ts) ──
   * Each addon's object hangs off an anchor frame on the inside of a board (binder.anchors). Every rendered frame the case is posed,
   * then each addon gets update(dt, t, anchorWorld); while any returns true frames keep coming. Frames that only addons asked for leave the
   * shadow maps (addons never cast; their receivers write no depth) and, with the frosted cover lying open, the frost background as they
   * were.
   */
  const anchorOf = (a: SceneAddon) => (a.anchor === "front-inside" ? binder.anchors.front : binder.anchors.back);
  /** The cover openness the addons were last told about (−1: not yet) */
  let addonOpen = -1;
  /** An addon claimed the gesture of this pointer */
  let addonHold: { a: SceneAddon; id: number } | null = null;
  let addonHover = false;
  /** One more frame without marking the book itself dirty (addon asked for it) */
  function wake() {
    needsFrame = true;
    schedule();
  }
  let warnedLayers = false;
  function adopt(a: SceneAddon) {
    anchorOf(a).add(a.object);
    // House rules (see addon.ts): no frost / desk layers, nothing cast; receivers (receiveShadow, the window light falls on them) stay
    // out of every shadow map all the same (VSM also draws receivers): renderSun gives them a depth pass that writes nothing
    a.object.traverse((ob) => {
      if (ob.layers.isEnabled(FROST_LAYER) || ob.layers.isEnabled(DESK_LAYER)) {
        ob.layers.disable(FROST_LAYER);
        ob.layers.disable(DESK_LAYER);
        if (!ob.layers.mask) ob.layers.set(0);
        if (!warnedLayers) console.warn("[sasshi] scene addons must not use three layers 1 / 2 (frost, desk); reset to layer 0");
        warnedLayers = true;
      }
      ob.castShadow = false;
      guardReceiver(ob);
    });
    const ctx: AddonContext = { renderer, scene, camera, invalidate: wake };
    a.attach?.(ctx);
  }
  /** Poses the case for this frame, tells the addons the openness, runs their update; true when one asked for more frames */
  function poseAddons(dt: number, now: number): boolean {
    addonMoved = false;
    if (!addons.length) return false;
    const bp = binder.pose(cover);
    ring = bp.ring;
    bookGroup.updateMatrixWorld(true);
    if (cover !== addonOpen) {
      addonOpen = cover;
      for (const a of addons) a.setOpen?.(cover);
    }
    for (const a of addons) if (a.update(dt, now, anchorOf(a).matrixWorld)) addonMoved = true;
    return addonMoved;
  }
  /** A world-space ray under a client point (a fresh object: addons may keep it) */
  function worldRay(x: number, y: number): THREE.Ray {
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.clone();
  }
  const addonsLive = () => addons.length > 0 && cover >= 1 - 1e-4 && !coverTween;

  /* ── Every frame ── */
  let raf = 0;
  let lastT = 0;
  let needsFrame = true;
  /**
   * sasshi: something of the book itself changed since the last render (case, sheets, camera, tilt, theme, size). Frames that
   * only addons asked for skip the shadow-map update and, when the frosted cover lies flat, the frost background pass.
   */
  let bookDirty = true;
  let renderCount = 0;
  let visible = document.visibilityState === "visible";
  /** sasshi: the WebGL context is lost and not back yet (see `lost`): no frames until it is */
  let glLost = false;
  function invalidate() {
    needsFrame = true;
    bookDirty = true;
    schedule();
  }
  function schedule() {
    if (raf || disposed || !visible || glLost) return;
    raf = requestAnimationFrame(tick);
  }
  function tick(ms: number) {
    raf = 0;
    if (disposed) return;
    const now = ms / 1000;
    // sasshi: a long frame (a loaded machine, a background tab coming back) advances the book by at most DT_MAX: everything
    // stepped by dt is exact or sub-stepped anyway (approach, the tilt springs, the physics' fixed steps); the clamp keeps a page or the
    // pouch from taking one big leap
    const dt = lastT ? Math.min(DT_MAX, now - lastT) : 1 / 60;
    lastT = now;
    const active = frozen || manual !== null ? false : step(now, dt);
    // sasshi (D4): moving, a lighter canvas; settled, the full one again (one more frame)
    if (active) setRatio(MOVING_RATIO === null ? fullRatio : Math.min(fullRatio, MOVING_RATIO));
    else if (ratioNow !== fullRatio) {
      setRatio(fullRatio);
      needsFrame = true;
    }
    if (active || needsFrame) {
      needsFrame = false;
      render();
    }
    if (active) schedule();
    else lastT = 0;
  }
  /** sasshi: an addon's update() asked for frames this step (its objects moved) */
  let addonMoved = false;
  const keyLocal = new THREE.Vector3();
  const hiddenForFrost: THREE.Object3D[] = [];
  /** The sheets' gloss while the frosted background is drawn (two numbers a sheet; reused) */
  const saved: number[] = [];
  function render() {
    // sasshi (round 4, E1): a side this frame shows is never one printed from the content before the last swap
    if (stale.size) freshen();
    const full = bookDirty;
    bookDirty = false;
    renderCount++;
    // the metal's highlights are motion-blurred by the spine's angular speed (the same idea as the pockets, a shutter of STEEL_SHUTTER
    // s): as the spine turns over, the softbox's reflection on the base stretches and dims instead of flashing white for a frame or two
    const sweep = 2 * spineW * STEEL_SHUTTER;
    binder.steel.roughness = Math.min(0.65, Math.sqrt(Math.hypot(STEEL_ROUGH * STEEL_ROUGH, sweep)));
    binder.steel.clearcoatRoughness = Math.min(0.65, Math.sqrt(Math.hypot(STEEL_COAT * STEEL_COAT, sweep)));
    const pose = binder.pose(cover);
    ring = pose.ring;
    frontAngle = pose.front;
    keyDir.copy(key.position).sub(key.target.position);
    // sasshi: the frosted cover and its analytic shadow work in the book's own frame (boards come from binder.pose in it)
    if (frost) frost.uniforms.uFrostInv.value.copy(bookInv);
    if (tilted) keyLocal.copy(keyDir).transformDirection(bookInv);
    // sasshi: under a cloth / leather case the analytic frost shadow is off (strength 0 leaves the light untouched)
    const fsStrength = binder.frost ? FROST_SHADOW.strength : 0;
    frostShadow.update(pose.boards, tilted ? keyLocal : keyDir, fsStrength, FROST_SHADOW.ground, tilted ? bookInv : undefined);
    for (const s of sheets.values()) {
      // sheets at rest: the hole angle recomputed from the current ring centre (the rings move while the cover opens / closes)
      if (s.body.asleep && !s.pinned) s.body.phi = holeAngle(s.body.a[0]!, envOf(s.index));
      updateUniforms(s);
    }
    // sasshi: a tilted book is lifted off the desk; its contact shadows fade with the lift
    const liftFade = tilt.lift > 0 ? 1 - smooth(clamp(tilt.lift / 0.3, 0, 1)) : 1;
    contactMat.opacity = CONTACT * liftFade;
    // the left contact shadow is there only while the front board lies flat (within about 15° of the desk): once the board lifts, nothing
    // is under it
    contactL.material.opacity = contactMat.opacity * smooth(clamp(1 - (Math.PI - frontAngle) / 0.26, 0, 1));
    // fully open: the boards lie flat on the desk with only the desk behind them — the background draws the desk layer alone (with the
    // last frame's shadow map), and the shadow map is updated in the main render
    const deskOnly = cover >= 1 - 1e-4 && carry === 0;
    // sasshi (D2): the sun's map when the book changed or the twig swayed (the key's only when the book changed)
    const sunFrame = full || sunDirty;
    if (sunFrame) {
      sunDirty = false;
      for (const a of addons) a.object.traverse(guardReceiver);
    }
    // sasshi: frames only addons asked for keep the last shadow map and (flat open frost) the last frost background
    if (frost && (sunFrame || (!deskOnly && addonMoved))) {
      if (!deskOnly && full) keyMap();
      // while the cover lies over the pages, light reaching inside first passes through the frosted board: dimmer and diffused — the
      // softbox's and the key's specular highlights on the pockets' clearcoat must not show through (flickering). The background pass
      // lowers the environment light, the key and the pockets' gloss by how much the cover covers, back to normal once it is lifted to
      // vertical; the metal seen through the frost is only a soft grey too
      const env = scene.environmentIntensity;
      const keyI = key.intensity;
      const sunI = sun.intensity;
      const open = smooth(clamp((cover - 0.04) / 0.46, 0, 1));
      const gloss = FROST.shadeGloss + (1 - FROST.shadeGloss) * open;
      scene.environmentIntensity = env * (FROST.shadeEnv + (1 - FROST.shadeEnv) * open);
      key.intensity = keyI * (FROST.shadeKey + (1 - FROST.shadeKey) * open);
      sun.intensity = sunI * (FROST.shadeKey + (1 - FROST.shadeKey) * open);
      let n = 0;
      for (const s of sheets.values()) {
        // sheets carried by the closing front board lie against its inside: however high the cover is lifted, their light has come
        // through the board
        const g = carry > 0 && s.index < carry ? FROST.shadeGloss : gloss;
        saved[n++] = s.mat.clearcoat;
        saved[n++] = s.mat.specularIntensity;
        s.mat.clearcoat *= g;
        s.mat.specularIntensity *= g;
      }
      const st = binder.steel;
      const steelEnv = st.envMapIntensity;
      const steelCoat = st.clearcoat;
      const steelRough = st.roughness;
      const groundOpacity = groundMat.opacity;
      groundMat.opacity = Math.min(0.9, groundOpacity * deskGain);
      const sunOpacity = groundU.uSunOpacity.value;
      groundU.uSunOpacity.value = Math.min(0.9, sunOpacity * deskGain);
      // clearcoat cannot be set to 0 (that switches to another shader program): pressed very low instead
      st.envMapIntensity *= 0.35;
      st.clearcoat *= 0.02;
      st.roughness = 0.6;
      // sasshi: transparent addon meshes stay out of the background (they would show twice through the back board under them)
      if (!deskOnly) {
        for (const a of addons)
          a.object.traverseVisible((ob) => {
            const m = ob as THREE.Mesh;
            if (m.isMesh && (Array.isArray(m.material) ? m.material.some((x) => x.transparent) : m.material.transparent)) hiddenForFrost.push(m);
          });
        for (const m of hiddenForFrost) m.visible = false;
      }
      // the desk inside the box (the margin seen round the pages through the front board, really the back board's inside): with the cover
      // over it less light gets in there too, so it darkens with the pages rather than a bright frame round a grey window
      frost.render(renderer, scene, camera, bgInside.copy(bgBehind).multiplyScalar(FROST.shadeDesk + (1 - FROST.shadeDesk) * open), deskOnly);
      for (const m of hiddenForFrost) m.visible = true;
      hiddenForFrost.length = 0;
      st.envMapIntensity = steelEnv;
      st.clearcoat = steelCoat;
      st.roughness = steelRough;
      groundMat.opacity = groundOpacity;
      groundU.uSunOpacity.value = sunOpacity;
      let k = 0;
      for (const s of sheets.values()) {
        s.mat.clearcoat = saved[k++]!;
        s.mat.specularIntensity = saved[k++]!;
      }
      scene.environmentIntensity = env;
      key.intensity = keyI;
      sun.intensity = sunI;
      if (deskOnly && full) keyMap();
    } else if (full) keyMap();
    if (sunFrame) {
      sun.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  /** Advance one frame; returns whether anything is still moving */
  function step(now: number, dt: number): boolean {
    let active = false;
    const coverBefore = cover;
    bookT += dt;
    // the cover (sasshi: on the book's clamped clock, see Tween)
    if (coverTween) {
      coverTween.t += dt;
      cover = clamp(tweenAt(coverTween), 0, 1);
      if (coverTween.t >= coverTween.dur) {
        cover = coverTween.to;
        coverTween = null;
        if (cover === 0 && carry > 0) {
          // shut: every turned sheet goes back to the right; the next opening starts at the first page
          carry = 0;
          spread = 0;
          page = 0;
          for (const s of sheets.values()) restSheet(s, 0);
          syncWindow();
          emit();
        } else if (cover === 1 && carry > 0) {
          // opened again halfway through closing and the front board is flat: sheets that swung back on it lie on the left; sheets a
          // finger lifted back go back to the ordinary physics (landing on the left stack)
          for (const s of sheets.values()) {
            if (s.index >= carry) continue;
            if (s.loose) s.loose = false;
            else restSheet(s, 1);
          }
          carry = 0;
          syncWindow();
        }
      }
      active = true;
    } else if (!drag || drag.mode !== "cover") {
      // hovering over the closed cover: the cover lifts a little
      const goal = coverTarget === 0 && hover && "cover" in hover ? HOVER_COVER : coverTarget;
      if (Math.abs(cover - goal) > 1e-4) {
        cover = approach(cover, goal, 0.09, dt);
        active = true;
      } else cover = goal;
    }
    const bp = binder.pose(cover);
    ring = bp.ring;
    // closing: the left stack turns back with the front board (a little ahead of it, the board holding it from below): while on the
    // board the sheets are posed directly and cannot pass out through it; past vertical they are let go to the physics one by one —
    // they topple by themselves (the seam sagging as usual) onto the right stack, and the front board comes down last.
    // A sheet already let go is pushed right by the front board when it catches up (the board's inside is its ceiling), never swept through
    if (carry > 0) {
      // the front board's angular speed this frame (rad / s, negative turning right): a sheet let go starts at it
      const wBoard = (frontOf(cover) - frontOf(coverBefore)) / Math.max(dt, 1e-3);
      // from sheet 0 on the front board upward: each is turned one pocket thickness less than the one below (their roots differ, so their
      // own limits may cross — and then two neighbours would pass through each other)
      let below = Infinity;
      for (const s of sheetList()) {
        if (s.index >= carry) continue;
        s.hovering = false;
        const lim = underBoard(s.index, bp);
        if (s.loose) {
          below = pageProgress(s.body);
          continue;
        }
        const lead = clamp(bp.front / Math.PI - 0.03 - 0.008 * s.index, 0, 1);
        const before = s.p;
        const next = Math.max(0, Math.min(lead, lim, below - CARRY_GAP));
        const w = ((next - before) * Math.PI) / Math.max(dt, 1e-3);
        s.wKin = Math.abs(w);
        if (coverTarget === 0 && Math.PI * next < Math.PI / 2 - CARRY_RELEASE[0] - CARRY_RELEASE[1] * (carry - 1 - s.index)) {
          // let go: handed to the physics from the pose of the last frame, at the speed it turned with the front board — the physics
          // moves it on this frame, it is not both posed and stepped
          s.loose = true;
          freePage(s.body);
          s.body.goal = 0;
          s.body.w.fill(Math.min(0, w));
          below = before;
          continue;
        }
        s.p = next;
        below = s.p;
        posePage(s.body, Math.PI * s.p, envOf(s.index));
      }
    }
    // hovering near a page edge: a finger gently lifts the edge (a soft hand; let go, gravity brings it back down)
    for (const s of sheets.values()) {
      const want = !!hover && "sheet" in hover && hover.sheet === s.index && cover >= 1 && !drag && carry === 0;
      if (want && !s.hovering && s.body.asleep && !s.body.hand && (s.p === 0 || s.p === 1)) {
        const side = s.p;
        s.hovering = true;
        s.pinned = false;
        grabPage(s.body, GEOM.inner + GEOM.outer - 0.04, side * Math.PI, HOVER_SOFT);
        pullPage(s.body, side === 0 ? HOVER_LIFT : Math.PI - HOVER_LIFT);
      } else if (!want && s.hovering) {
        s.hovering = false;
        if (s !== drag?.sheet) freePage(s.body);
      }
    }
    // the dragged sheet: the point the hand holds follows the pointer (when pointer events are sparser than frames, it looks back half a
    // beat by frame number and interpolates between two successive events)
    if (drag?.sheet) {
      pointerAt(drag, frameNo - (drag.cad - 1));
      pullPage(drag.sheet.body, dragGoal(drag));
    }
    if (drag?.mode === "cover") {
      const before = cover;
      cover = approach(cover, drag.targetP, 0.06, dt);
      if (Math.abs(cover - before) > 1e-5 || Math.abs(cover - drag.targetP) > 1e-4) active = true;
    }
    // how fast the spine (with the metal) turns: it turns only in the second half of the opening / closing
    spineW = Math.abs(hingeAngles(cover)[0] - hingeAngles(coverBefore)[0]) / Math.max(dt, 1e-3);
    // physics: every awake sheet advanced in fixed substeps (not those the closing front board carries)
    const H = 1 / P.hz;
    const list = sheetList();
    simAcc = Math.min(simAcc + dt, 0.1);
    while (simAcc >= H) {
      simAcc -= H;
      simT += H;
      for (const s of list) {
        if (riding(s)) continue;
        stepPage(s.body, envOf(s.index), H, simT, P);
      }
      keepOrder(list);
    }
    // sheets already let go from the closing front board: after the physics step, the board's inside (and the sheet under it in the
    // stack) is its ceiling — when the front board catches up it pushes the sheet right, at the board's speed, never sweeping through it
    if (carry > 0) {
      const wBoard = (frontOf(cover) - frontOf(coverBefore)) / Math.max(dt, 1e-3);
      let below = Infinity;
      for (const s of list) {
        if (s.index >= carry) continue;
        if (s.loose) {
          const top = Math.PI * Math.min(underBoard(s.index, bp), below - CARRY_GAP);
          let hit = false;
          for (let k = 0; k < s.body.n; k++)
            if (s.body.a[k]! > top) {
              s.body.a[k] = top;
              s.body.w[k] = Math.min(s.body.w[k]!, wBoard);
              hit = true;
            }
          if (hit) s.body.asleep = false;
        }
        below = s.loose ? pageProgress(s.body) : s.p;
      }
    }
    for (const s of list) {
      if (riding(s)) continue;
      s.p = pageProgress(s.body);
      if (!s.body.asleep) active = true;
    }
    followSounds(dt);
    // everything in flight has landed: tidy up the texture window; close was pressed during a turn: close now
    if (!active) syncWindow();
    if (closeAsked && !pagesBusy()) {
      closeCover();
      active = true;
    }
    // camera
    const target = frame();
    const prevX = camX;
    const prevW = camW;
    if (cover > 0 && cover < 1) {
      // sasshi (D1): during a swing the camera is a function of the openness (placeCamera sets camX); the frame width keeps up
      // with the target so the resting framing takes over exactly where the swing ends
      camW = target.w;
    } else if (swingCam) {
      // the swing just ended (a long frame may have skipped its last stretch): the resting framing it was heading for, at once
      camX = target.x;
      camW = target.w;
      if (pageCam()) snapPage();
    } else if (pageCam()) {
      // sasshi (round 4, E2): a phone's open album: the page camera (placeCamera puts it)
      if (stepPageCam(dt)) active = true;
      camX = pcam.b / pcam.a;
    } else {
      camX = approach(camX, target.x, 0.26, dt);
      camW = approach(camW, target.w, 0.26, dt);
      // stop within a quarter of a pixel: no frame after frame for movement no one can see
      const quarterPx = (0.25 * camW) / Math.max(1, width);
      if (Math.abs(camX - target.x) < quarterPx) camX = target.x;
      if (Math.abs(camW - target.w) < quarterPx) camW = target.w;
    }
    if (camX !== prevX || camW !== prevW) active = true;
    // sasshi: whole-book tilt (pivot on this frame's camera target; the camera then backs off by its lift), then the addons
    // (their anchors now carry this frame's case pose and tilt)
    if (stepTilt(bookT, dt)) active = true;
    placeCamera(camW);
    if (active) bookDirty = true;
    if (poseAddons(dt, now)) active = true;
    frameNo++;
    return active;
  }

  /**
   * Two neighbouring sheets in flight may not pass through each other: sheet j is always turned further than sheet j + 1 (inner-column
   * angles at least GAP apart, the gap closing to 0 as they near either side). When that is broken, the chasing sheet is pushed back
   * and loses the part of its angular speed that overshot
   */
  function keepOrder(list: Sheet[]) {
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k]!.body;
      const b = list[k + 1]!.body;
      if (list[k + 1]!.index !== list[k]!.index + 1 || (a.asleep && b.asleep)) continue;
      // sheets posed on the closing front board are handled by the board's part; those let go from it lie stacked anyway and need only
      // one pocket thickness between them
      if (riding(list[k]!) || riding(list[k + 1]!)) continue;
      const stacked = list[k]!.loose && list[k + 1]!.loose;
      const ta = clamp(a.a[0]!, 0, Math.PI);
      const tb = clamp(b.a[0]!, 0, Math.PI);
      const gap = Math.max(0, Math.min(stacked ? CARRY_GAP * Math.PI : GAP, Math.PI - ta, tb));
      const d = tb + gap - ta;
      if (d <= 0) continue;
      // push whichever one is chasing: the lower sheet catching up leftward (turning left), or the upper one pressing down rightward
      // (turning right); never the one in the hand
      let mover = Math.max(0, b.w[0]!) >= Math.max(0, -a.w[0]!) ? b : a;
      const other = mover === b ? a : b;
      if (mover.hand && !other.hand) mover = other;
      const sgn = mover === b ? -1 : 1;
      for (let i = 0; i < mover.n; i++) mover.a[i]! += sgn * d;
      const rel = b.w[0]! - a.w[0]!;
      if (rel > 0) for (let i = 0; i < mover.n; i++) mover.w[i]! += sgn * rel;
      mover.asleep = false;
    }
  }

  const shapeOut = new Float64Array(9);
  function updateUniforms(s: Sheet) {
    const [cx, cz] = ring;
    const R = dims.R;
    const k = pageKnotsInto(s.body, shapeOut);
    const phi = k[0]!;
    s.u.uHole.value.set(cx + R * Math.cos(phi), cz + R * Math.sin(phi));
    s.u.uPhi.value = phi;
    s.u.uIn.value.set(k[1]!, k[2]!, k[3]!, k[4]!);
    s.u.uOut.value.set(k[5]!, k[6]!, k[7]!, k[8]!);
    // sasshi (round 4, E6): a sheet lying on a stack is kept on or above it (the physics' planes) — not while the closing front
    // board carries it (that stack is not flat then)
    const env = envOf(s.index);
    s.u.uStack.value.set(env.zL, env.zR, env.axisX, carry > 0 && s.index < carry ? 0 : 1);
    // highlight motion blur: on a fast-turning sheet the reflected direction sweeps 2ω/60 rad in one frame (1/60 s) — that swept angle
    // is folded into the clearcoat's microfacet distribution (α = roughness²), so the reflection widens and its peak dims instead of
    // flashing white for a frame
    let wmax = carry > 0 && s.index < carry ? s.wKin : 0;
    for (const x of s.body.w) wmax = Math.max(wmax, Math.abs(x));
    const a0 = GLOSS_ROUGHNESS * GLOSS_ROUGHNESS;
    const sweep = (2 * wmax) / 60;
    s.mat.clearcoatRoughness = Math.min(0.6, Math.sqrt(Math.hypot(a0, sweep)));
    // only moving sheets and the top one of each stack cast shadows: plates stacked at rest shading each other only make artefacts
    const moving = !s.body.asleep || (s.p > 0 && s.p < 1);
    s.mesh.castShadow = moving || s.index === spread || s.index === spread - 1;
  }

  /* ── Pointer ── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  /** What the pointer is on: shut, the cover; open, which side and which card (only the two sides lying flat) */
  function pick(clientX: number, clientY: number): Pick {
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // sasshi: intersect in book coordinates (the whole book may be tilted)
    const bray = toBook(ray.ray);
    if (cover < 0.5) {
      plane.constant = -dims.S;
      if (!bray.intersectPlane(plane, hit)) return null;
      const [c0, c1] = binder.closedSpan;
      return hit.x >= c0 && hit.x <= c1 && Math.abs(hit.y) <= dims.H / 2 ? { kind: "cover" } : null;
    }
    for (const side of ["R", "L"] as const) {
      const left = side === "L";
      const sheet = left ? spread - 1 : spread;
      const has = sheet >= 0 && sheet < SHEETS;
      plane.constant = -(has ? restZ(sheet, left) + SLAB / 2 : 0);
      if (!bray.intersectPlane(plane, hit)) continue;
      if (Math.abs(hit.y) > dims.H / 2) continue;
      if (left ? hit.x > 0 : hit.x < 0) continue;
      if (Math.abs(hit.x) > HALF_W) continue;
      const v = hit.y / (PAGE_H * MM * 0.5);
      if (!has) return { kind: "page", side, card: -1, v, u: -1 };
      const root = restRoot(ring, sheet, left);
      const u = SEG.b1 + (left ? root - hit.x : hit.x - root);
      const faceSide = left ? 2 * sheet + 1 : 2 * sheet;
      let card = -1;
      if (u >= 0 && u <= PW) {
        const umm = u / MM;
        const X = left ? PAGE_W - umm : umm;
        const Y = PAGE_H / 2 - hit.y / MM;
        card = layout.itemIndex(faceSide, layout.slotAt(X, Y, left), COUNT);
      }
      return { kind: "page", side, card, v, u: u - SEG.b1 };
    }
    return null;
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    if (down || addonHold || coverTween) return;
    // sasshi: addons get the first look (only while the book is fully open); one that claims it gets the whole gesture
    if (e.button === 0 && addonsLive()) {
      const r = worldRay(e.clientX, e.clientY);
      for (const a of addons) {
        if (!a.pointer?.down(r, e)) continue;
        addonHold = { a, id: e.pointerId };
        canvasEl.setPointerCapture(e.pointerId);
        if (hover) {
          hover = null;
          invalidate();
        }
        wake();
        return;
      }
    }
    down ={ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, pick: pick(e.clientX, e.clientY), touch: e.pointerType !== "mouse", button: e.button, meta: e.metaKey || e.ctrlKey };
    hover = null;
    if (e.button === 0) canvasEl.setPointerCapture(e.pointerId);
  }

  function projectedPageWidth() {
    const a = projectBook(new THREE.Vector3(0, 0, 0));
    const b = projectBook(new THREE.Vector3(PW, 0, 0));
    return Math.max(80, (Math.abs(b.x - a.x) / 2) * width);
  }

  function startDrag(dx: number): boolean {
    if (!down) return false;
    const pagePx = projectedPageWidth();
    const p = down.pick;
    // cover: shut, a drag to the left opens it; open at the first spread, a drag on the left (the cover's inside) to the right closes it
    if (isClosed()) {
      if (dx < 0 && p?.kind === "cover") {
        drag = { sheet: null, mode: "cover", sign: 1, base: cover, targetP: cover, spanPx: pagePx * 1.3, samples: [], px: 0, py: 0, gy: 0, trail: [], cad: 1, off: [0, 0], last: null, lever: false };
        return true;
      }
      return false;
    }
    if (cover < 1) return false;
    const r = canvasEl.getBoundingClientRect();
    const side = p?.kind === "page" ? p.side : down.x - r.left > r.width / 2 ? "R" : "L";
    const atStart = narrow ? page === 0 : spread === 0;
    if (narrow) {
      const onLeft = page % 2 === 1;
      if (!onLeft && dx < 0 && page + 1 < PAGES) return beginTurn(spread, 1, pagePx * SPAN_NARROW, grabAt(p, "R"));
      if (onLeft && dx > 0) return beginTurn(spread - 1, -1, pagePx * SPAN_NARROW, grabAt(p, "L"));
      if ((!onLeft && dx > 0 && page > 0) || (onLeft && dx < 0 && page + 1 < PAGES)) {
        // sasshi (round 4, E2): the camera pans to the other page of the spread under the finger (one move, the page's framing
        // at its far end); the finger's travel maps onto the slide of the view's middle
        const sign = dx < 0 ? 1 : -1;
        const m = startMove(page + sign, null, 0, sign, true);
        drag = { sheet: null, mode: "pan", sign, base: 0, targetP: 0, spanPx: Math.max(40, m.shift * width), samples: [], px: 0, py: 0, gy: 0, trail: [], cad: 1, off: [0, 0], last: null, lever: false };
        return true;
      }
      if (atStart && dx > 0) return beginCoverClose(pagePx);
      return false;
    }
    if (side === "R" && dx < 0 && spread < SHEETS) return beginTurn(spread, 1, pagePx * SPAN_WIDE, grabAt(p, "R"));
    if (side === "L" && dx > 0 && spread > 0) return beginTurn(spread - 1, -1, pagePx * SPAN_WIDE, grabAt(p, "L"));
    if (side === "L" && dx > 0 && atStart) return beginCoverClose(pagePx);
    return false;
  }

  function beginCoverClose(pagePx: number) {
    // pages still in flight (say the one ← just sent back is still falling): no drag to close, or the front board would sweep in and
    // flatten it in one frame
    if (pagesBusy()) return false;
    drag = { sheet: null, mode: "cover", sign: -1, base: 1, targetP: 1, spanPx: pagePx * 1.3, samples: [], px: 0, py: 0, gy: 0, trail: [], cad: 1, off: [0, 0], last: null, lever: false };
    coverTarget = 0;
    emit();
    return true;
  }

  /**
   * How far from the root the pressed point is (where the hand holds): pressed on this side's pocket plate, that point; on the rings or
   * the punched strip, the plate root; anywhere else, as if held near the outer page edge
   */
  function grabAt(p: Pick, side: "L" | "R") {
    const full = GEOM.inner + GEOM.outer;
    const u = p?.kind === "page" && p.side === side ? (p.u >= 0 ? p.u : GRAB_ROOT) : full * 0.88;
    return clamp(u, GRAB_ROOT, full - 0.02);
  }

  /**
   * Pick up a sheet: the hand holds it at the point u from the root (held at the page edge: the outer column leads and the inner one
   * follows across the seam; held near the rings: the inner column leads and the outer one hangs)
   */
  function beginTurn(index: number, sign: 1 | -1, spanPx: number, u: number): boolean {
    const s = sheets.get(index);
    if (!s || !down || (s.body.finger && s.body.finger.start > simT)) return false;
    s.hovering = false;
    s.pinned = false;
    // close was pressed during a turn, then a page was dragged: the visitor wants to keep looking, so no close
    closeAsked = false;
    const p = down.pick;
    const gy = p?.kind === "page" ? clamp(p.v, -0.95, 0.95) * PAGE_H * MM * 0.5 : 0;
    const env = envOf(s.index);
    grabPage(s.body, u, 0);
    const [rx, rz, gx, gz] = grabPoint(s.body, env);
    const a = Math.atan2(gz - rz, gx - rx);
    pullPage(s.body, a);
    s.body.hand!.th = a;
    // the lever point: the point toward the grabbed point at max(DRAG_R, grab distance) from the root. However far it was from the
    // pointer on screen at press, it stays that far off — the drag goes on from the page as it is, and pressed off the page (taken as
    // holding the page edge) or near the rings, the page does not jump under the pointer at once
    const r0 = Math.hypot(gx - rx, gz - rz);
    const L = Math.max(DRAG_R, r0);
    const v = projectBook(new THREE.Vector3(rx + L * Math.cos(a), gy, rz + L * Math.sin(a)));
    const rect = canvasEl.getBoundingClientRect();
    const off: [number, number] = [rect.left + ((v.x + 1) / 2) * rect.width - down.x, rect.top + ((1 - v.y) / 2) * rect.height - down.y];
    drag = { sheet: s, mode: "turn", sign, base: s.index < spread ? 1 : 0, targetP: s.p, spanPx, samples: [], px: down.x, py: down.y, gy, trail: [{ f: frameNo, x: down.x, y: down.y }], cad: 1, off, last: null, lever: r0 < DRAG_R };
    // sasshi (round 4, E2): on a phone the camera goes with the sheet under the finger, toward the page it would turn to
    if (narrow && pageCam()) startMove(clamp(page + sign, 0, PAGES - 1), s, drag.base, sign, true);
    // sasshi: the visitor's hand on a page: pageTurn once it is lifted past TURN_SOUND.drag, pageLand where it comes down
    follow(s, sign);
    s.snd.turnAt = Number.NaN;
    return true;
  }

  /**
   * Drag: the direction the hand pulls the grabbed point to (the angle from the root to the grabbed point): the pointer ray is projected
   * onto the turning plane (xz) and intersected with the upper half of a circle round the root — so the grabbed point lies on the
   * pointer ray (under the top-down camera, almost exactly under the pointer). The circle's radius is the grabbed point's distance from
   * the root, but at least DRAG_R (held near the rings, a small pointer move does not swing the page round a long way; the pointer plus
   * the offset at press stands for the lever point). Where the ray misses the circle, the nearest point on its upper half is taken.
   * The root slides along the ring with the holes, and the centre moves with it: the target moves only the way the pointer goes
   * (compared with the last frame, on the same circle) — the centre's own motion never pulls the page back.
   * Held near the rings (the lever point is not the grabbed point itself), only the angle worked out from "how much further the pointer
   * went this frame than the last" pushes: that circle does not match the grabbed point, and using it directly would make the page jump
   * back
   */
  const dragNdc = new THREE.Vector2();
  function dragGoal(d: Drag): number {
    const s = d.sheet!;
    const hd = s.body.hand!;
    const [rx, rz, gx, gz] = grabPoint(s.body, envOf(s.index));
    const r = Math.max(DRAG_R, Math.hypot(gx - rx, gz - rz));
    const q: [number, number] = [d.px + d.off[0], d.py + d.off[1]];
    const now = unwrap(pointerAngle(q, rx, rz, r), hd.goal);
    const was = d.last ? unwrap(pointerAngle(d.last, rx, rz, r), hd.goal) : now;
    d.last = q;
    const step = now - was;
    // held on a pocket plate: the angle straight at the pointer (the grabbed point on the pointer ray), only never backing against the
    // way the pointer goes (the small step back the root's motion causes becomes a pause).
    // Lever (held near the rings): by increments only
    const g = d.lever ? hd.goal + step : step > 1e-7 ? Math.max(hd.goal, now) : step < -1e-7 ? Math.min(hd.goal, now) : hd.goal;
    return clamp(g, -0.06, Math.PI + 0.06);
  }
  const unwrap = (g: number, ref: number) => g + 2 * Math.PI * Math.round((ref - g) / (2 * Math.PI));
  /**
   * The pointer's (client px) ray projected onto the turning plane: the angle of its intersection with the upper half of the circle of
   * radius r round (rx, rz); where it misses, of the nearest point on the upper half
   */
  function pointerAngle(p: [number, number], rx: number, rz: number, r: number) {
    const rect = canvasEl.getBoundingClientRect();
    dragNdc.set(((p[0] - rect.left) / rect.width) * 2 - 1, -((p[1] - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(dragNdc, camera);
    // sasshi: the turning plane is in book coordinates
    const bray = toBook(ray.ray);
    const o = bray.origin;
    const dir = bray.direction;
    // the ray projected into the xz plane (relative to the centre): x = c + k·z
    const k = dir.x / Math.min(-1e-4, dir.z);
    const c = o.x + k * (rz - o.z) - rx;
    // the flat solution: where the pointer ray reaches the root's height, the grabbed point's x is matched to it (cos = c / r).
    // Near lying flat only this is used: a perspective ray is slanted, its intersection with the circle is already up at 2|k| rad while
    // lying flat (a page edge just lifting first moves outward on screen), and a few px of pointer would flip the page up 30 or 40°;
    // with the plane solution the page edge moves in exactly as far as the pointer does, monotonic, no jump
    const flat = Math.acos(clamp(c / r, -1, 1));
    const disc = r * r * (1 + k * k) - c * c;
    let circ: number;
    if (disc > 0) {
      // of the two intersections, the one with the larger z
      const uz = (-c * k + Math.sqrt(disc)) / (1 + k * k);
      circ = Math.atan2(uz, c + k * uz);
    } else {
      // a miss: the direction of the line's point nearest the centre, clamped to the upper half (z ≥ 0)
      const uz = (-c * k) / (1 + k * k);
      circ = Math.atan2(Math.max(0, uz), c + k * uz);
    }
    // between DRAG_FLAT[0] … [1] rad off lying flat (either side), blend smoothly to the circle's intersection (once the page stands
    // up, the grabbed point is on the pointer ray)
    const lift = Math.min(flat, Math.PI - flat);
    const m = smooth(clamp((lift - DRAG_FLAT[0]) / (DRAG_FLAT[1] - DRAG_FLAT[0]), 0, 1));
    return flat + (unwrap(circ, flat) - flat) * m;
  }

  /**
   * The pointer position the hand uses: where the pointer is at frame q (may be fractional) — linear between the two received events
   * around it, the last one when q is later than it
   */
  function pointerAt(d: Drag, q: number) {
    const tr = d.trail;
    let i = tr.length - 1;
    while (i > 0 && tr[i]!.f > q) i--;
    const a = tr[i]!;
    const b = tr[i + 1];
    const t = b && q > a.f ? Math.min(1, (q - a.f) / (b.f - a.f)) : 0;
    d.px = a.x + (b ? (b.x - a.x) * t : 0);
    d.py = a.y + (b ? (b.y - a.y) * t : 0);
  }

  function onMove(e: PointerEvent) {
    if (addonHold) {
      if (e.pointerId === addonHold.id) {
        addonHold.a.pointer!.move(worldRay(e.clientX, e.clientY), e);
        wake();
      }
      return;
    }
    if (!down || e.pointerId !== down.id) {
      if (e.pointerType === "mouse" && !down) hoverAt(e.clientX, e.clientY);
      return;
    }
    if (tiltDrag) return tiltMove(e);
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (!drag) {
      const slop = down.touch ? SLOP_TOUCH : SLOP_FINE;
      if (Math.hypot(dx, dy) < slop) return;
      // sasshi: a drag that starts on the desk tilts the book; so does one on the book that no page / cover drag takes
      if (tiltOn && down.button === 0 && (down.pick === null || !startDrag(dx))) {
        down.pick = null;
        if (!drag && tiltDown(e)) return tiltMove(e);
      }
      if (!drag && !startDrag(dx)) {
        down.pick = null;
        return;
      }
      // the press counts as a velocity sample too: a very quick fling of press, one move and release still measures a speed (else too
      // few samples give a speed of 0 and the whole fling is lost)
      drag!.samples.push({ t: down.t, x: down.x });
    }
    const d = drag!;
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    if (d.samples.length > 6) d.samples.shift();
    if (d.mode === "pan") {
      if (pmove?.finger && !pmove.sheet) pmove.fu = clamp((-dx * d.sign) / d.spanPx, 0, 1);
    } else if (d.mode === "cover") {
      // a drag to the left opens (openness up), to the right closes
      d.targetP = clamp(d.base - dx / d.spanPx, 0, 1);
    } else {
      // turn: the grabbed point follows the pointer (interpolated every frame in step and turned into the hand's direction). Stamped by
      // frame number: of several in one frame only the last is kept; when they come every few frames, the average frames per event is
      // kept (not counting a pause before moving again)
      const tr = d.trail;
      const last = tr[tr.length - 1];
      if (last && last.f === frameNo) {
        last.x = e.clientX;
        last.y = e.clientY;
      } else {
        const gap = last ? frameNo - last.f : 1;
        if (gap <= 4) d.cad += (Math.max(1, gap) - d.cad) * 0.35;
        tr.push({ f: frameNo, x: e.clientX, y: e.clientY });
        if (tr.length > 8) tr.shift();
      }
    }
    invalidate();
  }

  /** The speed over the last stretch of a drag (px / s, positive to the left) */
  function velocity(d: Drag) {
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    if (!a || !b || b.t - a.t < 8) return 0;
    return (-(b.x - a.x) / (b.t - a.t)) * 1000;
  }

  function onUp(e: PointerEvent) {
    if (addonHold) {
      if (e.pointerId !== addonHold.id) return;
      const h = addonHold;
      addonHold = null;
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
      h.a.pointer!.up(worldRay(e.clientX, e.clientY), e);
      wake();
      return;
    }
    if (!down || e.pointerId !== down.id) return;
    const dn = down;
    down = null;
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (tiltDrag) return tiltUp();
    const d = drag;
    drag = null;
    if (d) {
      // the moment of release counts as a sample too
      const last = d.samples[d.samples.length - 1];
      if (!last || e.timeStamp > last.t) d.samples.push({ t: e.timeStamp, x: e.clientX });
      if (d.samples.length > 7) d.samples.shift();
      const vPx = velocity(d);
      if (d.mode === "pan") {
        const m = pmove?.finger && !pmove.sheet ? pmove : null;
        const go = (m ? m.fu > 0.45 : false) || vPx * d.sign > 500;
        // committed: setPage hands the same move on (to the other page); else it goes back the way it came
        if (go) setPage(page + d.sign);
        else if (m) {
          m.finger = false;
          m.goal = 0;
        }
        invalidate();
        return;
      }
      // everything made positive "toward the target": progress, speed (progress / s)
      const pv = clamp((vPx * d.sign) / d.spanPx, -4, 4);
      if (d.mode === "cover") {
        const moved = (cover - d.base) * d.sign;
        const commit = pv > COMMIT_V || (moved > COMMIT_P && pv > -COMMIT_V * 0.6);
        const opening = d.sign === 1 ? commit : !commit;
        // a fling's speed has a limit too (openness / s): a quick fling does not slam the cover down in a blink
        const v0 = clamp(vPx / d.spanPx, -COVER_FLING, COVER_FLING);
        if (opening) {
          carry = 0;
          coverTo(1, Math.max(0, v0));
        } else {
          carry = spread;
          coverTo(0, Math.min(0, v0));
        }
        return;
      }
      // release: the page flies on with the speed the hand gave it; if it is not yet over the top toward the side it goes to, a finger
      // carries it over. It counts as turned only when lifted a fair way and the pointer is not pulling back (stopped or still going
      // on); let go while dragging back, it falls back by itself
      const s = d.sheet!;
      const moved = (s.p - d.base) * d.sign;
      const commit = pv > COMMIT_V || (moved > COMMIT_P && pv >= -0.05);
      if (commit) {
        // sasshi: a fling released before the drag reached the turn threshold still turns the page: it sounds now
        if (!d.turned) turnSound(s, 0.9);
        // the hand still holds that point and carries it on over the top (a finger takes over only when it holds nothing)
        s.hovering = false;
        s.pinned = false;
        carryPage(s.body, envOf(s.index), d.base === 0 ? 1 : 0, simT, P);
        if (narrow) {
          page = clamp(page + d.sign, 0, PAGES - 1);
          spread = spreadOfPage(page);
        } else spread = clamp(spread + d.sign, 0, SHEETS);
        syncWindow();
        emit();
      } else flipSheet(s, d.base === 0 ? 0 : 1, simT);
      // sasshi (round 4, E2): the phone's camera stays with the sheet, by itself now: on with it, or back with it
      if (pmove?.sheet === s) pmove.finger = false;
      invalidate();
      return;
    }
    // click: shut, open; a card → open the card; anything else → turn left / right
    if (e.type === "pointercancel") return;
    const p = dn.pick;
    if (isClosed()) {
      if (p?.kind === "cover" && dn.button === 0) openCover();
      return;
    }
    if (p?.kind === "page" && p.card >= 0 && !anyMoving()) {
      opts.onOpenCard(p.card, dn.meta || dn.button === 1);
      return;
    }
    if (dn.button !== 0) return;
    const r = canvasEl.getBoundingClientRect();
    const right = p?.kind === "page" ? p.side === "R" : dn.x - r.left > r.width / 2;
    if (right) next();
    else prev();
  }

  function anyMoving() {
    if (coverTween || cover < 1) return true;
    for (const s of sheets.values()) if ((!s.body.asleep && !s.hovering) || (s.p > 0.05 && s.p < 0.95)) return true;
    return false;
  }

  function hoverAt(x: number, y: number) {
    // sasshi: addons first (every addon updates its own hover state)
    if (addonsLive()) {
      const r = worldRay(x, y);
      let any = false;
      for (const a of addons) if (a.pointer?.hover?.(r)) any = true;
      if (any !== addonHover) {
        addonHover = any;
        wake();
      }
      if (any) {
        canvasEl.style.cursor = "grab";
        if (hover) {
          hover = null;
          invalidate();
        }
        return;
      }
    }
    if (narrow || coverTween) {
      canvasEl.style.cursor = tiltOn && !coverTween ? "grab" : "";
      return;
    }
    const p = pick(x, y);
    let next: typeof hover = null;
    if (p?.kind === "cover") next = { cover: true };
    else if (p?.kind === "page" && cover >= 1) {
      // near the outer page edge (the outer 18 % of the page) the page lifts
      const r = canvasEl.getBoundingClientRect();
      const ndcX = ((x - r.left) / r.width) * 2 - 1;
      // the outer 20 % of the pocket plate. sasshi (round 4): measured on the page under the pointer — the book box is off the
      // canvas's middle (the words column on the left), so the right page's line measured from the middle never let the left page lift
      const idx = p.side === "R" ? spread : spread - 1;
      if (SHEETS > 0 && idx >= 0 && idx < SHEETS) {
        const left = p.side === "L";
        const root = restRoot(ring, idx, left);
        const edge = projectBook(new THREE.Vector3(root + (left ? -1 : 1) * (PW - SEG.b1) * 0.8, 0, 0)).x;
        if (left ? ndcX < edge : ndcX > edge) next = { sheet: idx };
      }
    }
    canvasEl.style.cursor = p?.kind === "cover" || (p?.kind === "page" && p.card >= 0) ? "pointer" : p || tiltOn ? "grab" : "";
    const same = (next && hover && "sheet" in next && "sheet" in hover && next.sheet === hover.sheet) || (next && hover && "cover" in next && "cover" in hover) || (!next && !hover);
    if (!same) {
      hover = next;
      invalidate();
    }
  }
  function onLeave() {
    if (hover) {
      hover = null;
      invalidate();
    }
    // sasshi: a ray that hits nothing clears the addons' hover
    if (addonHover && !addonHold) {
      const away = new THREE.Ray(camera.position.clone(), new THREE.Vector3(0, 0, 1));
      for (const a of addons) a.pointer?.hover?.(away);
      addonHover = false;
      wake();
    }
    if (!down && !addonHold) canvasEl.style.cursor = "";
  }

  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove);
  canvasEl.addEventListener("pointerup", onUp);
  canvasEl.addEventListener("pointercancel", onUp);
  canvasEl.addEventListener("pointerleave", onLeave);
  canvasEl.addEventListener("lostpointercapture", (e) => {
    if ((down && e.pointerId === down.id) || (addonHold && e.pointerId === addonHold.id)) onUp(e);
  });

  /*
   * sasshi: a lost WebGL context (a GPU reset; the browser taking the oldest context to make room for a newer one …) is waited
   * out rather than given up at once. preventDefault asks the browser to give it back; until it does, no frames. When it comes back,
   * three's own handler (registered first, when the renderer was made) has already set up a fresh GL state, and three uploads
   * geometry, textures and programs again by itself on the next render — every texture here keeps its canvas or image. What lived
   * only on the GPU is made again here: the clear colour (three resets it), the environment map (a render target), the shadow map and
   * the frost targets (re-rendered with a full frame), the canvas size; then the addons' restore(). A context still lost after
   * RESTORE_WAIT ms of a visible page counts as lost for good: onLost, and the host shows its flat book.
   */
  let lostTimer = 0;
  const giveUp = () => {
    lostTimer = 0;
    if (disposed || !glLost) return;
    // a hidden page may get its context back only when it is shown again: wait on
    if (!visible) {
      lostTimer = window.setTimeout(giveUp, RESTORE_WAIT);
      return;
    }
    opts.onLost();
  };
  const lost = (e: Event) => {
    e.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    glLost = true;
    clearTimeout(lostTimer);
    lostTimer = window.setTimeout(giveUp, RESTORE_WAIT);
  };
  const restored = () => {
    if (disposed) return;
    clearTimeout(lostTimer);
    lostTimer = 0;
    glLost = false;
    readBg();
    // the old targets' GL objects went with the old context: dropped, not disposed (deleting them now only draws WebGL warnings). three's
    // fresh shadow-map module would dispose the key light's old map itself (its type is set again after the restore), so hand it none.
    envRT = studioEnv();
    scene.environment = envRT.texture;
    key.shadow.map = null;
    key.shadow.mapPass = null;
    sun.shadow.map = null;
    sun.shadow.mapPass = null;
    sunDirty = true;
    keyMap();
    lastT = 0;
    resize();
    for (const a of addons) a.restore?.();
    // one frame now and the next one from the loop: the frosted case's background pass reads the shadow map the frame before rendered
    bookDirty = true;
    render();
    invalidate();
  };
  canvasEl.addEventListener("webglcontextlost", lost);
  canvasEl.addEventListener("webglcontextrestored", restored);
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const onVis = () => {
    visible = document.visibilityState === "visible";
    if (visible) {
      invalidate();
      startSway();
    } else stopSway();
  };
  document.addEventListener("visibilitychange", onVis);

  /* ── Frosted case: the desk colour seen through it and its tint (when built, after a case swap) ── */
  function applyFrostLook() {
    if (frost) {
      untoneMap(bgLit.copy(bg).convertLinearToSRGB().multiplyScalar(FROST.lit).convertSRGBToLinear(), renderer.toneMappingExposure, bgBehind);
      deskGain = shadowGain(bgBehind, renderer.toneMappingExposure, groundMat.opacity);
      // light passing through takes on a little of the board's colour (squared in the shader: absorbed once going in, once coming out)
      frost.setLook(new THREE.Color(1, 1, 1).lerp(binder.caseMaterial.color, FROST.tint));
    }
    invalidate();
  }

  /** sasshi: paint the printed parts again (case print, pages): the faces they are set in arrived after they were painted */
  function repaintPrint() {
    if (disposed) return;
    binder.repaint();
    if (ready) prepaintSoon();
    for (const [side, st] of sides) {
      paintSide(st.canvas, side);
      st.tex.needsUpdate = true;
    }
    stale.clear();
    invalidate();
  }

  /* ── First screen: once the first spread's textures are in (waiting 2.5 s at most), open the cover ── */
  let readyTimer = 0;
  function firstSpreadCheck() {
    if (ready) return;
    // sasshi: a book without sheets has nothing to wait for
    const done = SHEETS === 0 || sides.get(0)?.loaded ? 1 : 0;
    opts.onProgress?.(done);
    if (done) becomeReady();
  }
  /** sasshi: how long (ms) the opening on arrival waits for the faces of the print it uncovers */
  const PRINT_WAIT = 2500;
  function becomeReady() {
    if (ready || disposed) return;
    ready = true;
    clearTimeout(readyTimer);
    renderer.compile(scene, camera);
    canvasEl.style.opacity = "1";
    invalidate();
    opts.onReady();
    prepaintSoon();
    startSway();
    setTimeout(() => {
      if (disposed || frozen || !autoOpen) return;
      // sasshi: the cover swings open onto the print (the liner, the slip, the addons' things): it waits for their faces, at most
      // PRINT_WAIT ms, and the case is painted in them before it opens. Slower faces still repaint the print when they come.
      const runs = caseFontRuns(curCover.title, curCase);
      const late = !fontsLoadedFor(runs);
      const waits = [late ? ensureFonts(runs) : null, ...addons.map((a) => a.printed?.())].filter((p) => !!p);
      const go = () => {
        if (disposed || frozen || !autoOpen) return;
        if (late) binder.repaint();
        if (reducedMotion) openNow();
        else openCover();
      };
      if (!waits.length) return go();
      void Promise.race([Promise.all(waits).catch(() => {}), new Promise((r) => setTimeout(r, PRINT_WAIT))]).then(go);
    }, 420);
  }
  readyTimer = window.setTimeout(becomeReady, 2500);
  /** The cover's display-pocket picture and the liner's portrait, for the case that is up now (a swap asks again; both are cached) */
  function loadCaseImages() {
    const b = binder;
    const win = curCover.window?.src;
    if (win)
      void loadImage(win).then((img) => {
        if (disposed || !img || binder !== b) return;
        b.setWindowImage(img);
        invalidate();
      });
    // sasshi: the liner's portrait picture
    const portrait = curCase.liner?.portrait?.src;
    if (portrait)
      void loadImage(portrait).then((img) => {
        if (disposed || !img || binder !== b) return;
        b.setLinerPortrait(img);
        invalidate();
      });
  }
  loadCaseImages();
  for (const a of addons) adopt(a);

  /*
   * ── sasshi: a live case swap (Book.setCover) ──
   * Only the case is rebuilt: a new binder (boards, creases, liner, stamp, window, metal) replaces the old one in bookGroup, the addons'
   * objects move to the new anchors as they are (no re-adopt, no re-attach: the pouch keeps its bodies and its state), the frosted pass
   * comes or goes with the material, and the desk follows the case's thickness. Pages, camera, physics and the cover's openness stay.
   * The frame before the swap is copied into a 2D canvas over the WebGL one and faded out over the new frame (one context throughout).
   */
  const SWAP_FADE = matchMedia("(prefers-reduced-motion: reduce)").matches ? 140 : 380;
  let swapVeil: HTMLCanvasElement | null = null;
  function veil(): HTMLCanvasElement | null {
    if (!ready || !visible || glLost || width < 2 || height < 2) return null;
    // the frame as it is now: render it and copy it out in the same task (the drawing buffer is still intact)
    render();
    const v = swapVeil ?? document.createElement("canvas");
    v.width = canvasEl.width;
    v.height = canvasEl.height;
    const ctx = v.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvasEl, 0, 0);
    if (!swapVeil) {
      Object.assign(v.style, { position: "absolute", left: `${canvasEl.offsetLeft}px`, top: `${canvasEl.offsetTop}px`, width: `${canvasEl.clientWidth}px`, height: `${canvasEl.clientHeight}px`, pointerEvents: "none", opacity: "1" });
      v.setAttribute("aria-hidden", "true");
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      canvasEl.after(v);
      swapVeil = v;
    }
    v.style.transition = "none";
    v.style.opacity = "1";
    return v;
  }
  let veilTimer = 0;
  function liftVeil(v: HTMLCanvasElement) {
    clearTimeout(veilTimer);
    // two frames: the new case is on screen under the veil before it starts to fade
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (swapVeil !== v) return;
        v.style.transition = `opacity ${SWAP_FADE}ms cubic-bezier(0.2, 0.6, 0.2, 1)`;
        v.style.opacity = "0";
        veilTimer = window.setTimeout(() => {
          if (swapVeil !== v) return;
          v.remove();
          swapVeil = null;
        }, SWAP_FADE + 60);
      }),
    );
  }
  /**
   * The other materials' print and maps, painted ahead in idle time (one per idle slot, after the first frame and after every swap or
   * late font repaint), so the first swap to one of them only builds and uploads.
   */
  let prepaintTimer = 0;
  let frostCompiled = false;
  const idle = (fn: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 2000 }) : window.setTimeout(fn, 400));
  const cancelIdle = (id: number) => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(id) : clearTimeout(id));
  function prepaintSoon() {
    cancelIdle(prepaintTimer);
    const todo = COVER_MATERIALS.filter((m) => m !== curCover.material).map((m) => ({ ...curCover, material: m }));
    // sasshi (round 4, E1): a step of one (binder.ts prepaintSteps) an idle slot
    let steps: Generator<void, void> | null = null;
    const next = () => {
      if (disposed) return;
      // a frosted case: its background pass's program variants, before the cover first moves
      if (frost && !frostCompiled) {
        frostCompiled = true;
        void frost.compile(renderer, scene, camera).catch(() => {});
        prepaintTimer = idle(next);
        return;
      }
      if (!steps) {
        const c = todo.shift();
        if (!c) return;
        steps = prepaintSteps(binderOpts(c));
      }
      try {
        if (steps.next().done) steps = null;
      } catch {
        /* painting ahead is only an optimisation */
        steps = null;
      }
      prepaintTimer = idle(next);
    };
    prepaintTimer = idle(next);
  }
  const sameCover = (a: CoverSpec, b: CoverSpec) =>
    a.material === b.material && a.color === b.color && a.foil === b.foil && a.title === b.title && (a.window?.src ?? "") === (b.window?.src ?? "") && (a.window?.color ?? "") === (b.window?.color ?? "");
  /** sasshi (round 4, E1): the same case print (the liner, the slip; the shape is always the build's, caseOf) */
  const sameCase = (a: CaseSpec, b: CaseSpec) => a === b || JSON.stringify(a) === JSON.stringify(b);
  /*
   * sasshi (round 4, E1): a swap — another cover (setCover), another case print (setCover with a case: the liner, the 題簽
   * slip), another content (setContent: the same album in another language), or any of them at once (asked for in the same task, they
   * make one swap) — is made ahead in small steps, run in slices of SLICE ms (a task each), so that no frame waits on it: the faces the
   * new print is set in (at most FACE_WAIT), the content's pages in view printed into canvases of their own (a pocket a step), the new
   * case's print painted (binder.ts prepaintSteps: kept by its inputs, so the build only builds), the case built and its programs
   * compiled (compileAsync: off the main thread where the GPU offers parallel compiling) and its textures uploaded; then commitSwap puts
   * it all up at once under the veil (the content's other sides follow in idle time, see freshen). Until then the old case and print
   * stay on screen. A newer request replaces the one under way; one for what is up already cancels it.
   */
  /** How long (ms) a swap waits for the faces its print is set in before it goes up with what has loaded (as createBook waits) */
  const FACE_WAIT = 600;
  type Want = { cover: CoverSpec; kase: CaseSpec; content: ContentSource };
  type Built = { cover: CoverSpec; kase: CaseSpec; binder: Binder; frost: FrostPass | null };
  let want: Want | null = null;
  let pending: Built | null = null;
  let swapSeq = 0;
  function dropPending() {
    if (!pending) return;
    pending.binder.dispose();
    if (pending.frost && pending.frost !== frost) pending.frost.dispose();
    pending = null;
  }
  function request(next: Partial<Want>) {
    if (disposed) return;
    const w: Want = { cover: curCover, kase: curCase, content, ...(want ?? {}), ...next };
    if (want && sameCover(w.cover, want.cover) && sameCase(w.kase, want.kase) && w.content === want.content) return;
    dropPending();
    const seq = ++swapSeq;
    const caseUp = !sameCover(w.cover, curCover) || !sameCase(w.kase, curCase);
    if (!caseUp && w.content === content) {
      want = null;
      return;
    }
    want = w;
    // the debug clock (debug.advance), a hidden page, a lost context and a book not shown yet render nothing: swap at once (faces
    // that have not loaded paint the print again when they arrive)
    if (manual !== null || !visible || !ready || glLost) {
      const runs = caseUp ? caseFontRuns(w.cover.title, w.kase) : [];
      if (!fontsLoadedFor(runs)) void ensureFonts(runs).then(repaintPrint);
      const swapContent = w.content !== content;
      commitSwap(w, caseUp ? buildCase(w) : null);
      if (swapContent) lateFaces(w.content);
      return;
    }
    void prepareSwap(w, seq, caseUp);
  }
  const task = () => new Promise<void>((go) => setTimeout(go, 0));
  /** A swap's work runs in slices of about this long (ms), a task each: a frame is never kept waiting for more than one */
  const SLICE = 4;
  async function prepareSwap(w: Want, seq: number, caseUp: boolean) {
    const live = () => !disposed && seq === swapSeq;
    let sliceAt = performance.now();
    /** The next step's turn: in this slice while it lasts, else in the next task */
    const pace = async () => {
      if (performance.now() - sliceAt < SLICE) return;
      await task();
      sliceAt = performance.now();
    };
    const runs = caseUp ? caseFontRuns(w.cover.title, w.kase) : [];
    const swapContent = w.content !== content;
    let faces = false;
    const all = Promise.all([
      fontsLoadedFor(runs) ? null : ensureFonts(runs),
      swapContent ? w.content.ready : null,
      // the pictures of the pages in view (the old content's own: in the cache)
      swapContent ? Promise.all([...sides.keys()].filter(inView).flatMap((k) => sideSources(k, w.content).map(loadImage))) : null,
    ]).then(() => {
      faces = true;
    });
    await Promise.race([all, new Promise((go) => setTimeout(go, FACE_WAIT))]);
    if (!live()) return;
    // faces that come later than that: the print is painted again when they are in (if it is still this swap's)
    if (!faces) void all.then(() => !disposed && content === w.content && sameCase(curCase, w.kase) && sameCover(curCover, w.cover) && repaintPrint());
    // the pages in view printed from the new content ahead, into canvases of their own, a step (a pocket) at a time in slices of
    // SLICE ms: commitSwap only puts them up
    const fresh = new Map<number, HTMLCanvasElement>();
    if (swapContent)
      for (const k of [...sides.keys()].filter(inView)) {
        const c = sideCanvas(texWidth, layout);
        for (const step of sideSteps(c, k, w.content)) {
          await pace();
          if (!live()) return;
          step();
        }
        fresh.set(k, c);
      }
    let built: Built | null = null;
    if (caseUp) {
      try {
        for (const _ of prepaintSteps(binderOpts(w.cover, w.kase))) {
          await pace();
          if (!live()) return;
        }
      } catch {
        /* painting ahead is only an optimisation */
      }
      await task();
      if (!live()) return;
      built = buildCase(w);
      await Promise.all([renderer.compileAsync(built.binder.group, camera, scene), built.frost ? built.frost.compile(renderer, scene, camera, built.binder.group) : null]).catch(() => {});
      await task();
      if (!live()) return;
      uploadCase(built.binder);
      await task();
      if (!live()) return;
    }
    commitSwap(w, built, fresh);
  }
  /** The new case for a swap (the pending one) */
  function buildCase(w: Want): Built {
    const b = makeBinder(w.cover, w.kase);
    // the frosted pass follows the material (render targets only; the context stays)
    let f: FrostPass | null = null;
    if (b.frost) {
      f = frost ?? createFrost(renderer, small ? 0.25 : 0.5, SHEETS * PITCH);
      if (f !== frost) {
        // the targets at the full ratio's size (three's drawing buffer: floor(css px × ratio)); the screen mapping as drawn now
        f.setSize(Math.floor(width * fullRatio), Math.floor(height * fullRatio));
        renderer.getDrawingBufferSize(bufSize);
        f.setScreen(bufSize.x, bufSize.y);
      }
      f.patch(b.caseMaterial);
    }
    frostShadow.patch(b.caseMaterial);
    pending = { cover: w.cover, kase: w.kase, binder: b, frost: f };
    return pending;
  }
  /** The new case's textures onto the GPU ahead of its first frame (which then only draws) */
  function uploadCase(b: Binder) {
    if (glLost) return;
    const seen = new Set<THREE.Texture>();
    b.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mt of Array.isArray(m) ? m : [m])
        for (const v of Object.values(mt))
          if (v instanceof THREE.Texture && !seen.has(v)) {
            seen.add(v);
            renderer.initTexture(v);
          }
    });
  }
  function commitSwap(w: Want, built: Built | null, fresh?: Map<number, HTMLCanvasElement>) {
    want = null;
    pending = null;
    const v = veil();
    if (built) putCase(built);
    if (w.content !== content) {
      content = w.content;
      for (const [k, st] of sides) {
        const c = fresh?.get(k);
        if (c) putSide(st, c);
        else stale.add(k);
      }
      freshen();
      staleSoon();
    }
    bookDirty = true;
    if (v) {
      render();
      liftVeil(v);
    } else invalidate();
    if (built) prepaintSoon();
  }
  function putCase(p: Built) {
    curCover = p.cover;
    curCase = p.kase;
    const old = binder;
    binder = p.binder;
    dims = binder.dims;
    bookGroup.remove(old.group);
    bookGroup.add(binder.group);
    // the addons keep their objects and state: re-hang them on the new boards
    for (const a of addons) anchorOf(a).add(a.object);
    old.dispose();
    if (frost && frost !== p.frost) frost.dispose();
    frost = p.frost;
    // the desk follows the case's thickness; the contact shadow's shape follows the material
    layoutDesk();
    drawContact(contactTex.image as HTMLCanvasElement, binder.frost);
    contactTex.needsUpdate = true;
    // ring and stack heights follow the case (frost sinks the spine): forget the cached page environments
    envs.clear();
    liftKey = "";
    ring = binder.pose(cover).ring;
    loadCaseImages();
    // a case of another size (another material's board thickness) is framed anew; the same size (another print: a language) keeps
    // the camera where it is — a phone's page camera goes on with its move
    if (JSON.stringify(old.dims) !== JSON.stringify(dims)) {
      relayout();
      snapFrame();
    }
    placeCamera(camW);
    applyFrostLook();
  }

  /*
   * sasshi (round 4, E1): the sides of a swapped content. All of them are printed again: the ones in view (the spread's two
   * pages, both faces of every sheet off its stack: turning, lifted, carried by the closing board) ahead by the swap and put up with it;
   * the rest — under the stacks, stale — in idle time, the nearest the spread first, a step (a pocket) an idle slot into a canvas of
   * its own, put up and uploaded when done (renderer.initTexture: no frame for it). A frame about to show a side that is still stale
   * (a turn started meanwhile) paints it at once first (render → freshen).
   */
  function inView(k: number) {
    if (k === 2 * spread || k === 2 * spread - 1) return true;
    const s = sheets.get(k >> 1);
    return !!s && (!s.body.asleep || (s.p > 0 && s.p < 1) || riding(s));
  }
  function freshen() {
    for (const k of stale) if (inView(k)) paintStale(k);
  }
  function paintStale(k: number) {
    stale.delete(k);
    const st = sides.get(k);
    if (!st) return;
    paintSide(st.canvas, k);
    st.tex.needsUpdate = true;
    reloadMissing(k, st);
  }
  /** A picture the cache has let go of: the side is painted once more when it is back (as ensureSide does) */
  function reloadMissing(k: number, st: SideTex) {
    const srcs = sideSources(k);
    if (srcs.every((src) => loaded.has(src))) return;
    const gen = st.gen;
    void Promise.all(srcs.map(loadImage)).then(() => {
      if (disposed || sides.get(k) !== st || st.gen !== gen) return;
      paintSide(st.canvas, k);
      st.tex.needsUpdate = true;
      invalidate();
    });
  }
  /** A side printed anew (a canvas of its own): on its texture, uploaded with the next frame (or initTexture) */
  function putSide(st: SideTex, c: HTMLCanvasElement) {
    st.canvas = c;
    st.tex.image = c;
    st.tex.needsUpdate = true;
  }
  /** The stale side being printed in idle time: into a canvas of its own, a step (a pocket) an idle slot, put up when done */
  let job: { k: number; st: SideTex; c: ContentSource; canvas: HTMLCanvasElement; steps: (() => void)[]; i: number } | null = null;
  let staleTimer = 0;
  function staleSoon() {
    if (staleTimer || disposed || (!stale.size && !job)) return;
    staleTimer = idle(() => {
      staleTimer = 0;
      if (disposed) return;
      // gone, painted meanwhile (a frame showed it), or another content since: dropped
      if (job && (sides.get(job.k) !== job.st || !stale.has(job.k) || job.c !== content)) job = null;
      if (!job) {
        let best = -1;
        let far = Infinity;
        for (const k of stale) {
          const d = Math.min(Math.abs((k >> 1) - spread), Math.abs((k >> 1) - (spread - 1)));
          if (d < far && sides.has(k)) {
            far = d;
            best = k;
          }
        }
        if (best < 0) return stale.clear();
        const canvas = sideCanvas(texWidth, layout);
        job = { k: best, st: sides.get(best)!, c: content, canvas, steps: sideSteps(canvas, best), i: 0 };
      }
      const j = job;
      if (j.i < j.steps.length) j.steps[j.i++]!();
      else {
        job = null;
        stale.delete(j.k);
        putSide(j.st, j.canvas);
        if (!glLost) renderer.initTexture(j.st.tex);
        reloadMissing(j.k, j.st);
      }
      staleSoon();
    });
  }

  applyFrostLook();
  syncWindow();
  {
    const t = frame();
    camX = t.x;
    camW = t.w;
  }
  resize();
  emit();
  firstSpreadCheck();

  /**
   * sasshi (round 4, minor): three's DFG lookup texture for the physical materials is one module-level DataTexture shared by
   * every renderer, and each renderer that uploads it hangs a `dispose` listener on it — which keeps that renderer (its programs, its
   * last render list: the whole scene) alive after it is disposed: ≈ 0.5 MB of heap for every book built and thrown away (a booklet
   * switch). Disposing the texture runs and removes every such listener; a renderer still in use uploads it again on its next frame.
   */
  /**
   * sasshi (round 4, minor): the same for what an addon shares between its instances (the pouch's one receive-only depth material,
   * its kept geometries and textures): the listeners this renderer hung on them would keep it and its scene alive for as long as they
   * live. Disposed here, with the addon that used them in this book: three lets go of them in every renderer, and the next one to draw
   * them (the next book's addon) uploads them again.
   */
  function releaseShared(root: THREE.Object3D) {
    const done = new Set<object>();
    const free = (x: { dispose(): void } | null | undefined) => {
      if (!x || done.has(x)) return;
      done.add(x);
      x.dispose();
    };
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Line).isLine && !(o as THREE.Points).isPoints) return;
      free(m.geometry);
      const mats = [...(Array.isArray(m.material) ? m.material : [m.material]), m.customDepthMaterial, m.customDistanceMaterial];
      for (const mt of mats) {
        if (!mt || !renderer.properties.has(mt)) continue;
        for (const v of Object.values(mt)) if (v instanceof THREE.Texture && renderer.properties.has(v)) free(v);
        free(mt);
      }
    });
  }
  function releaseLut() {
    type Props = { uniforms?: { dfgLUT?: { value: THREE.Texture | null } } };
    for (const m of [contactMat, binder.caseMaterial, ...[...sheets.values()].map((x) => x.mat)]) {
      const lut = (renderer.properties.get(m) as Props).uniforms?.dfgLUT?.value;
      if (lut) return lut.dispose();
    }
  }

  return {
    next,
    prev,
    toggleCover() {
      if (isClosed()) openCover();
      else askClose();
    },
    setCover(next, kase) {
      request(kase ? { cover: next, kase: caseOf(kase) } : { cover: next });
    },
    setContent(next) {
      if (disposed) return false;
      if (next === (want?.content ?? content)) return true;
      if (!sameGrid(content, next)) return false;
      request({ content: next });
      return true;
    },
    shake(strength = 1) {
      if (!tiltOn || disposed) return;
      jiggles.push({ t0: bookT, amp: clamp(strength, 0, 3), dir: jiggleDir });
      // the next one goes the other way, a little off the last line
      jiggleDir = jiggleDir + Math.PI + 0.7;
      invalidate();
    },
    setTilt(x, y) {
      if (!tiltOn || disposed) return;
      const tx = clamp(Number.isFinite(x) ? x : 0, -TILT_FEEL.max, TILT_FEEL.max);
      const ty = clamp(Number.isFinite(y) ? y : 0, -TILT_FEEL.max, TILT_FEEL.max);
      if (Math.abs(tx - devTilt.tx) < 1e-4 && Math.abs(ty - devTilt.ty) < 1e-4) return;
      devTilt.tx = tx;
      devTilt.ty = ty;
      invalidate();
    },
    setNarrow(n) {
      if (n === narrow) return;
      narrow = n;
      if (narrow) page = clamp(spread < SHEETS ? 2 * spread : 2 * spread - 1, 0, PAGES - 1);
      relayout();
      snapFrame();
      placeCamera(camW);
      emit();
      invalidate();
    },
    setAmbient(on) {
      ambient = on;
      if (on) startSway();
      else stopSway();
    },
    setLightFade(fade) {
      lightFade = fade;
      applyFade();
      invalidate();
    },
    setInsets(i) {
      insets = i;
      relayout();
      snapFrame();
      placeCamera(camW);
      invalidate();
    },
    dispose() {
      disposed = true;
      clearTimeout(readyTimer);
      stopSway();
      windowLight.dispose();
      receiveOnly.dispose();
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(lostTimer);
      canvasEl.removeEventListener("webglcontextlost", lost);
      canvasEl.removeEventListener("webglcontextrestored", restored);
      // (before any material is disposed: their uniforms lead to it)
      releaseLut();
      // sasshi: addons first, detached, so the traversal below never touches what they own
      for (const a of addons) {
        a.object.removeFromParent();
        releaseShared(a.object);
        a.dispose();
      }
      for (const s of [...sheets.values()]) dropSheet(s);
      for (const st of sides.values()) st.tex.dispose();
      sides.clear();
      images.clear();
      loaded.clear();
      binder.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) mt.dispose();
      });
      for (const t of [blank.front, blank.back, normalTex, contactTex]) t.dispose();
      sheetGeo.dispose();
      envRT.dispose();
      frost?.dispose();
      dropPending();
      cancelIdle(staleTimer);
      cancelIdle(prepaintTimer);
      clearTimeout(veilTimer);
      swapVeil?.remove();
      renderer.dispose();
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      canvasEl.remove();
    },
    debug: {
      setProgress(p, dir = 1, bend) {
        frozen = true;
        autoOpen = false;
        for (const x of sheets.values()) quiet(x);
        cover = coverTarget = 1;
        coverTween = null;
        const idx = dir === 1 ? spread : spread - 1;
        const s = sheets.get(idx);
        if (s) {
          s.p = dir === 1 ? clamp(p, 0, 1) : clamp(1 - p, 0, 1);
          s.pinned = true;
          s.hovering = false;
          const strip = bend?.strip ?? 0;
          posePage(s.body, Math.PI * s.p + strip, envOf(idx), bend?.seam ?? 0, strip);
        }
        snapFrame();
        placeCamera(camW);
        // sasshi: a posed frame is a change of the book itself (shadow map, frost background)
        bookDirty = true;
        render();
      },
      setCover(t) {
        frozen = true;
        autoOpen = false;
        for (const x of sheets.values()) quiet(x);
        coverTween = null;
        cover = clamp(t, 0, 1);
        coverTarget = cover < 0.5 ? 0 : 1;
        snapFrame();
        placeCamera(camW);
        // sasshi: the addons see the frozen pose too (and are told the openness)
        poseAddons(1 / 60, clockNow());
        bookDirty = true;
        render();
      },
      release() {
        frozen = false;
        manual = null;
        for (const s of sheets.values()) s.pinned = false;
        invalidate();
      },
      advance(dt) {
        if (manual === null) {
          manual = performance.now() / 1000;
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
        }
        frozen = false;
        manual += dt;
        step(manual, dt);
        render();
      },
      state() {
        const r = (x: number) => +x.toFixed(4);
        let grab: [number, number] | null = null;
        if (drag?.sheet) {
          const [, , gx, gz] = grabPoint(drag.sheet.body, envOf(drag.sheet.index));
          const v = projectBook(new THREE.Vector3(gx, drag.gy, gz));
          const rect = canvasEl.getBoundingClientRect();
          grab = [+(rect.left + ((v.x + 1) / 2) * rect.width).toFixed(1), +(rect.top + ((1 - v.y) / 2) * rect.height).toFixed(1)];
        }
        return {
          spread,
          page,
          cover: r(cover),
          grab,
          ptr: drag?.sheet ? [+drag.px.toFixed(1), +drag.py.toFixed(1)] : null,
          goal: drag?.sheet?.body.hand ? r(drag.sheet.body.hand.goal) : null,
          closeAsked,
          sheets: [...sheets.values()].map((x) => ({
            i: x.index,
            p: r(x.p),
            awake: !x.body.asleep,
            finger: !!x.body.finger,
            hand: !!x.body.hand,
            carry: !!x.body.hand?.carry,
            angles: [...x.body.a].map(r),
            seam: r(seamFold(x.body)),
            peak: r(x.body.peak),
          })),
        };
      },
      info() {
        const m = renderer.info.memory;
        return { textures: m.textures, geometries: m.geometries, sides: sides.size, sheets: sheets.size, calls: renderer.info.render.calls };
      },
      physics: P,
      repaintPrint,
      tilt() {
        return { x: tilt.x, y: tilt.y, lift: tilt.lift, frames: renderCount, dragging: !!tiltDrag, cam: [camera.position.x, camera.position.length()] as [number, number] };
      },
      screenBox() {
        const rect = canvasEl.getBoundingClientRect();
        const empty = (): ScreenRect => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        const all = empty();
        const [front, spine, back] = binder.boards(cover).map((b) => {
          const r = empty();
          for (const sx of [-1, 1])
            for (const sy of [-1, 1])
              for (const sz of [-1, 1]) {
                boardCorner(b, sx, sy, sz).applyMatrix4(bookGroup.matrix).project(camera);
                const x = rect.left + ((corner.x + 1) / 2) * rect.width;
                const y = rect.top + ((1 - corner.y) / 2) * rect.height;
                for (const o of [r, all]) {
                  o.left = Math.min(o.left, x);
                  o.right = Math.max(o.right, x);
                  o.top = Math.min(o.top, y);
                  o.bottom = Math.max(o.bottom, y);
                }
              }
          return r;
        });
        const round = (o: ScreenRect): ScreenRect => ({ left: +o.left.toFixed(1), top: +o.top.toFixed(1), right: +o.right.toFixed(1), bottom: +o.bottom.toFixed(1) });
        return { all: round(all), front: round(front!), spine: round(spine!), back: round(back!), canvas: round(rect) };
      },
    },
  };
}

/* ── Helpers ──────────────────────────────────────────────────────── */
function range(a: number, b: number) {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/**
 * Environment light (used only for reflections and ambient diffuse): a grey studio — a little brighter above, dark below, a large
 * softbox high up at the back left (the key is on the other side, at the top right), a narrow rim light on the right. A page lying
 * flat reflects just the dark grey of the zenith, so card colours stay clean; as soon as a page lifts, the softbox's highlight slides
 * across it
 */
function studioScene() {
  const env = new THREE.Scene();
  const dome = new THREE.SphereGeometry(10, 48, 24);
  const pos = dome.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / 10;
    const v = z > 0 ? 0.16 + 0.1 * z : 0.16 * (1 + z) + 0.03;
    // a grey room with a hint of daylight blue
    col[i * 3] = v;
    col[i * 3 + 1] = v * 1.01;
    col[i * 3 + 2] = v * 1.04;
  }
  dome.setAttribute("color", new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w: number, h: number, dir: [number, number, number], power: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power * 0.98), side: THREE.DoubleSide }));
    m.position.set(...dir).normalize().multiplyScalar(8);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(5.2, 3.6, [-0.5, 0.45, 0.74], 7);
  panel(1.2, 6, [0.85, -0.15, 0.5], 2.2);
  panel(7, 1.2, [0.1, -0.9, 0.42], 0.9);
  return env;
}

/** three's Neutral tone mapping (as in the shader), linear → linear */
function neutral(c: [number, number, number], exposure: number): [number, number, number] {
  let [r, g, b] = c.map((v) => v * exposure) as [number, number, number];
  const x = Math.min(r, g, b);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off;
  g -= off;
  b -= off;
  const peak = Math.max(r, g, b);
  if (peak < 0.76) return [r, g, b];
  const d = 0.24;
  const np = 1 - (d * d) / (peak + d - 0.76);
  const k = np / peak;
  const gg = 1 - 1 / (0.15 * (peak - np) + 1);
  return [r * k * (1 - gg) + np * gg, g * k * (1 - gg) + np * gg, b * k * (1 - gg) + np * gg];
}

/** Find a base colour that comes out exactly as target after exposure and tone mapping (uniform scale, bisection) */
function untoneMap(target: THREE.Color, exposure: number, out: THREE.Color) {
  const t = Math.max(target.r, target.g, target.b);
  let lo = 0.2;
  let hi = 4;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const m = neutral([target.r * mid, target.g * mid, target.b * mid], exposure);
    if (Math.max(...m) < t) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  return out.setRGB(target.r * s, target.g * s, target.b * s);
}

/**
 * Black at opacity a over the linear base colour bg: on the canvas it is laid over in sRGB (darkening by a); how much must be laid
 * over the linear background before tone mapping to darken it as much. Returns the factor (≥ 1)
 */
function shadowGain(bg: THREE.Color, exposure: number, a: number) {
  const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  const shown = (k: number) => srgb(Math.max(...neutral([bg.r * k, bg.g * k, bg.b * k], exposure)));
  const want = shown(1) * (1 - a);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (shown(1 - mid) > want) lo = mid;
    else hi = mid;
  }
  return Math.min(6, Math.max(1, (lo + hi) / 2 / Math.max(1e-3, a)));
}

/** Any CSS colour (oklch etc.) → sRGB rgb(): parsed by canvas 2D. sasshi: remembered (a GPU canvas readback costs ~15 ms) */
const cssColors = new Map<string, string>();
function cssColor(v: string, fallback: string) {
  const key = `${v}|${fallback}`;
  const hit = cssColors.get(key);
  if (hit) return hit;
  const out = parseCssColor(v, fallback);
  if (cssColors.size > 32) cssColors.clear();
  cssColors.set(key, out);
  return out;
}
function parseCssColor(v: string, fallback: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = fallback;
  ctx.fillStyle = v.trim();
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The contact shadow under the book: a rounded rectangle, blurred all round.
 * The frosted case can be seen through, and the desk under a board shows: the board floats a mm or two above the desk, so the
 * occlusion under it is even and fades only within a few mm of the board's edge — a core that covers the whole board with only a few
 * mm of blur at its edges, plus a very faint wide halo around it (the ring where the book meets the desk); otherwise what shows through
 * the board is a "pillow", dark in the middle and light all round
 */
function contactShadow(tight: boolean) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#fff";
  if (tight) {
    ctx.filter = "blur(12px)";
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.roundRect(22, 18, 212, 220, 14);
    ctx.fill();
    ctx.filter = "blur(2.5px)";
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(19, 16, 218, 224, 6);
    ctx.fill();
  } else {
    ctx.filter = "blur(14px)";
    ctx.beginPath();
    ctx.roundRect(30, 26, 196, 204, 12);
    ctx.fill();
  }
  ctx.filter = "none";
  return c;
}
