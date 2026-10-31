import type { Profile } from "../src/profile/schema";

/*
 * Xiang Bo, in English (`?lang=en`; the Chinese one lives in zh.ts). Every fact here comes from the person's own pages
 * (about / journey / essays / gallery / contact) — nothing is invented. Each pouch thing carries an `href`: tapping it
 * goes to that page of the site, so the five things in the pouch are the site's five modules, one to one:
 *   business card → 联络 Contact · résumé → 关于 About · ticket → 足迹 Journey · polaroid → 相册 Gallery · note → 随笔 Essays
 * Picture paths are relative to the page ("photos/…", no leading slash), so the site works at a domain root and under
 * a sub-path. The albums are empty for now: the desk shows the folio alone until real pictures are chosen.
 */

export const profile: Profile = {
  name: "Xiang Bo",
  nameLocal: "向博",
  handle: "@Ultra-Brio",
  role: "Antai College of Economics & Management, SJTU",
  location: "Shanghai",
  timezone: "Asia/Shanghai",
  bio: "I study economics & management at Shanghai Jiao Tong University. Writing, volunteering and financial markets are the three threads of my life — this site is a corner I built for myself: for experiences, photos, and some serious thoughts.",
  coverTitle: "Xiang Bo — Folio",
  seal: null,
  source: "https://github.com/Ultra-Brio/personal-website",
  links: [
    { label: "Email", href: "mailto:xangbo@163.com" },
    { label: "GitHub", href: "https://github.com/Ultra-Brio" },
  ],
  items: [
    {
      kind: "card",
      id: "card",
      label: "Business card",
      href: "contact.html",
      links: [{ label: "Open Contact", href: "contact.html" }],
      anecdote: "A card not yet sent to the printer: every row on it is a way to reach me.",
      story: "Whether about finance, medicine, volunteering, or just a chat — feel free to write to me. I read every letter.",
      specs: [
        { k: "Programme", v: "Economics Management Experimental Class" },
        { k: "Class of", v: "2025" },
        { k: "Base", v: "Shanghai · from Yibin, Sichuan" },
      ],
      front: { name: "Xiang Bo", role: "Antai College of Economics & Management", tagline: "Record seriously, live seriously" },
      inside: [
        { k: "Email", v: "xangbo@163.com" },
        { k: "GitHub", v: "github.com/Ultra-Brio" },
        { k: "Based", v: "Shanghai · UTC+8" },
      ],
      insideNote: "Writing, volunteering and financial markets — the three threads of my life.",
    },
    {
      kind: "resume",
      id: "resume",
      label: "Résumé",
      href: "about.html",
      links: [{ label: "Open About", href: "about.html" }],
      anecdote: "One page for the work; the About page holds what a page cannot.",
      story: "I began in clinical medicine and moved to Antai for economics & management; the mountain roads and rivers of Yibin shaped how I see the world. Who I am and what I care about lives on the About page.",
      specs: [
        { k: "Updated", v: "2026" },
        { k: "Languages", v: "中文 · English" },
      ],
      summary: "Antai undergraduate with a medical-school beginning, doing industry research and investment.",
      experience: [
        {
          org: "Jinding Capital",
          role: "CVC investment intern",
          from: "2026.06",
          to: "2026.08",
          bullets: ["Researched the upstream AI computing industry: technical roadmaps and competitive landscapes of 3D AI-inference chip and compute-in-memory companies.", "Contributed to project proposals and investment-committee materials for two companies."],
        },
        {
          org: "Industrial Securities",
          role: "Equity research intern",
          from: "2026.02",
          to: "2026.06",
          bullets: ["Tracked AI large-model, computing-power and application sectors.", "Built a fund knowledge base and AI research skills; contributed to weekly reports, earnings notes and roadshow decks."],
        },
        {
          org: "SJTU Medical School Youth League Committee",
          role: "Head of Organisation & Personnel",
          from: "2026.09",
          to: "Now",
          bullets: ["Planned and hosted Young Marxists Programme events for 100+ students; rated a university-level best case.", "A science-popularisation article on “headphone illness” won first prize in the Medical School contest."],
        },
      ],
      education: [{ school: "Shanghai Jiao Tong University · Antai College of Economics & Management", degree: "Economics Management Experimental Class (GPA 4.0/4.3, ranked 1/39)", from: "2026", to: "2030" }],
      skills: ["Industry research", "Company analysis", "Investment writing", "Python (NumPy, Pandas)", "Science writing", "Information curation"],
      languages: ["中文", "English (CET-6 609)"],
    },
    {
      kind: "ticket",
      id: "ticket",
      label: "Ticket",
      href: "journey.html",
      links: [{ label: "Open Journey", href: "journey.html" }],
      anecdote: "Five talks at my high school: 8 classes, and 400+ students joined the community.",
      story: "I stood at my alma mater's lectern five times — about SJTU, about medicine, about changing majors, and about turning an idea into a team.",
      event: "Campus talks by outstanding alumni",
      date: "2026-01-16",
      time: "14:00",
      venue: "Lecture hall, my high school",
      city: "Yibin",
      seat: "Team leader / Speaker",
      serial: "No. 0526",
    },
    {
      kind: "polaroid",
      id: "polaroid",
      label: "Polaroid",
      href: "gallery.html",
      links: [{ label: "Open Gallery", href: "gallery.html" }],
      anecdote: "The homepage's own background: a plane landing right over the neon sign.",
      story: "Everything I want the homepage to feel is in this picture — the sky between day and dark, the city lights just coming on. It sits at the door; the rest of the moments are in the gallery.",
      caption: "Los Angeles · dusk",
      image: "photos/polaroid-dusk.jpg",
      tint: "#c9d3da",
      place: "Los Angeles",
      date: "2026-10-29",
      back: "The gallery keeps moments like this one.",
    },
    {
      kind: "note",
      id: "note",
      label: "A note",
      href: "essays.html",
      links: [{ label: "Open Essays", href: "essays.html" }],
      anecdote: "A 一筆箋 holds a few lines: shorter than a letter, kinder than a text.",
      text: "Write slowly, let go slowly. The first essay is in — on why I wanted a corner of my own.",
      from: "Xiang Bo",
      date: "2026-10-29",
    },
  ],
  albums: {
    cards: [],
    postcards: [],
  },
};
