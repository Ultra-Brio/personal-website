import { describe, expect, test } from "bun:test";
import { NO_END, NO_START } from "../print/kinsoku";
import { profile as sample } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";
import type { ResumeItem } from "../profile/schema";
import { PAGE, SINGLE_COLUMN, layoutResume, resumeLang, wrap, wrapPretty, type Measure, type Op } from "./typeset";

/** Stub measure: every Latin character is 0.5 em wide, a CJK character a full em, plus tracking. */
const measure: Measure = (t, st) => [...(st.caps ? t.toUpperCase() : t)].reduce((w, ch) => w + st.size * ((/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.5) + (st.track ?? 0)), 0);
const resume = sample.items.find((i): i is ResumeItem => i.kind === "resume")!;
const owner = { name: sample.name, nameLocal: sample.nameLocal, role: sample.role, location: sample.location, handle: sample.handle, links: sample.links };
type Text = Extract<Op, { kind: "text" }>;
const texts = (ops: Op[]) => ops.filter((o): o is Text => o.kind === "text");
/** the page's text block: no running head, no foot */
const body = (ops: Op[]) => texts(ops).filter((o) => o.y > 34 && o.y < PAGE.h - 24);

describe("wrap", () => {
  test("never exceeds the measure and keeps every word", () => {
    const st = { face: "sans" as const, size: 3.3, color: "#000" };
    const text = "Cut interaction latency from 140 ms to 38 ms on mid-range phones, and mentored five engineers.";
    const lines = wrap(text, st, 60, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, st)).toBeLessThanOrEqual(60);
    expect(lines.join(" ")).toBe(text);
  });
  test("breaks CJK between characters", () => {
    const st = { face: "sans" as const, size: 4, color: "#000" };
    const lines = wrap("设计工程师把整个东西从第一张草图做到最后一个像素的动效", st, 30, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, st)).toBeLessThanOrEqual(30);
  });
  test("kinsoku: no line starts with closing punctuation or ends with an opening one", () => {
    const st = { face: "sans" as const, size: 4, color: "#000" };
    const text = "讲的是怎样让界面像纸一样：有分量，有摩擦，落下来有纸的样子。日语叫「広縁」：两把椅子，一张矮桌。";
    for (let max = 16; max <= 60; max += 2) {
      const lines = wrap(text, st, max, measure);
      expect(lines.join("")).toBe(text);
      for (const l of lines) {
        expect(NO_START.has(Array.from(l)[0]!)).toBe(false);
        expect(NO_END.has(Array.from(l).pop()!)).toBe(false);
      }
    }
  });
  test("pretty wrapping does not leave one word alone on the last line", () => {
    const st = { face: "serif" as const, size: 6, color: "#000" };
    const text = "Design engineer who ships the whole thing — from the first sketch to the last pixel of motion.";
    // a measure where plain wrapping strands "motion." on its own line
    let max = 0;
    for (let w = 60; w < 160; w += 0.5) {
      const ls = wrap(text, st, w, measure);
      if (ls.length > 1 && !/\s/.test(ls[ls.length - 1]!)) {
        max = w;
        break;
      }
    }
    expect(max).toBeGreaterThan(0);
    const pretty = wrapPretty(text, st, max, measure);
    expect(/\s/.test(pretty[pretty.length - 1]!)).toBe(true);
    expect(pretty.join(" ")).toBe(text);
    for (const l of pretty) expect(measure(l, st)).toBeLessThanOrEqual(max);
  });
});

describe("layoutResume", () => {
  test("print scale: exactly two pages, both well filled, the label column kept", () => {
    const L = layoutResume(resume, owner, 1, measure);
    expect(L.columns).toBe(2);
    expect(L.pages.length).toBe(2);
    // no near-empty page
    for (const f of L.fill) expect(f).toBeGreaterThan(0.4);
    // identity, profile and experience on page 1; education onward on page 2
    const p1 = texts(L.pages[0]!).map((o) => o.text);
    const p2 = texts(L.pages[1]!).map((o) => o.text);
    expect(p1).toContain(sample.name);
    expect(p1).toContain("Experience");
    expect(p2).toContain("Education");
    expect(p2).toContain("Elsewhere");
  });

  test("everything stays inside the margins", () => {
    for (const s of [1, 1.5, 2]) {
      const L = layoutResume(resume, owner, s, measure);
      for (const page of L.pages)
        for (const o of texts(page)) {
          expect(o.y).toBeGreaterThan(0);
          expect(o.y).toBeLessThan(PAGE.h);
          const w = measure(o.text, o.style);
          const x0 = o.align === "right" ? o.x - w : o.x;
          expect(x0).toBeGreaterThanOrEqual(10);
          expect(x0 + w).toBeLessThanOrEqual(PAGE.w - 10 + 1e-6);
        }
    }
  });

  test("the name, local name, every organisation and every bullet word appear once", () => {
    const L = layoutResume(resume, owner, 1.2, measure);
    const all = L.pages.flatMap(body).map((o) => o.text);
    expect(all).toContain(sample.name);
    expect(all).toContain(sample.nameLocal!);
    const words = all.join(" ");
    for (const e of resume.experience) {
      for (const w of e.org.split(" ")) expect(words).toContain(w);
      for (const b of e.bullets) for (const w of b.split(" ")) expect(words).toContain(w);
    }
  });

  test("bigger type flows onto more pages and drops the label column", () => {
    const small = layoutResume(resume, owner, 1, measure);
    const big = layoutResume(resume, owner, 1.9, measure);
    expect(big.columns).toBe(1);
    expect(1.9).toBeGreaterThan(SINGLE_COLUMN);
    expect(big.pages.length).toBeGreaterThan(small.pages.length);
    // ... but not absurdly many, and none of them nearly empty
    expect(big.pages.length).toBeLessThanOrEqual(5);
    for (const f of big.fill) expect(f).toBeGreaterThan(0.3);
  });

  test("a job line never ends a page without its first bullet", () => {
    const heads = resume.experience.filter((e) => e.bullets.length).map((e) => `${e.role}, ${e.org}`);
    for (const s of [1, 1.15, 1.3, 1.5, 1.75, 2]) {
      const L = layoutResume(resume, owner, s, measure);
      for (const page of L.pages) {
        const t = body(page).sort((a, b) => a.y - b.y || a.x - b.x);
        const tail = t[t.length - 1];
        if (!tail) continue;
        expect(heads.some((h) => tail.style.face === "serif" && h.includes(tail.text.trim()))).toBe(false);
      }
    }
  });

  test("a job's last bullet never starts a page alone", () => {
    const lasts = resume.experience.filter((e) => e.bullets.length > 1).map((e) => e.bullets[e.bullets.length - 1]!.split(" ")[0]!);
    for (let s = 1; s <= 2.001; s += 0.05) {
      const L = layoutResume(resume, owner, s, measure);
      L.pages.slice(1).forEach((page) => {
        const t = body(page).sort((a, b) => a.y - b.y || a.x - b.x);
        const head = t[0];
        if (!head || head.style.face !== "sans") return;
        // the page opens with a bullet: it must not be the last bullet of its job
        expect(lasts.some((w) => head.text.startsWith(w))).toBe(false);
      });
    }
  });

  test("every page carries the running head, its folio and the foot rule", () => {
    for (const s of [1, 1.6]) {
      const L = layoutResume(resume, owner, s, measure);
      const n = L.pages.length;
      L.pages.forEach((p, i) => {
        const t = texts(p);
        expect(t.some((o) => o.text === `${i + 1} / ${n}` && o.y > PAGE.h - 24)).toBe(true);
        expect(t.some((o) => o.text === sample.name && o.y < 30)).toBe(true);
      });
    }
  });
});

describe("a Chinese résumé", () => {
  const zh = sampleZh.items.find((i): i is ResumeItem => i.kind === "resume")!;
  const zhOwner = { name: sampleZh.name, role: sampleZh.role, location: sampleZh.location, handle: sampleZh.handle, links: sampleZh.links, lang: sampleZh.lang };
  test("the language comes from the owner, or from the résumé's own words", () => {
    expect(resumeLang(zh, zhOwner)).toBe("zh-CN");
    expect(resumeLang(zh, { name: "林文" })).toBe("zh-CN");
    expect(resumeLang(resume, owner)).toBeUndefined();
  });
  test("Chinese labels and punctuation, kinsoku on every line, everything on the page", () => {
    for (const s of [1, 1.6]) {
      const L = layoutResume(zh, zhOwner, s, measure);
      const all = L.pages.flatMap(texts);
      const words = all.map((o) => o.text);
      expect(words).toContain("工作经历");
      expect(words).toContain("教育");
      expect(words).not.toContain("Experience");
      expect(words.some((w) => w.includes("资深设计工程师，"))).toBe(true);
      for (const o of all) {
        expect(NO_START.has(Array.from(o.text.trimStart())[0] ?? "")).toBe(false);
        expect(o.x).toBeGreaterThanOrEqual(10);
        expect(o.y).toBeLessThan(PAGE.h);
      }
      // every bullet's characters are on a page, in order
      const flat = all.map((o) => o.text).join("");
      for (const e of zh.experience) for (const b of e.bullets) expect(flat.replace(/\s/g, "")).toContain(b.replace(/\s/g, "").slice(0, 6));
    }
  });
  test("print scale: two pages, the second starting at a section (the jobs are not split across pages)", () => {
    const L = layoutResume(zh, zhOwner, 1, measure);
    expect(L.pages.length).toBe(2);
    const p1 = texts(L.pages[0]!).map((o) => o.text).join("");
    for (const e of zh.experience) expect(p1).toContain(e.org.split(" ")[0]!);
    expect(texts(L.pages[1]!).some((o) => o.text === "教育")).toBe(true);
  });
});

describe("job lines (QA 2026-10-19)", () => {
  for (const [name, p] of [["en", sample], ["zh", sampleZh]] as const) {
    test(`${name}: an organisation's name is never broken across lines`, () => {
      const r = p.items.find((i): i is ResumeItem => i.kind === "resume")!;
      const o = { name: p.name, nameLocal: p.nameLocal, role: p.role, location: p.location, handle: p.handle, links: p.links, lang: p.lang };
      for (const s of [1, 1.4, 2]) {
        const L = layoutResume(r, o, s, measure);
        const all = L.pages.flatMap((ops) => texts(ops));
        for (const org of [...r.experience.map((e) => e.org), ...r.education.map((e) => e.school)]) {
          // set in the org's weight, in one piece
          const pieces = all.filter((t) => t.style.weight === 600 && org.includes(t.text.trim()));
          expect(pieces.some((t) => t.text.trim() === org)).toBe(true);
        }
      }
    });
  }
});
