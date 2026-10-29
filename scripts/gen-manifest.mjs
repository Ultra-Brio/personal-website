// 部署时生成随笔目录：扫描 content/essays/*.md 的 frontmatter → essays-manifest.json
// Cloudflare Pages 的 Build Command 就是运行本脚本；本地由 serve.py 动态提供同一接口。
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public", "content", "essays");
const out = join(root, "public", "essays-manifest.json");

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s?(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(m[0].length) };
}

const essays = [];
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse()) {
    const { meta } = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
    essays.push({
      slug: basename(f, ".md"),
      title: meta.title || f,
      date: meta.date || f.slice(0, 10),
      tag: meta.tag || "随笔",
      excerpt: meta.excerpt || "",
    });
  }
}

writeFileSync(out, JSON.stringify({ essays }, null, 2) + "\n", "utf8");
console.log(`wrote ${out} with ${essays.length} essay(s)`);
