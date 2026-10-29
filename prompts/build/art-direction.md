# Set the tone · 风格定调

How this site's look was set: a room, a time of day and one light, then colour, type, layout and motion that all follow from it. Use it to give a site of your own a direction, or to change sasshi's (`docs/ART-DIRECTION.md`, `src/app/app.css`, `src/app/layout.ts`, `src/app/Room.tsx`).

这个网站的视觉是怎么定下来的：先定一个房间、一天中的一个时刻、一束光，颜色、字体、版式和动效都从它推出来。可以用它给你自己的网站定方向，也可以用来调整 sasshi 的风格（`docs/ART-DIRECTION.md`、`src/app/app.css`、`src/app/layout.ts`、`src/app/Room.tsx`）。

## English

```text
You are the art director of a personal website whose hero is a real-feeling 3D object (here: booklets lying on a desk). Give it
a direction, written as docs/ART-DIRECTION.md and as CSS custom properties, before any component is styled.

My brief in five words: <e.g. 简约、日系冷色调、有质感、有光影、有品味 — simple, cool Japanese colours, texture, light and shade, taste>.
References I admire (learn what they do well; never copy their look): <sites>.

Decide, in this order, and give the reason for each:
1. The scene: one room, one time of day, one light source and where it comes from. (sasshi: a pale blue-grey room at six in
   the morning, low sun through a window at the top right, the shadow of the window bar and a twig across the desk and the book.)
2. Colour: a named palette of 8–10 tokens from one tradition (sasshi uses 和色: 朝霧 desk, 墨 names, 鉄鼠 body, 藍鼠 labels,
   白鼠 hairlines, 藍 the only accent). Exactly one accent. Shadows tinted with the palette (blue-black), never pure black.
   Warm colour only inside photographs, if the palette is cool.
3. Type: at most three families with fixed roles (serif for names and titles, sans for everything else, a handwriting face for
   what is handwritten). For CJK: one Latin source for every language so English never changes shape, CJK slices loaded only
   when a string needs them. No italics, no capitals for emphasis, tabular figures.
4. Layout: a grid with real numbers (columns, margin, gutter), where the words sit, where the object sits, what happens on a
   phone, a tablet and a 2560-wide desk. Prefer words set like a book's front matter over cards and panels.
5. Controls: how they look without containers (sasshi: printed words on one bottom line, the active one in ink).
6. Light and motion: what is lit, what casts a shadow, what may move and how often; nothing animating for ever, nothing
   blending over the 3D canvas, reduced motion still showing the object.
7. Don'ts: a short list of what would break the direction (dark mode, pills, glassmorphism, gradients, emoji, stock 3D).

Deliver the document, the tokens, and three ASCII sketches (desk 1440 × 900, phone 390 × 844, detail view). Ask me before
inventing a brand colour or a font licence I have not cleared.
```

## 中文

```text
你是一个个人网站的艺术指导，网站的主角是一个有真实质感的 3D 物件（这里是摆在书桌上的几本册子）。在给任何组件写样式之前，
先给它定一个方向，写成 docs/ART-DIRECTION.md，并落成一组 CSS 自定义属性。

我的五个关键词：<例如：简约、日系冷色调、有质感、有光影、有品味>。
我欣赏的参考：<网站>。学它们做得好的地方，绝不照搬它们的样子。

按这个顺序决定，每一条都写出理由：
1. 场景：一个房间，一天里的一个时刻，一个光源和它的方向。（sasshi：早上六点，一间浅蓝灰色的房间，低低的太阳从右上方的窗
   照进来，窗框和一根树枝的影子落在桌上，也落在书上。）
2. 颜色：从同一个传统里取 8–10 个有名字的颜色（sasshi 用和色：朝霧做桌面，墨写名字，鉄鼠写正文，藍鼠写标签，白鼠做细线，
   藍是唯一的强调色）。强调色只能有一个。阴影带着色板的色相（蓝黑），不用纯黑。色板是冷色时，暖色只出现在照片里。
3. 字体：最多三款，各司其职（衬线体用于名字和标题，无衬线体用于其余文字，手写体只用于手写的东西）。中日文：所有语言共用
   一套拉丁字体，英文在哪种语言下都长一个样；中日文字体切片只在有文字用到时才加载。不用斜体，不用大写来强调，数字等宽。
4. 版式：一套有具体数字的网格（栏数、边距、栏间距），文字放哪、物件放哪，手机、平板和 2560 宽的桌面上分别怎么排。文字
   优先排成书前页的样子，而不是一张张卡片和面板。
5. 控件：不用容器时它们长什么样（sasshi：底部一行印刷体文字，当前项用墨色）。
6. 光与动效：什么被照亮，什么投下影子，什么可以动、多久动一次；没有永远循环的动画，3D 画布上不叠混合图层，开了减少动态效果
   也照样展示物件。
7. 禁止项：列出会破坏这个方向的东西（深色模式、胶囊按钮、毛玻璃卡片、渐变、表情符号、素材库里的 3D 模型）。

交付这份文档、这组颜色和尺寸变量，以及三张 ASCII 草图（桌面 1440 × 900、手机 390 × 844、详情视图）。我没确认过的品牌色或
字体授权，先问我，不要自己定。
```
