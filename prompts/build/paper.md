# Paper you can turn · 能翻的纸

The détail view of the résumé and the business card: A4 pages typeset from data and turned like real paper, a card that unfolds on its crease, and a wheel that brings the paper closer. Use it to build one, or to work on sasshi's (`src/paper/`: `viewer.ts`, `resume.ts`, `typeset.ts`, `card.ts`; `src/print/kinsoku.ts`).

简历和名片的详情视图：由数据排版出来的 A4 纸页，像真纸一样翻动；一张沿折痕打开的名片；滚轮可以把纸拉近。可以从零做一个，也可以用来改 sasshi 的（`src/paper/`：`viewer.ts`、`resume.ts`、`typeset.ts`、`card.ts`；`src/print/kinsoku.ts`）。

## English

```text
Build a paper viewer for a dialog with three.js: a résumé typeset from structured data onto A4 pages that turn like real paper,
and a folded business card that opens on its crease.

Typesetting (pure, unit-tested with an injected measuring function):
- Résumé data → pages of draw operations in millimetres → canvases. Sizes in cqw of the page (1 % of its width): a running head
  over an ink rule, the name in the serif, section labels in a narrow column, "Role, Org" lines with the years on the right,
  en-rule bullets, skill lists, indexed link rows, a foot.
- CJK set per character with kinsoku (no line starts with ，。、；：？！」 and none ends with 「（), Latin words kept whole, a
  number kept with its counter. Chinese section labels and punctuation for a Chinese résumé.
- Paint in fonts already loaded only; load the exact strings' web fonts first and repaint once if they come late.

Paper:
- Each sheet a short link chain (3 + 3 links, a paper preset) with its root at the binding; drag, click (right forward, left
  back), arrow keys; the free edge lifts a little on hover. Show-through of the other side, barely visible.
- A wide host shows the open spread (double-sided leaves bound at the centre); a narrow one shows one page at a time and a
  turned sheet slides off. The camera eases between framings as a critically damped spring; the canvas overscans the host so a
  sheet in flight is never cut; textures have one texel per device pixel within a pixel budget.
- The card: two panels joined by a scored crease, bistable (past about 130° it falls shut), letterpress in the bump map.
- A wheel or pinch zooms up to about 2.5×, the view following the pointer so the point under it stays under it; the print gets
  more texels once, without reflowing; the canvas then covers just its host with faded edges.

Deliver the typesetter with tests, the viewer, a harness page with ?item=resume|card, and headless frame sequences of a turn.
```

## 中文

```text
用 three.js 给一个对话框做纸张查看器：一份由结构化数据排版到 A4 纸上、能像真纸一样翻动的简历，以及一张沿折痕打开的对折名片。

排版（纯函数，测量函数由外部注入，有单元测试）：
- 简历数据 → 以毫米为单位的绘制指令页 → canvas。尺寸用页面宽度的 cqw（1 % 页宽）：页眉下一条墨线，名字用衬线体，左侧窄栏
  放分节标签，「职位，公司」一行、年份靠右，短横线项目符号，技能列表，带编号的链接行，页脚。
- 中日文逐字排，遵守禁则（行首不出现 ，。、；：？！」，行尾不出现 「（），拉丁单词不拆开，数字和后面的量词不分行。中文简历
  用中文分节标签和中文标点。
- 只用已经加载好的字体绘制；先按实际要印的字加载网页字体，晚到了就再重画一次。

纸：
- 每张纸是一条短链（3 + 3 节，纸张参数），根部固定在装订处；可以拖动、点击（点右边往后翻，点左边往前翻）、用方向键；鼠标
  悬停时自由边微微翘起。另一面的字隐约透过来，几乎看不见。
- 宿主够宽时显示整个跨页（双面纸在中间装订）；窄的时候一次一页，翻过的纸滑出去。镜头在不同取景之间按临界阻尼弹簧缓动；画布
  比宿主大一圈，翻在半空的纸不会被裁掉；纹理在像素预算内做到一个纹素对应一个设备像素。
- 名片：两块面板由一道压痕连接，双稳态（超过约 130° 就合上），凸版印刷的压痕做在凹凸贴图里。
- 滚轮或捏合可以放大到约 2.5 倍，画面跟着指针走，指针下的那一点始终在指针下；第一次放大时给印刷内容换更高分辨率的纹理，
  不重新排版；放大时画布只覆盖宿主，边缘渐隐。

交付带测试的排版模块、查看器、一个支持 ?item=resume|card 的调试页面，以及一次翻页的无头逐帧截图。
```
