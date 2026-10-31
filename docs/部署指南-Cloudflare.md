# 部署指南 · Cloudflare Pages + Sveltia CMS

> 目标：push 到 GitHub 自动部署；打开 `/admin/` 就能在网页后台写随笔、传图片，不碰代码。
> 全程免费。做之前只需一个 GitHub 仓库（已有：`Ultra-Brio/personal-website`）。

## 一、接入 Cloudflare Pages（约 5 分钟）

1. 注册 / 登录 [dash.cloudflare.com](https://dash.cloudflare.com)。
2. 左侧 **Workers & Pages → Create → Pages → Connect to Git**，授权 GitHub，选 `personal-website`。
3. 构建设置：
   - Framework preset：**None**（或 Vite）
   - Build command：`npm run build`
   - Build output directory：`dist`
4. **Save and Deploy**。一两分钟后得到 `https://ultra-brio.pages.dev`。
5. 之后每次 `git push` 到 main，Cloudflare 自动重新构建；开着的 Pull Request 还有独立预览地址。

## 二、（推荐）绑定自定义域名

现在 sitemap 和分享卡片里用的是相对路径，搜索引擎要求绝对 URL——这一步卡在"有没有自己的域名"上。

1. 域名可以在任何注册商买（约 ¥60–100/年）；也可以直接在 Cloudflare Registrar 买（成本价，省去 DNS 配置）。
2. Pages 项目 → **Custom domains → Set up a domain**，填域名，按提示把域名 DNS 托管到 Cloudflare（如果在别家买的，改 NS 记录即可）。
3. 域名生效后告诉我，我把 sitemap、og:image 一次性改成绝对地址（10 分钟）。

## 三、内容后台（已建好，两条路任选）

### 方式 A · Pages CMS（推荐：零部署，3 分钟）

配置已写在仓库根目录的 `.pages.yml`（随笔集合 + 图片上传到 `assets/uploads/`）。用法：

1. 打开 [pagescms.org](https://pagescms.org) → **Sign in with GitHub**。
2. 首次进入选择仓库 `Ultra-Brio/personal-website`，并安装它请求的 GitHub App（只授这个仓库）。
3. 左侧「随笔」集合：写标题、日期、标签、摘要，正文用富文本编辑器；图片直接拖进编辑器，自动落在 `assets/uploads/`。
4. 点 **Save** = 自动 commit = Cloudflare 自动重新部署，一两分钟后线上可见。

### 方式 B · Sveltia CMS（备选：要自建一个授权 Worker）

后台入口是 `/admin/`，配置已经写好（`admin/config.yml`），只差一个授权服务。

1. **创建 GitHub OAuth 应用**：GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Homepage URL：`https://personal-website.xbbruce2007.workers.dev`（或你的域名）
   - Callback URL：`https://sveltia-cms-auth.你的子域.workers.dev/callback`（子域下一步确定，先随便填一个，之后回来改）
   - 创建后记下 **Client ID**，并生成一个 **Client Secret**
2. **部署授权 Worker**：打开 [i404788/sveltia-cms-auth](https://github.com/i404788/sveltia-cms-auth)，点 README 里的 **Deploy to Cloudflare** 按钮，按向导填写上面两个值，得到 Worker 地址，如 `https://sveltia-cms-auth.你的子域.workers.dev`。
3. 回 GitHub OAuth App 设置里把 Callback URL 的子域改成真实的。
4. 修改本仓库 `admin/config.yml` 第 7 行：`base_url: https://sveltia-cms-auth.你的子域.workers.dev`，push。
5. 打开 `https://personal-website.xbbruce2007.workers.dev/admin/` → GitHub 登录 → 就能看到「随笔」集合；写完点 Save = 自动 commit = 自动部署。图片在编辑器里直接拖拽上传，落在 `assets/uploads/`。

## 四、日常维护约定

- **图片**：上传前压到宽度 ≤1600px（每张约 200–500KB）。仓库放几百张没有问题（GitHub 单文件上限 100MB）；真到图库级别再迁移 Cloudflare R2（免费 10GB）。
- **首页资料**（名字、简介、袋中五物的故事）在 `profile/zh.ts`，属低频修改，让 AI 改或网页编辑器改都行；高频内容（随笔、照片）全部走内容后台。
- **国内访问**：`workers.dev` / `pages.dev` 子域在大陆时常被墙，绑定自定义域名后明显改善；不保证 100%，这是无备案方案的固有代价。

## 五、部署后清单

- [ ] 首页、五个子页、Pages CMS（pagescms.org）全部可用
- [ ] CMS 能写一篇随笔并自动部署
- [ ] CMS 能传一张图
- [ ] 域名绑定后：sitemap 绝对化 + og:image（交给 AI 收尾）
