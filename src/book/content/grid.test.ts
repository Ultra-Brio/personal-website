import { describe, expect, test } from "bun:test";
import { profile as sample } from "../../../profile/en";
import { profileZh as sampleZh } from "../../../profile/zh";
import { createCardContent } from "./cards";
import { sameGrid } from "./grid";
import { createPostcardContent } from "./postcards";

describe("an album in another language replaces the one in the book (brief r4 E1)", () => {
  test("the sample's English and Chinese albums are the same grid", () => {
    expect(sameGrid(createCardContent(sample.albums.cards), createCardContent(sampleZh.albums.cards))).toBe(true);
    expect(sameGrid(createPostcardContent(sample.albums.postcards), createPostcardContent(sampleZh.albums.postcards))).toBe(true);
  });
  test("other pictures, another layout or other items are not", () => {
    const pc = sample.albums.postcards;
    const moved = pc.map((p, i) => ({ ...p, src: pc[(i + 1) % pc.length]!.src }));
    expect(sameGrid(createPostcardContent(pc), createPostcardContent(moved))).toBe(false);
    expect(sameGrid(createCardContent(sample.albums.cards), createCardContent(sample.albums.cards, "idCard2x3"))).toBe(false);
    expect(sameGrid(createCardContent(sample.albums.cards), createCardContent(sample.albums.cards.slice(1)))).toBe(false);
  });
});
