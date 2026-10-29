import { describe, expect, test } from "bun:test";
import { CARD_H, CARD_W, PAGE_H, PAGE_W, PER_SIDE, cardIndex, cardRect, pageCount, pocketRect, sheetCount, slotAt, spreadOfPage, spreadSides } from "./layout";

describe("album book layout", () => {
  test("pockets fit inside the page and hold a card", () => {
    for (const mirrored of [false, true]) {
      for (let s = 0; s < PER_SIDE; s++) {
        const r = pocketRect(s, mirrored);
        expect(r.x).toBeGreaterThan(0);
        expect(r.y).toBeGreaterThan(0);
        expect(r.x + r.w).toBeLessThan(PAGE_W);
        expect(r.y + r.h).toBeLessThan(PAGE_H);
        expect(r.w).toBeGreaterThan(CARD_W);
        expect(r.h).toBeGreaterThan(CARD_H);
        const c = cardRect(s, mirrored, 17 + s);
        expect(c.x).toBeGreaterThanOrEqual(r.x);
        expect(c.x + c.w).toBeLessThanOrEqual(r.x + r.w);
      }
    }
  });

  test("the back of a pocket is its mirror image (same physical pocket)", () => {
    for (let s = 0; s < PER_SIDE; s++) {
      const f = pocketRect(s, false);
      // the back reads left-right reversed: column 0 on the front (by the spine) is column 1 on the back
      const b = pocketRect(s % 2 === 0 ? s + 1 : s - 1, true);
      expect(b.x).toBeCloseTo(PAGE_W - (f.x + f.w), 6);
      expect(b.y).toBe(f.y);
    }
  });

  test("slotAt finds the pocket under a point, −1 in the margins", () => {
    for (const mirrored of [false, true]) {
      for (let s = 0; s < PER_SIDE; s++) {
        const r = pocketRect(s, mirrored);
        expect(slotAt(r.x + r.w / 2, r.y + r.h / 2, mirrored)).toBe(s);
      }
      expect(slotAt(1, 1, mirrored)).toBe(-1);
    }
  });

  test("sheets, pages and spreads", () => {
    expect(sheetCount(0)).toBe(1);
    expect(sheetCount(12)).toBe(1);
    expect(sheetCount(13)).toBe(2);
    expect(sheetCount(500)).toBe(42);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(7)).toBe(2);
    // spread 0: inside of the front cover + sheet 0's front; last spread: the last sheet's back + inside of the back cover
    expect(spreadSides(0, 3)).toEqual([-1, 0]);
    expect(spreadSides(1, 3)).toEqual([1, 2]);
    expect(spreadSides(3, 3)).toEqual([5, -1]);
    // narrow screen: side 0 is in spread 0, sides 1 and 2 in spread 1
    expect([0, 1, 2, 3, 4].map(spreadOfPage)).toEqual([0, 1, 1, 2, 2]);
  });

  test("cardIndex walks sides in reading order", () => {
    expect(cardIndex(0, 0, 40)).toBe(0);
    expect(cardIndex(1, 5, 40)).toBe(11);
    expect(cardIndex(6, 3, 40)).toBe(39);
    expect(cardIndex(6, 4, 40)).toBe(-1);
    expect(cardIndex(-1, 0, 40)).toBe(-1);
  });
});
