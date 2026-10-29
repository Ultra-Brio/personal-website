# Profile and résumé · 资料和简历

Turns a résumé (PDF, LinkedIn, plain notes) into the top of `profile/en.ts`, the résumé that prints on real paper in the folio, and the business card.

把一份简历（PDF、LinkedIn、随手的笔记）变成 `profile/en.ts` 的开头部分、文件夹里那份印在真纸上的简历，以及名片。

## English

```text
Read src/profile/schema.ts, profile/en.ts and prompts/use/style.md. Then, from the résumé below, rewrite in profile/en.ts:

- The person: name, nameLocal (only if I have a name in another script), handle, role, location, timezone (IANA), bio (two
  sentences, first person), links (label + href; email as mailto:), coverTitle ("<Name> — Folio").
- The résumé item (id "resume"): summary (one sentence), experience (newest first; org, role, from, to, at most three bullets
  each, every bullet starting with a verb, a number only where my material has one), education, skills (six to eight, the ones
  that matter), languages. It prints on A4 at résumé type sizes: keep it to two pages.
- Its anecdote, story and specs (Pages, Updated, Languages), in the voice of prompts/use/style.md.
- The business card (id "card"): front (name, role, a tagline of a few words), inside (three contact rows: k / v), insideNote
  (one line about what I am open to), and its anecdote, story, specs.

Leave a TODO where my material has nothing; never invent an employer, a date or a number. Run `bun run typecheck` when done.

My résumé:
<paste here>
```

## 中文

```text
先读 src/profile/schema.ts、profile/en.ts 和 prompts/use/style.md。然后根据下面的简历，改写 profile/en.ts 里的这些内容：

- 人物本身：name、nameLocal（只有我有其他文字的名字时才填）、handle、role、location、timezone（IANA 时区）、bio（两句，第一
  人称）、links（label + href；邮箱写成 mailto:）、coverTitle（「<名字> — Folio」）。
- 简历（id 为 "resume"）：summary（一句）、experience（从最近的写起；org、role、from、to，每段最多三条，每条以动词开头，
  只有我的材料里有数字时才写数字）、education、skills（六到八项，挑真正重要的）、languages。它会按简历字号印在 A4 纸上，
  控制在两页以内。
- 简历的 anecdote、story 和 specs（Pages、Updated、Languages），语气按 prompts/use/style.md。
- 名片（id 为 "card"）：front（名字、职位、几个字的一句标语）、inside（三行联系方式：k / v）、insideNote（一行，说我目前接受
  什么样的合作），以及名片的 anecdote、story、specs。

材料里没有的地方留 TODO；不要编造雇主、日期或数字。改完运行 `bun run typecheck`。

（profile/en.ts 用英文写；中文版之后按 prompts/use/translate.md 单独写进 profile/zh.ts。）

我的简历：
<粘贴在这里>
```
