/*
 * 内容渲染器 —— public/content/*.json 的唯一渲染逻辑。
 * 两处使用：scripts/build-content.mjs（构建时注入静态 HTML，SEO 用）
 *          main.js（切换到英文时原地重渲染）。纯字符串函数，无浏览器 API。
 */

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 扁平双语字段：leadZh / leadEn → 按语言取值 */
const bi = (d, base, lang) => d[base + (lang === "en" ? "En" : "Zh")] ?? "";

function aboutIntro(d, lang) {
  const tags = (d.tags ?? []).map((t) => `<span class="tag">${esc(bi(t, "", lang) || t.zh)}</span>`).join("");
  return `<p class="about-lead">${esc(bi(d, "lead", lang))}</p>
  <p>${esc(bi(d, "p1", lang))}</p>
  <p>${esc(bi(d, "p2", lang))}</p>
  <div class="tag-cloud">${tags}</div>`;
}

function aboutCares(d, lang) {
  return (d.cares ?? [])
    .map(
      (c) => `<div class="care-card">
        <h3>${esc(bi(c, "title", lang))}</h3>
        <p>${esc(bi(c, "desc", lang))}</p>
      </div>`,
    )
    .join("\n");
}

function motto(d, lang) {
  return `<p id="motto" class="motto-text">${esc(bi(d, "motto", lang))}</p>
      <p class="motto-src">${esc(bi(d, "mottoSrc", lang))}</p>`;
}

function journeyItems(d, lang) {
  return (d.items ?? [])
    .map(
      (it) => `<div class="timeline-item" data-cat="${esc(it.cat)}">
        <div class="timeline-dot"></div>
        <div class="timeline-card">
          <span class="timeline-date">${esc(it.date)}</span>
          <h3>${esc(bi(it, "title", lang))}</h3>
          <p>${esc(bi(it, "desc", lang))}</p>
        </div>
      </div>`,
    )
    .join("\n");
}

function galleryItems(d, lang) {
  return (d.items ?? [])
    .map((it, i) => {
      const cap = bi(it, "caption", lang);
      const ph = `assets/gallery/placeholder-${(i % 6) + 1}.svg`;
      return `<figure class="masonry-item" data-caption-zh="${esc(it.captionZh)}" data-caption-en="${esc(it.captionEn)}">
        <img src="${esc(it.image)}" alt="${esc(it.captionZh)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
        <figcaption>${esc(cap)}</figcaption>
      </figure>`;
    })
    .join("\n");
}

function contactRows(d, lang) {
  const zh = lang !== "en";
  const chips = d.github
    ? `<a class="contact-chip" href="${esc(d.github)}" target="_blank" rel="noopener">GitHub</a>`
    : `<span class="contact-chip" style="opacity:.5">${zh ? "待补充" : "TBD"}</span>`;
  return `<div class="contact-row">
        <span class="contact-row-label">${zh ? "邮箱" : "Email"}</span>
        <span class="contact-row-value"><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></span>
      </div>
      <div class="contact-row">
        <span class="contact-row-label">${zh ? "其他" : "Elsewhere"}</span>
        <span class="contact-row-value contact-chips">${chips}</span>
      </div>
      <div class="contact-row">
        <span class="contact-row-label">📍</span>
        <span class="contact-row-value">${esc(zh ? d.locationZh : d.locationEn)}</span>
      </div>`;
}

const api = { aboutIntro, aboutCares, motto, journeyItems, galleryItems, contactRows, esc, bi };
if (typeof window !== "undefined") window.ContentRender = api;

export default api;
export { aboutIntro, aboutCares, motto, journeyItems, galleryItems, contactRows, esc, bi };
