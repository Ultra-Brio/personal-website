# sasshi

[English](README.md) · 简体中文

**给个人主页用的一排「实物册子」。** 翻一本卡册、一本明信片册，或者打开一只文件夹，从透明拉链袋里拿出名片、简历、门票、拍立得和一张便笺。全部是实时物理模拟，摆在清晨光线里的一张浅色书桌上。

> **sasshi** 是日语「冊子」的读音。演示：[sasshi.zezn.dev](https://sasshi.zezn.dev)。脱胎于 [CardArt](https://cardart.cc) 的 3D 卡册，仍在早期，会有变动。

## 册子

| | 是什么 | 里面装着 |
|---|---|---|
| **卡册** | 带透明 PVC 内页的活页夹，每面 2×4 | 卡片大小的东西 |
| **明信片册** | 带 A6 内页的活页夹，每面 2×3 | 明信片：正面隔着前膜看图，背面隔着后膜看字 |
| **简历夹** | 对开的文件夹，里面一只透明拉链袋 | 名片（可以打开）、简历（真实的纸，可以翻页）、可以翻面的门票和拍立得，还有一张一筆箋便笺 |

拖动翻页，拖动桌面倾斜文件夹，摇手机，抓起物件甩出去，点击看详情；在电脑上滚动鼠标滚轮，可以把简历拉近看。每本册子都有由同一份数据生成的无障碍文字版。

## 做成你自己的

1. 点仓库顶部的 **Use this template**（或者 fork）。
2. 在 `profile/` 里写你的资料。`en.ts` 是示例人物：名字、链接、简历、袋子里的物件、卡片和明信片；每个字段的类型和说明都在 [`src/profile/schema.ts`](src/profile/schema.ts)。`zh.ts` 是同一个人物的中文版：改写它，或者删掉它和 `profile/index.ts` 里对应的一行，页面就只有一种语言。改完名字后运行 `bun run seal`，给藏书票刻一方小篆名章；名字里有字没有篆字时，印章仍用宋体。
3. 把图片放进 `public/photos/`，在资料里写成 `photos/…`（开头不加斜杠）。删掉示例照片，以及 `CREDITS.md` 和 `manifest.json` 里对应的条目。
4. 把 `source` 改成你自己仓库的地址。页脚会链接到它，公开部署时就靠它满足 AGPL（见「许可」）。
5. 发布。用 GitHub Pages：Settings → Pages → Source 选 **GitHub Actions**，之后每次推送到 `main` 都会自动构建并部署（`.github/workflows/pages.yml`），地址是 `https://<用户名>.github.io/<仓库名>/`。部署到别处（Cloudflare、Netlify、Vercel、自己的服务器）：构建命令 `bun run build`，输出目录 `dist`。所有路径都是相对路径，放在域名根目录或子路径下都能用。

页面标题、描述和链接预览在构建时由你的资料生成，`src/` 里的东西都不用改。

想让 AI 来做？[`prompts/`](prompts/README.zh-CN.md) 里有现成的提示词：一组用来把页面做成你自己的（资料和简历、袋子里的物件、两本册子、照片、中文版、写作风格），一组用来构建和扩展项目本身（风格定调、3D 活页册、拉链袋、纸张、光、声音、新册子、验收标准）。

## 本地开发

```bash
bun install
bun run dev      # http://127.0.0.1:5188
```

同一份文件同时驱动 3D 册子、无障碍文字版（`?view=text`）和机器可读视图（`?view=json`）；`bun run typecheck` 会按 schema 检查你的资料。把 `lang` 设成资料所用的语言：`"zh-CN"` 会让页面界面变成中文，中文用思源宋体 / 思源黑体 / 霞鹜文楷排印，一句话里不会混用两种字形；拉丁字母始终来自日文字体。

## 多语言

每种语言写一份资料，列在 `profile/index.ts` 里，页面就会出现一个小小的「English · 中文」切换（桌面版在左侧文字栏底部，手机版在名字旁边），原地切换语言：不刷新页面，桌上的册子不动，册子上的印刷内容跟着换。示例带英文和简体中文两份：

```ts
// profile/index.ts：每种语言一份 Profile；除了 primary，其他语言要等访客选中时才加载
import type { Folio } from "../src/profile/folio";
import { profile } from "./en";

export const folio: Folio = {
  primary: "en",
  profiles: { en: profile, zh: () => import("./zh").then((m) => m.profileZh) },
};
```

- 各语言描述的是同一组东西：袋子里的物件（id 和种类，顺序一致）、卡册的卡片和明信片（id、颜色、图片）都相同，只有文字不同（`shapeDiff(a, b)` 会列出不一致的地方）。
- 访客先看到哪种语言：URL 里的 `?lang=zh`（页面自己的链接会带着它；旧的 `?sample=zh` 仍然有效），否则是他上次选的语言，否则就是 `primary`（不看浏览器语言）。只列一份资料时，页面不显示切换。

## 原理

- `src/book`：活页夹引擎。透明内页是一串刚性面板，由柔软的热封折痕连在一起，以 480 Hz 积分；磨砂封面是一道屏幕空间的模糊。版式（示例的长页用 `idCard2x4` 和 `postcard2x3`；另有 `idCard2x3`、`postcard2x2`）和内容来源都可以替换。
- `src/bag`：拉链袋。一个二维刚体世界（planck.js，连续碰撞检测，三层深度，手写的库仑摩擦），由文件夹在 3D 里的视加速度驱动；物件都是程序生成的，用 three.js 渲染。
- `src/paper`：纸张查看器。简历的纸页和对折的名片，沿着同样的物理链弯曲。
- `src/app`：页面本身。左侧文字栏（名字、简介、册子目录、版权信息）、画布下面那张静止的书桌（落在桌上和册子上的窗影由引擎投射）、底部那行印刷体文字按钮、详情视图、文字版和 JSON 视图、中英文界面。
- `src/fonts`：决定每段文字用哪款字体。拉丁字母来自日文字体，汉字按语言选字体，每个中日文字体切片只在有文字用到时才加载。

没有用到第三方模型或贴图。示例照片按 Unsplash 许可使用，见 public/photos/CREDITS.md。

## 第三方声明

- 字体均为 SIL Open Font License 1.1，除注明外都通过 Fontsource 引入：[Shippori Mincho](https://github.com/fontdasu/ShipporiMincho)、[Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic)、[Klee One](https://github.com/fontworks-fonts/Klee)、[Noto Serif SC](https://github.com/notofonts/noto-cjk)（思源宋体）和 [Noto Sans SC](https://github.com/notofonts/noto-cjk)（思源黑体）；[霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai) 通过 `lxgw-wenkai-webfont` 引入。
- `profile/seal.ts` 里藏书票印章的篆字字形来自[开元小篆](https://github.com/frankslin/kaiyuan-small-seal-font)，描自公有领域的《说文解字》刻本，按 SIL Open Font License 1.1 授权（[`profile/seal-OFL.txt`](profile/seal-OFL.txt)），不在 AGPL 范围内；`bun run seal` 用 [OpenCC](https://github.com/BYVoid/OpenCC) 的篆字对照表（Apache-2.0）查字。
- `public/photos/` 里的示例照片（日本：明信片和拍立得）按 [Unsplash 许可](https://unsplash.com/license) 使用，不在 AGPL 范围内；摄影师和出处列在 [CREDITS.md](public/photos/CREDITS.md)。请换成你自己的照片。
- `public/sounds/` 里的音效和房间环境声（树叶间的微风，偶尔一声远处的鸟鸣；`createSoundKit({ ambient: false })` 可以关掉）由 [ElevenLabs](https://elevenlabs.io) 的音效 API 生成，经 `scripts/sounds/` 处理（环境声见 `ambient.ts`）；用你自己的 `ELEVENLABS_API_KEY` 可以重新生成。

## 许可

版权所有 © 2026 qzz0518，以 [GNU AGPL-3.0](LICENSE) 发布。

- 任何网站都可以用：个人主页、求职简历、接单作品集、公司页面。部署修改过的版本时需要公开源码：一个公开的 fork，加上页脚的 Source 链接（在 profile 里填 `source`）即可。
- 要放进闭源产品，可以购买商业授权，请通过 [cardart.cc](https://cardart.cc) 联系。
- 欢迎贡献，提交前请同意[贡献者协议](CLA.md)（见 [CONTRIBUTING](CONTRIBUTING.md)）。
