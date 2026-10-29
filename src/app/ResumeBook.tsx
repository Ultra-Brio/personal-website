import { profileHan } from "../fonts";
import type { Profile, ResumeItem } from "../profile/schema";
import { run, textProps, useFontRuns } from "./fonts";
import { useT } from "./i18n";
import { linkText, pad2, zoneShort } from "./util";

/*
 * The DOM résumé (no WebGL / a lost paper context): two A4 pages set like the paper viewer's typesetter — a running head over a
 * rule, the name in Shippori Mincho on the content column, a hanging label column, job lines with the years, en-rule bullets.
 * Sizes are in cqw of the page width, so it is the same page at any size. On a desk both pages lie side by side, bound at the
 * centre; on a phone one page is shown at a time (`page`). The seal is printed on the paper only, never in the DOM (§S).
 */

function Years({ from, to }: { from: string; to: string }) {
  return (
    <span className="yr">
      {from} <span aria-hidden="true">–</span>
      <span className="sr-only"> – </span> {to}
    </span>
  );
}

export function ResumePages({ profile, item, page = 0 }: { profile: Profile; item: ResumeItem; page?: number }) {
  const t = useT();
  const han = profileHan(profile);
  const tp = (s: string) => textProps(s, profile.lang, han);
  useFontRuns([
    ...run("serif", 500, han, profile.name, profile.nameLocal),
    ...run("serif", 400, han, profile.role, profile.location, item.summary, ...item.experience.map((e) => e.role), ...item.education.map((e) => e.degree)),
    ...run("serif", 600, han, ...item.experience.map((e) => e.org), ...item.education.map((e) => e.school)),
    ...run("sans", 400, han, ...item.experience.flatMap((e) => e.bullets), ...item.skills, ...(item.languages ?? [])),
    ...run("sans", 500, t.lang === "zh" ? "zh-Hans" : han, t.text.profile, t.text.experience, t.text.education, t.text.skills, t.text.languages, t.text.elsewhere),
  ]);
  const site = profile.links.find((l) => /^https?:/.test(l.href) && !/github|twitter|x\.com|linkedin/.test(l.href));
  const mail = profile.links.find((l) => l.href.startsWith("mailto:"));
  return (
    <div className="rs-spread" data-page={page}>
      <article className="pg pg-l" aria-label={t.paper.page(1, 2)}>
        <div className="rs">
          <div className="rs-top">
            <b {...tp(profile.name)}>{profile.name}</b>
            <span>{site ? linkText(site.href) : (profile.handle ?? "")}</span>
            <span>{mail ? linkText(mail.href) : ""}</span>
          </div>
          <h3 className="rs-name" {...tp(profile.name)}>
            {profile.name}
            {profile.nameLocal ? <span {...tp(profile.nameLocal)}>{profile.nameLocal}</span> : null}
          </h3>
          <p className="rs-role" {...tp(profile.role)}>
            {profile.role}
            {profile.location ? `, ${profile.location}` : ""}
          </p>
          <section className="rs-sec">
            <span className="k">{t.text.profile}</span>
            <p className="rs-sum" {...tp(item.summary)}>
              {item.summary}
            </p>
          </section>
          <section className="rs-sec">
            <span className="k">{t.text.experience}</span>
            <div>
              {item.experience.map((e, i) => (
                <div className="job" key={e.org + i}>
                  <h4 {...tp(e.role + e.org)}>
                    <span className="jt">
                      {e.role}, <b>{e.org}</b>
                    </span>
                    <Years from={e.from} to={e.to} />
                  </h4>
                  <ul>
                    {e.bullets.map((b, j) => (
                      <li key={j} {...tp(b)}>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
          <div className="rs-foot">
            <span>{profile.name}</span>
            <span>1 / 2</span>
          </div>
        </div>
      </article>
      <article className="pg pg-r" aria-label={t.paper.page(2, 2)}>
        <div className="rs">
          <div className="rs-top">
            <b {...tp(profile.name)}>{profile.name}</b>
            <span>{[profile.location, profile.timezone ? zoneShort(profile.timezone) : null].filter(Boolean).join(" · ")}</span>
            <span>{profile.handle ?? ""}</span>
          </div>
          <section className="rs-sec rs-first">
            <span className="k">{t.text.education}</span>
            <div>
              {item.education.map((e, i) => (
                <div className="job" key={e.school + i}>
                  <h4 {...tp(e.degree + e.school)}>
                    <span className="jt">
                      {e.degree}, <b>{e.school}</b>
                    </span>
                    <Years from={e.from} to={e.to} />
                  </h4>
                </div>
              ))}
            </div>
          </section>
          <section className="rs-sec">
            <span className="k">{t.text.skills}</span>
            <ul className="tags">
              {item.skills.map((s) => (
                <li key={s} {...tp(s)}>
                  {s}
                </li>
              ))}
            </ul>
          </section>
          {item.languages?.length ? (
            <section className="rs-sec">
              <span className="k">{t.text.languages}</span>
              <ul className="tags">
                {item.languages.map((s) => (
                  <li key={s} {...tp(s)}>
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="rs-sec">
            <span className="k">{t.text.elsewhere}</span>
            <ul className="rs-links">
              {profile.links.map((l, i) => (
                <li key={l.href}>
                  <span className="i" aria-hidden="true">
                    {pad2(i + 1)}
                  </span>
                  <span className="k2" {...tp(l.label)}>
                    {l.label}
                  </span>
                  <span>{linkText(l.href)}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="rs-foot">
            <span>{profile.name}</span>
            <span>2 / 2</span>
          </div>
        </div>
      </article>
    </div>
  );
}
