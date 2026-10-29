import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { profileHan } from "../fonts";
import type { PocketItem, Profile, ResumeItem } from "../profile/schema";
import { writeClipboard } from "./ContactRows";
import { hasHan, run, textProps, useFontRuns } from "./fonts";
import { useT } from "./i18n";
import { SpecRows } from "./Modal";
import { withLang } from "./ItemDetail";
import { Colophon, Identity } from "./Shell";
import { play } from "./sound";
import type { Tab } from "./types";
import { FALLBACK_TINT, NE_ARROW, isExternal, linkText, pad2, pageUrl, signature, specRows } from "./util";

/*
 * The profile in print (§1.6.12). `Letter` is the text version (?view=text, and what a booklet shows in its box when it cannot
 * be drawn): one sheet of 胡粉 paper on the desk, the label in a narrow left column, the person's words at reading size.
 * `ProfileView` is its invisible twin behind the 3D stages, for screen readers and crawlers. `JsonView` is the same sheet holding
 * profile.json.
 */

function Years({ from, to }: { from: string; to: string }) {
  return (
    <span className="yr">
      {from} <span aria-hidden="true">–</span>
      <span className="sr-only"> – </span> {to}
    </span>
  );
}

function Sec({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <section className="lt-sec" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <h2 className="lt-k" id={id ? `${id}-h` : undefined}>
        {label}
      </h2>
      <div className="lt-v">{children}</div>
    </section>
  );
}

/** "TypeScript · WebGL / three.js · …": each entry unbroken with its separator, so a line never starts with "·". */
function Listed({ items }: { items: string[] }) {
  return (
    <>
      {items.map((s, i) => (
        <Fragment key={i}>
          {i ? " " : null}
          <span className="lt-li">{i < items.length - 1 ? `${s} ·` : s}</span>
        </Fragment>
      ))}
    </>
  );
}

function ResumeText({ item, lang }: { item: ResumeItem; lang: string | undefined }) {
  const t = useT();
  const han = profileHan({ lang });
  const tp = (s: string) => textProps(s, lang, han);
  return (
    <>
      <Sec id="pv-resume" label={t.text.experience}>
        <p className="lt-lead" {...tp(item.summary)}>
          {item.summary}
        </p>
        <ol className="lt-jobs">
          {item.experience.map((e, i) => (
            <li key={e.org + i}>
              <h3 className="lt-job" {...tp(e.role + e.org)}>
                <span>
                  {e.role}
                  {t.text.join}
                  <b>{e.org}</b>
                </span>
                <Years from={e.from} to={e.to} />
              </h3>
              <ul className="lt-bul">
                {e.bullets.map((b, j) => (
                  <li key={j} {...tp(b)}>
                    {b}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Sec>
      <Sec label={t.text.education}>
        <ul className="lt-jobs">
          {item.education.map((e, i) => (
            <li key={e.school + i}>
              <h3 className="lt-job" {...tp(e.degree + e.school)}>
                <span>
                  {e.degree}
                  {t.text.join}
                  <b>{e.school}</b>
                </span>
                <Years from={e.from} to={e.to} />
              </h3>
            </li>
          ))}
        </ul>
      </Sec>
      <Sec label={t.text.skills}>
        <p className="lt-body" {...tp(item.skills.join(""))}>
          <Listed items={item.skills} />
        </p>
        {item.languages?.length ? (
          <p className="lt-body lt-langs" {...tp(item.languages.join(""))}>
            <Listed items={item.languages} />
          </p>
        ) : null}
        {item.pdf ? (
          <p className="lt-acts">
            <a className="lt-w" href={item.pdf} download>
              {t.detail.pdf} {t.detail.download} <span className="go">↓</span>
            </a>
          </p>
        ) : null}
      </Sec>
    </>
  );
}

function PouchItem({ item, i, profile, onOpenItem }: { item: PocketItem; i: number; profile: Profile; onOpenItem?: ((id: string) => void) | undefined }) {
  const t = useT();
  const han = profileHan(profile);
  const tp = (s: string) => textProps(s, profile.lang, han);
  const local = t.held[item.kind].local;
  return (
    <li className="lt-item" data-kind={item.kind}>
      <p className="lt-idx" aria-hidden="true">
        {pad2(i + 1)}
      </p>
      <div>
        <h3 className="lt-name" {...tp(item.label)}>
          {item.label}
          {/* the kind's local name, unless the title already says it (名片 · 名片) */}
          {item.label.includes(local) ? null : (
            <span className="lt-kind" {...textProps(local, t.lang === "zh" ? "zh-CN" : "ja", han)}>
              {local}
            </span>
          )}
        </h3>
        {item.anecdote ? (
          <p className="lt-body" {...tp(item.anecdote)}>
            {item.anecdote}
          </p>
        ) : null}
        {item.kind === "note" ? (
          <p className="lt-hand" data-han={hasHan(item.text) ? undefined : "ja"} {...tp(item.text)}>
            {item.text}
            <span className="lt-from">{signature(item.text, item.from)}</span>
          </p>
        ) : null}
        <SpecRows rows={specRows(item, t).map((r) => withLang(r, profile.lang, han))} className="lt-specs" />
        <p className="lt-acts">
          {onOpenItem ? (
            <button type="button" className="lt-w" onClick={() => onOpenItem(item.id)}>
              {t.text.lookCloser} <span className="go">→</span>
            </button>
          ) : null}
          {[...(item.links ?? []), ...(item.href ? [{ label: linkText(item.href), href: item.href }] : [])].map((l) => (
            <a key={l.href} className="lt-w" href={l.href} {...(isExternal(l.href) ? { target: "_blank", rel: "noopener" } : {})}>
              <span {...tp(l.label)}>{l.label}</span> <span className="go">{NE_ARROW}</span>
            </a>
          ))}
        </p>
      </div>
    </li>
  );
}

type LetterProps = {
  profile: Profile;
  /** In the book box (a booklet that cannot be drawn): start at that booklet's section. */
  focus?: Tab;
  compact?: boolean;
  onOpenItem?(id: string): void;
  onOpenCard?(kind: "cards" | "postcards", id: string): void;
};

export function Letter({ profile, focus, compact, onOpenItem, onOpenCard }: LetterProps) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const han = profileHan(profile);
  const tp = (s: string) => textProps(s, profile.lang, han);
  const resumes = profile.items.filter((i): i is ResumeItem => i.kind === "resume");
  const { cards, postcards } = profile.albums;
  useFontRuns([
    ...run("serif", 500, han, profile.nameLocal, profile.name, ...profile.items.map((i) => i.label), ...resumes.flatMap((r) => r.experience.map((e) => e.role + e.org))),
    ...run("sans", 400, han, profile.bio, ...profile.items.map((i) => i.anecdote), ...cards.map((c) => c.label + (c.nameLocal ?? "")), ...postcards.map((p) => p.place), ...resumes.flatMap((r) => [r.summary, ...r.experience.flatMap((e) => e.bullets)])),
    ...run("hand", 600, han, ...postcards.map((p) => p.message), ...profile.items.map((i) => (i.kind === "note" ? i.text : ""))),
    // the kinds' local names (名刺 …) and the 和色 names: the faces they are set in, at 400
    ...run("serif", 400, t.lang === "zh" ? "zh-Hans" : "ja", ...profile.items.map((i) => t.held[i.kind].local)),
    ...run("serif", 400, t.lang === "zh" ? han : "ja", ...cards.map((c) => c.nameLocal)),
    // the organisations are set bold (600)
    ...run("serif", 600, han, ...resumes.flatMap((r) => [...r.experience.map((e) => e.org), ...r.education.map((e) => e.school)])),
  ]);

  useLayoutEffect(() => {
    if (!focus) return;
    const el = root.current?.querySelector<HTMLElement>(`#pv-${focus}`);
    const scroller = root.current?.closest<HTMLElement>(".panel");
    if (el && scroller) scroller.scrollTop = Math.max(0, el.offsetTop - 24);
  }, [focus]);

  return (
    <article ref={root} className="letter" data-compact={compact || undefined} aria-label={t.text.printed}>
      <header className="lt-head">
        <Identity profile={profile} han={han} asHeading={!compact} />
      </header>

      <Sec id="pv-profile" label={t.text.profile}>
        <p className="lt-prose" {...tp(profile.bio)}>
          {profile.bio}
        </p>
      </Sec>

      {resumes.map((r) => (
        <ResumeText key={r.id} item={r} lang={profile.lang} />
      ))}

      <Sec id="pv-contact" label={t.text.elsewhere}>
        <ul className="lt-links">
          {profile.links.map((l) => (
            <li key={l.href}>
              <span className="lt-lk" {...tp(l.label)}>
                {l.label}
              </span>
              <a href={l.href} {...(isExternal(l.href) ? { target: "_blank", rel: "me noopener" } : {})}>
                {linkText(l.href)}
              </a>
            </li>
          ))}
        </ul>
      </Sec>

      <Sec id="pv-pouch" label={t.text.pouch}>
        <ol className="lt-items">
          {profile.items.map((item, i) => (
            <PouchItem key={item.id} item={item} i={i} profile={profile} onOpenItem={onOpenItem} />
          ))}
        </ol>
      </Sec>

      <Sec id="pv-cards" label={t.text.cards}>
        <ul className="lt-album">
          {cards.map((c, i) => {
            const body = (
              <>
                <span className="lt-n">{pad2(i + 1)}</span>
                <i className="lt-chip" style={{ "--tint": c.color ?? FALLBACK_TINT } as CSSProperties} aria-hidden="true" />
                <span className="lt-cl" {...tp(c.label)}>
                  {c.label}
                </span>
                {c.nameLocal ? (
                  // 和色: the Japanese face the card itself prints it in; a Chinese page reads it as its own colour name
                  <span className="lt-cj" {...textProps(c.nameLocal, t.lang === "zh" ? profile.lang : "ja", han)}>
                    {c.nameLocal}
                  </span>
                ) : null}
              </>
            );
            return <li key={c.id}>{onOpenCard ? <button type="button" className="lt-row" onClick={() => onOpenCard("cards", c.id)}>{body}</button> : <span className="lt-row">{body}</span>}</li>;
          })}
        </ul>
      </Sec>

      <Sec id="pv-postcards" label={t.text.postcards}>
        <ul className="lt-album lt-pc">
          {postcards.map((c) => {
            const body = (
              <>
                <span className="lt-thumb" style={{ "--tint": c.color ?? FALLBACK_TINT } as CSSProperties} aria-hidden="true">
                  {c.src ? <img src={c.src} alt="" loading="lazy" draggable={false} /> : null}
                </span>
                <span className="lt-pl">
                  <span className="lt-pp" {...tp(c.place)}>
                    {c.place}
                    {c.date ? ` · ${t.date(c.date)}` : ""}
                  </span>
                  <span className="lt-msg" {...tp(c.message)} data-han={hasHan(c.message) ? tp(c.message)["data-han"] : "ja"}>
                    {c.message}
                    <span className="lt-from">{signature(c.message, c.from)}</span>
                  </span>
                </span>
              </>
            );
            return <li key={c.id}>{onOpenCard ? <button type="button" className="lt-row" onClick={() => onOpenCard("postcards", c.id)}>{body}</button> : <span className="lt-row">{body}</span>}</li>;
          })}
        </ul>
      </Sec>

      <footer className="lt-foot">
        <Colophon profile={profile} han={han} />
        <a className="lt-w" href={pageUrl({ view: "json" })}>
          {t.text.json} <span className="go">→</span>
        </a>
      </footer>
    </article>
  );
}

/**
 * The invisible twin of the 3D stages: the whole profile as plain structured HTML for screen readers and crawlers. Its links are
 * kept out of the tab order (a visually hidden region must not be a keyboard trap for sighted visitors).
 */
export function ProfileView({ profile }: { profile: Profile }) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>("a, button").forEach((el) => el.setAttribute("tabindex", "-1"));
  });
  const resumes = profile.items.filter((i): i is ResumeItem => i.kind === "resume");
  return (
    <article ref={root} className="sr-only" aria-label={t.text.printed} id="profile-text" lang={profile.lang ?? "en"}>
      <h2>
        {profile.name}
        {profile.nameLocal ? <span> {profile.nameLocal}</span> : null}
      </h2>
      <p>{[profile.role, profile.location, profile.handle].filter(Boolean).join(" · ")}</p>
      <p>{profile.bio}</p>
      <h3>{t.text.contact}</h3>
      <ul>
        {profile.links.map((l, i) => (
          <li key={l.href + i}>
            <a href={l.href}>{l.label}</a> {linkText(l.href)}
          </li>
        ))}
        {profile.source ? (
          <li>
            <a href={profile.source}>{t.colophon.source}</a> {linkText(profile.source)}
          </li>
        ) : null}
      </ul>
      <h3>{t.text.pouch}</h3>
      <ol>
        {profile.items.map((item) => (
          <li key={item.id}>
            <h4>{item.label}</h4>
            {item.anecdote ? <p>{item.anecdote}</p> : null}
            {item.story ? <p>{item.story}</p> : null}
            <dl>
              {specRows(item, t).map((r, i) => (
                <div key={r.k + i}>
                  <dt>{r.k}</dt>
                  <dd>{r.v}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
      {resumes.map((r) => (
        <section key={r.id}>
          <h3>{r.label}</h3>
          <p>{r.summary}</p>
          <ul>
            {r.experience.map((e, i) => (
              <li key={e.org + i}>
                {e.role}, {e.org} ({e.from} – {e.to}): {e.bullets.join(" ")}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <h3>{t.text.cards}</h3>
      <ul>
        {profile.albums.cards.map((c) => (
          <li key={c.id}>
            {c.label}
            {c.nameLocal ? ` ${c.nameLocal}` : ""}
            {c.note ? ` — ${c.note}` : ""}
          </li>
        ))}
      </ul>
      <h3>{t.text.postcards}</h3>
      <ul>
        {profile.albums.postcards.map((c) => (
          <li key={c.id}>
            {c.label}: {c.message} — {c.from}, {c.place}
            {c.date ? `, ${t.date(c.date)}` : ""}
          </li>
        ))}
      </ul>
    </article>
  );
}

/* ------------------------------------------------------------------ ?view=json */
type Tok = { t: "k" | "s" | "n" | "p" | "w"; v: string };
/** A tiny tokenizer for pretty JSON: keys, strings, numbers / booleans / null, punctuation, whitespace. */
function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([{}[\],:])|(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) {
      out.push({ t: m[2] ? "k" : "s", v: m[1] });
      if (m[2]) out.push({ t: "p", v: m[2] });
    } else if (m[3]) out.push({ t: "n", v: m[3] });
    else if (m[4]) out.push({ t: "p", v: m[4] });
    else if (m[5]) out.push({ t: "w", v: m[5] });
  }
  return out;
}

export function JsonView({ profile }: { profile: Profile }) {
  const t = useT();
  const text = useMemo(() => JSON.stringify(profile, null, 2), [profile]);
  const toks = useMemo(() => tokenize(text), [text]);
  const kb = (new Blob([text]).size / 1024).toFixed(1);
  const [copied, setCopied] = useState(false);
  const href = useMemo(() => `data:application/json;charset=utf-8,${encodeURIComponent(text)}`, [text]);
  return (
    <article className="letter json" aria-label={t.text.jsonAria}>
      <header className="js-head">
        <p className="js-name">profile.json · {kb} KB</p>
        <p className="js-acts">
          <button
            type="button"
            className="lt-w"
            onClick={async () => {
              if (await writeClipboard(text)) {
                play("copy");
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }
            }}
          >
            {copied ? (
              <>
                <i className="cdot" aria-hidden="true" />
                {t.text.copied}
              </>
            ) : (
              t.text.copy
            )}
          </button>
          <a className="lt-w" href={href} download="profile.json">
            {t.text.download} <span className="go">↓</span>
          </a>
        </p>
      </header>
      <pre className="js" tabIndex={0} aria-label="profile.json">
        {toks.map((k, i) => (k.t === "w" ? k.v : <span key={i} className={`j-${k.t}`}>{k.v}</span>))}
      </pre>
    </article>
  );
}
