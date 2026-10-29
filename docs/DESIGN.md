# sasshi — design notes (v2, working doc)

An open-source **shelf of physical booklets** for personal pages, derived from CardArt's 3D ring-binder album.
The visitor picks a booklet from tabs; every booklet is a real object on a desk — it opens, its pages turn with physics, and what is inside can be picked up.

| Tab | Object | Inside |
|---|---|---|
| 卡册 Cards | ring binder, clear PVC sleeves 2×3 | card-size pieces (85.6×54 mm) |
| 明信片册 Postcards | ring binder, clear sleeves 2×2 | A6 postcards (148×105 mm): **picture through the front film, the handwritten message side through the back film** — turning the page shows the reverse of the same postcards |
| 简历夹 Résumé folio | clamshell folder (the binder's case, no rings) | inside the back board: one large **clear zip pouch** holding the person's things — business card, résumé, ticket, polaroid, a 一筆箋 note — under 2D rigid-body physics (owner 2026-10-19: key, USB stick and sticker removed as meaningless; no gimmick objects) |

Extensible: a booklet = case + page types. Page types are *pocket grid* (any `LayoutSpec`), *pouch* (live objects), *paper* (printed pages). Later booklets (photo prints 4×6, ticket-stub book, sticker book, passport stamps) are new presets, not new engines.

## Interaction
- Open/close a booklet: drag or click the cover (existing binder physics). Turn pages: drag, click, keys (existing).
- **Résumé folio**: once open, drag on the desk around the folio (or the folio's edge) to tilt/shake it — the pouch frame's acceleration drives the objects. Phones: DeviceMotion (permission on first tap; iOS needs HTTPS). A "Shake" button for keyboard/mouse users. Pick up an object (drag) and fling it; click (<6 px, <250 ms) opens its detail.
- Detail: the business card **unfolds** (folding card, hinge physics), the résumé opens in a **paper viewer** whose pages turn like real paper (physics.ts chain with a paper preset + single-panel paper shader). The ticket and the polaroid are the pouch's own render (snapshot) and **turn over** to their printed backs; the note is held up alone. The caption (count, title, local name, anecdote, story, spec rows, links, actions) is real selectable text in the words column.
- Everything has a DOM fallback (no WebGL, screen readers, crawlers) rendered from the same `Profile`; `?view=json` serves it machine-readable. Reduced motion keeps the 3D, without the arrival swing or the moving light (owner 2026-10-23).

## Decisions (owner-changeable)
- Single package, Vite + React 19 + TS strict, `three ^0.186.0`, `planck 1.5.1`, bun. Directories are the module boundary; split into packages only when a second consumer exists.
- No third-party models or textures; procedural textures/geometry; fictional demo content. Demo photos (owner 2026-10-19: Japanese photos for postcards and the polaroid) are Unsplash-licensed files in `public/photos/` with `CREDITS.md`.
- **Direction C, 朝の光 morning light** (owner 2026-10-19): a pale blue-grey desk, window light from the top right, the words in the shade set like a Japanese book's front matter, printed-word controls with no containers. `docs/ART-DIRECTION.md` describes it.
- **No dark mode** (owner 2026-10-19): light only, no theme toggle, no `prefers-color-scheme: dark`; no ⌘K palette either (keys: 1 2 3, ← →, Space, Esc, S shake, M sound).
- **Fonts and language** (owner 2026-10-19, 「简体中文也要适配」): Shippori Mincho, Zen Kaku Gothic New, Klee One; Noto Serif SC, Noto Sans SC and LXGW WenKai for Chinese — all SIL OFL 1.1. `Profile.lang` picks the chrome (English or Simplified Chinese, `src/app/i18n.ts`) and the Han faces: kana or `ja` → the Japanese faces, `zh-Hant` → TC system faces, anything else with Han → the SC faces. Latin always comes from the Japanese faces (alias families), so a sentence never mixes glyph shapes. Every element holding the person's words carries a `lang` attribute; CJK slices load only when a string on screen needs them (`src/fonts`).
- **Several languages, one switch** (owner 2026-10-20, brief r4 E1): a folio is one `Profile` per language (`src/profile/folio.ts`: `{ primary, profiles }`, every language but the primary a lazy import). With two or more, the page prints a switch in its own style — 「English · 中文」, the language on view in ink — at the foot of the words column on a desk, in the header beside the identity on phones and tablets. The first language: `?lang=` (the older `?sample=zh` still works), else the visitor's last choice (localStorage), else the primary (never the browser's language: owner 2026-10-23). A switch changes everything in place, without a reload: the new profile and the faces of its words load first; then only the words that change step out (160 ms; the switch itself, counts, values, swatches and arrows stay) while `<html lang>` is set (the Chinese faces take its weight bands), and the new words step in at once (180 ms, a compositor-run animation, so a long task cannot leave the desk wordless); the booklet on the desk reprints only after that (pouch `setProfile`, paper `setContent`, the case's liner and the albums' print in place), so a frame always shows the words or the booklet. `?lang=` is written with replaceState and kept by the page's own links; the booklet on the desk stays. The languages must describe the same things (same ids, kinds, pictures: `shapeDiff`), so only words differ.
- **On a large desk only the book grows** (owner 2026-10-20): the words column, its type, the rows and controls keep their 1440 × 900 size (`layout.ts K_MAX` is 1 — raise it to scale them with the screen through `--k`, `--u`). The book box spans to the right margin where the hashira stands, and every booklet reaches to a margin after the words column; the book is sized for that box and then leans toward the middle of the screen as far as the room beside it allows (`Insets.anchor`, `scene.ts leanNow`: never smaller for it). On a 2512 × 1233 desk the résumé and the card album stand in the middle; the postcard album already fills the width and stays where it is. Held things in a detail view lean the same way. Wider than 2.1 : 1 the composition stops at 2.1 × H and stands centred, so a 21:9 screen does not pull the words away from the book.
- **Five pouch items**: business card, résumé, ticket, polaroid, note. The pouch counts read `05`.
- **The book box** is computed by the DOM (`src/app/layout.ts`) and passed to the engine as four-sided camera insets; the canvas is full-bleed with a transparent clear, so the cover is never clipped mid-screen.
- Sounds: ElevenLabs-generated foley (owner 2026-10-19, replacing synthesized sounds), processed by `scripts/sounds/` into `public/sounds/*.m4a` + `manifest.json`.
- Portrait phones are first-class (no "rotate your phone").
- License: **AGPL-3.0-only + CLA** (owner decision 2026-10-19, replacing an interim PolyForm Noncommercial choice): real open source; closed-source use needs a commercial license (dual licensing, enabled by CLA.md). Profile `source` feeds a footer Source link so deployers satisfy the AGPL by linking their fork. Name: **sasshi** (冊子, a booklet; owner 2026-10-23). Repo github.com/qzz0518/sasshi, a template repository, private until the owner makes it public.

## Modules and ownership
```
profile/      the page's content: index.ts (the folio) · en.ts · zh.ts (the demo persona)
src/profile/  schema.ts (the one content model) · folio.ts (one profile per language)
src/book/     the binder engine (from CardArt): stage, case, sheets, page physics; gains LayoutSpec, ContentSource, scene addons, ring-less case
src/bag/      the pouch: sim/ (planck, pure TS) · objects/ (procedural meshes + pouch film) · addon.ts (pouch as a book scene addon)
src/paper/    paper viewer: résumé page-turn + folding business card (physics.ts chains, paper shader)
src/app/      shell: the words column, the window light, the hands row, detail views, DOM fallback, text / json views, i18n
src/fonts/    which face sets a string (DOM stacks, canvas fonts, exact-string loading)
scripts/      headless harnesses and screenshot tools
```

## Interfaces

### Book engine (`src/book`)
- `createBook(host, opts)` as in CardArt's `scene.ts`, plus:
  - `layout: LayoutPreset | LayoutSpec` — presets `idCard2x3` (must equal today's constants value-for-value: golden test), `postcard2x2`; shaders built per layout (cache key includes a layout hash); per-book physics profile (mass/torque scaled by page area; never mutate the module-level `PHYSICS`).
  - `content: ContentSource` — replaces `cards: BookCard[]`; `createPocketGrid({ items })` keeps today's behaviour; for postcards each slot paints a different item per side (`paintSlot({ side, slot, mirrored })`): front film shows the picture, the back film shows the message side of the same postcard.
  - `case: { rings: boolean }` — `rings:false, sheets: 0` gives the clamshell folder.
  - `addons: SceneAddon[]` — see below.
  - `tilt: boolean` — drag on the desk outside the book tilts the whole book group (spring back, max ~25°); fast drags shake it. `book.shake(strength)`, `book.setTilt(x, y)` for device motion.
- Scene addon (the extension point the pouch uses):
```ts
export interface SceneAddon {
  /** Where the addon's object is parented. Frame: origin at the board's centre, x along the board width (to the right when open), y along its height (up), z = the board's inside normal; scene units (1 mm = 0.01). */
  anchor: "back-inside" | "front-inside";
  object: THREE.Object3D;
  /** Called every rendered frame while the book is alive. anchorWorld = the anchor frame's world matrix this frame. Return true to keep frames coming (physics not idle). */
  update(dt: number, t: number, anchorWorld: THREE.Matrix4): boolean;
  /** Pointer routing: down() returns true to claim the gesture (then move/up go to the addon and the page/cover drag is skipped). */
  pointer?: { down(ray: THREE.Ray, e: PointerEvent): boolean; move(ray: THREE.Ray, e: PointerEvent): void; up(ray: THREE.Ray, e: PointerEvent): void; hover?(ray: THREE.Ray): boolean };
  /** Cover openness 0 (closed) … 1 (open), called when it changes. */
  setOpen?(c: number): void;
  setDark?(dark: boolean): void;
  /** Resolves once the print is painted in its own faces; the book's opening on arrival waits for it (at most 2.5 s). */
  printed?(): Promise<void>;
  dispose(): void;
}
```
The résumé folio's front board gets a printed inside liner (`case.liner = { title, subtitle?, lines? }`: name, role, location, a small portrait window), so the open folio reads as an ID page on the left and the pouch on the right.

### Pouch (`src/bag`)
The sim/object contract (unchanged from v1 — `src/bag/sim` and `src/bag/objects` both mirror it exactly):
```ts
// sim — pure TS, no three, no DOM. Unit-tested with bun.
export type Frame = { ax: number; ay: number; gn: number; omega: number; alpha: number }; // apparent accel in pouch plane (m/s²), normal load, angular vel/accel
export type BodySpec = { id: string; w: number; h: number; layer: 0 | 1 | 2; shape: "rect" | "circle" | "capsule"; mass?: number; radius?: number };
export type BodyState = { id: string; x: number; y: number; angle: number; vx: number; vy: number; w: number; layer: number; held: boolean };
export function createBagSim(o: { width: number; height: number; bodies: BodySpec[]; seed?: number }): BagSim;
interface BagSim {
  step(dt: number, frame: Frame): void;           // fixed 120 Hz substeps internally, dt clamped to 0.1 s
  state(): readonly BodyState[];
  grab(id: string, x: number, y: number): void;   // ghost: filter → walls only, raised to top layer
  drag(x: number, y: number): void;
  release(vx: number, vy: number): void;          // re-admit into a free layer only when not overlapping
  idle(): boolean;                                // true when everything is at rest and input unchanged → host may stop stepping
  shake(strength?: number): void;                 // convenience impulse for the "Shake" button
}
export function frameFromMatrices(prev: Matrix4Like[], dt: number): Frame; // pocket world matrix history → apparent acceleration

// objects — three, pouch-plane metres
export function buildObject(item: PocketItem, ctx): { object: THREE.Group; body: BodySpec; update(state: BodyState, t: number): void; setDark(d: boolean): void; dispose(): void };
export function createPouch(ctx): { group: THREE.Group; update(t: number): void; setDark(d: boolean): void; dispose(): void };
```
- `sim/`: planck, bullet bodies, fixed 120 Hz, own idle detection, Coulomb friction in velocity space before planck integrates (FrictionJoint creeps, friction after the step drifts — never use either), 3 collision layers, grab = ghost + overlap-free re-admit, release speed cap.
- `objects/`: `buildObject(item, ctx)`, `createPouch(ctx)` in pouch-plane metres.
- `addon.ts`: `createPouchAddon({ profile, dark, onPick, scale })` → `SceneAddon` (anchor `back-inside`; converts metres → scene units; frame from `anchorWorld` history; DeviceMotion helper `enableMotion()`).

### Paper (`src/paper`)
`createPaperViewer(host, { item: ResumeItem | BusinessCardItem, dark, labels })` → handle with `next/prev/close/dispose`. Résumé = N A4 pages typeset to canvas from `ResumeItem`, turned with the physics chain (paper preset; fixes needed in `physics.ts`: zero-length outer column NaN, hand `reach`). Business card = 2-panel chain with a soft hinge that unfolds when dragged/clicked.

### App (`src/app`)
Booklets Cards · Postcards · Résumé (hash-synced), the grid and book box (`layout.ts`), the room and its light (`Room.tsx`), `ItemDetail` / `AlbumDetail` detail views in one frame (`Modal.tsx`), `ProfileView` fallback, `?view=text|json`, the language switch and `?lang=` (`App` useLanguage, `Shell` LangSwitch), English / Chinese chrome (`i18n.ts`), the desk's scale above 1440 × 900 (`layout.ts`). One WebGL context alive at a time (serial dispose → create).
