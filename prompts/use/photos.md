# Photos · 照片

How the pictures are cropped, sized and toned so they sit in the room's light, and how they are credited.

照片怎么裁、多大、怎么调色，才能和页面的光线融在一起，以及怎么署名。

## English

```text
Prepare my photos for this page (read prompts/use/style.md for the look). Write a small script (Python with Pillow, or Bun with
sharp) rather than editing by hand, and keep it out of the repository.

Sizes and crops (centre on the subject):
- polaroid: 1:1, 1200 × 1200
- postcards: 148:105 (A6, landscape), 1600 px wide
- album cards with a picture: 85.6:54 (ID-1 card), 1200 px wide

For every file: convert to sRGB, crop, resize (Lanczos), a light unsharp mask, then a gentle cool harmonise — saturation down
about 8 %, shadows and mid-tones a little cooler (red −2 %, blue +2 % weighted towards the dark), blacks lifted slightly towards
a cool slate (about +3 % R, +4 % G, +5 % B), highlights left neutral. Save as progressive JPEG at quality 74–82, at most 250 KB.
Show me a before / after of each before you replace anything.

Then: put them in public/photos/ with lower-case, hyphenated names that say the place ("kyoto-ryoanji-snow.jpg"), refer to them as
"photos/<name>.jpg" (no leading slash), and list each one in public/photos/manifest.json (file, use, place, caption_en,
photographer, source, license, aspect) and in public/photos/CREDITS.md. A photo from Unsplash or similar keeps its photographer
and link; my own photos say so. Delete the demo photos I no longer use.
```

## 中文

```text
帮我把照片处理成适合这个页面的样子（风格见 prompts/use/style.md）。写一个小脚本来做（Python + Pillow，或 Bun + sharp），不要手动
修图，脚本不要放进仓库。

尺寸和裁切（以主体为中心）：
- 拍立得：1:1，1200 × 1200
- 明信片：148:105（A6 横版），宽 1600 px
- 带图的卡片：85.6:54（证件卡尺寸），宽 1200 px

每张照片：转成 sRGB，裁切，缩放（Lanczos），轻微锐化，再做一次温和的冷调统一：饱和度降低约 8 %；暗部和中间调稍微偏冷
（红 −2 %、蓝 +2 %，越暗越明显）；黑位略微提亮，偏向冷灰（约 R +3 %、G +4 %、B +5 %）；高光保持中性。存成渐进式 JPEG，
质量 74–82，不超过 250 KB。替换之前，先把每张的前后对比给我看。

然后：放进 public/photos/，文件名用小写加连字符，写明地点（如 "kyoto-ryoanji-snow.jpg"）；在资料里写成
"photos/<文件名>.jpg"（开头不加斜杠）；每张都登记到 public/photos/manifest.json（file、use、place、caption_en、
photographer、source、license、aspect）和 public/photos/CREDITS.md。来自 Unsplash 等图库的照片保留作者和链接；我自己拍的就
写明是我拍的。删掉不再使用的示例照片。
```
