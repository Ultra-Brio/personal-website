# A second language · 第二种语言

Writes `profile/zh.ts` (or another language) from `profile/en.ts`. The page then shows an 「English · 中文」 switch; English stays the default.

根据 `profile/en.ts` 写出 `profile/zh.ts`（或其他语言）。页面会出现「English · 中文」切换，默认仍是英文。

## English

```text
Read profile/en.ts, profile/zh.ts (the demo's Chinese edition: how it reuses the English data), src/profile/folio.ts (shapeDiff)
and prompts/use/style.md. Then write profile/zh.ts as the Simplified Chinese edition of my profile/en.ts, with lang: "zh-CN".

- Same shape: the same items (ids and kinds, in order), the same album cards and postcards (ids, colours, pictures). Only words
  change; reuse the English data (`profile.albums…`) for everything that is not words.
- Write it as good Chinese prose, not a translation: natural word order, full-width punctuation and 「」 quotes, a space between
  Han characters and digits or Latin words ("6 个产品团队"). Date fields stay ISO ("2024-09-14"): the page formats them.
- Names: my Chinese name if I have one; brand, company and product names stay as they are.
- It must read as carefully as the English. If a sentence would come out stiff, rewrite it rather than translate it.

Run `bun run typecheck`, then open the page with ?lang=zh and check that every line reads naturally.
```

## 中文

```text
先读 profile/en.ts、profile/zh.ts（示例的中文版，看它怎么复用英文版的数据）、src/profile/folio.ts（shapeDiff）和
prompts/use/style.md。然后把 profile/zh.ts 写成我的 profile/en.ts 的简体中文版，lang 设为 "zh-CN"。

- 结构相同：同样的物件（id 和种类，顺序一致），同样的卡片和明信片（id、颜色、图片）。只改文字；不是文字的部分直接复用英文
  版的数据（`profile.albums…`）。
- 写成好的中文，不要翻译腔：语序自然，全角标点和「」引号，汉字与数字、拉丁字母之间留一个空格（「6 个产品团队」）。日期字段
  保持 ISO 格式（"2024-09-14"），页面会自己格式化。
- 名字：我有中文名就用中文名；品牌、公司和产品名保持原样。
- 要和英文版一样用心。哪句话直译出来生硬，就重写，而不是硬翻。

运行 `bun run typecheck`，然后用 ?lang=zh 打开页面，逐句检查读起来是否自然。
```
