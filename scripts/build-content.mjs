// 构建时把 public/content/*.json 注入 dist 的子页面：
//   1. 展开每个 <!--content:NAME-->…<!--/content--> 标记（保留标记本身，可重复运行），
//      注入中文静态 HTML —— 搜索引擎和禁 JS 的访客看到的仍是完整页面；
//   2. 在 </body> 前放一份 <script id="content-data" type="application/json">，
//      供 main.js 在切换英文时原地重渲染（public/js/content-render.js 与本脚本共用同一套渲染函数）。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { aboutIntro, aboutCares, motto, journeyItems, galleryItems, contactRows } from "../public/js/content-render.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const read = (p) => JSON.parse(readFileSync(join(root, "public", "content", p), "utf8"));

const data = { site: read("site.json"), about: read("about.json"), journey: read("journey.json"), gallery: read("gallery.json") };

const pages = {
  "about.html": [
    ["about-intro", aboutIntro(data.about, "zh")],
    ["about-cares", aboutCares(data.about, "zh")],
    ["about-motto", motto(data.about, "zh")],
  ],
  "journey.html": [["journey-items", journeyItems(data.journey, "zh")]],
  "gallery.html": [["gallery-items", galleryItems(data.gallery, "zh")]],
  "contact.html": [["contact-rows", contactRows(data.site, "zh")]],
};

for (const [file, slots] of Object.entries(pages)) {
  const p = join(dist, file);
  if (!existsSync(p)) continue;
  let html = readFileSync(p, "utf8");
  for (const [name, rendered] of slots) {
    const re = new RegExp(`(<!--content:${name}-->)[\\s\\S]*?(<!--/content:${name}-->)`);
    if (!re.test(html)) {
      console.warn(`[build-content] ${file} 缺少标记 content:${name}，跳过`);
      continue;
    }
    html = html.replace(re, `$1\n${rendered}\n  $2`);
  }
  const payload = `<script id="content-data" type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
  html = html.replace("</body>", `${payload}\n</body>`);
  writeFileSync(p, html);
  console.log(`[build-content] ${file} ✓`);
}
