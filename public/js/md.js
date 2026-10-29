/* md.js —— 极简 Markdown 渲染器（无外部依赖）
   支持：# 标题、**粗体**、*斜体*、`代码`、- 列表、> 引用、[链接](url)、分段 */
(function () {
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  window.renderMarkdown = function (md) {
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let list = null;
    const flushList = () => {
      if (list) { out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); list = null; }
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^\s*$/.test(line)) { flushList(); continue; }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) { flushList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
      if (/^[-*]\s+/.test(line)) { list = list || []; list.push(line.replace(/^[-*]\s+/, "")); continue; }
      const q = line.match(/^>\s?(.*)/);
      if (q) { flushList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
      flushList();
      out.push(`<p>${inline(line)}</p>`);
    }
    flushList();
    return out.join("\n");
  };
  window.parseFrontmatter = function (text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { meta: {}, body: text };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_]+):\s?(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
    return { meta, body: text.slice(m[0].length) };
  };
})();
