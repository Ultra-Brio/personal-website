import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { hanLangOf, profileHan, stack } from "../fonts";
import type { AlbumCard, Postcard, Profile } from "../profile/schema";
import { hasHan, run, textProps, useFontRuns } from "./fonts";
import { useT } from "./i18n";
import { booklet } from "./booklets";
import { withLang } from "./ItemDetail";
import { heldRect, useFrame } from "./layout";
import { DetailFrame, Lightbox, SpecRows, useLightboxClose, type Row } from "./Modal";
import { Pager, Sep, useCopy, Word } from "./Shell";
import { play } from "./sound";
import { FALLBACK_TINT, NE_ARROW, pad2, signature } from "./util";

/** The picture area of a card or postcard: the photo when there is one, otherwise a tint (under the painted face). */
export function Picture({ src, color, label, className }: { src?: string | undefined; color?: string | undefined; label: string; className?: string }) {
  const tint = color ?? FALLBACK_TINT;
  return (
    <div className={["pic", className].filter(Boolean).join(" ")} style={{ "--tint": tint } as CSSProperties}>
      {src ? <img src={src} alt="" draggable={false} /> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}

type Painters = { content: typeof import("../book/content"); layout: typeof import("../book/layout") };
let painters: Promise<Painters> | null = null;
// canvas only (no three); the album stage has already loaded this code, so it is usually instant
const loadPainters = () => (painters ??= Promise.all([import("../book/content"), import("../book/layout")]).then(([content, layout]) => ({ content, layout })));

/**
 * One face of an album item painted by the same painter as the 3D album's pockets (src/book/content), at the detail view's size,
 * over the DOM face (which stays as the readable version and the fallback). It paints again when the faces or the photo arrive.
 */
function PaintedFace({ kind, item, index, face, han }: { kind: "cards" | "postcards"; item: AlbumCard | Postcard; index: number; face: "front" | "back"; han: ReturnType<typeof profileHan> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let dead = false;
    let ro: ResizeObserver | null = null;
    let paint = () => {};
    const images = new Map<string, HTMLImageElement>();
    loadPainters()
      .then(({ content, layout: L }) => {
        if (dead) return;
        // the booklet's own pocket grid (booklets.ts): the same item size and painter details as its 3D pockets
        const layout = L.resolveLayout(booklet(kind).layout ?? (kind === "postcards" ? "postcard2x3" : "idCard2x4"));
        const { w, h, r } = layout.item;
        const cell = { side: face === "back" ? 1 : 0, slot: 0, index, face, mirrored: false, pocket: { x: 0, y: 0, w, h }, place: { x: 0, y: 0, w, h, tilt: 0, r }, seed: index + 1 };
        paint = () => {
          const ctx = c.getContext("2d");
          if (!ctx || !c.clientWidth || dead) return;
          const k = Math.max(2, (c.clientWidth * Math.min(2, window.devicePixelRatio || 1)) / w);
          c.width = Math.round(w * k);
          c.height = Math.round(h * k);
          ctx.setTransform(k, 0, 0, k, 0, 0);
          const env = { layout, pxPerMm: k, font: stack("sans", han), serif: stack("serif", han), image: (src: string) => images.get(src) ?? null };
          if (kind === "postcards") content.paintPostcard(ctx, item as Postcard, cell, env);
          else content.paintAlbumCard(ctx, item as AlbumCard, cell, env);
          c.dataset.painted = "";
        };
        paint();
        document.fonts?.addEventListener("loadingdone", paint);
        ro = new ResizeObserver(paint);
        ro.observe(c);
        const src = item.src;
        if (src) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            if (dead) return;
            images.set(src, img);
            paint();
          };
          img.src = src;
        }
      })
      .catch(() => {
        /* the DOM face stays */
      });
    return () => {
      dead = true;
      ro?.disconnect();
      document.fonts?.removeEventListener("loadingdone", paint);
    };
  }, [kind, item, index, face, han]);
  return <canvas ref={ref} className="painted-face" aria-hidden="true" />;
}

/** "Kyoto" + "19.12.29" for the postmark. */
function postmark(p: Postcard): { place: string; date: string } {
  // "Ryōan-ji, Kyoto" → Kyoto; a Chinese place puts the city first: "京都，龙安寺" → 京都
  const parts = p.place.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  const place = (/[，、]/.test(p.place) ? parts[0] : parts[parts.length - 1]) ?? p.place;
  const m = /^(\d{2})(\d{2})-(\d{2})-(\d{2})$/.exec(p.date ?? "");
  return { place, date: m ? `${m[2]}.${m[3]}.${m[4]}` : "" };
}

/**
 * 郵便はがき: the message side of a postcard, in the DOM (§1.6.11, C's design): the header, the handwritten message signed at
 * the right, the divider, a stamp cropped from the same photo with a perforated edge, a round postmark over it, four address lines.
 * Sized in container units so it is the same card at any width.
 */
function Hagaki({ p, lang, han }: { p: Postcard; lang: string | undefined; han: ReturnType<typeof profileHan> }) {
  const t = useT();
  const pm = postmark(p);
  // the message in the handwriting its words need (Klee One; LXGW WenKai for Chinese), signed as the 3D back film signs it
  const msgHan = hasHan(p.message) ? hanLangOf(p.message, lang) : "ja";
  useFontRuns([...run("hand", 600, msgHan, p.message, p.from), ...run("serif", 600, "ja", t.hagaki), ...run("sans", 500, han, pm.place)]);
  return (
    <div className="hagaki">
      <span className="hd" {...textProps(t.hagaki, "ja", han)}>
        {t.hagaki}
      </span>
      <p className="msg" {...textProps(p.message, lang, han)} {...(hasHan(p.message) ? {} : { "data-han": "ja" as const })}>
        {p.message}
        <span className="sig">{signature(p.message, p.from)}</span>
      </p>
      <i className="div" aria-hidden="true" />
      <div className="addr" aria-hidden="true">
        <span className="stamp">
          <span style={p.src ? { backgroundImage: `url("${p.src}")` } : { background: p.color ?? FALLBACK_TINT }} />
        </span>
        <span className="pm">
          <span>
            {pm.place}
            {pm.date ? <b>{pm.date}</b> : null}
          </span>
        </span>
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

function PutBack({ short }: { short: boolean }) {
  const t = useT();
  const close = useLightboxClose();
  return <Word onClick={close}>{short ? t.controls.putBackShort : t.controls.putBack}</Word>;
}

type Props = {
  profile: Profile;
  kind: "cards" | "postcards";
  id: string;
  onSelect(id: string): void;
  onClose(): void;
  fallbackFocus?(): void;
};

/** The detail view of a card or a postcard from the albums (§1.6.11): same frame, the card alone. Postcards turn over. */
export function AlbumDetail({ profile, kind, id, onSelect, onClose, fallbackFocus }: Props) {
  const t = useT();
  const f = useFrame();
  const uid = useId();
  const titleId = `${uid}-title`;
  const han = profileHan(profile);
  const list: (AlbumCard | Postcard)[] = profile.albums[kind];
  const index = list.findIndex((c) => c.id === id);
  const entry = list[index];
  const [back, setBack] = useState(false);
  const { copied, copy } = useCopy();
  const phone = f.cls === "p" || f.cls === "t";
  useEffect(() => setBack(false), [id]);
  const isPostcard = kind === "postcards";
  const pc = entry as Postcard | undefined;
  const ac = entry as AlbumCard | undefined;
  const chromeHan = t.lang === "zh" ? "zh-Hans" : "ja";
  const local = entry ? (isPostcard ? pc?.placeLocal : ac?.nameLocal) : undefined;
  // A colour card's 和色 name is printed in the Japanese face on the card itself (book/content/cards.ts), so the caption sets it in
  // the same face. A Chinese page reads 月白 as its own traditional colour name: there it is the title (SC face), the romaji under it.
  const zhColour = !isPostcard && t.lang === "zh" && !!ac?.nameLocal;
  const title = zhColour ? (ac?.nameLocal ?? "") : (entry?.label ?? "");
  const sub = zhColour ? entry?.label : local;
  const subLang = zhColour || isPostcard ? profile.lang : "ja";
  const subHan = sub && hasHan(sub) ? hanLangOf(sub, subLang) : han;
  useFontRuns(
    entry
      ? [
          ...run("serif", 500, han, title),
          ...run("serif", 400, subHan, sub),
          ...run("serif", 400, han, isPostcard ? undefined : ac?.note),
          ...run("sans", 400, han, ...(isPostcard ? [pc?.place, pc?.date ? t.date(pc.date) : "", pc?.from, pc?.credit] : [])),
          ...run("sans", 400, chromeHan, isPostcard ? undefined : t.spec.seriesValue),
          ...run("sans", 500, chromeHan, t.spec.place, t.spec.postmarked, t.spec.from, t.spec.credit, t.spec.colour, t.spec.series),
        ]
      : [],
  );
  if (!entry) return null;
  const n = list.length;
  const go = (d: number) => {
    const j = index + d;
    const x = list[j];
    if (x) onSelect(x.id);
  };
  const turn = () => {
    play("pageTurn", { gain: 0.4 });
    setBack((b) => !b);
  };
  const hex = !isPostcard && ac?.color ? ac.color : null;
  const copyHex = () => {
    if (hex) void copy(hex);
  };
  const rect = heldRect(f, kind);

  const rows: Row[] = isPostcard
    ? [
        { k: t.spec.place, v: pc!.place },
        ...(pc!.date ? [{ k: t.spec.postmarked, v: t.date(pc!.date) }] : []),
        { k: t.spec.from, v: pc!.from },
        ...(pc!.credit ? [{ k: t.spec.credit, v: pc!.credit.replace(/^(Photo|摄影|攝影|写真)\s*[:：]\s*/i, "") }] : []),
      ]
    : [
        ...(hex
          ? [
              {
                k: t.spec.colour,
                v: (
                  <button type="button" className="v hex" onClick={copyHex} aria-label={`${t.controls.copyHex} ${hex}`}>
                    {copied ? (
                      <>
                        <i className="cdot" aria-hidden="true" />
                        {t.controls.copied}
                      </>
                    ) : (
                      hex
                    )}
                  </button>
                ),
              },
            ]
          : []),
        // 色見本 is Japanese on an English page (Shippori's sibling Zen Kaku), 传统色 Chinese on a Chinese one
        withLang({ k: t.spec.series, v: t.spec.seriesValue }, t.lang === "zh" ? (profile.lang ?? "zh-CN") : "ja", han),
      ];

  const caption = (
    <>
      <p className="cap-count" aria-live="polite" aria-atomic="true">
        <span aria-hidden="true">
          {pad2(index + 1)}
          <i>/</i>
          {pad2(n)}
        </span>
        <span className="sr-only">{t.controls.objectOf(index + 1, n)}</span>
      </p>
      <h2 id={titleId} className="cap-title" {...textProps(title, profile.lang, han)}>
        {title}
      </h2>
      {sub ? (
        <p className={zhColour ? "cap-local romaji" : "cap-local"} {...textProps(sub, subLang, han)}>
          {sub}
        </p>
      ) : null}
      {!isPostcard && ac?.note ? (
        <p className="cap-anec" {...textProps(ac.note, profile.lang, han)}>
          {ac.note}
        </p>
      ) : null}
      <SpecRows rows={rows.map((r) => (typeof r.v === "string" && !r.lang ? withLang(r, profile.lang, han) : r))} />
      {!isPostcard && ac?.href ? (
        <ul className="cap-links">
          <li>
            <a href={ac.href} target="_blank" rel="noopener">
              {ac.href.replace(/^https?:\/\//, "")}
              <span className="go" aria-hidden="true">
                {" "}
                {NE_ARROW}
              </span>
            </a>
          </li>
        </ul>
      ) : null}
    </>
  );

  const object = isPostcard ? (
    <div className="held pc" data-kind="postcards" onClick={() => !window.getSelection()?.toString() && turn()}>
      <div className="flip" data-turned={back || undefined}>
        <div className="flip-face front pc-face" inert={back}>
          <Picture src={pc!.src} color={pc!.color} label={pc!.label} />
          <PaintedFace kind="postcards" item={pc!} index={index} face="front" han={han} />
        </div>
        <div className="flip-face back" inert={!back}>
          <Hagaki p={pc!} lang={profile.lang} han={han} />
        </div>
      </div>
    </div>
  ) : (
    <div className="held ac" data-kind="cards">
      <div className="ac-frame">
        <Picture src={ac!.src} color={ac!.color} label={ac!.label} />
        <PaintedFace kind="cards" item={ac!} index={index} face="front" han={han} />
      </div>
    </div>
  );

  const controls = (
    <>
      <span className="cg">
      <Pager
        text={`${index + 1} / ${n}`}
        label={t.controls.objectOf(index + 1, n)}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        atStart={index <= 0}
        atEnd={index >= n - 1}
        prevLabel={t.controls.prev}
        nextLabel={t.controls.next}
      />
      </span>
      <Sep />
      <span className="cg">
      {isPostcard ? (
        <>
          <Word onClick={turn} pressed={back}>
            {back ? t.controls.turnBack : t.controls.turnOver}
          </Word>
          <Sep />
        </>
      ) : hex ? (
        <>
          <Word onClick={copyHex} label={`${t.controls.copyHex} ${hex}`}>
            {copied ? t.controls.copied : `${t.controls.copyHex} ${hex}`}
          </Word>
          <Sep />
        </>
      ) : null}
      <PutBack short={phone || f.cls === "l"} />
      </span>
    </>
  );

  const heldName = isPostcard ? t.held.postcard : t.held.colour;
  return (
    <Lightbox labelledBy={titleId} kind={kind} onClose={onClose} onPrev={() => go(-1)} onNext={() => go(1)} onSpace={isPostcard ? turn : hex ? copyHex : undefined} {...(fallbackFocus ? { fallbackFocus } : {})}>
      <DetailFrame id={entry.id} profile={profile} rect={rect} hashira={{ local: heldName.local, latin: `${heldName.latin} · ${pad2(index + 1)}` }} caption={caption} controls={controls} object={object} />
    </Lightbox>
  );
}
