import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CoverMaterial } from "../book/cover";
import { hanLangOf, profileHan, type HanLang } from "../fonts";
import { langName } from "../profile/folio";
import type { Profile } from "../profile/schema";
import { BOOKLETS, booklet, caseHex, countOf, MATERIALS } from "./booklets";
import { emailOf, writeClipboard } from "./ContactRows";
import { hasHan, run, textProps, useFontRuns } from "./fonts";
import { useT, type Dict } from "./i18n";
import { useFrame, type Frame } from "./layout";
import { Room } from "./Room";
import { play, useMuted } from "./sound";
import type { Langs, StageApi, Tab, View } from "./types";
import { NE_ARROW, finePointer, isExternal, linkText, pad2, pageUrl, prefersReducedMotion, shortLink, zonedClock } from "./util";

/*
 * The page around the booklets (spec §1.5, §1.6): set like the front matter of a Japanese book.
 *   the words column (desktop: 204 px at the left margin, in the shade)   名 identity · 序 bio · 目次 booklets · handling · 奥付 colophon
 *   柱 the hashira   a vertical running title in the outer margin
 *   the hands row    under the book box: the case switch at the left, the controls as printed words at the right
 * The canvas is full-bleed under all of it; the book is framed into the book box by the camera (layout.ts). Phones get a header
 * (identity, booklet tabs), a hint and a bottom row (Profile, controls); the bio, colophon and case move into the Profile sheet.
 * No containers anywhere: no pill, tray or chip (F1). Frosted glass only on the detail veil, the Profile sheet and tooltips.
 */

/* ------------------------------------------------------------------ small parts */

/** Swaps its content with a cross-fade (the old one fades out on top while the new one fades in). */
function CrossFade({ k, className, children, ms = 360 }: { k: string; className?: string; children: ReactNode; ms?: number }) {
  const [shown, setShown] = useState<{ k: string; node: ReactNode }[]>([{ k, node: children }]);
  const latest = useRef(children);
  latest.current = children;
  useEffect(() => {
    setShown((cur) => (cur[cur.length - 1]?.k === k ? cur.map((s) => (s.k === k ? { k, node: latest.current } : s)) : [...cur.slice(-1), { k, node: latest.current }]));
    const t = window.setTimeout(() => setShown((cur) => cur.slice(-1)), ms + 40);
    return () => window.clearTimeout(t);
  }, [k, ms]);
  // the newest content always reflects the latest render
  const list = shown.map((s, i) => (i === shown.length - 1 ? { k: s.k, node: children } : s));
  return (
    <div className={className ? `xf ${className}` : "xf"}>
      {list.map((s, i) => (
        <div key={s.k} className="xf-i" data-out={i < list.length - 1 || undefined} aria-hidden={i < list.length - 1 || undefined}>
          {s.node}
        </div>
      ))}
    </div>
  );
}

/** A glass tooltip 8 px above `el`, on fine pointers only, after 400 ms (§1.6.14). */
function useTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((el: HTMLElement, text: string) => {
    if (!finePointer()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.left + r.width / 2, y: r.top - 8 });
    }, 400);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setTip(null);
  }, []);
  const node =
    typeof document === "undefined"
      ? null
      : createPortal(
          <span className="tip" role="tooltip" data-show={tip ? "" : undefined} style={tip ? { left: tip.x, top: tip.y } : undefined}>
            {tip?.text ?? ""}
          </span>,
          document.body,
        );
  return { show, hide, node };
}

/** Live local time at minute resolution (no seconds, no blinking colon). */
function useMinuteClock(timezone: string | undefined) {
  const [clock, setClock] = useState(() => zonedClock(timezone, new Date()));
  useEffect(() => {
    let t = 0;
    const tick = () => {
      setClock((cur) => {
        const next = zonedClock(timezone, new Date());
        return cur.time === next.time && cur.zone === next.zone ? cur : next;
      });
      t = window.setTimeout(tick, 60000 - (Date.now() % 60000) + 30);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [timezone]);
  return clock;
}

export function useCopy(ms = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      const ok = await writeClipboard(text);
      if (!ok) return false;
      play("copy");
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), ms);
      return true;
    },
    [ms],
  );
  return { copied, copy };
}

/* ------------------------------------------------------------------ 名 identity */
export function Identity({ profile, han, onProfile, asHeading = true }: { profile: Profile; han: HanLang; onProfile?: (() => void) | undefined; asHeading?: boolean }) {
  const t = useT();
  const { time, zone } = useMinuteClock(profile.timezone);
  const city = profile.location;
  useFontRuns([...run("serif", 500, han, profile.nameLocal, profile.name), ...run("sans", 400, han, profile.role, city)]);
  // a name written in Han with no separate local name (林文 in a Chinese profile) is itself the vertical plate (§1.6.1's 名 block)
  if (!profile.nameLocal && hasHan(profile.name) && !/[A-Za-z]/.test(profile.name)) {
    const props = { className: "nameplate is-name", ...textProps(profile.name, profile.lang, han) };
    const plate = onProfile ? (
      <button type="button" {...props} onClick={onProfile} aria-haspopup="dialog">
        {profile.name}
      </button>
    ) : asHeading ? (
      <h1 {...props}>{profile.name}</h1>
    ) : (
      <p {...props}>{profile.name}</p>
    );
    return (
      <div className="id" data-plate="">
        {plate}
        <div className="id-text">
          <p className="id-role" {...textProps(profile.role, profile.lang, han)}>
            {profile.role}
          </p>
          <p className="id-where" aria-label={t.clock(time, city)}>
            {city ? <span {...textProps(city, profile.lang, han)}>{city} </span> : null}
            <time dateTime={time}>{time}</time>
            {zone ? <span className="z"> · {zone}</span> : null}
          </p>
        </div>
      </div>
    );
  }
  const name = onProfile ? (
    <button type="button" className="id-name" onClick={onProfile} aria-haspopup="dialog" {...textProps(profile.name, profile.lang, han)}>
      {profile.name}
    </button>
  ) : asHeading ? (
    <h1 className="id-name" {...textProps(profile.name, profile.lang, han)}>
      {profile.name}
    </h1>
  ) : (
    <p className="id-name" {...textProps(profile.name, profile.lang, han)}>
      {profile.name}
    </p>
  );
  return (
    <div className="id" data-plate={profile.nameLocal ? "" : undefined}>
      {profile.nameLocal ? (
        <span className="nameplate" aria-hidden="true" {...textProps(profile.nameLocal, profile.lang, han)}>
          {profile.nameLocal}
        </span>
      ) : null}
      <div className="id-text">
        {name}
        <p className="id-role" {...textProps(profile.role, profile.lang, han)}>
          {profile.role}
        </p>
        <p className="id-where" aria-label={t.clock(time, city)}>
          {city ? <span {...textProps(city, profile.lang, han)}>{city} </span> : null}
          <time dateTime={time}>{time}</time>
          {zone ? <span className="z"> · {zone}</span> : null}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 目次 the booklets */
function Toc({ profile, tab, onTab }: { profile: Profile; tab: Tab; onTab(t: Tab): void }) {
  const t = useT();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const index = BOOKLETS.findIndex((b) => b.id === tab);
  useFontRuns(run("serif", 400, t.lang === "zh" ? "zh-Hans" : "ja", ...BOOKLETS.map((b) => t.booklet[b.id].name)));
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const i = refs.current.findIndex((r) => r === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    refs.current[(i + d + BOOKLETS.length) % BOOKLETS.length]?.focus();
  };
  return (
    <nav className="toc" aria-label={t.nav.booklets} onKeyDown={onKey} style={{ "--i": index } as CSSProperties}>
      <i className="toc-disc" aria-hidden="true" />
      <ol>
        {BOOKLETS.map((b, i) => {
          const n = countOf(profile, b.id);
          const name = t.booklet[b.id].name;
          return (
            <li key={b.id}>
              <a
                ref={(el) => {
                  refs.current[i] = el;
                }}
                href={`#${b.id}`}
                aria-current={tab === b.id ? "page" : undefined}
                aria-label={`${name}, ${pad2(n)} ${t.booklet[b.id].noun(n)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onTab(b.id);
                }}
              >
                <span className="nm" aria-hidden="true">
                  {name}
                </span>
                <span className="lead" aria-hidden="true" />
                <span className="n" aria-hidden="true">
                  {pad2(n)}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ 奥付 the colophon */
export function Colophon({ profile, han }: { profile: Profile; han: HanLang }) {
  const t = useT();
  const email = emailOf(profile);
  const { copied, copy } = useCopy();
  const tip = useTip();
  const [status, setStatus] = useState("");
  const others = profile.links.filter((l) => !l.href.startsWith("mailto:"));
  const rows: { k: string; v: string; href: string; ext: boolean }[] = [
    ...others.map((l) => ({ k: l.label, v: linkText(l.href), href: l.href, ext: isExternal(l.href) })),
    ...(profile.source ? [{ k: t.colophon.source, v: shortLink(profile.source), href: profile.source, ext: true }] : []),
  ];
  const dl = useRef<HTMLDListElement>(null);
  // F2 / §1.6.5: a value wider than its cell drops its row's label column; nothing ever truncates
  useLayoutEffect(() => {
    const el = dl.current;
    if (!el) return;
    const fit = () => {
      for (const row of el.querySelectorAll<HTMLElement>(".row")) {
        row.removeAttribute("data-drop");
        const v = row.querySelector<HTMLElement>(".v");
        const dd = row.querySelector<HTMLElement>("dd");
        if (v && dd && v.scrollWidth > dd.clientWidth + 0.5) row.setAttribute("data-drop", "");
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [profile, t]);
  useFontRuns(run("sans", 500, han, t.colophon.email, ...rows.map((r) => r.k)));
  return (
    <section className="oku" aria-label={t.colophon.label}>
      <dl ref={dl}>
        {email ? (
          <div className="row">
            <dt>{t.colophon.email}</dt>
            <dd>
              <button
                type="button"
                className="v copy"
                data-copied={copied || undefined}
                aria-label={copied ? t.colophon.emailCopied : `${t.colophon.copy} ${email}`}
                onMouseEnter={(e) => tip.show(e.currentTarget, t.colophon.copy)}
                onMouseLeave={tip.hide}
                onFocus={tip.hide}
                onClick={async (e) => {
                  tip.hide();
                  if (e.metaKey || e.ctrlKey) {
                    window.location.href = `mailto:${email}`;
                    return;
                  }
                  const ok = await copy(email);
                  setStatus(ok ? t.colophon.emailCopied : "");
                  if (!ok) window.location.href = `mailto:${email}`;
                  else window.setTimeout(() => setStatus(""), 1600);
                }}
              >
                {copied ? (
                  <>
                    <i className="cdot" aria-hidden="true" />
                    {t.colophon.copied}
                  </>
                ) : (
                  email
                )}
              </button>
            </dd>
            <span />
          </div>
        ) : null}
        {rows.map((r) => (
          <div className="row" key={r.href}>
            <dt {...textProps(r.k, undefined, han)}>{r.k}</dt>
            <dd>
              <a className="v" href={r.href} {...(r.ext ? { target: "_blank", rel: "me noopener" } : {})} aria-label={`${r.k}: ${linkText(r.href)}${r.ext ? ` ${t.colophon.newTab}` : ""}`}>
                {r.v}
              </a>
            </dd>
            <span className="go" aria-hidden="true">
              {r.ext ? NE_ARROW : ""}
            </span>
          </div>
        ))}
      </dl>
      <p className="sr-only" role="status" aria-live="polite" data-testid="copy-status">
        {status}
      </p>
      {tip.node}
    </section>
  );
}

/** Sound On|Off and Text version →: the prefs row on the page's bottom line. */
export function Prefs({ tab }: { tab: Tab }) {
  const t = useT();
  const { muted, toggle } = useMuted();
  return (
    <div className="prefs">
      <button type="button" className="pw" aria-pressed={!muted} aria-keyshortcuts="M" onClick={toggle} data-testid="sound-toggle">
        {t.colophon.sound} <b>{muted ? t.colophon.off : t.colophon.on}</b>
      </button>
      <a className="pw" href={pageUrl({ view: "text", tab })}>
        {t.colophon.textVersion} <span className="go" aria-hidden="true">→</span>
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ the language switch (brief r4 E1) */
/**
 * English · 中文: each language named in itself, the one on view in ink, the other muted, printed like the prefs (no capitals, no
 * flags). Each is a real link to the page in that language (?lang=, kept by the views' links), so it can be opened in a new tab; a
 * plain click changes the language in place (App).
 */
export function LangSwitch({ langs, han, view = "folio", tab }: { langs: Langs | undefined; han: HanLang; view?: View; tab: Tab }) {
  const t = useT();
  const f = useFrame();
  // (its lang and, when it differs from the page's, its Han face: 中文 is set in the SC face on an English page too; at 400 in a
  // phone's or a tablet's header, 500 on the desk's bottom lines)
  const names = (langs?.list ?? []).map((l) => ({ l, name: langName(l), props: textProps(langName(l), l, han) }));
  const weight = view === "folio" && (f.cls === "p" || f.cls === "t") ? 400 : 500;
  useFontRuns(names.flatMap((n) => run("sans", weight, hanLangOf(n.name, n.l), n.name)));
  if (!langs || langs.list.length < 2) return null;
  return (
    <nav className="lang" aria-label={t.langs.label}>
      {names.map((n, i) => (
        <Fragment key={n.l}>
          {i ? (
            <i className="lang-dot" aria-hidden="true">
              ·
            </i>
          ) : null}
          <a
            className="lang-a"
            href={pageUrl({ lang: n.l, tab, ...(view !== "folio" ? { view } : {}) })}
            hrefLang={n.props.lang}
            {...n.props}
            aria-current={n.l === langs.current ? "true" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              if (n.l !== langs.current) play("tab", { gain: 0.4 });
              langs.set(n.l);
            }}
          >
            {n.name}
          </a>
        </Fragment>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ 柱 the hashira */
/**
 * A Chinese page pairs its Han title with the small Latin line on purpose (简历 — Résumé folio · 05, set like a bilingual
 * colophon): the Han line is the running title a screen reader meets, the Latin line is decoration (lang en, hidden from it, in the
 * Latin alias face). An English page's hashira is all decoration: its Japanese line is flavour and the booklet list names the booklet.
 */
export function Hashira({ local, latin, han }: { local: string; latin: string; han: HanLang }) {
  const t = useT();
  useFontRuns(run("serif", 500, han, local));
  const named = t.lang === "zh" && !!local;
  return (
    <div className="hashira" aria-hidden={named ? undefined : "true"}>
      <CrossFade k={`${local}|${latin}`} className="hashira-x">
        <span className="hs">
          {local ? (
            <span className="jp" lang={han} data-han={han}>
              {local}
            </span>
          ) : null}
          {local ? <i className="rule" aria-hidden="true" /> : null}
          <span className="en" lang="en" aria-hidden="true">
            {latin}
          </span>
        </span>
      </CrossFade>
    </div>
  );
}

/* ------------------------------------------------------------------ the case switch (§1.6.7) */
export function CaseSwitch({ tab, material, onMaterial }: { tab: Tab; material: CoverMaterial; onMaterial(m: CoverMaterial): void }) {
  const t = useT();
  const hex = caseHex(booklet(tab));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (MATERIALS.indexOf(material) + d + MATERIALS.length) % MATERIALS.length;
    const m = MATERIALS[j];
    if (!m) return;
    onMaterial(m);
    refs.current[j]?.focus();
  };
  return (
    <div className="case" role="radiogroup" aria-label={t.case.aria} onKeyDown={onKey} style={{ "--c": hex.base, "--f": hex.frost } as CSSProperties}>
      <span className="case-l" aria-hidden="true">
        {t.case.label}
      </span>
      {MATERIALS.map((m, i) => (
        <button
          key={m}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          className="cs"
          aria-checked={m === material}
          tabIndex={m === material ? 0 : -1}
          onClick={() => onMaterial(m)}
        >
          <span className={`sw sw-${m}`} aria-hidden="true" />
          <span className="cs-t">{t.case.material[m]}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ controls: printed words, no container (§1.6.8, F1) */
export function Word({ children, onClick, disabled, label, pressed, className, keys }: { children: ReactNode; onClick?: (() => void) | undefined; disabled?: boolean | undefined; label?: string | undefined; pressed?: boolean | undefined; className?: string | undefined; keys?: string | undefined }) {
  return (
    <button
      type="button"
      className={className ? `w ${className}` : "w"}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={keys}
    >
      {children}
    </button>
  );
}
export const Sep = () => <i className="sep" aria-hidden="true" />;

/** ‹ 01 / 02 › */
export function Pager({ text, label, onPrev, onNext, atStart, atEnd, prevLabel, nextLabel }: { text: string; label: string; onPrev(): void; onNext(): void; atStart: boolean; atEnd: boolean; prevLabel: string; nextLabel: string }) {
  return (
    <>
      <Word className="ar" onClick={onPrev} disabled={atStart} label={prevLabel}>
        ‹
      </Word>
      <span className="ct" aria-live="polite">
        <span aria-hidden="true">{text}</span>
        <span className="sr-only">{label}</span>
      </span>
      <Word className="ar" onClick={onNext} disabled={atEnd} label={nextLabel}>
        ›
      </Word>
    </>
  );
}

/** Tilt (phones): a ring while off, a disc while on; denied reads "Tilt off" for 2 s, then greys out. */
function Tilt({ motion }: { motion: NonNullable<StageApi["motion"]> }) {
  const t = useT();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (motion.state !== "denied") return;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 2000);
    return () => window.clearTimeout(id);
  }, [motion.state]);
  if (motion.state === "unsupported") return null;
  const off = motion.state === "denied";
  return (
    <>
      <Word className="tilt" onClick={motion.toggle} disabled={off || motion.state === "asking"} pressed={motion.state === "on"} label={t.controls.tiltAria}>
        <i className="led" data-on={motion.state === "on" || undefined} aria-hidden="true" />
        {off && flash ? t.controls.tiltOff : t.controls.tilt}
      </Word>
      <Sep />
    </>
  );
}

function StageControls({ api, tab, frame }: { api: StageApi; tab: Tab; frame: Frame }) {
  const t = useT();
  const last = useRef(0);
  if (!api.open)
    return (
      <Word onClick={() => api.toggle?.()} label={tab === "resume" ? t.controls.openFolio : t.controls.openAlbum}>
        {t.controls.open}
      </Word>
    );
  if (tab === "resume") {
    const phone = frame.cls === "p" || frame.cls === "t" || frame.cls === "l";
    const shake = () => {
      const now = performance.now();
      if (now - last.current < 600) return;
      last.current = now;
      api.shake?.();
    };
    return (
      <>
        {api.motion && (frame.cls === "p" || frame.cls === "t") ? <Tilt motion={api.motion} /> : null}
        {api.shake ? (
          <>
            <Word onClick={shake} keys="S">
              {t.controls.shake}
            </Word>
            <Sep />
          </>
        ) : null}
        <Word onClick={() => api.toggle?.()} label={t.controls.closeFolio}>
          {phone ? t.controls.closeFolioShort : t.controls.closeFolio}
        </Word>
      </>
    );
  }
  const p = api.page ?? { index: 0, count: 1 };
  return (
    <>
      <Pager
        text={`${pad2(p.index + 1)} / ${pad2(p.count)}`}
        label={t.controls.pageOf(p.index + 1, p.count)}
        onPrev={() => api.prev?.()}
        onNext={() => api.next?.()}
        atStart={p.index <= 0}
        atEnd={p.index >= p.count - 1}
        prevLabel={t.controls.prevPage}
        nextLabel={t.controls.nextPage}
      />
      <Sep />
      <Word onClick={() => api.toggle?.()} label={t.controls.closeAlbum}>
        {t.controls.close}
      </Word>
    </>
  );
}

/* ------------------------------------------------------------------ the Profile sheet (phones, landscape: §1.6.9) */
function ProfileSheet({ profile, han, tab, material, onMaterial, printed, onClose }: { profile: Profile; han: HanLang; tab: Tab; material: CoverMaterial; onMaterial(m: CoverMaterial): void; printed: boolean; onClose(): void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [out, setOut] = useState(false);
  const done = useRef(false);
  /** set when our own cleanup closes the dialog (StrictMode re-mount, unmount): that "close" event is not a user close */
  const suppress = useRef(false);
  const close = useCallback(() => {
    if (done.current) return;
    if (prefersReducedMotion()) {
      done.current = true;
      ref.current?.close();
      return;
    }
    setOut(true);
    window.setTimeout(() => {
      done.current = true;
      ref.current?.close();
    }, 300);
  }, []);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    d.focus({ preventScroll: true });
    return () => {
      if (d.open) {
        suppress.current = true;
        d.close();
      }
    };
  }, []);
  useFontRuns(run("serif", 400, han, profile.bio));
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={t.profile.sheet}
      tabIndex={-1}
      data-out={out || undefined}
      style={dy ? ({ "--dy": `${dy}px` } as CSSProperties) : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => {
        if (suppress.current) {
          suppress.current = false;
          return;
        }
        opener.current?.focus({ preventScroll: true });
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="sheet-grip"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, id: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId) setDy(Math.max(0, e.clientY - drag.current.y));
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          if (dy > 80) close();
          setDy(0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDy(0);
        }}
      >
        <i aria-hidden="true" />
      </div>
      <div className="sheet-body">
        <p className="jo" {...textProps(profile.bio, profile.lang, han)}>
          {profile.bio}
        </p>
        <Colophon profile={profile} han={han} />
        {!printed ? <CaseSwitch tab={tab} material={material} onMaterial={onMaterial} /> : null}
        <Prefs tab={tab} />
      </div>
    </dialog>
  );
}

/** " →" to the text version, after the no-WebGL line */
function TextLink({ tab }: { tab: Tab }) {
  const t = useT();
  return (
    <>
      {" "}
      <a className="tl" href={pageUrl({ view: "text", tab })} aria-label={t.loading.noGlLink}>
        →
      </a>
    </>
  );
}

/* ------------------------------------------------------------------ the shell */
type ShellProps = {
  profile: Profile;
  /** The folio's languages and the switch (two or more), and a switch's fade of the words that change (App useLanguage). */
  langs?: Langs | undefined;
  fade?: "out" | "in" | null;
  tab: Tab;
  /** The booklet picked a moment ago while the current one fades out: the index shows it already. */
  next?: Tab | null;
  /** The booklet cannot be drawn and the printed version stands in: there is no case to choose. */
  printed?: boolean;
  onTab(t: Tab): void;
  view: View;
  /** The live stage's state and actions (null while none is mounted). */
  stage: StageApi | null;
  material: CoverMaterial;
  onMaterial(m: CoverMaterial): void;
  /** A detail view is up: the words, hashira and controls step back (the detail view draws its own frame). */
  detail: boolean;
  /** The handling line for the current booklet and state. */
  handling: string;
  /** The phone hint (empty: none). */
  hint: string;
  /** Daybreak (0 … 1): the window light rising with the first load. */
  day: number;
  /** While the booklet loads: the line in the book box centre and its progress. */
  loading: { label: string; progress: number } | null;
  /** The hashira (the text views pass their own). */
  hashira?: { local: string; latin: string; han: HanLang };
  children: ReactNode;
};

export function Shell({ profile, langs, fade = null, tab, next, printed = false, onTab, view, stage, material, onMaterial, detail, handling, hint, day, loading, hashira, children }: ShellProps) {
  const t = useT();
  const f = useFrame();
  const han = profileHan(profile);
  const folio = view === "folio";
  const shown = next ?? tab;
  const [sheet, setSheet] = useState(false);
  const phone = f.cls === "p" || f.cls === "t";
  const land = f.cls === "l";
  const compact = phone || land;
  // the stage region is named by the booklet it shows
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    mainRef.current?.setAttribute("aria-label", folio ? t.booklet[tab].name : view === "json" ? "profile.json" : t.text.printed);
  }, [folio, tab, view, t]);
  // the sheet only exists on phones and in landscape
  useEffect(() => {
    if (!compact) setSheet(false);
  }, [compact]);
  const chromeHan: HanLang = t.lang === "zh" ? "zh-Hans" : "ja";
  // the printed words (set at 500: Noto Sans SC 400 under a Chinese page) and the lines (400: Noto Sans SC 300)
  const c = t.controls;
  useFontRuns([
    ...run("serif", 400, han, profile.bio),
    ...run("sans", 400, chromeHan, handling, hint, loading?.label),
    ...run("sans", 500, chromeHan, c.open, c.close, c.closeFolio, c.closeFolioShort, c.shake, c.tilt, c.tiltOff, t.profile.open, t.case.label, ...Object.values(t.case.material), t.colophon.sound, t.colophon.on, t.colophon.off, t.colophon.textVersion, t.colophon.copied),
  ]);

  const n = countOf(profile, shown);
  const hs = hashira ?? { local: t.booklet[shown].local, latin: `${t.booklet[shown].latin} · ${pad2(n)}`, han: chromeHan };
  const showControls = folio && !!stage && stage.ready && !next;

  return (
    <div className="page" data-view={view} data-detail={detail || undefined} data-loading={loading ? "" : undefined} data-lang-out={fade === "out" || undefined} data-lang-in={fade === "in" || undefined} id="top">
      <a
        className="skip"
        href="#stage"
        onClick={(e) => {
          e.preventDefault();
          (document.getElementById("panel") ?? document.getElementById("stage"))?.focus({ preventScroll: true });
        }}
      >
        {t.nav.skip}
      </a>
      {/* the 3D desk's window light is the engine's; the flat book, the printed version and the text views keep a still one */}
      <Room day={folio ? day : 1} cast={!folio || printed || !!stage?.flat} />
      <main id="stage" className={folio ? "stage" : "sheetwrap"} tabIndex={-1} ref={mainRef}>
        {children}
      </main>
      {folio ? (
        <>
          <aside className="words" aria-label={profile.name}>
            <Identity profile={profile} han={han} onProfile={compact ? () => setSheet(true) : undefined} />
            {/* phones and the tablet: the switch in the header, at the identity's right (one tap, clear of the booklet tabs) */}
            {phone ? <LangSwitch langs={langs} han={han} tab={tab} /> : null}
            {f.cls !== "p" && f.cls !== "l" ? (
              <p className="jo" {...textProps(profile.bio, profile.lang, han)}>
                {profile.bio}
              </p>
            ) : null}
            <Toc profile={profile} tab={shown} onTab={onTab} />
            {land ? <LangSwitch langs={langs} han={han} tab={tab} /> : null}
            {!compact ? (
              <CrossFade k={handling} className="handling" ms={300}>
                <p aria-live="polite">
                  {handling}
                  {printed ? <TextLink tab={tab} /> : null}
                </p>
              </CrossFade>
            ) : null}
            {!compact ? (
              <div className="foot">
                <Colophon profile={profile} han={han} />
                {/* the desk: on the column's bottom lines, over Sound and Text version */}
                <LangSwitch langs={langs} han={han} tab={tab} />
                <Prefs tab={tab} />
              </div>
            ) : null}
          </aside>
          {f.cls !== "l" ? <Hashira local={hs.local} latin={hs.latin} han={hs.han} /> : null}
          <div className="hands" data-show={showControls || undefined}>
            {phone ? (
              <button type="button" className="pf" onClick={() => setSheet(true)} aria-haspopup="dialog">
                <span className="av" aria-hidden="true" {...textProps(profile.nameLocal ?? profile.name, profile.lang, han)}>
                  {profile.nameLocal ? Array.from(profile.nameLocal)[0] : (profile.name[0] ?? "")}
                </span>
                <span className="pf-t">{t.profile.open}</span>
              </button>
            ) : !compact && !printed ? (
              <CaseSwitch tab={tab} material={material} onMaterial={onMaterial} />
            ) : (
              <span />
            )}
            <div className="ctl" role="toolbar" aria-label={t.controls.toolbar} aria-hidden={!showControls || undefined} inert={!showControls}>
              {stage ? <StageControls api={stage} tab={tab} frame={f} /> : null}
            </div>
          </div>
          {phone && (hint || printed) ? (
            <p className="hint" aria-hidden={printed ? undefined : "true"}>
              {printed ? handling : hint}
              {printed ? <TextLink tab={tab} /> : null}
            </p>
          ) : null}
          {loading ? (
            <div className="dawn" role="status" style={{ "--p": loading.progress.toFixed(3) } as CSSProperties}>
              <span>{loading.label}</span>
              <i aria-hidden="true" />
            </div>
          ) : null}
          {sheet ? <ProfileSheet profile={profile} han={han} tab={tab} material={material} onMaterial={onMaterial} printed={printed} onClose={() => setSheet(false)} /> : null}
        </>
      ) : (
        <>
          <a className="back" href={view === "json" ? pageUrl({ view: "text", tab }) : pageUrl({ tab })}>
            <span aria-hidden="true">←</span> {view === "json" ? t.text.jsonBack : t.text.back}
          </a>
          <LangSwitch langs={langs} han={han} view={view} tab={tab} />
          {f.cls !== "l" && f.cls !== "p" ? <Hashira local={hs.local} latin={hs.latin} han={hs.han} /> : null}
        </>
      )}
    </div>
  );
}

export type { Dict };
