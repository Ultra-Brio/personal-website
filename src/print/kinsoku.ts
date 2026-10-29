/*
 * Line-break units for mixed CJK / Latin text (禁則処理, kinsoku). Latin words stay whole; CJK text may break between any two
 * characters, except that closing punctuation never starts a line (it hangs on the character before it) and opening punctuation never
 * ends one (it moves down with the character after it). A wrapper only ever breaks between the units returned here.
 * Pure: shared by the résumé typesetter and the pouch's painters.
 */

/** May not start a line: closing brackets and quotes, full stops and commas, small kana, the prolonged sound mark, %. */
export const NO_START = new Set(Array.from("，。、；：？！」』）】》〉〕”’…‥・ー々ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ％%,.;:?!)]}"));
/** May not end a line: opening brackets and quotes. */
export const NO_END = new Set(Array.from("「『（【《〈〔“‘([{"));

/** One CJK character (ideographs, kana, CJK punctuation, full-width forms): a unit of its own. */
const CJK = /[⺀-鿿豈-﫿＀-￯]/u;
const SPACE = /\s/u;
/** A word that is a number (2027, 4.5, 1,200): it keeps the counter after it on its line. */
const NUMBER = /^[0-9][0-9.,:]*$/;
/** Pauses a balanced line may end on (a break after them reads naturally). */
const PAUSE = /[，、；：,;]$/u;

/**
 * Text → break units: Latin words, single CJK characters (with any punctuation glued on by the rules above) and runs of white space.
 * Joining the units gives the text back unchanged.
 */
export function breakUnits(text: string): string[] {
  const raw: string[] = [];
  let word = "";
  let space = "";
  const flush = () => {
    if (word) raw.push(word);
    if (space) raw.push(space);
    word = space = "";
  };
  for (const ch of Array.from(text)) {
    if (SPACE.test(ch)) {
      if (word) {
        raw.push(word);
        word = "";
      }
      space += ch;
    } else if (CJK.test(ch)) {
      flush();
      raw.push(ch);
    } else {
      if (space) {
        raw.push(space);
        space = "";
      }
      word += ch;
    }
  }
  flush();
  // a number and the counter or unit after it stay together (120 张, 2027 年, 3 月): the space between them is not a break
  for (let i = 0; i + 2 < raw.length; i++) {
    if (NUMBER.test(raw[i]!) && /^[  ]+$/.test(raw[i + 1]!) && CJK.test(raw[i + 2]!) && !NO_START.has(raw[i + 2]!)) raw.splice(i, 3, raw[i]! + raw[i + 1]! + raw[i + 2]!);
  }
  // glue: a unit that starts with a no-start character joins the unit before it; one that ends with a no-end character, the one after
  const out: string[] = [];
  let carry = "";
  for (const u of raw) {
    const isSpace = SPACE.test(u[0]!);
    if (carry && !isSpace) {
      const merged = carry + u;
      carry = "";
      pushGlued(out, merged);
      continue;
    }
    if (carry && isSpace) {
      // an opening bracket before a space ends its line anyway: let it go
      out.push(carry);
      carry = "";
    }
    if (!isSpace && NO_END.has(Array.from(u).pop()!)) {
      carry = u;
      continue;
    }
    pushGlued(out, u);
  }
  if (carry) out.push(carry);
  return out;
}

/** Appends a non-space unit, gluing it to the previous unit when it opens with a character that may not start a line. */
function pushGlued(out: string[], u: string) {
  const prev = out[out.length - 1];
  if (prev !== undefined && !SPACE.test(prev[0]!) && NO_START.has(Array.from(u)[0]!)) out[out.length - 1] = prev + u;
  else out.push(u);
}

export type WrapOptions = {
  /**
   * Centred short text: the same number of lines, as even as they come, breaking after a pause (，、；：) when one gives lines of
   * similar length ("2027 年春天起，/ 接一些小而用心的项目。" rather than a full first line and a short second).
   */
  balance?: boolean;
};

/** CJK lines of at most this many characters (closing punctuation included) are an orphan at the end of a paragraph. */
const ORPHAN = 2;
/** …and the measure narrows until the last line holds at least this many. */
const LAST_MIN = 4;

/**
 * Wrap into lines no wider than `max` (whatever unit `measure` returns). Never breaks inside a unit unless one unit alone is wider than
 * the line (then it is cut by characters). Lines carry no leading or trailing white space.
 * CJK text never ends on an orphan (one character and its full stop alone on the last line, 「…他 / 日。」): the measure narrows a
 * character at a time, with the same number of lines, until the last line holds at least four. `balance` evens the lines out.
 */
export function wrapUnits(text: string, max: number, measure: (s: string) => number, o: WrapOptions = {}): string[] {
  const units = breakUnits(text);
  const lines = greedy(units, max, measure);
  if (lines.length < 2 || !hasCjk(text)) return o.balance && lines.length > 1 ? balanced(units, lines, max, measure) : lines;
  if (o.balance) {
    const b = balanced(units, lines, max, measure);
    if (!orphan(b)) return b;
  }
  if (!orphan(lines)) return lines;
  const em = measure(Array.from(text).find((c) => CJK.test(c)) ?? "国");
  for (let k = 1; k <= 12 && max - k * em > em * 2; k++) {
    const ls = greedy(units, max - k * em, measure);
    if (ls.length !== lines.length) break;
    if (cjkLength(ls[ls.length - 1]!) >= LAST_MIN) return ls;
  }
  return lines;
}

const cjkLength = (line: string) => Array.from(line.replace(/\s/gu, "")).length;
function orphan(lines: string[]): boolean {
  const last = lines[lines.length - 1]!;
  return lines.length > 1 && hasCjk(last) && cjkLength(last) <= ORPHAN;
}

/** The same number of lines, as even as possible: after a pause if one splits it evenly enough, else the narrowest measure. */
function balanced(units: string[], lines: string[], max: number, measure: (s: string) => number): string[] {
  const n = lines.length;
  if (n === 2) {
    let best: string[] | null = null;
    let bestD = Infinity;
    let head = "";
    for (let i = 0; i < units.length - 1; i++) {
      head += units[i]!;
      if (!PAUSE.test(head.trimEnd())) continue;
      const a = head.trim();
      const b = units.slice(i + 1).join("").trim();
      const wa = measure(a);
      const wb = measure(b);
      if (!b || wa > max || wb > max || Math.min(wa, wb) < 0.55 * Math.max(wa, wb)) continue;
      if (Math.abs(wa - wb) < bestD) {
        bestD = Math.abs(wa - wb);
        best = [a, b];
      }
    }
    if (best) return best;
  }
  // the narrowest measure that still gives n lines
  let lo = 0;
  let hi = max;
  let got = lines;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const ls = greedy(units, mid, measure);
    if (ls.length <= n) {
      hi = mid;
      got = ls;
    } else lo = mid;
  }
  return got;
}

/** Greedy wrap of break units. */
function greedy(units: string[], max: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const u of units) {
    const space = SPACE.test(u[0]!);
    if (!line) {
      if (space) continue;
      line = u;
    } else if (space || measure((line + u).trimEnd()) <= max) {
      line += u;
      continue;
    } else {
      lines.push(line.trimEnd());
      line = u;
    }
    // a single unit wider than the line: cut it by characters
    while (measure(line) > max && Array.from(line).length > 1) {
      const chars = Array.from(line);
      let k = chars.length - 1;
      while (k > 1 && measure(chars.slice(0, k).join("")) > max) k--;
      lines.push(chars.slice(0, k).join(""));
      line = chars.slice(k).join("");
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** True when the text has CJK characters (its lines break by character, so "a short last word" is not a thing). */
export function hasCjk(text: string): boolean {
  return CJK.test(text);
}
