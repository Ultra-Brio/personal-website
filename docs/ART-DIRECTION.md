# sasshi — art direction: 朝の光 (morning light)

Direction C (2026-10-19). The brief: 「简约、日系冷色调、有质感、有光影、有品味」 — simple, cool Japanese colours, texture, light and
shade, taste. Light only.

## The idea

The page is a pale blue-grey room at six in the morning. Low sun comes through a window at the top right and lays one soft patch
of light across the desk; the shadow of the window bar and a twig with leaves falls across it and over the booklet lying in that
light. The words sit in the shade on the left, set like the front matter of a Japanese book: 名 the name (with a vertical
nameplate), 序 the bio, 目次 the booklets, and 奥付 the colophon. A vertical running title (柱, hashira) stands in the outer margin.
There are no containers: no pill, no tray, no chip. Controls are printed words on the page's one bottom line.

## Colour (和色)

| Token | Hex | Use |
|---|---|---|
| 朝霧 asagiri | `#e3e8eb` | the desk; the 3D canvas clears transparent over it |
| 白磁 hakuji | `#eef2f4` | raised surfaces (the avatar disc, the Profile sheet) |
| 胡粉 gofun | `#f8f9f7` | DOM paper (the text version, the 郵便はがき back) |
| 墨 sumi | `#1c232b` | names, the active booklet, values |
| 鉄鼠 tetsu | `#36424e` | body text |
| 藍鼠 ainezu | `#4f5d69` | labels, counts, hints |
| 白鼠 shironezu | `#c2cbd2` | hairlines |
| 薄墨 usuzumi | `#8e9aa4` | leader dots, disabled arrows (never meaningful text) |
| 藍 ai | `#2f4f73` | the one accent: the active disc, focus, "Copied", the seal and ○ marks in print |

Shadows are blue-black (`rgb(21 35 58)`), never black or warm. No red, green or warm colour anywhere in the chrome or the print;
warm colour exists only inside photographs.

## Type

Shippori Mincho (serif: names, titles, the booklets, bio, anecdotes), Zen Kaku Gothic New (sans: everything else), Klee One
(handwriting: the polaroid, postcards, the note). For a Chinese profile, Han glyphs come from Noto Serif SC, Noto Sans SC and
LXGW WenKai; Latin always comes from the Japanese faces, so English looks the same in every language (src/fonts). No capitals in
the DOM, no italics, no mono web font. Numbers are tabular.

## Light

Real light, not a film over the book (owner, round 3). The window bars and the twig with its leaves are occluders in the 3D scene,
lit by one far sun (src/book): their shadow falls on the desk and goes on over the booklet with parallax and its own shading —
stronger on pale paper, faint on dark leather, a highlight on the pouch film. It keeps off the words: the engine fades its light on
the desk in screen space before the words column and the hands row (on a phone, the header and the foot), from the edges the page
gives it (`layout.ts` lightFade). The twig may sway a little (a few renders a second), never while a detail view or the Profile
sheet is up and never in a hidden tab.

The page's own room is one still layer under the transparent canvas (`Room.tsx`), painted once: 朝霧 with washi fibres, the corner
away from the window falling into shade, the lit patch with the shade round it and its glow, paper tooth. Nothing of the page lies
over the canvas, nothing blends over it, nothing animates for ever. On a first load the light rises with the load (daybreak). The
flat book, the printed version and the text views keep a still window bar and twig of their own on that layer. A detail view lays a
plain veil over the room (no backdrop blur); the booklet behind it goes soft and half transparent and stands still.

## Layout

A 12-column grid (margin 48, gutter 24 at ≥ 1360; margin 40 below): the 204 px words column, one empty column of 間, then the book
box to the right margin; the two albums, whose open spreads are wide, reach into the 間 column (a gutter short of the words).
The DOM computes the book box (src/app/layout.ts) and hands it to the engine as camera insets; the canvas is full-bleed and never
clipped. Phones: a header (name, booklet tabs), the book box full width, a hint, and a bottom row
(Profile, controls); the bio, colophon and case switch move into the Profile sheet. Landscape phones: a 172 px column beside the
book; tablets the phone structure, one page at a time in portrait, the open spread when the window is held landscape. The detail
view keeps the same frame: the caption takes the words column plus the 間 column, the object is held large in the book box, the
hashira names the object (名刺, 履歴書, 入場券, 写真, 一筆箋, 絵葉書, 色見本). On a phone the object's top edge sits 24 px under the
book box's top and the caption hangs 14 px under its foot (the business card's caption follows it down when it unfolds); a
landscape tablet window sets the caption beside the object, as on a desk. The ticket, polaroid and note stills carry their own
lift shadow, baked by the pouch from the object's silhouette (the desk shows through the ticket's punch); the page adds none.
A Chinese page pairs its Han running title with the small Latin line (简历 — Résumé folio · 05) as a bilingual colophon would: the
Han line is what a screen reader meets, the Latin line is decoration.

## The full specification

The values (every token, size, geometry and state) live in the code (`src/app/app.css`, `src/app/layout.ts`); `docs/DESIGN.md` lists the decisions.
