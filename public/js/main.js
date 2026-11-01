/* ============================================================
   main.js —— 全站共享脚本：语言切换、导航、滚动动画、
   足迹筛选、相册灯箱、随笔列表、配置渲染
   ============================================================ */
(function () {
  "use strict";

  /* ================= 语言 ================= */
  let lang = localStorage.getItem("site-lang") || "zh";

  function applyLang(l) {
    lang = l;
    localStorage.setItem("site-lang", l);
    const dict = I18N[l];
    document.documentElement.lang = l === "zh" ? "zh" : "en";
    document.title = dict.pageTitle;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key] !== undefined) el.textContent = dict[key];
    });
    // 带换行的提示文本
    document.querySelectorAll("[data-i18n-nl]").forEach((el) => {
      const key = el.getAttribute("data-i18n-nl");
      if (dict[key] !== undefined) el.textContent = dict[key];
    });
    document.querySelectorAll(".lang-option").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-lang-btn") === l);
    });
    if (document.getElementById("typingText")) startTyping();
    if (document.getElementById("essayList") && typeof ESSAYS !== "undefined") renderEssays();
    initMotto();
    if (CONTENT) renderAll(l);
  }

  const langToggle = document.getElementById("langToggle");
  if (langToggle) {
    langToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".lang-option");
      if (btn) applyLang(btn.getAttribute("data-lang-btn"));
    });
  }

  /* ================= 打字机（仅首页） ================= */
  const typingEl = document.getElementById("typingText");
  let typingTimer = null;
  function startTyping() {
    if (!typingEl) return;
    clearTimeout(typingTimer);
    const roles = I18N[lang].heroRoles.slice();
    let roleIdx = 0, charIdx = 0, deleting = false;
    (function typeNext() {
      const word = roles[roleIdx % roles.length];
      if (!deleting) {
        charIdx++;
        typingEl.textContent = word.slice(0, charIdx);
        if (charIdx >= word.length) { deleting = true; typingTimer = setTimeout(typeNext, 2100); return; }
        typingTimer = setTimeout(typeNext, 90 + Math.random() * 90);
      } else {
        charIdx--;
        typingEl.textContent = word.slice(0, charIdx);
        if (charIdx <= 0) { deleting = false; roleIdx++; typingTimer = setTimeout(typeNext, 350); return; }
        typingTimer = setTimeout(typeNext, 45);
      }
    })();
  }

  /* ================= 导航 & 进度条 ================= */
  const nav = document.getElementById("nav");
  const progressBar = document.getElementById("progressBar");
  window.addEventListener("scroll", () => {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 40);
    if (progressBar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0) progressBar.style.width = (window.scrollY / max) * 100 + "%";
    }
  }, { passive: true });

  const burger = document.getElementById("navBurger");
  const mobileMenu = document.getElementById("mobileMenu");
  const setMenu = (open) => {
    mobileMenu.classList.toggle("open", open);
    burger.closest(".nav").classList.toggle("menu-open", open);
    document.body.classList.toggle("menu-open", open);
  };
  if (burger) {
    burger.addEventListener("click", () => setMenu(!mobileMenu.classList.contains("open")));
    mobileMenu.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mobileMenu.classList.contains("open")) setMenu(false);
    });
  }
  // 高亮当前页
  const page = document.body.getAttribute("data-page");
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.getAttribute("data-nav") === page) a.classList.add("active");
  });

  /* ================= 内容数据（public/content/*.json） =================
     生产环境：构建脚本已把中文静态注入页面，并内嵌一份 JSON（#content-data）供切换英文；
     本地开发（无 #content-data）：从 content/*.json 拉取，客户端渲染。 */
  let CONTENT = null;
  const hasStaticContent = !!document.getElementById("content-data");

  function applySite(l) {
    if (!CONTENT) return;
    const s = CONTENT.site;
    document.querySelectorAll("[data-config-email]").forEach((el) => {
      if (el.tagName === "A") { el.href = "mailto:" + s.email; }
      el.textContent = s.email;
    });
    document.querySelectorAll("[data-config-location]").forEach((el) => {
      el.textContent = l === "en" ? s.locationEn : s.locationZh;
    });
  }

  function renderAll(l) {
    if (!CONTENT || !window.ContentRender) return;
    const R = window.ContentRender;
    const set = (name, html) => {
      const el = document.querySelector(`[data-content="${name}"]`);
      if (el) el.innerHTML = html;
    };
    set("about-intro", R.aboutIntro(CONTENT.about, l));
    set("about-cares", R.aboutCares(CONTENT.about, l));
    set("about-motto", R.motto(CONTENT.about, l));
    const m = document.getElementById("motto");
    if (m) { delete m.dataset.lit; initMotto(); }
    set("journey-items", R.journeyItems(CONTENT.journey, l));
    set("gallery-items", R.galleryItems(CONTENT.gallery, l));
    set("contact-rows", R.contactRows(CONTENT.site, l));
    applySite(l);
  }

  function initContent() {
    const tag = document.getElementById("content-data");
    const load = tag
      ? Promise.resolve(JSON.parse(tag.textContent))
      : Promise.all(["site", "about", "journey", "gallery"].map((n) => fetch(`content/${n}.json`).then((r) => r.json())))
          .then(([site, about, journey, gallery]) => ({ site, about, journey, gallery }));
    load.then((data) => {
      CONTENT = data;
      if (!hasStaticContent || lang !== "zh") renderAll(lang);
    }).catch((err) => console.warn("[site] 内容数据加载失败", err));
  }
  document.addEventListener("DOMContentLoaded", initContent);

  /* ================= 滚动显现 ================= */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("visible"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ================= 逐字点亮（关于页「生于此，归于斯」） ================= */
  const motto = document.getElementById("motto");
  function initMotto() {
    if (!motto) return;
    const lit = motto.dataset.lit === "1";
    const text = motto.textContent.trim();
    motto.innerHTML = text.split("").map((c) => `<span class="w">${c === " " ? " " : c}</span>`).join("");
    const words = motto.querySelectorAll(".w");
    if (lit) { words.forEach((s) => s.classList.add("on")); return; }
    const ioMotto = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        words.forEach((s, i) => setTimeout(() => s.classList.add("on"), i * 55));
        motto.dataset.lit = "1";
        ioMotto.disconnect();
      });
    }, { threshold: 0.5 });
    ioMotto.observe(motto);
  }
  initMotto();

  /* ================= 足迹筛选（仅足迹页） ================= */
  const tabs = document.querySelectorAll(".tab");
  if (tabs.length) {
    tabs.forEach((t) => t.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const cat = t.getAttribute("data-cat");
      document.querySelectorAll(".timeline-item").forEach((item) => {
        const show = cat === "all" || item.getAttribute("data-cat") === cat;
        item.style.display = show ? "" : "none";
      });
    }));
  }

  /* ================= 相册灯箱（仅相册页；委托绑定，重渲染后依旧可用） ================= */
  const masonry = document.getElementById("masonry");
  if (masonry) {
    const lightbox = document.getElementById("lightbox");
    const lbImg = document.getElementById("lightboxImg");
    const lbCap = document.getElementById("lightboxCaption");
    const figs = () => Array.from(masonry.querySelectorAll(".masonry-item"));
    let current = 0;
    const openLb = (i) => {
      const items = figs();
      if (!items.length) return;
      current = (i + items.length) % items.length;
      const fig = items[current];
      const img = fig.querySelector("img");
      lbImg.src = img.src;
      lbImg.alt = img.alt;
      lbCap.textContent = fig.querySelector("figcaption").textContent;
      lightbox.classList.add("open");
      lightbox.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    };
    const closeLb = () => {
      lightbox.classList.remove("open");
      lightbox.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };
    masonry.addEventListener("click", (e) => {
      const fig = e.target.closest(".masonry-item");
      if (fig) openLb(figs().indexOf(fig));
    });
    document.getElementById("lightboxClose").addEventListener("click", closeLb);
    document.getElementById("lightboxPrev").addEventListener("click", (e) => { e.stopPropagation(); openLb(current - 1); });
    document.getElementById("lightboxNext").addEventListener("click", (e) => { e.stopPropagation(); openLb(current + 1); });
    lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLb(); });
    document.addEventListener("keydown", (e) => {
      if (!lightbox.classList.contains("open")) return;
      if (e.key === "Escape") closeLb();
      if (e.key === "ArrowLeft") openLb(current - 1);
      if (e.key === "ArrowRight") openLb(current + 1);
    });
  }

  /* ================= 随笔列表（仅随笔页） ================= */
  function renderEssays() {
    const list = document.getElementById("essayList");
    if (!list) return;
    if (!ESSAYS.length) {
      list.innerHTML = `<p class="essays-empty" data-i18n="essaysEmpty">${I18N[lang].essaysEmpty}</p>`;
      return;
    }
    list.innerHTML = ESSAYS.map((e) => `
      <a class="essay-card reveal visible" href="${e.file}">
        <span class="essay-date">${e.date}</span>
        <span class="essay-tag">${e.tag[lang] || e.tag.zh}</span>
        <h3>${e.title[lang] || e.title.zh}</h3>
        <p>${e.excerpt[lang] || e.excerpt.zh}</p>
        <span class="essay-arrow">→</span>
      </a>`).join("");
  }
  renderEssays();

  /* ================= 首页：可拖拽的 5 件纸上物 ================= */
  const constellation = document.getElementById("constellation");
  const papers = constellation ? [...constellation.querySelectorAll(".paper")] : [];
  const orbVeil = document.getElementById("orbVeil");

  if (constellation && papers.length) {
    const SHELF_KEY = "shelf-pos-v2";

    function place(p, x, y, rot, delay) {
      p.style.left = x.toFixed(2) + "%";
      p.style.top = y.toFixed(2) + "%";
      p.style.setProperty("--r", rot.toFixed(2) + "deg");
      p.style.setProperty("--d", (delay * 0.14).toFixed(2) + "s");
      p.classList.add("placed");
    }
    function saveShelf() {
      const data = papers.map((q) => ({
        x: parseFloat(q.style.left),
        y: parseFloat(q.style.top),
        r: parseFloat(q.style.getPropertyValue("--r")) || 0,
      }));
      try { localStorage.setItem(SHELF_KEY, JSON.stringify(data)); } catch (e) {}
    }

    // 初次布点：3×2 网格分区 + 区内抖动，保证均匀铺满又每次不同
    function scatter() {
      const cols = 3, rows = 2;
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c });
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      papers.forEach((p, i) => {
        const cell = cells[i % cells.length];
        const cw = 100 / cols, rh = 100 / rows;
        const x = cell.c * cw + 2 + Math.random() * (cw - 26);
        const y = cell.r * rh + 4.5 + Math.random() * (rh - 42);
        place(p, x, y, Math.random() * 6 - 3, i);
      });
      try { localStorage.removeItem(SHELF_KEY); } catch (e) {}
    }

    // 用户摆过的位置优先恢复（架子会记住你的整理）
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SHELF_KEY) || "null"); } catch (e) {}
    if (saved && saved.length === papers.length) {
      saved.forEach((pos, i) => place(papers[i], pos.x, pos.y, pos.r, i));
    } else {
      scatter();
    }
    const reshuffleBtn = document.getElementById("reshuffle");
    if (reshuffleBtn) reshuffleBtn.addEventListener("click", scatter);

    // 拖拽 + 惯性；几乎没动 = 点击 → 渐进式失焦转场
    papers.forEach((p) => {
      let dragging = false, moved = 0;
      let startX, startY, origX, origY;
      let lastX, lastY, lastT, vx = 0, vy = 0, raf = 0;
      const cardW = () => (p.offsetWidth / window.innerWidth) * 100;
      const cardH = () => (p.offsetHeight / window.innerHeight) * 100;

      // 原生 <a> 点击一律吞掉：导航完全由 pointerup 里“移动距离”判定接管
      p.addEventListener("click", (e) => e.preventDefault());

      p.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        dragging = true; moved = 0;
        startX = e.clientX; startY = e.clientY;
        origX = parseFloat(p.style.left); origY = parseFloat(p.style.top);
        lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
        vx = 0; vy = 0;
        p.classList.add("dragging");
        p.setPointerCapture(e.pointerId);
        cancelAnimationFrame(raf);
        e.preventDefault();
      });

      p.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        moved = Math.max(moved, Math.hypot(dx, dy));
        const now = performance.now();
        vx = (e.clientX - lastX) / Math.max(1, now - lastT);
        vy = (e.clientY - lastY) / Math.max(1, now - lastT);
        lastX = e.clientX; lastY = e.clientY; lastT = now;
        let nx = origX + (dx / window.innerWidth) * 100;
        let ny = origY + (dy / window.innerHeight) * 100;
        nx = Math.min(100 - cardW() - 0.4, Math.max(0.4, nx));
        ny = Math.min(100 - cardH() - 0.4, Math.max(0.4, ny));
        p.style.left = nx + "%"; p.style.top = ny + "%";
        p.style.setProperty("--r", Math.max(-9, Math.min(9, vx * 45)).toFixed(2) + "deg");
      });

      p.addEventListener("pointerup", () => {
        if (!dragging) return;
        dragging = false;
        p.classList.remove("dragging");

        if (moved < 6) {
          // 点击 → 渐进式失焦转场
          const url = p.getAttribute("href");
          p.classList.add("defocus-keep");
          constellation.classList.add("defocus");
          orbVeil.classList.add("on");
          setTimeout(() => { window.location.href = url; }, 820);
          return;
        }

        // 惯性滑行 + 回正旋转，停下后记住位置
        let px = parseFloat(p.style.left), py = parseFloat(p.style.top);
        const rot0 = parseFloat(p.style.getPropertyValue("--r")) || 0;
        const glide = () => {
          px += vx * 16; py += vy * 16;
          vx *= 0.9; vy *= 0.9;
          px = Math.min(100 - cardW() - 0.4, Math.max(0.4, px));
          py = Math.min(100 - cardH() - 0.4, Math.max(0.4, py));
          p.style.left = px + "%"; p.style.top = py + "%";
          const target = Math.max(-9, Math.min(9, vx * 45));
          const cur = parseFloat(p.style.getPropertyValue("--r")) || 0;
          p.style.setProperty("--r", (cur + (target - cur) * 0.12).toFixed(2) + "deg");
          if (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02) {
            raf = requestAnimationFrame(glide);
          } else {
            p.style.setProperty("--r", rot0.toFixed(2) + "deg");
            saveShelf();
          }
        };
        raf = requestAnimationFrame(glide);
        saveShelf();
      });
    });
  }

  /* ================= 初始化 ================= */
  applyLang(lang);
})();
