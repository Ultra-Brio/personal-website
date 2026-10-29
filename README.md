# 向博 · 个人主页（sasshi 模板版）

基于 [sasshi](https://github.com/qzz0518/sasshi)（AGPL-3.0）模板：个人主页做成一排实物册子——
名片卡册、明信片册、履历书，袋子里五件可拖拽的纸上物（名片/简历/门票/拍立得/便笺），
在真实物理与晨光下呈现。背景已替换为向博的照片，档案已写入向博的内容。

## 本地开发

```bash
npm install        # 已装好可跳过
npx vite --port 8738
```

## 构建

```bash
npm run build      # 生成随笔目录 + vite 构建 → dist/
npx vite preview --port 8739   # 本地看构建产物
```

## 子页（关于/足迹/随笔/相册/联络）

在 `public/` 下，与主页同域部署：
- `public/about.html` 等 6 个页面，样式 `public/css/style.css`（sasshi 晨光和色主题）
- 随笔：`public/content/essays/*.md`（Markdown + frontmatter），
  目录由 `scripts/gen-manifest.mjs` 在构建时生成到 `public/essays-manifest.json`
- 首页五件物件通过 `profile/zh.ts` 里的 `href` / `links` 指向子页

## 改内容

- **个人信息/物件/册子**：`profile/zh.ts`（一个文件管全部）
- **背景照片**：`public/photos/home-bg.jpg`
- **拍立得照片**：`public/photos/polaroid-dusk.jpg`
- **随笔**：`public/content/essays/` 或浏览器后台 `/admin/`
- **子页文案（中英）**：`public/js/i18n.js`；联系方式：`public/js/config.js`

## 发布（Cloudflare Pages）

- Build command: `npm run build`
- Build output directory: `dist`
- Node 20+

## CMS 后台

`/admin/`（Sveltia CMS）。首次启用：
1. 部署 [sveltia-cms-auth](https://github.com/sdorra/sveltia-cms-auth) Worker（Cloudflare 免费版）
2. GitHub OAuth App callback 填 `https://<worker>/callback`，把 Client ID/Secret 填进 Worker 环境变量
3. `admin/config.yml` 里填 worker 地址（repo 已是 Ultra-Brio/personal-website）

## 许可

模板为 AGPL-3.0：部署时须保留源码链接（左栏「源码」一行已指向本仓库）。
