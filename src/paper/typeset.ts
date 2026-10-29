/*
 * Résumé typesetting: ResumeItem → A4 pages of draw operations in millimetres, then painted onto canvases.
 *
 * The page (sizes in cqw: 1 % of the page width; A4 is 210 mm wide, so 1 cqw = 2.1 mm): a running head in small tracked Zen Kaku
 * (the section labels are its only capitals: names and addresses never are) over a 0.25 cqw ink rule, the name in Shippori Mincho indented to the content column, sections on a 24 cqw label column
 * with hairlines between them, job lines "Role, Org" in Mincho with the Org at 600 and the years in Zen Kaku on the right, en-rule
 * bullets in Zen Kaku, inline skill lists, indexed link rows, a foot, and the owner's 藍 seal (落款) on the last page when there is
 * room for it. Cool inks on cool white stock; no italics anywhere.
 *
 * Chinese (and Japanese) text is set per character with kinsoku (src/print/kinsoku.ts): no line starts with ，。、；：？！」』）%
 * and none ends with 「『（; Latin words stay whole. A profile in Chinese (Owner.lang zh…, or a Chinese summary) gets Chinese
 * section labels and punctuation.
 *
 * Layout is pure (a measuring function is injected), so pagination is unit-tested without a DOM. One number, `scale`, sizes the
 * type: 1 is the printed sheet; the viewer raises it only when a single page is small on screen (a phone), and the text flows onto
 * more pages. Above `SINGLE_COLUMN` the label column folds into the text column so the measure stays readable.
 */
import { canvasFont, canvasFontLocal, hanLangOf, type HanLang } from "../fonts";
import { breakUnits, hasCjk, wrapUnits } from "../print/kinsoku";
import type { Link, ResumeItem } from "../profile/schema";

export const PAGE = { w: 210, h: 297 } as const;
/** 1 cqw of an A4 page, in millimetres */
const CQ = PAGE.w / 100;
/** Above this type scale the label column is dropped (labels sit above their section) */
export const SINGLE_COLUMN = 1.32;

/** The person: name, local name, role, place, handle, links, and the language they write in (Profile.lang). */
export type Owner = { name: string; nameLocal?: string; role?: string; location?: string; handle?: string; links?: Link[]; lang?: string };

/** Printed colours: cool inks on cool white, 藍 the one accent */
export const INK = {
  paper: "#f8f9f7",
  ink: "#1c232b",
  body: "#2e3946",
  role: "#384450",
  mute: "#56626d",
  faint: "#949fa9",
  rule: "#d3dae0",
  accent: "#2f4f73",
} as const;

/** serif = Shippori Mincho, sans = Zen Kaku Gothic New (Han in the SC faces for Chinese text; see src/fonts) */
export type Face = "serif" | "sans";
export type TextStyle = {
  face: Face;
  /** font size, mm */
  size: number;
  weight?: number;
  /** letter spacing, em */
  track?: number;
  color: string;
  caps?: boolean;
};
/** Width in mm of `text` set in `style` (size in mm). */
export type Measure = (text: string, style: TextStyle) => number;

export type Op =
  | { kind: "text"; x: number; y: number; text: string; style: TextStyle; align?: "left" | "right" }
  | { kind: "rule"; x: number; y: number; w: number; h: number; color: string };

export type ResumeLayout = { pages: Op[][]; scale: number; columns: 1 | 2; /** filled height of each page's text area, 0 … 1 */ fill: number[] };

/** The printed labels, in the language the résumé is written in. */
export type ResumeWords = { profile: string; experience: string; education: string; skills: string; languages: string; elsewhere: string; /** between a role and its organisation */ comma: string; /** between the name and the document's title in the foot */ dash: string };
const WORDS: Record<"en" | "zh", ResumeWords> = {
  en: { profile: "Profile", experience: "Experience", education: "Education", skills: "Skills", languages: "Languages", elsewhere: "Elsewhere", comma: ", ", dash: " — " },
  zh: { profile: "简介", experience: "工作经历", education: "教育", skills: "技能", languages: "语言", elsewhere: "联系", comma: "，", dash: " · " },
};

/** The résumé's language: the owner's, else Chinese when the résumé's own words are (a summary in Han without kana). */
export function resumeLang(item: ResumeItem, owner?: Owner): string | undefined {
  if (owner?.lang) return owner.lang;
  const sample = `${item.summary} ${item.experience[0]?.role ?? ""}`;
  return /\p{Script=Han}/u.test(sample) && hanLangOf(sample) !== "ja" ? "zh-CN" : undefined;
}
export function resumeWords(lang?: string): ResumeWords {
  return /^zh/i.test(lang ?? "") ? WORDS.zh : WORDS.en;
}

/**
 * Where the baseline sits in a line box. Every print face here has the same em box (Shippori, Zen Kaku, Klee One and the Noto SC
 * faces all report ascent 1.154 / descent 0.269 em in Chrome); the box is centred on the ideographic em box (−0.12 … 0.88 em), which
 * also centres Latin capitals, so Han and Latin lines sit the same in a line box.
 */
const METRICS = { a: 0.88, d: 0.12 };
const baseline = (st: TextStyle, lh: number) => st.size * ((lh - METRICS.a - METRICS.d) / 2 + METRICS.a);

/** A run of content that stays on one page: height (mm), its ops (y from the run's top), space before it (dropped at a page top). */
type Run = { h: number; ops: Op[]; before: number; /** keep with the next run */ keep: boolean; /** a section starts here (a preferred break) */ section?: boolean };

/** keep: one unit, never broken inside (an organisation's name), unless it is wider than a whole line */
type Span = { text: string; style: TextStyle; keep?: boolean };

/** Break text into lines no wider than `max` (mm). Latin breaks at spaces; CJK between characters, with kinsoku. */
export function wrap(text: string, st: TextStyle, max: number, measure: Measure): string[] {
  return wrapUnits(text, max, (s) => measure(s, st));
}

/**
 * wrap(), but never leaves one short word alone on the last line (CSS text-wrap: pretty): narrows the measure a little instead.
 * For CJK text, where every character is a break, only a very short last line counts as lonely.
 */
export function wrapPretty(text: string, st: TextStyle, max: number, measure: Measure): string[] {
  const base = wrap(text, st, max, measure);
  const lonely = (ls: string[]) => {
    if (ls.length < 2) return false;
    const last = ls[ls.length - 1]!;
    return hasCjk(last) ? measure(last, st) < 0.16 * max : !/\s/.test(last.trim()) || measure(last, st) < 0.22 * max;
  };
  if (!lonely(base)) return base;
  for (let k = 1; k <= 8; k++) {
    const ls = wrap(text, st, max * (1 - 0.025 * k), measure);
    if (ls.length > base.length) break;
    if (!lonely(ls)) return ls;
  }
  return base;
}

/** Lines of mixed-style spans (a job line "Role, Org"), broken between units; each line is a list of positioned pieces. */
function wrapSpans(spans: Span[], max: number, measure: Measure): { text: string; style: TextStyle; dx: number }[][] {
  const toks: Span[] = [];
  for (const s of spans) for (const t of s.keep && measure(s.text, s.style) <= max ? [s.text] : breakUnits(s.text)) toks.push({ text: t, style: s.style });
  const lines: { text: string; style: TextStyle; dx: number }[][] = [];
  let cur: { text: string; style: TextStyle; dx: number }[] = [];
  let x = 0;
  const flush = () => {
    // drop trailing spaces
    while (cur.length && /^\s+$/.test(cur[cur.length - 1]!.text)) cur.pop();
    if (cur.length) lines.push(cur);
    cur = [];
    x = 0;
  };
  for (const t of toks) {
    const space = /^\s+$/.test(t.text);
    if (space && !cur.length) continue;
    const w = measure(t.text, t.style);
    if (!space && cur.length && x + w > max) flush();
    cur.push({ text: t.text, style: t.style, dx: x });
    x += w;
  }
  flush();
  // merge neighbours of the same style back into one string per piece (fewer draw calls, real kerning inside a run)
  return lines.map((l) => {
    const out: { text: string; style: TextStyle; dx: number }[] = [];
    for (const p of l) {
      const last = out[out.length - 1];
      if (last && last.style === p.style) last.text += p.text;
      else out.push({ ...p });
    }
    return out;
  });
}

/** "mailto:hello@example.com" → "hello@example.com", "https://github.com/x" → "github.com/x" */
export function linkText(href: string): string {
  return href.replace(/^mailto:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Lay the résumé out on A4 pages.
 * scale: type scale (1 = print). owner: the person (name, local name, role, location, handle, links); without it the item's label heads the page.
 */
export function layoutResume(item: ResumeItem, owner: Owner | undefined, scale: number, measure: Measure): ResumeLayout {
  const s = Math.max(0.8, scale);
  const two = s <= SINGLE_COLUMN;
  const c = (v: number) => v * CQ;
  const t = (v: number) => v * CQ * s;
  // margins (§7.9.1: padding 9 / 8.5 / 7 cqw) give way a little as the type grows
  const x0 = two ? c(8.5) : Math.max(11, c(8.5) - (s - 1) * 12);
  const right = PAGE.w - x0;
  const padTop = two ? c(9) : Math.max(13, c(9) - (s - 1) * 10);
  const padBottom = two ? c(7) : Math.max(11, c(7) - (s - 1) * 6);
  const labelW = two ? c(24) : 0;
  const xc = x0 + labelW;
  const colW = right - xc;

  const name = owner?.name || item.label;
  const lang = resumeLang(item, owner);
  const W = resumeWords(lang);
  const zh = W === WORDS.zh;
  const st = (face: Face, size: number, color: string, extra: Partial<TextStyle> = {}): TextStyle => ({ face, size, color, ...extra });
  // section labels: Zen Kaku 500 in sentence case (Profile, Experience — as the page's own labels), 2.6 mm so they read in the detail
  // view; Chinese labels 3 mm, no tracking. The running head and foot at 2.3 mm (2.5 Chinese). No capitals anywhere on the page.
  const label = zh ? t(3 / CQ) : t(2.6 / CQ);
  const micro = t((zh ? 2.5 : 2.3) / CQ);
  const T = {
    // the running head carries a name and addresses: small, tracked, but never in capitals
    head: st("sans", micro, INK.mute, { weight: 500, track: 0.06 }),
    headName: st("sans", micro, INK.ink, { weight: 500, track: 0.06 }),
    name: st("serif", t(7.4), INK.ink, { weight: 500, track: hasCjk(name) ? 0.06 : -0.01 }),
    local: st("serif", t(7.4) * 0.5, INK.mute, { weight: 500, track: 0.08 }),
    role: st("serif", t(3), INK.role),
    label: st("sans", label, INK.mute, { weight: 500, track: zh ? 0 : 0.04 }),
    summary: st("serif", t(2.9), INK.ink),
    job: st("serif", t(2.75), INK.ink),
    org: st("serif", t(2.75), INK.ink, { weight: 600 }),
    years: st("sans", t(1.75), INK.mute),
    body: st("sans", t(2.05), INK.body, { track: zh ? 0.02 : 0.005 }),
    tag: st("sans", t(2.05), INK.ink, { track: zh ? 0.02 : 0.005 }),
    index: st("sans", t(1.75), INK.faint),
    key: st("sans", label, INK.mute, { weight: 500, track: zh ? 0 : 0.04 }),
    foot: st("sans", micro, INK.mute, { weight: 500, track: 0.06 }),
  };
  const LH = { head: 1.4, name: 1, role: 1.3, label: 1.4, summary: 1.42, job: 1.3, body: 1.5, link: 1.6, foot: 1 };
  const ruleH = c(0.12);
  const secTop = t(3);
  const secBottom = t(3.4);

  /* ── running head + foot geometry (the same on every page) ── */
  const headLine = T.head.size * LH.head;
  const headBase = padTop + baseline(T.head, LH.head);
  const headRule = padTop + headLine + t(2.4);
  const headRuleH = c(0.25);
  const contentTop = headRule + headRuleH + t(6);
  const footLine = T.foot.size * LH.foot;
  const footBase = PAGE.h - padBottom - footLine + baseline(T.foot, LH.foot);
  const footRule = PAGE.h - padBottom - footLine - t(2) - ruleH;
  const limit = footRule - c(1);

  const runs: Run[] = [];

  /* ── identity: the name (indented to the content column), the local name beside it, role and place ── */
  {
    const ops: Op[] = [];
    const nx = two ? xc : x0;
    const maxW = right - nx;
    let ns = T.name;
    const localGap = T.local.size * 0.7;
    const localW = owner?.nameLocal ? measure(owner.nameLocal, T.local) + localGap : 0;
    const nw = measure(name, ns);
    // a long name shrinks to fit its line (the local name still beside it) rather than wrapping
    if (nw + localW > maxW) ns = { ...ns, size: (ns.size * (maxW - localW)) / nw };
    const nameLine = ns.size * LH.name;
    const yb = baseline(ns, LH.name);
    ops.push({ kind: "text", x: nx, y: yb, text: name, style: ns });
    if (owner?.nameLocal) ops.push({ kind: "text", x: nx + measure(name, ns) + localGap, y: yb, text: owner.nameLocal, style: T.local });
    let y = nameLine + t(1.2);
    const role = [owner?.role, owner?.location].filter((v): v is string => !!v).join(W.comma);
    if (role) {
      const lines = wrap(role, T.role, maxW, measure);
      for (const l of lines) {
        ops.push({ kind: "text", x: nx, y: y + baseline(T.role, LH.role), text: l, style: T.role });
        y += T.role.size * LH.role;
      }
    }
    y += t(5);
    runs.push({ h: y, ops, before: 0, keep: true });
  }

  /** A section: hairline, label (left column, or above the content) and its blocks; the label keeps with the first block. */
  const section = (label: string, blocks: Run[]) => {
    if (!blocks.length) return;
    const first = blocks[0]!;
    const head: Op[] = [{ kind: "rule", x: x0, y: 0, w: right - x0, h: ruleH, color: INK.rule }];
    let lift: number;
    if (two) {
      // the label hangs in the left column, on the section's first line box (padding-top .5 cqw, §7.9.1)
      head.push({ kind: "text", x: x0, y: secTop + t(0.5) + baseline(T.label, LH.label), text: label, style: T.label });
      lift = secTop;
    } else {
      head.push({ kind: "text", x: x0, y: secTop + baseline(T.label, LH.label), text: label, style: T.label });
      lift = secTop + T.label.size * LH.label + t(1.6);
    }
    const merged: Run = { h: lift + first.h, ops: [...head, ...first.ops.map((o) => ({ ...o, y: o.y + lift }))], before: 0, keep: first.keep || blocks.length > 1, section: true };
    blocks[0] = merged;
    const last = blocks[blocks.length - 1]!;
    last.h += secBottom;
    runs.push(...blocks);
  };

  /** Paragraph lines as one run each; a two-line paragraph stays together, longer ones never leave a single line behind. */
  const paragraph = (lines: string[], stl: TextStyle, x: number, lh: number, before = 0, mark = false): Run[] => {
    const h = stl.size * lh;
    return lines.map((text, i) => {
      const ops: Op[] = [{ kind: "text", x, y: baseline(stl, lh), text, style: stl }];
      // the bullet: an en-rule at .72 em, 1.2 cqw × .14 cqw, in the faint ink
      if (mark && i === 0) ops.push({ kind: "rule", x: x - t(2.6), y: stl.size * 0.72 + (h - stl.size * lh) / 2, w: t(1.2), h: Math.max(0.12, t(0.14)), color: INK.faint });
      // no orphan (the first line keeps with the second) and no widow (the second-to-last keeps with the last)
      const n = lines.length;
      return { h, ops, before: i === 0 ? before : 0, keep: i < n - 1 && (i === 0 || i === n - 2) };
    });
  };

  /**
   * A job line: "Role, **Org**" in the serif (wrapping), the years on the right of its first line. The organisation is never broken
   * (no "Paperplane / Labs"): when it does not fit after the role it moves to the next line whole.
   */
  const jobLine = (role: string, org: string, years: string, before: number, keep: boolean): Run => {
    const yw = measure(years, T.years);
    const lines = wrapSpans(
      [
        { text: role ? `${role}${W.comma}` : "", style: T.job },
        { text: org, style: T.org, keep: true },
      ],
      colW - yw - t(2),
      measure,
    );
    const lh = T.job.size * LH.job;
    const ops: Op[] = [];
    const yb = baseline(T.job, LH.job);
    lines.forEach((l, i) => {
      for (const p of l) ops.push({ kind: "text", x: xc + p.dx, y: i * lh + yb, text: p.text, style: p.style });
    });
    ops.push({ kind: "text", x: right, y: yb, text: years, style: T.years, align: "right" });
    return { h: lines.length * lh, ops, before, keep };
  };

  /* ── profile ── */
  if (item.summary) section(W.profile, paragraph(wrapPretty(item.summary, T.summary, colW, measure), T.summary, xc, LH.summary));

  /* ── experience ── */
  {
    const blocks: Run[] = [];
    item.experience.forEach((e, i) => {
      blocks.push(jobLine(e.role, e.org, `${e.from} – ${e.to}`, i === 0 ? 0 : t(3.4), e.bullets.length > 0));
      e.bullets.forEach((b, j) => {
        const indent = t(2.6);
        const lines = paragraph(wrapPretty(b, T.body, colW - indent, measure), T.body, xc + indent, LH.body, j === 0 ? t(1) : 0, true);
        // a job's last bullet never starts a page alone: the one before keeps with it
        if (j === e.bullets.length - 2) lines[lines.length - 1]!.keep = true;
        blocks.push(...lines);
      });
    });
    section(W.experience, blocks);
  }

  /* ── education ── */
  section(
    W.education,
    item.education.map((e, i) => jobLine(e.degree, e.school, `${e.from} – ${e.to}`, i === 0 ? 0 : t(2.4), false)),
  );

  /** An inline list (skills, languages): items with 3.2 cqw between them, 1.2 cqw between rows */
  const tags = (items: string[]): Run[] => {
    const lineH = T.tag.size * LH.body;
    const rows: { text: string; x: number }[][] = [[]];
    let x = 0;
    for (const it of items) {
      const w = measure(it, T.tag);
      if (x > 0 && x + w > colW) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1]!.push({ text: it, x });
      x += w + t(3.2);
    }
    return rows.map((r, i) => ({ h: lineH, ops: r.map((p) => ({ kind: "text" as const, x: xc + p.x, y: baseline(T.tag, LH.body), text: p.text, style: T.tag })), before: i === 0 ? 0 : t(1.2), keep: i < rows.length - 1 }));
  };
  if (item.skills.length) section(W.skills, tags(item.skills));
  if (item.languages?.length) section(W.languages, tags(item.languages));

  /* ── elsewhere: indexed link rows (index · label · address), hairlines between ── */
  if (owner?.links?.length) {
    const lineH = Math.max(T.body.size * LH.body, T.key.size * LH.link);
    const pad = t(1.4);
    const yb = pad + baseline(T.body, lineH / T.body.size);
    const blocks: Run[] = owner.links.map((l, i) => {
      const ops: Op[] = [];
      if (i === 0) ops.push({ kind: "rule", x: xc, y: 0, w: colW, h: ruleH, color: INK.rule });
      ops.push({ kind: "text", x: xc, y: yb, text: String(i + 1).padStart(2, "0"), style: T.index });
      ops.push({ kind: "text", x: xc + t(6), y: yb, text: l.label, style: T.key });
      ops.push({ kind: "text", x: xc + t(22), y: yb, text: linkText(l.href), style: { ...T.body, color: INK.ink } });
      ops.push({ kind: "rule", x: xc, y: lineH + 2 * pad - ruleH, w: colW, h: ruleH, color: INK.rule });
      return { h: lineH + 2 * pad, ops, before: 0, keep: false };
    });
    section(W.elsewhere, blocks);
  }

  /* ── paginate: greedy fill, keeping chains together ── */
  const capacity = limit - contentTop;
  const paginate = (from: number, to: number, startTop = contentTop): { pages: { start: number; end: number; used: number }[] } => {
    const pages = [{ start: from, end: from, used: 0 }];
    let y = startTop;
    let i = from;
    while (i < to) {
      const r = runs[i]!;
      let need = r.h;
      for (let j = i; runs[j]!.keep && j + 1 < to; ) {
        j++;
        need += runs[j]!.before + runs[j]!.h;
      }
      // a chain taller than a page cannot stay together: fill it greedily
      if (need > capacity) need = r.h;
      const atTop = y === startTop;
      const before = atTop ? 0 : r.before;
      if (!atTop && y + before + need > limit) {
        pages.push({ start: i, end: i, used: 0 });
        y = startTop;
        continue;
      }
      y += before + r.h;
      const p = pages[pages.length - 1]!;
      p.end = i + 1;
      p.used = y - startTop;
      i++;
    }
    return { pages };
  };
  let { pages: plan } = paginate(0, runs.length);

  // no near-empty last page: if it holds less than a third of a page, move the start of the last page earlier — to a section
  // boundary when one keeps both pages reasonably full — as long as everything still fits
  if (plan.length >= 2) {
    const last = plan[plan.length - 1]!;
    const prev = plan[plan.length - 2]!;
    if (last.used < capacity / 3) {
      const height = (a: number, b: number) => {
        let h = 0;
        for (let k = a; k < b; k++) h += (k === a ? 0 : runs[k]!.before) + runs[k]!.h;
        return h;
      };
      // a new page starts at a section (a page that breaks a list of jobs in two reads as an accident); only when no section
      // boundary keeps both pages reasonably full, at any boundary that does
      const pick = (sectionsOnly: boolean) => {
        let at = -1;
        let bestScore = Infinity;
        for (let k = prev.start + 1; k < last.start; k++) {
          if (runs[k - 1]!.keep || (sectionsOnly && !runs[k]!.section)) continue;
          const a = height(prev.start, k);
          const b = height(k, last.end);
          if (b > capacity) continue;
          const score = Math.abs(a - b) - (runs[k]!.section ? capacity * 0.15 : 0);
          if (a >= capacity * 0.4 && score < bestScore) {
            bestScore = score;
            at = k;
          }
        }
        return at;
      };
      let best = pick(true);
      if (best < 0) best = pick(false);
      if (best > 0) {
        prev.end = best;
        prev.used = height(prev.start, best);
        last.start = best;
        last.used = height(best, last.end);
      }
    }
  }

  const pages: Op[][] = plan.map((p) => {
    const ops: Op[] = [];
    let y = contentTop;
    for (let k = p.start; k < p.end; k++) {
      const r = runs[k]!;
      if (k > p.start) y += r.before;
      for (const o of r.ops) ops.push({ ...o, y: y + o.y });
      y += r.h;
    }
    return ops;
  });

  /* ── running head, foot, seal ── */
  const n = pages.length;
  const email = owner?.links?.find((l) => l.href.startsWith("mailto:"));
  const web = owner?.links?.filter((l) => /^https?:/.test(l.href));
  const site = web?.find((l) => /site|web|home|portfolio|read\.cv/i.test(l.label)) ?? web?.[web.length - 1];
  const fill: number[] = plan.map((p) => Math.min(1, p.used / capacity));
  pages.forEach((ops, p) => {
    // page 1: name · site · email; later pages: name · place · handle
    const mid = p === 0 ? (site ? linkText(site.href) : owner?.location) : owner?.location;
    const end = p === 0 ? (email ? linkText(email.href) : owner?.handle) : owner?.handle;
    const head: Op[] = [{ kind: "text", x: x0, y: headBase, text: name, style: T.headName }];
    const endW = end ? measure(end, T.head) : 0;
    if (end) head.push({ kind: "text", x: right, y: headBase, text: end, style: T.head, align: "right" });
    const midX = two ? xc : x0 + measure(name, T.headName) + t(4);
    if (mid && midX + measure(mid, T.head) + t(3) < right - endW) head.push({ kind: "text", x: midX, y: headBase, text: mid, style: T.head });
    head.push({ kind: "rule", x: x0, y: headRule, w: right - x0, h: headRuleH, color: INK.ink });
    // foot
    head.push({ kind: "rule", x: x0, y: footRule, w: right - x0, h: ruleH, color: INK.rule });
    head.push({ kind: "text", x: x0, y: footBase, text: `${name}${W.dash}${item.label}`, style: T.foot });
    head.push({ kind: "text", x: right, y: footBase, text: `${p + 1} / ${n}`, style: T.foot, align: "right" });
    ops.unshift(...head);
  });
  return { pages, scale: s, columns: two ? 2 : 1, fill };
}

/* ── painting (DOM) ── */

/**
 * The canvas font of a style painted at `px` CSS px, for this text (its Han faces follow the text and the résumé's language).
 * `local`: only faces already in, never a download (the pouch's first paint, see canvasFontLocal).
 */
export function cssFont(st: TextStyle, px: number, text: string, lang?: string, local = false): string {
  return (local ? canvasFontLocal : canvasFont)(st.face, st.weight ?? 400, px, hanLangOf(text, lang));
}

type Ctx2D = CanvasRenderingContext2D & { letterSpacing?: string };

/** Draw one line of text at (x, y) (alphabetic baseline) with the style painted at `px` px. */
export function paintText(g: CanvasRenderingContext2D, text: string, x: number, y: number, st: TextStyle, px: number, lang?: string, align: CanvasTextAlign = "left", local = false) {
  const t = st.caps ? text.toUpperCase() : text;
  g.save();
  g.translate(x, y);
  g.font = cssFont(st, px, t, lang, local);
  if ("letterSpacing" in g) (g as Ctx2D).letterSpacing = `${((st.track ?? 0) * px).toFixed(3)}px`;
  g.fillStyle = st.color;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(t, 0, 0);
  g.restore();
}

/** A canvas measure: widths in mm for a style whose size is in mm (measured at 100 px and scaled). */
export function canvasMeasure(lang?: string, local = false): Measure {
  const g = document.createElement("canvas").getContext("2d")!;
  const cache = new Map<string, number>();
  return (text, st) => {
    const t = st.caps ? text.toUpperCase() : text;
    const key = `${st.face}|${st.weight ?? 400}|${st.track ?? 0}|${t}`;
    let w = cache.get(key);
    if (w === undefined) {
      g.font = cssFont(st, 100, t, lang, local);
      if ("letterSpacing" in g) (g as Ctx2D).letterSpacing = `${(st.track ?? 0) * 100}px`;
      w = g.measureText(t).width / 100;
      cache.set(key, w);
    }
    return w * st.size;
  };
}

/** Every string a layout paints, with its style: what ensureFonts must load before the pages are painted. */
export function layoutRuns(layout: ResumeLayout, lang?: string): { role: Face; weight: number; text: string; han: HanLang }[] {
  const by = new Map<string, { role: Face; weight: number; text: string; han: HanLang }>();
  for (const page of layout.pages)
    for (const o of page) {
      if (o.kind !== "text") continue;
      const text = o.style.caps ? o.text.toUpperCase() : o.text;
      if (!text.trim()) continue;
      const role: Face = o.style.face;
      const weight = o.style.weight ?? 400;
      const han = hanLangOf(text, lang);
      const key = `${role}|${weight}|${han}`;
      const r = by.get(key);
      if (r) r.text += text;
      else by.set(key, { role, weight, text, han });
    }
  return [...by.values()];
}

/** Deterministic PRNG (mulberry32) so the paper fibres are the same every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blank paper: a cool white with very faint mottling and fibres (the relief itself is the normal map). */
export function paintPaper(g: CanvasRenderingContext2D, w: number, h: number, seed: number, base: string = INK.paper) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const k = w / 1000;
  // the paper's formation: fibre clumps as a soft, low-contrast cloud (value noise drawn up smoothly and blurred), felt rather than
  // seen; two scales, ~6 mm and ~20 mm. Drawn shapes (discs, blots) read as dirt, so there are none.
  const cloud = (cells: number, amp: number) => {
    const cw = cells;
    const ch = Math.max(2, Math.round((cells * h) / w));
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const cg = c.getContext("2d");
    if (!cg) return;
    const img = cg.createImageData(cw, ch);
    for (let i = 0; i < cw * ch; i++) {
      img.data[i * 4] = 96;
      img.data[i * 4 + 1] = 104;
      img.data[i * 4 + 2] = 110;
      img.data[i * 4 + 3] = Math.round(r() * amp * 255);
    }
    cg.putImageData(img, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    if ("filter" in g) g.filter = `blur(${((w / cells) * 0.45).toFixed(1)}px)`;
    g.drawImage(c, 0, 0, w, h);
    g.restore();
  };
  cloud(36, 0.028);
  cloud(11, 0.024);
  // fibres
  g.lineCap = "round";
  for (let i = 0; i < 2200; i++) {
    const x = r() * w;
    const y = r() * h;
    const l = (2 + r() * 7) * k;
    const a = r() * Math.PI;
    g.strokeStyle = r() < 0.55 ? "rgba(80,92,104,0.04)" : "rgba(255,255,255,0.28)";
    g.lineWidth = Math.max(0.6, 0.7 * k);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}

/** Draw a page's ops onto a canvas context at `px` pixels per millimetre (`local`: see cssFont). */
export function paintOps(g: CanvasRenderingContext2D, ops: Op[], px: number, lang?: string, local = false) {
  for (const o of ops) {
    if (o.kind === "rule") {
      g.fillStyle = o.color;
      g.fillRect(o.x * px, o.y * px, o.w * px, Math.max(1, o.h * px));
      continue;
    }
    paintText(g, o.text, o.x * px, o.y * px, o.style, o.style.size * px, lang, o.align ?? "left", local);
  }
}

/** Paint every page of a layout; returns one canvas per page, `heightPx` tall (A4 proportions). */
export function paintResume(layout: ResumeLayout, heightPx: number, lang?: string, seed = 7): HTMLCanvasElement[] {
  const H = Math.round(heightPx);
  const W = Math.round((H * PAGE.w) / PAGE.h);
  const px = H / PAGE.h;
  return layout.pages.map((ops, i) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    paintPaper(g, W, H, seed + i * 101);
    paintOps(g, ops, px, lang);
    return c;
  });
}
