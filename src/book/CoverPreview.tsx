import type { CSSProperties } from "react";
import type { CoverSpec } from "./cover";
import { COVER_HEX } from "./cover-style";

/*
 * The cover's 2D preview (plain CSS, no three; the flat album's closed state uses it).
 * CoverPreview: the front of the closed album (a strip of spine on the left), scaled by its width (container units); material, colour
 *   and foil stamp read clearly anywhere from 64–480px; the album's name shows only at ≥ 120px, smaller sizes have two short bars
 *   standing for the stamp. When cover.window is set, the top right holds that picture in the clear display pocket.
 * Copied from CardArt's CoverPreview.tsx (CoverSwatch dropped); the styles live in book.css under `.folio-cv`.
 */

export function CoverPreview({ cover, className, style }: { cover: CoverSpec; className?: string; style?: CSSProperties }) {
  const hex = COVER_HEX[cover.color];
  const dark = cover.material !== "frost" && hex.dark;
  return (
    <span
      className={className ? `folio-cv ${className}` : "folio-cv"}
      data-material={cover.material}
      data-foil={cover.foil}
      data-dark={dark ? "" : undefined}
      style={{ "--cv-base": cover.material === "frost" ? hex.frost : hex.base, "--cv-liner": hex.liner, ...style } as CSSProperties}
      aria-hidden="true"
    >
      <span className="folio-cv-face">
        {cover.material === "frost" && (
          <span className="folio-cv-ghost">
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
        {cover.window && (
          <span className="folio-cv-window" style={cover.window.color ? ({ "--cv-window": cover.window.color } as CSSProperties) : undefined}>
            {cover.window.src && <img src={cover.window.src} alt="" loading="lazy" decoding="async" draggable={false} />}
          </span>
        )}
        <span className="folio-cv-stamp">
          {cover.title && <span className="folio-cv-title">{cover.title}</span>}
          <span className="folio-cv-bars">
            <i />
            <i />
          </span>
        </span>
      </span>
      <span className="folio-cv-spine" />
    </span>
  );
}
