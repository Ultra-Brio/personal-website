# The things in the pouch · 袋子里的物件

The ticket, the polaroid and the note: the three small things that say who you are, beside the business card and the résumé.

门票、拍立得和便笺：放在名片和简历旁边，说明你是谁的三样小东西。

## English

```text
Read src/profile/schema.ts (TicketItem, PolaroidItem, NoteItem), the three items in profile/en.ts and prompts/use/style.md. Ask me
the questions below one at a time, then write the three items in profile/en.ts (keep their ids: ticket, polaroid, note).

1. Ticket: an event that mattered to me — a talk I gave, a concert, a match, a first day somewhere. What was it, when (date and
   doors time), where (venue, city), my seat or role, a ticket number if I kept one, and a link (slides, a recording) if any.
2. Polaroid: one photo that feels like me, where and when it was taken, and what was happening just outside the frame.
3. Note (一筆箋): a few lines to whoever opens the folio, signed with the name I sign letters with.

For each: an anecdote (one sentence, with a real number if there is one) and a story (two to four sentences). The polaroid also
gets a caption of a few handwritten words, a place, a date and a line for its back; its picture is prepared as prompts/use/photos.md
says. Run `bun run typecheck` when done.
```

## 中文

```text
先读 src/profile/schema.ts（TicketItem、PolaroidItem、NoteItem）、profile/en.ts 里的这三样东西，以及 prompts/use/style.md。按
下面的问题一次问我一个，问完再把这三样写进 profile/en.ts（id 不变：ticket、polaroid、note）。

1. 门票：一件对我重要的事：我做过的一次分享、一场演出、一场比赛、在某处的第一天。是什么，什么时候（日期和入场时间），在哪
   （场馆、城市），我的座位或身份，留着的票号，有的话再给一个链接（幻灯片、录像）。
2. 拍立得：一张像我的照片，在哪、什么时候拍的，画面外当时正在发生什么。
3. 便笺（一筆箋）：写给打开文件夹的人的几行字，落款用我写信时用的名字。

每一样都写一个 anecdote（一句，有真实数字就带上）和一个 story（两到四句）。拍立得另外要几个字的手写题字、地点、日期，和写在
背面的一行字；照片按 prompts/use/photos.md 处理。改完运行 `bun run typecheck`。
```
