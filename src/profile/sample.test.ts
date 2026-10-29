import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { profile as sample } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";

/** The colours added to the card album after the first eleven, as the 和色大辞典 (colordic.org/w) publishes them. */
const PUBLISHED: Record<string, string> = {
  藍白: "#ebf6f7",
  白花色: "#e8ecef",
  薄雲鼠: "#d4dcda",
  灰青: "#c0c6c9",
  千草鼠: "#bed3ca",
  秘色: "#abced8", // listed as 秘色色 (ひそくいろ)
  錫色: "#9ea1a3",
  湊鼠: "#80989b",
  錆浅葱: "#5c9291",
  舛花色: "#5b7e91",
  錆御納戸: "#53727d",
  鉄御納戸: "#455765",
  錆鼠: "#47585c",
  // the fourth side (brief r4 E5)
  白緑: "#d6e9ca",
  白群: "#83ccd2",
  浅縹: "#84b9cb",
  深川鼠: "#97a791",
  利休鼠: "#888e7e",
  薄花色: "#698aab",
  御召茶: "#43676b",
  藍色: "#165e83",
};

describe("the sample's card album", () => {
  const cards = sample.albums.cards;
  test("four full sides of eight", () => {
    expect(cards.length).toBe(32);
  });
  test("ids, names and colours are unique and well formed", () => {
    for (const key of ["id", "label", "nameLocal", "color"] as const) expect(new Set(cards.map((c) => c[key])).size).toBe(cards.length);
    for (const c of cards) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.label).toMatch(/^[A-Z][a-z]+$/);
      expect(c.nameLocal).toMatch(/^[一-鿿]+$/);
      expect(c.note).toMatch(/^[^.]+(\.[^.]+)*\.$/);
    }
  });
  test("the added colours carry their published hex", () => {
    const added = cards.slice(11);
    expect(added.map((c) => c.nameLocal)).toEqual(Object.keys(PUBLISHED));
    for (const c of added) expect(c.color).toBe(PUBLISHED[c.nameLocal!]!);
  });
  test("the Chinese sample has the same colours, each with its own Chinese note", () => {
    const zh = sampleZh.albums.cards;
    expect(zh.map(({ id, label, nameLocal, color }) => ({ id, label, nameLocal, color }))).toEqual(cards.map(({ id, label, nameLocal, color }) => ({ id, label, nameLocal, color })));
    for (const c of zh) expect(c.note).toMatch(/^[^a-zA-Z]*[一-鿿][^a-zA-Z]*。$/);
    expect(new Set(zh.map((c) => c.note)).size).toBe(zh.length);
  });
});

describe("the sample's postcard album", () => {
  const cards = sample.albums.postcards;
  const photos = join(import.meta.dir, "../../public/photos");
  test("two full sheets of six", () => {
    expect(cards.length).toBe(12);
  });
  test("every postcard is a real photograph in public/photos, credited in CREDITS.md and the manifest", () => {
    const credits = readFileSync(join(photos, "CREDITS.md"), "utf8");
    const manifest = JSON.parse(readFileSync(join(photos, "manifest.json"), "utf8")) as { file: string; photographer: string; source: string; license: string }[];
    expect(new Set(cards.map((c) => c.src)).size).toBe(cards.length);
    for (const c of cards) {
      expect(c.src).toMatch(/^photos\/[a-z0-9-]+\.jpg$/);
      expect(existsSync(join(photos, c.src!.slice("photos/".length)))).toBe(true);
      const row = manifest.find((m) => m.file === c.src);
      expect(row?.license).toBe("Unsplash License");
      expect(row?.source).toMatch(/^https:\/\/unsplash\.com\/photos\//);
      expect(c.credit).toBe(`Photo: ${row!.photographer} / Unsplash`);
      expect(credits).toContain(`\`${c.src!.slice("photos/".length)}\``);
      expect(c.message.trim().length).toBeGreaterThan(20);
    }
  });
  test("the Chinese sample has the same postcards, each in its own Chinese words", () => {
    const zh = sampleZh.albums.postcards;
    expect(zh.map(({ id, src, color, date, placeLocal }) => ({ id, src, color, date, placeLocal }))).toEqual(cards.map(({ id, src, color, date, placeLocal }) => ({ id, src, color, date, placeLocal })));
    zh.forEach((c, i) => {
      expect(c.message).not.toBe(cards[i]!.message);
      expect(c.message).toMatch(/[一-鿿]/);
      expect(c.place).toMatch(/[一-鿿]/);
      expect(c.credit).toMatch(/^摄影：/);
    });
  });
});

describe("the sample's spec rows", () => {
  test("languages are spelled out", () => {
    const rows = JSON.stringify(sample);
    expect(rows).toContain("English · 中文");
    expect(rows).not.toContain("EN · 中文");
  });
});
