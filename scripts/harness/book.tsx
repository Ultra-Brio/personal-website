import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookView, DEFAULT_COVER, type Book, type BookCard, type BookState, type CoverSpec } from "../../src/book";
import type { PostcardItem } from "../../src/book/content";
import type { AlbumCard } from "../../src/profile/schema";

/*
 * Harness page for src/book. Query: ?cover=frost|cloth|leather &color=paper|fog|sand|sage|slate|moss|clay|ink &foil=silver|gold|blind
 * &n=14 &mode=auto|3d|flat &narrow=0|1 &img=1 (paint a procedural picture on every card) &box=WxH (size the parent) &window=1 (cover display pocket)
 * &kind=cards (default: plain BookCards, the golden path) | album (AlbumCards with procedural faces) | postcards (the postcard binder, A6 2x2)
 * &msg=long (longer postcard messages)
 * Exposes window.__book (Book | null, with .debug), window.__state (BookState), window.__ready (first spread painted), window.__picks,
 * window.__sounds (the onSound cues: { t: ms, name, gain?, pan? }, for book.sounds.ts), window.__setCover(partial) (live case swap).
 * &title=… overrides the stamped title. book.polish.html loads the same harness with the site's fonts and desk tokens.
 */

const q = new URLSearchParams(location.search);
const n = Math.max(0, Number(q.get("n") ?? 14));

const PALETTE = ["#e8d9c4", "#c9d6cf", "#d9c3c0", "#cbd1e3", "#e6dcb8", "#c4d9dc", "#dccbe0", "#d8d4cc", "#bfd0c0", "#e2cdb8", "#c8cbd6", "#e0c8c8"];

/** A procedural 640x404 picture: two soft discs and the card number. Only used with ?img=1. */
function picture(i: number, color: string): string {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 404;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 640, 404);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "#ffffff");
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 404);
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.beginPath();
  g.arc(120 + ((i * 97) % 300), 200, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.beginPath();
  g.arc(480, 120 + ((i * 53) % 160), 80, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(20,24,30,0.78)";
  g.font = "600 64px system-ui, sans-serif";
  g.fillText(String(i + 1).padStart(2, "0"), 40, 360);
  return c.toDataURL("image/png");
}

const cards: BookCard[] = Array.from({ length: n }, (_, i) => {
  const color = PALETTE[i % PALETTE.length]!;
  return { id: `c${i + 1}`, label: `Card ${i + 1}`, color, href: `#card-${i + 1}`, ...(q.get("img") === "1" && { src: picture(i, color) }) };
});

const PLACES = ["Hangzhou", "Kyoto", "Lisbon", "Reykjavik", "Taipei", "Porto", "Oslo", "Valparaíso", "Tbilisi", "Hội An", "Cádiz", "Bergen"];
const kind = q.get("kind") ?? "cards";
const longMsg = q.get("msg") === "long";
const postcards: PostcardItem[] = Array.from({ length: n }, (_, i) => ({
  id: `p${i + 1}`,
  label: PLACES[i % PLACES.length]!,
  place: PLACES[i % PLACES.length]!,
  color: PALETTE[(i * 5) % PALETTE.length]!,
  message: longMsg
    ? "Wish you were here. The light is unreal this time of year — we walked the old town until the lamps came on, ate far too much, and I thought of you at every corner."
    : "Wish you were here. The light is unreal this time of year.",
  from: "Lin",
  ...(i % 3 === 1 && { stamp: `No.${i + 1}` }),
}));
const albumCards: AlbumCard[] = cards.map((c, i) => ({ id: c.id, label: `Study ${String(i + 1).padStart(2, "0")}`, color: c.color ?? undefined, href: c.href, ...(c.src && i % 4 === 0 && { src: c.src }) }));

const cover: CoverSpec = {
  ...DEFAULT_COVER,
  material: (q.get("cover") as CoverSpec["material"]) ?? "frost",
  color: (q.get("color") as CoverSpec["color"]) ?? "paper",
  foil: (q.get("foil") as CoverSpec["foil"]) ?? "silver",
  title: q.get("title") ?? "Lin Wen — Folio",
  window: q.get("window") === "1" ? { src: cards[0]?.src ?? "", color: cards[0]?.color ?? undefined } : null,
};

type SoundCue = { t: number; name: string; gain?: number; pan?: number };
const w = window as unknown as { __book: Book | null; __state: BookState | null; __ready: boolean; __picks: unknown[]; __sounds: SoundCue[] };
w.__book = null;
w.__state = null;
w.__ready = false;
w.__picks = [];
w.__sounds = [];

const box = (q.get("box") ?? "").split("x").map(Number);
const narrow = q.get("narrow");

function Harness() {
  // live case swap: window.__setCover({ material: "cloth" }) (BookView swaps the case in place)
  const [liveCover, setCover] = useState(cover);
  useEffect(() => {
    (window as unknown as { __setCover: (c: Partial<CoverSpec>) => void }).__setCover = (c) => setCover((p) => ({ ...p, ...c }));
  }, []);
  return (
    <div style={{ width: box[0] || "100%", height: box[1] || "100%" }}>
      <BookView
        {...(kind === "postcards" ? { items: postcards, kind: "postcards" as const } : kind === "album" ? { items: albumCards, kind: "cards" as const } : { cards })}
        cover={liveCover}
        mode={(q.get("mode") as "auto" | "3d" | "flat") ?? "auto"}
        narrow={narrow === null ? undefined : narrow === "1"}
        quality={(q.get("quality") as "auto" | "low" | "high" | null) ?? undefined}
        onBook={(b) => (w.__book = b)}
        onState={(s) => (w.__state = s)}
        onReady={() => (w.__ready = true)}
        onPick={(i, o) => w.__picks.push({ i, ...o })}
        onSound={(name, o) => w.__sounds.push({ t: performance.now(), name, ...o })}
        tilt={q.get("tilt") === "1"}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
