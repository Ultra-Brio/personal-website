# Make it yours, in one go · 一步做成你自己的

For an AI coding agent working in this repository (Claude Code, Cursor, Codex, Copilot …). Fill in the angle brackets, attach your résumé and photos, and send.

给在这个仓库里工作的 AI 编程助手用（Claude Code、Cursor、Codex、Copilot 等）。把尖括号里的内容换成你的，附上简历和照片，发出去即可。

## English

```text
This repository is sasshi: a personal page made of physical booklets — a card album, a postcard album, and a résumé folio with
a clear zip pouch. Make it mine.

Read first: README.md ("Make it yours"), src/profile/schema.ts (every field and what it is for), profile/en.ts (the demo persona:
the shape to follow), prompts/use/style.md (the voice and the look), prompts/use/photos.md (how pictures are prepared).

My material:
- Résumé, LinkedIn or notes: <paste or attach>
- Links (email, GitHub, website …): <…>
- Photos: <folder or list; say which one is the polaroid and which are postcards>
- Languages: <English only | English and Simplified Chinese>
- My repository URL (for `source`): <…>

Then:
1. Rewrite profile/en.ts as me: name, nameLocal (if I have a name in another script), role, location, timezone, bio, links,
   coverTitle, source. Then run `bun run seal` to cut my name seal in small seal script (it says so when a character has none).
2. The pouch keeps its five things, in this order and with these ids: card, resume, ticket, polaroid, note. Fill the résumé and
   the business card from my material; write the ticket, the polaroid and the note as small true stories about me.
3. The albums: cards (a multiple of 8, up to 32) and postcards (a multiple of 6, up to 12), from my photos or as flat colours.
4. Photos: prepare them as prompts/use/photos.md says; delete the demo photos I don't use, with their entries in
   public/photos/manifest.json and public/photos/CREDITS.md.
5. Chinese: if I want it, write profile/zh.ts as prompts/use/translate.md says; if not, delete zh.ts and its line in profile/index.ts.
6. Run `bun run typecheck` and `bun run build` and fix what fails (the unit tests describe the demo persona; skip them). Then
   start `bun run dev` and tell me what to look at.

Ask me before you invent anything about me: employers, titles, dates, numbers. Keep every field inside the schema and leave
src/ alone unless I ask.
```

## 中文

```text
这个仓库是 sasshi：一个由实物册子组成的个人主页，有卡册、明信片册，和一只装着透明拉链袋的简历夹。帮我把它做成我自己的。

先读：README.zh-CN.md（「做成你自己的」）、src/profile/schema.ts（每个字段和它的用途）、profile/en.ts（示例人物，照着它的结构
写）、prompts/use/style.md（文字语气和视觉风格）、prompts/use/photos.md（照片怎么处理）。

我的材料：
- 简历、LinkedIn 或者笔记：<粘贴或附上>
- 链接（邮箱、GitHub、个人网站……）：<……>
- 照片：<文件夹或清单；说明哪张做拍立得，哪些做明信片>
- 语言：<只要英文 | 英文和简体中文>
- 我的仓库地址（填 `source`）：<……>

然后：
1. 把 profile/en.ts 改写成我：name、nameLocal（如果我有其他文字的名字）、role、location、timezone、bio、links、coverTitle、
   source。然后运行 `bun run seal`，用小篆刻我的名章（有字没有篆字时它会说明）。
2. 袋子里保留五样东西，顺序和 id 不变：card、resume、ticket、polaroid、note。简历和名片按我的材料填；门票、拍立得和便笺
   写成关于我的、真实的小故事。
3. 册子：卡册（8 的倍数，最多 32 张）和明信片（6 的倍数，最多 12 张），用我的照片，或者用纯色。
4. 照片：按 prompts/use/photos.md 处理；删掉用不到的示例照片，以及 public/photos/manifest.json 和 public/photos/CREDITS.md 里
   对应的条目。
5. 中文：如果我要，按 prompts/use/translate.md 写 profile/zh.ts；不要的话，删掉 zh.ts 和 profile/index.ts 里对应的一行。
6. 运行 `bun run typecheck` 和 `bun run build`，有错就修（单元测试描述的是示例人物，跳过）。然后启动 `bun run dev`，告诉我
   该看哪里。

凡是关于我的内容（雇主、职位、日期、数字），不确定就先问我，不要编。所有字段都在 schema 范围内，没让你改就不要动 src/。
```
