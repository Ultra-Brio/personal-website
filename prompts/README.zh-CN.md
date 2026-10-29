# 提示词

[English](README.md) · 简体中文

用 AI 来做这个项目，这里是现成的提示词。在 AI 编程助手（Claude Code、Cursor、Codex、Copilot 等）里打开这个仓库，复制一段提示词，把尖括号里的内容换成你的，发出去即可。每个文件里都有英文和中文两个版本。

## 使用模板

把页面做成你自己的：你的文字、你的照片、你的语言。

| 提示词 | 做什么 |
|---|---|
| [make-it-yours](use/make-it-yours.md) | 一步到位：资料、简历、袋子里的物件、两本册子、照片，以及（可选的）中文版 |
| [profile](use/profile.md) | 名字、简介和链接，文件夹里那份印在纸上的简历，名片 |
| [pouch](use/pouch.md) | 门票、拍立得和便笺，会先问你几个问题 |
| [albums](use/albums.md) | 卡册和明信片 |
| [photos](use/photos.md) | 裁切、尺寸，以及和页面光线相配的冷调处理；署名 |
| [translate](use/translate.md) | 和英文版一样用心的简体中文版（`profile/zh.ts`） |
| [style](use/style.md) | 文字语气和视觉风格；在任何对话里让 AI 写文案之前，先贴上它 |

## 构建和扩展

这个项目本身是怎么做出来的：风格方向、几个引擎、光、声音。写成了提示词，可以拿来做一个类似的东西，也可以用来改这里的代码。

| 提示词 | 做什么 |
|---|---|
| [art-direction](build/art-direction.md) | 风格定调：先定一个房间、一个时刻、一束光，再推出颜色、字体、版式、控件和动效 |
| [ring-binder](build/ring-binder.md) | 3D 活页册：内页是一串物理链，封面，磨砂外壳，按需渲染 |
| [clear-pouch](build/clear-pouch.md) | 拉链袋：由文件夹的运动驱动的二维刚体，抓取和甩动，印着字的物件 |
| [paper](build/paper.md) | 排版到 A4 上、像纸一样翻动的简历，对折的名片，滚轮放大 |
| [room-and-light](build/room-and-light.md) | 画布下面那间清晨的房间，以及在 3D 场景里真实投射的窗影 |
| [sound](build/sound.md) | 生成的拟音和安静的环境声，靠耳朵挑选，靠测量定音量 |
| [new-booklet](build/new-booklet.md) | 在书架上加第四本册子，用预设而不是另写引擎 |
| [review](build/review.md) | 一个改动上线前要达到的验收标准 |

这些提示词都要求 AI 不编造关于你的事实：不确定就问你，或者留一个 TODO。
