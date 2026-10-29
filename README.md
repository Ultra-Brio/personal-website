# 向博 · 个人网站（暮色天际线 · 多页面 + CMS 版）

纯静态 + 免费动态平台：前端无框架无构建（随笔目录由一个小脚本生成），部署在
Cloudflare Pages（免费），内容用 Sveltia CMS（免费）在浏览器里编辑。

## 页面结构

| 页面 | 文件 | 视觉 |
|------|------|------|
| 首页 | `index.html` | 全屏大图 + 散布「拍立得」模块导航（悬停抖动放大，点击转场） |
| 关于 | `about.html` | 东京晴空塔横幅，自述 + 竖版照片位 + 我关心的事 |
| 足迹 | `journey.html` | 纽约夜航横幅，分类筛选时间线 |
| 随笔 | `essays.html` + `essay.html` | 富士山横幅，Markdown 文章系统 |
| 相册 | `gallery.html` | 洛杉矶横幅，瀑布流 + 灯箱 |
| 联络 | `contact.html` | 渐变横幅，联系方式（配置驱动） |
| 后台 | `admin/` | Sveltia CMS，浏览器里写随笔传照片 |

## 随笔系统（CMS）

- 文章本体：`content/essays/*.md`（frontmatter：title / date / tag / excerpt，正文 Markdown）
- 目录：`essays-manifest.json` —— 部署时由 `scripts/gen-manifest.mjs` 自动重新生成；
  本地由 `serve.py` 动态提供；直接双击打开时退回 `js/essays.js` 兜底
- 浏览器后台：访问 `<你的域名>/admin/`，用 GitHub 登录即可写随笔、传照片，保存自动发布
- 首次启用 CMS 需要一次性配置（GitHub OAuth App + 授权 Worker），步骤见下文

## 首次部署 / CMS 启用清单

1. **Cloudflare Pages**：注册并登录 dash.cloudflare.com → Workers & Pages → Create →
   Pages → Connect to Git → 选本仓库 → Build command 填 `node scripts/gen-manifest.mjs`，
   Build output directory 填 `/` → Deploy，得到 `xxx.pages.dev` 地址
2. **授权 Worker**：打开 github.com/sdorra/sveltia-cms-auth → 点 "Deploy to Cloudflare"
   → 创建 Worker（先随便填 GH_CLIENT_ID / GH_CLIENT_SECRET），记下 Worker 地址
3. **GitHub OAuth App**：GitHub → Settings → Developer settings → OAuth Apps → New，
   Homepage 填 `https://xxx.pages.dev`，Callback 填 `https://<worker地址>/callback`
   → 生成 Client ID 和 Client Secret
4. 回到 Cloudflare Worker 设置 → Variables → 把真实的 GH_CLIENT_ID / GH_CLIENT_SECRET
   填入并保存
5. 修改 `admin/config.yml`：`backend.repo` 与 `backend.base_url`（Worker 地址）、
   `site_url`（pages.dev 地址）
6. 访问 `https://xxx.pages.dev/admin/` → GitHub 登录 → 开始写

## 常用修改

### 改联系方式
`js/config.js`（邮箱 / GitHub / 微信 / 知乎 / 小红书 / 所在地），留空即不显示。

### 换照片
- 竖版个人照（关于页）：命名为 `portrait.jpg` 放入 `assets/images/`
- 相册：照片放进 `assets/gallery/`，编辑 `gallery.html` 复制一个 `<figure class="masonry-item">`
- 页面横幅：替换 `assets/images/` 下 `la.jpg / nyc.jpg / fuji.jpg / tokyo.jpg`
- 首页背景与模块照片：`index.html` 里 `constellation` 的 background-image 和各 `orb` 的 img

### 改全站文案（中英）
`js/i18n.js`，`zh:` 与 `en:` 一一对应。

### 改配色
`css/style.css` 顶部 `:root`。

## 本地预览

```bash
python serve.py 8737    # http://localhost:8737 （随笔系统完整可用）
```

直接双击 html 也能看，但随笔正文页需要本地服务器或线上环境（浏览器不允许
file:// 页面读取本地文件）。

## 技术栈

- 原生 HTML / CSS / JS，无框架无打包
- 随笔：Markdown + frontmatter，部署时生成目录 JSON，客户端轻量渲染（js/md.js）
- Sveltia CMS（浏览器端，免费开源）+ GitHub OAuth（sveltia-cms-auth Worker）
- Cloudflare Pages 免费托管，自动 HTTPS、全球 CDN
