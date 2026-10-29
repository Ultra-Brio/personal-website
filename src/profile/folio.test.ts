import { describe, expect, test } from "bun:test";
import { folioLangs, langName, loadedProfile, loadProfile, matchLang, pickLang, shapeDiff, toFolio, type Folio } from "./folio";
import { folio as sampleFolio } from "../../profile";
import { profile as sample } from "../../profile/en";
import { profileZh as sampleZh } from "../../profile/zh";

const two: Folio = { primary: "en", profiles: { en: sample, zh: async () => sampleZh } };

describe("languages", () => {
  test("the primary first, then the rest as written", () => {
    expect(folioLangs(two)).toEqual(["en", "zh"]);
    expect(folioLangs({ primary: "zh", profiles: { en: sample, zh: sampleZh } })).toEqual(["zh", "en"]);
  });
  test("a plain profile is a folio of one language, keyed by its own", () => {
    expect(folioLangs(toFolio(sample))).toEqual(["en"]);
    expect(folioLangs(toFolio(sampleZh))).toEqual(["zh"]);
    expect(toFolio(two)).toBe(two);
  });
  test("tags match by key, then by language", () => {
    expect(matchLang(two, "zh")).toBe("zh");
    expect(matchLang(two, "ZH-cn")).toBe("zh");
    expect(matchLang(two, "zh_TW")).toBe("zh");
    expect(matchLang(two, "en-GB")).toBe("en");
    expect(matchLang(two, "ja")).toBeNull();
    expect(matchLang(two, "")).toBeNull();
    expect(matchLang({ primary: "zh-CN", profiles: { "zh-CN": sampleZh } }, "zh")).toBe("zh-CN");
  });
  test("the URL, then the stored choice, then the primary", () => {
    expect(pickLang(two)).toBe("en");
    expect(pickLang(two, { stored: "zh" })).toBe("zh");
    expect(pickLang(two, { param: "zh", stored: "en" })).toBe("zh");
    // a language the folio does not have falls through
    expect(pickLang(two, { param: "fr", stored: "de" })).toBe("en");
  });
  test("the switch's names are the languages' own", () => {
    expect(langName("en")).toBe("English");
    expect(langName("zh")).toBe("中文");
    expect(langName("zh-CN")).toBe("中文");
  });
});

describe("loading", () => {
  test("a loaded language is kept, the primary is there at once", async () => {
    let calls = 0;
    const f: Folio = { primary: "en", profiles: { en: sample, zh: async () => (calls++, { default: sampleZh }) } };
    expect(loadedProfile(f, "en")).toBe(sample);
    expect(loadedProfile(f, "zh")).toBeNull();
    const [a, b] = await Promise.all([loadProfile(f, "zh"), loadProfile(f, "zh-CN")]);
    expect(a).toBe(sampleZh);
    expect(b).toBe(sampleZh);
    expect(calls).toBe(1);
    expect(loadedProfile(f, "zh")).toBe(sampleZh);
  });
  test("a failed load is not kept; an unknown language rejects", async () => {
    let fail = true;
    const f: Folio = {
      primary: "en",
      profiles: {
        en: sample,
        zh: async () => {
          if (fail) throw new Error("offline");
          return sampleZh;
        },
      },
    };
    await expect(loadProfile(f, "zh")).rejects.toThrow("offline");
    fail = false;
    expect(await loadProfile(f, "zh")).toBe(sampleZh);
    await expect(loadProfile(f, "fr")).rejects.toThrow();
  });
  test("the sample folio carries English and Chinese", async () => {
    expect(folioLangs(sampleFolio)).toEqual(["en", "zh"]);
    expect((await loadProfile(sampleFolio, "zh")).lang).toBe("zh-CN");
  });
});

describe("in-place switching", () => {
  test("the sample's two languages describe the same things", () => {
    expect(shapeDiff(sample, sampleZh)).toEqual([]);
  });
  test("a different shape is named", () => {
    const fewer = { ...sampleZh, albums: { ...sampleZh.albums, postcards: sampleZh.albums.postcards.slice(1) } };
    expect(shapeDiff(sample, fewer)).toEqual([`postcards: ${sample.albums.postcards.length} vs ${sample.albums.postcards.length - 1}`]);
    const moved = { ...sampleZh, items: [...sampleZh.items].reverse() };
    expect(shapeDiff(sample, moved).length).toBeGreaterThan(0);
  });
});
