# A new booklet · 新加一种册子

Adds a fourth booklet to the shelf — a photo-print album, a ticket-stub book, a sticker book, a passport — as a new preset, not a new engine.

在书架上加第四本册子，比如照片冲印册、票根册、贴纸册、护照，做法是新增一个预设，而不是另写一个引擎。

## English

```text
Add a new booklet to sasshi: <e.g. a 4 × 6 photo-print album, two prints a side; or a ticket-stub book>.

Read first: docs/DESIGN.md, docs/ART-DIRECTION.md, src/app/booklets.ts (the shelf), src/book/layout.ts (LayoutSpec presets),
src/book/content/ (content sources and their painters), src/profile/schema.ts, src/app/stages/AlbumStage.tsx, src/app/i18n.ts.

Do it as data and presets:
1. Schema: the new booklet's items under profile.albums (plain JSON: id, label, picture or colour, the words it prints).
2. Layout: a LayoutSpec preset for its pockets (page size, slots, margins, double-sided or not), sized so a side fills.
3. Content: a painter that prints one slot on a canvas in the page's type and colours (the print rules of the other booklets:
   cool inks, 藍 the only accent, no italics).
4. The shelf: an entry in booklets.ts (case colour from the 和色 palette, foil, default material, its Japanese name for the
   hashira), its tab, its hint and its words in English and Chinese, its detail view, its text-version section.
5. The demo persona gets a few items in profile/en.ts and profile/zh.ts.
6. Tests for the layout and the painter, a harness page, headless screenshots at 1440 × 900 and 390 × 844, and the e2e
   sections the other albums have.

Do not fork the engine: if something is missing, add the smallest hook to src/book and say why.
```

## 中文

```text
给 sasshi 加一本新册子：<例如：4 × 6 照片冲印册，每面两张；或者一本票根册>。

先读：docs/DESIGN.md、docs/ART-DIRECTION.md、src/app/booklets.ts（书架）、src/book/layout.ts（LayoutSpec 预设）、
src/book/content/（内容源和它们的绘制器）、src/profile/schema.ts、src/app/stages/AlbumStage.tsx、src/app/i18n.ts。

用数据和预设来做：
1. Schema：新册子的内容放在 profile.albums 下（纯 JSON：id、label、图片或颜色、要印的文字）。
2. 版式：给它的卡袋写一个 LayoutSpec 预设（页面尺寸、卡位、边距、是否双面），尺寸要让一面正好放满。
3. 内容：一个绘制器，用页面的字体和颜色把一个卡位印到 canvas 上（遵守其他册子的印刷规矩：冷色墨，藍是唯一的强调色，不用
   斜体）。
4. 书架：在 booklets.ts 里加一项（封面颜色取自和色色板、烫印方式、默认材质、用在柱上的日文名），以及它的标签页、提示语、
   中英文文字、详情视图和文字版里的一节。
5. 示例人物在 profile/en.ts 和 profile/zh.ts 里各加几项内容。
6. 版式和绘制器的测试、一个调试页面、1440 × 900 和 390 × 844 的无头截图，以及其他册子都有的那几节 e2e 检查。

不要复制一份引擎：缺什么，就在 src/book 里加最小的钩子，并说明原因。
```
