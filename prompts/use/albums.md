# The card album and the postcards · 卡册和明信片

What goes into the two ring binders. A side holds 8 cards or 6 postcards, so full sides look best: 8, 16, 24 or 32 cards; 6 or 12 postcards.

两本活页册里放什么。每一面放 8 张卡或 6 张明信片，所以整面放满最好看：卡片 8、16、24 或 32 张；明信片 6 或 12 张。

## English

```text
Read src/profile/schema.ts (AlbumCard, Postcard), the albums in profile/en.ts and prompts/use/style.md. Then rewrite
profile.albums in profile/en.ts:

Cards (AlbumCard: id, label, nameLocal?, src? or color, note?, href?). Pick one theme that is mine, for example: <the colours I
love | projects I shipped | cities I lived in | books | my own photos>. Each card: a short label, an optional name in its own
script, a picture (card-size, 85.6 × 54 mm, prepared as prompts/use/photos.md says) or a flat colour (#hex), and a one-line note.
A multiple of 8, at most 32. Ids c1, c2, …

Postcards (Postcard: id, label, src, color, message, from, place, placeLocal?, credit?, date?). One per place I have been,
from these photos: <list with place and date>. Each: the place, a message of one or two sentences as if written on the back,
signed with my first name, the date, and the photo credit ("Photo: <name> / Unsplash" for a licensed photo; nothing for my own).
A multiple of 6, at most 12. Ids p1, p2, …; `color` is a pale tint shown while the picture loads.

Never invent where I have been. Run `bun run typecheck` when done.
```

## 中文

```text
先读 src/profile/schema.ts（AlbumCard、Postcard）、profile/en.ts 里的 albums，以及 prompts/use/style.md。然后改写
profile/en.ts 里的 profile.albums：

卡册（AlbumCard：id、label、nameLocal?、src? 或 color、note?、href?）。选一个属于我的主题，比如：<我喜欢的颜色 | 我做过的
项目 | 住过的城市 | 书 | 我自己拍的照片>。每张卡：一个短标签，可选的原文名字，一张图（卡片尺寸 85.6 × 54 mm，按
prompts/use/photos.md 处理）或一个纯色（#hex），再加一句注释。数量是 8 的倍数，最多 32 张。id 依次是 c1、c2……

明信片（Postcard：id、label、src、color、message、from、place、placeLocal?、credit?、date?）。我去过的地方一处一张，用这些
照片：<清单，写上地点和日期>。每张：地点，一两句像写在明信片背面的留言，落款用我的名字，日期，以及照片署名（授权照片写
「Photo: <作者> / Unsplash」；我自己拍的不写）。数量是 6 的倍数，最多 12 张。id 依次是 p1、p2……；`color` 是图片加载前
显示的浅色底。

不要编造我去过的地方。改完运行 `bun run typecheck`。
```
