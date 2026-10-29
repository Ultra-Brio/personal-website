import type { CSSProperties } from "react";
import { hanLangOf, type HanLang } from "../fonts";
import type { NoteItem, PolaroidItem, TicketItem } from "../profile/schema";
import { hasHan, run, useFontRuns } from "./fonts";
import { useT } from "./i18n";

/*
 * DOM versions of the small pouch objects, for when the stage cannot render them (opened from the text version, no WebGL) or while
 * its still is on its way. They follow the 3D objects (src/bag/objects): cool white stocks, 藍 as the one accent, the print in
 * Shippori Mincho and Zen Kaku Gothic, handwriting in Klee One (LXGW WenKai for Chinese). Everything printed comes from the item.
 * No capitals in the DOM, even here (§S).
 */

/** Handwriting: Klee One for Latin and Japanese, LXGW WenKai for Chinese. */
const handHan = (text: string): HanLang => (hasHan(text) ? hanLangOf(text) : "ja");

export function TicketArt({ item }: { item: TicketItem }) {
  const t = useT();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.date);
  const day = m ? String(Number(m[3])) : null;
  const month = m ? t.months[Number(m[2]) - 1] : null;
  return (
    <div className="tk" style={{ "--tk": item.color ?? "#2f4f73" } as CSSProperties} role="img" aria-label={`${item.label}: ${item.event}, ${t.date(item.date)}${item.seat ? `, ${item.seat}` : ""}`}>
      <div className="tk-main">
        <p className="tk-ev">{item.event}</p>
        {item.talk ? <p className="tk-talk">{item.talk}</p> : null}
        <div className="tk-rows">
          {item.time ? (
            <span>
              <b>{t.spec.time}</b>
              {item.time}
            </span>
          ) : null}
          {item.venue || item.city ? (
            <span>
              <b>{t.spec.venue}</b>
              {[item.venue, item.city].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          {item.seat ? (
            <span>
              <b>{t.spec.seat}</b>
              {item.seat}
            </span>
          ) : null}
        </div>
        {item.serial ? <p className="tk-no">{item.serial}</p> : null}
      </div>
      <div className="tk-date">
        {day ? (
          <>
            <span className="tk-day">{day}</span>
            <span className="tk-mo">
              {month} {m?.[1]}
            </span>
          </>
        ) : (
          <span className="tk-mo">{item.date}</span>
        )}
        <i className="tk-punch" aria-hidden="true" />
      </div>
      <div className="tk-stub" aria-hidden="true">
        <span>Admit one</span>
      </div>
    </div>
  );
}

export function TicketBack({ item }: { item: TicketItem }) {
  return (
    <div className="tk tk-back" style={{ "--tk": item.color ?? "#2f4f73" } as CSSProperties} aria-hidden="true">
      <i className="tk-disc" />
      <p className="tk-terms">
        {item.event}
        {item.serial ? ` · ${item.serial}` : ""}
      </p>
    </div>
  );
}

export function PolaroidFront({ item }: { item: PolaroidItem }) {
  useFontRuns(run("hand", 600, handHan(item.caption), item.caption));
  return (
    <div className="pol" role="img" aria-label={`${item.label}: ${item.caption}`}>
      <div className="pol-photo" style={item.image ? undefined : ({ "--tint": item.tint ?? "#c9d3da" } as CSSProperties)}>
        {item.image ? <img src={item.image} alt="" draggable={false} /> : null}
      </div>
      <p className="pol-cap" data-han={handHan(item.caption)}>
        {item.caption}
      </p>
    </div>
  );
}

export function PolaroidBack({ item }: { item: PolaroidItem }) {
  const t = useT();
  const text = item.back ?? item.caption;
  useFontRuns(run("hand", 600, handHan(text), text, item.date ? t.date(item.date) : ""));
  return (
    <div className="pol pol-back">
      <p className="pol-hand" data-han={handHan(text)}>
        {text}
      </p>
      {item.date ? (
        <p className="pol-date" data-han={handHan(text)}>
          {t.date(item.date)}
        </p>
      ) : null}
    </div>
  );
}

export function NoteArt({ item }: { item: NoteItem }) {
  const t = useT();
  const h = handHan(item.text);
  useFontRuns([...run("hand", 600, h, item.text, item.from), ...run("serif", 500, "ja", "一筆箋")]);
  return (
    <div className="note" role="img" aria-label={`${item.label}: ${item.text} — ${item.from}`}>
      <p className="note-text" data-han={h}>
        {item.text}
      </p>
      <p className="note-sign" data-han={h}>
        — {item.from}
        {item.date ? <span className="note-date">{t.date(item.date)}</span> : null}
      </p>
      <p className="note-foot" lang="ja" data-han="ja">
        <i aria-hidden="true" />
        一筆箋
      </p>
    </div>
  );
}
