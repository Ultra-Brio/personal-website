# The quality bar · 验收标准

How a change is checked before it ships: headless, at the sizes people use, in both languages, against the art direction. Give it to a reviewing agent, or use it on yourself.

一个改动上线前怎么验收：无头浏览器，用户常用的尺寸，两种语言，对照艺术方向。可以交给一个负责审查的 AI，也可以自己照着做。

## English

```text
Review this change to sasshi before it ships. Use headless browsers only. Report each finding with evidence (a screenshot
path, a number, a failing check), most severe first; do not fix anything yet.

1. Checks: `bun run typecheck`, `bun test src`, a production build, and the e2e suite
   (`bun scripts/harness/e2e.ts <url> <out dir>`) against `vite preview` of that build. All green, or say exactly what failed.
2. Sizes: 390 × 844 (phone), 834 × 1112 (tablet), 1440 × 900, 2560 × 1440; English and ?lang=zh; with reduced motion; with
   WebGL off (the printed version and the flat book).
3. Feel: frame pacing during a page turn, the cover's swing and a pouch shake (no long tasks over 50 ms in those moments); the
   folio opening onto its final print (no font swap, no reflow while visible); nothing flickering when the case material changes.
4. Craft, against docs/ART-DIRECTION.md: the palette (one accent, no warm colour in the chrome), the type roles and sizes, the
   grid and the book box, the light falling on the book and not on the words, controls as printed words, Chinese set as
   carefully as English (kinsoku, punctuation, spacing between Han and Latin).
5. Budgets: first paint fetches at most about 250 KB of woff2; the stage stays within its pixel budget; one WebGL context alive
   at a time; nothing renders while nothing moves.
6. Privacy and hygiene: no personal paths, emails, keys or tokens in the diff or the build; no stray files.

End with a verdict: ship, ship after the listed fixes, or do not ship.
```

## 中文

```text
在 sasshi 的这个改动上线前做一次审查。只用无头浏览器。每个问题都附上证据（截图路径、一个数字、一项失败的检查），从最严重
的开始排；先不要修。

1. 检查：`bun run typecheck`、`bun test src`、生产构建，以及对这个构建的 `vite preview` 跑 e2e
   （`bun scripts/harness/e2e.ts <网址> <输出目录>`）。全部通过；没通过就说清楚哪一项。
2. 尺寸：390 × 844（手机）、834 × 1112（平板）、1440 × 900、2560 × 1440；英文和 ?lang=zh；开着减少动态效果；关掉 WebGL
   （印刷版和平面册子）。
3. 手感：翻页、封面开合、摇晃袋子时的帧间隔（这些时刻不能有超过 50 ms 的长任务）；文件夹翻开时，看到的已经是最终的印刷
   内容（可见时不换字体、不重排）；切换封面材质时不闪烁。
4. 做工，对照 docs/ART-DIRECTION.md：色板（只有一个强调色，界面里没有暖色）、字体分工和字号、网格和书框、光落在书上而不落在
   文字上、控件是印刷体文字、中文和英文一样讲究（禁则、标点、汉字与拉丁字母之间的空格）。
5. 预算：首屏最多加载约 250 KB 的 woff2；舞台不超出像素预算；同一时间只有一个 WebGL 上下文；没有东西在动时不渲染。
6. 隐私和整洁：改动和构建产物里没有本机路径、邮箱、密钥或 token；没有多余的文件。

最后给出结论：可以上线、按列出的问题修完再上线，或者不能上线。
```
