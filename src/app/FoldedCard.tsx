import type { BusinessCardItem } from "../profile/schema";

/*
 * The DOM business card (no WebGL / a lost paper context): a card that folds once, in CSS 3D, like the paper
 * viewer's. Closed it shows the front (the ○ disc, the name, the role, the tagline); open, the cover stands up and the inside shows
 * the note on the left panel and the contact rows on hairlines on the right. One attribute flips it; the detail view's
 * Open it word (or Space, or a click on the card) drives it.
 */
export function FoldedCard({ item, open, onOpenChange }: { item: BusinessCardItem; open: boolean; onOpenChange(next: boolean): void }) {
  return (
    <div
      className="fc"
      data-open={open || undefined}
      onClick={() => {
        if (!window.getSelection()?.toString()) onOpenChange(!open);
      }}
    >
      <div className="fc-inside" inert={!open}>
        {item.insideNote ? <p className="fc-note">{item.insideNote}</p> : <span />}
        <dl className="fc-rows">
          {item.inside.map((r, i) => (
            <div key={r.k + i}>
              <dt>{r.k}</dt>
              <dd>{r.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="fc-leaf">
        <div className="fc-front" inert={open}>
          <i className="fc-disc" aria-hidden="true" />
          <p className="fc-name">{item.front.name}</p>
          <p className="fc-role">{item.front.role}</p>
          {item.front.tagline ? <p className="fc-tag">{item.front.tagline}</p> : null}
        </div>
        <div className="fc-back" aria-hidden="true">
          <i className="fc-disc" />
        </div>
      </div>
    </div>
  );
}
