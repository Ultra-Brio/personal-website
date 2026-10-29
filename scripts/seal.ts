/*
 * bun run seal [name] — cuts the bookplate's name seal in small seal script (小篆) and writes profile/seal.ts.
 *
 * The name is the primary profile's Han name (nameLocal, or a name written in Han characters), or the argument. The seal carries
 * the same glyphs as the typeset one (src/print/seal.ts sealChars): a 2-character name gains 之印, 3 gain 印, 4 are used as they
 * are; a 2-character name whose 之 has no seal form is cut as name + 印.
 *
 * Each character is looked up the way OpenCC's s2seal does it (STCharacters → SealVariants → SealCharacters reversed: modern
 * forms → the 說文解字 headword's code point in the Unicode 18 Seal block) and its outline is taken from the Kaiyuan Small Seal
 * (開元小篆) glyph sources, traced from public-domain editions of the 說文 and licensed under the SIL OFL 1.1 — so profile/seal.ts
 * carries their notice, and profile/seal-OFL.txt the licence. Both sources are pinned to a commit and fetched over the network.
 *
 * A character with no seal form (many characters postdate the 說文: 劉, 们 …) leaves the seal typeset: the file is written with
 * `seal = null`, and the bookplate cuts the name in the serif as before.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const KAIYUAN = "https://raw.githubusercontent.com/frankslin/kaiyuan-small-seal-font/97433695858330ec9fdb7de9c4604da2f635eba6";
const OPENCC = "https://raw.githubusercontent.com/BYVoid/OpenCC/bcf847cf3fbd79c74779567f9a491ea8ab878183/data/dictionary";
const OUT = join(import.meta.dir, "..", "profile", "seal.ts");

type Box = [number, number, number, number];

async function text(url: string): Promise<string | null> {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

/** An OpenCC dictionary as key → values; `reverse` maps each value back to its keys (in file order, @reverse-prefer first). */
async function dict(file: string, reverse = false): Promise<Map<string, string[]>> {
  const src = (await text(`${OPENCC}/${file}`))!;
  const m = new Map<string, string[]>();
  const add = (k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const line of src.split("\n")) {
    const pre = line.match(/^# @reverse-prefer:\s*(\S+)\s+(\S+)/u);
    if (pre && reverse) m.set(pre[1]!, [pre[2]!]);
    if (!line || line.startsWith("#")) continue;
    const [k, vs] = line.split("\t");
    for (const v of vs!.split(" ").filter(Boolean)) {
      if (!reverse) add(k!, v);
      else if (!m.get(v)?.includes(k!)) add(v, k!);
    }
  }
  return m;
}

/** The Han name the seal is cut from: as src/print/seal.ts sealName */
async function profileName(): Promise<string | undefined> {
  const { folio } = await import("../profile");
  const p = folio.profiles[folio.primary];
  const m = typeof p === "function" ? await p() : p!;
  const prof = "default" in m ? m.default : m;
  const latin = prof.name;
  return prof.nameLocal || (/\p{Script=Han}/u.test(latin) && !/[A-Za-z]/.test(latin) ? latin : undefined);
}

/** The bounding box of an SVG path (absolute M L H V C Q Z only; curves sampled) */
function boxOf(d: string): Box {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0, cmd = "";
  const pt = (x: number, y: number) => ((x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y)));
  const num = () => Number(tokens.shift());
  while (tokens.length) {
    if (/[A-Za-z]/.test(tokens[0]!)) cmd = tokens.shift()!;
    if (cmd === "Z") continue;
    if (cmd === "M" || cmd === "L") (cx = num()), (cy = num()), pt(cx, cy);
    else if (cmd === "H") (cx = num()), pt(cx, cy);
    else if (cmd === "V") (cy = num()), pt(cx, cy);
    else if (cmd === "C" || cmd === "Q") {
      const p = cmd === "C" ? [cx, cy, num(), num(), num(), num(), num(), num()] : [cx, cy, num(), num(), num(), num()];
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        if (cmd === "C") pt(u * u * u * p[0]! + 3 * u * u * t * p[2]! + 3 * u * t * t * p[4]! + t * t * t * p[6]!, u * u * u * p[1]! + 3 * u * u * t * p[3]! + 3 * u * t * t * p[5]! + t * t * t * p[7]!);
        else pt(u * u * p[0]! + 2 * u * t * p[2]! + t * t * p[4]!, u * u * p[1]! + 2 * u * t * p[3]! + t * t * p[5]!);
      }
      (cx = p[p.length - 2]!), (cy = p[p.length - 1]!);
    } else throw new Error(`path command ${cmd} is not handled`);
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return [r(x0), r(y0), r(x1 - x0), r(y1 - y0)];
}

const name = (process.argv[2] ?? (await profileName()))?.replace(/\s+/g, "");
const han = Array.from(name ?? "").filter((c) => /\p{Script=Han}/u.test(c));
if (!name || han.length !== Array.from(name).length) {
  console.log(`No Han name${name ? ` (${name})` : ""}: the seal stays typeset.`);
  write(null, name ?? "");
  process.exit(0);
}

const [st, variants, seals] = await Promise.all([dict("STCharacters.txt"), dict("SealVariants.txt"), dict("SealCharacters.txt", true)]);
const glyphs = new Map<string, { d: string; box: Box } | null>();
/** A character's seal outline: the character itself, its traditional form, then their 說文 variants, the first with a traced glyph */
async function glyph(c: string) {
  if (glyphs.has(c)) return glyphs.get(c)!;
  const forms = [c, ...(st.get(c) ?? [])];
  for (const f of [...forms]) forms.push(...(variants.get(f) ?? []));
  let found: { d: string; box: Box } | null = null;
  for (const f of forms) {
    for (const s of seals.get(f) ?? []) {
      const svg = await text(`${KAIYUAN}/glyphs/u${s.codePointAt(0)!.toString(16).toUpperCase()}.svg`);
      const d = svg ? [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]).join(" ") : "";
      if (d) {
        found = { d, box: boxOf(d) };
        break;
      }
    }
    if (found) break;
  }
  glyphs.set(c, found);
  return found;
}

const full = han.length >= 4 ? han.slice(0, 4) : han.length === 3 ? [...han, "印"] : han.length === 2 ? [...han, "之", "印"] : han;
const chars = han.length === 2 && !(await glyph("之")) ? [...han, "印"] : full;
const missing: string[] = [];
for (const c of chars) if (!(await glyph(c))) missing.push(c);
if (missing.length) {
  console.log(`No small seal form for ${missing.join(" ")}: the seal of ${name} stays typeset.`);
  write(null, name);
} else {
  write(chars, name);
  console.log(`Cut ${chars.join("")} in small seal script → profile/seal.ts`);
}

function write(cut: string[] | null, nm: string) {
  const art = cut ? { name: nm, glyphs: cut.map((c) => ({ char: c, ...glyphs.get(c)! })) } : null;
  writeFileSync(
    OUT,
    `/*
 * The bookplate's name seal in small seal script (小篆), written by \`bun run seal\` (scripts/seal.ts) — run it again after changing
 * your name; until then the bookplate cuts the name in the serif. null: no seal form for the name (see the script).
${art ? ` *
 * Glyph outlines from Kaiyuan Small Seal (開元小篆), https://github.com/frankslin/kaiyuan-small-seal-font
 * Copyright (c) 2026 Kaiyuan Small Seal Font Contributors. Licensed under the SIL Open Font License 1.1 (profile/seal-OFL.txt),
 * not the AGPL: this file's glyph data stays under the OFL.
` : ""} */
import type { SealArt } from "../src/profile/schema";

export const seal: SealArt | null = ${art ? `{
  name: ${JSON.stringify(art.name)},
  glyphs: [
${art.glyphs.map((g) => `    { char: ${JSON.stringify(g.char)}, box: ${JSON.stringify(g.box)}, d: ${JSON.stringify(g.d)} },`).join("\n")}
  ],
}` : "null"};
`,
  );
}
