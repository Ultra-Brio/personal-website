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
  if (burger) {
    burger.addEventListener("click", () => mobileMenu.classList.toggle("open"));
    mobileMenu.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => mobileMenu.classList.remove("open")));
  }
  // 高亮当前页
  const page = document.body.getAttribute("data-page");
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.getAttribute("data-nav") === page) a.classList.add("active");
  });

  /* ================= 配置渲染 ================= */
  if (typeof SITE_CONFIG !== "undefined") {
    document.querySelectorAll("[data-config-email]").forEach((el) => {
      if (el.tagName === "A") { el.href = "mailto:" + SITE_CONFIG.email; }
      el.textContent = SITE_CONFIG.email;
    });
    document.querySelectorAll("[data-config-location]").forEach((el) => {
      el.textContent = SITE_CONFIG.location[lang] || "";
    });
    // 其他联系方式列表（GitHub/微信/知乎/小红书，空的跳过）
    const other = document.getElementById("contactOther");
    if (other) {
      const items = [
        ["GitHub", SITE_CONFIG.github],
        ["微信 / 公众号", SITE_CONFIG.wechat],
        ["知乎", SITE_CONFIG.zhihu],
        ["小红书", SITE_CONFIG.xiaohongshu],
      ].filter(([, v]) => v);
      other.innerHTML = items.length
        ? items.map(([k, v]) =>
            v.startsWith("http")
              ? `<a class="contact-chip" href="${v}" target="_blank" rel="noopener">${k}</a>`
              : `<span class="contact-chip">${k} · ${v}</span>`).join("")
        : `<span class="contact-chip" style="opacity:.5">待补充（在 js/config.js 填写）</span>`;
    }
  }

  /* ================= 滚动显现 ================= */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("visible"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

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

  /* ================= 相册灯箱（仅相册页） ================= */
  const items = Array.from(document.querySelectorAll(".masonry-item"));
  if (items.length) {
    const lightbox = document.getElementById("lightbox");
    const lbImg = document.getElementById("lightboxImg");
    const lbCap = document.getElementById("lightboxCaption");
    let current = 0;
    const openLb = (i) => {
      current = (i + items.length) % items.length;
      const fig = items[current];
      lbImg.src = fig.querySelector("img").src;
      lbImg.alt = fig.querySelector("img").alt;
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
    items.forEach((fig, i) => fig.addEventListener("click", () => openLb(i)));
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

  /* ================= 首页星座导航 ================= */
  const constellation = document.getElementById("constellation");
  if (constellation) {
    const orbsEls = [...constellation.querySelectorAll(".orb")];

    // 每次打开随机生成互不重叠的模块位置
    const placed = [];
    let guard = 0;
    while (placed.length < orbsEls.length && guard < 800) {
      guard++;
      const x = 3 + Math.random() * 70;
      const y = 10 + Math.random() * 62;
      // 最小间距：横向约 19vw、纵向约 26vh，保证卡片互不挤压
      if (placed.every((p) => Math.hypot((p.x - x) * 1.4, p.y - y) > 26)) {
        placed.push({ x, y });
      }
    }
    orbsEls.forEach((orb, i) => {
      const p = placed[i] || { x: 4 + i * 19, y: 16 + (i % 2) * 44 };
      orb.style.left = p.x.toFixed(2) + "%";
      orb.style.top = p.y.toFixed(2) + "%";
      orb.style.setProperty("--r", (Math.random() * 5 - 2.5).toFixed(2) + "deg");
      orb.style.setProperty("--d", (Math.random() * 0.9).toFixed(2) + "s");
      orb.classList.add("placed");

      // 悬停模块时背景渐进虚化
      orb.addEventListener("mouseenter", () => constellation.classList.add("bg-blur"));
      orb.addEventListener("mouseleave", () => constellation.classList.remove("bg-blur"));
      orb.addEventListener("focus", () => constellation.classList.add("bg-blur"));
      orb.addEventListener("blur", () => constellation.classList.remove("bg-blur"));
    });
  }

  /* ================= 首页星座导航：点击模块的转场 ================= */
  const orbs = document.querySelectorAll(".orb");
  const orbVeil = document.getElementById("orbVeil");
  if (orbs.length && orbVeil) {
    orbs.forEach((orb) => {
      orb.addEventListener("click", (e) => {
        e.preventDefault();
        const url = orb.getAttribute("href");
        const r = orb.getBoundingClientRect();
        const clone = orb.cloneNode(true);
        clone.className = "orb-launch";
        clone.removeAttribute("href");
        Object.assign(clone.style, {
          left: r.left + "px", top: r.top + "px",
          width: r.width + "px", height: r.height + "px",
        });
        document.body.appendChild(clone);
        orbVeil.classList.add("on");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          Object.assign(clone.style, { left: "0px", top: "0px", width: "100vw", height: "100vh" });
        }));
        setTimeout(() => { window.location.href = url; }, 560);
      });
    });
  }

  /* ================= 初始化 ================= */
  applyLang(lang);
})();
