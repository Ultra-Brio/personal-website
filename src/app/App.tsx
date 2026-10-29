import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { CoverMaterial } from "../book/cover";
import { ensureFonts, hanLangOf, profileHan } from "../fonts";
import { folioLangs, langKey, langName, loadProfile, type Folio } from "../profile/folio";
import type { Profile } from "../profile/schema";
import { profile as sample } from "../../profile/en";
import { AlbumDetail } from "./AlbumDetail";
import { readMaterials, writeMaterial } from "./booklets";
import { applyFontVars, loadDomFaces, pageRuns, run } from "./fonts";
import { dictFor, I18n } from "./i18n";
import { ItemDetail } from "./ItemDetail";
import { useFrame } from "./layout";
import { JsonView, Letter, ProfileView } from "./ProfileView";
import { Shell } from "./Shell";
import { play, soundKit, useMuted } from "./sound";
import { StagePlaceholder } from "./StagePlaceholder";
import { STAGES } from "./stages";
import { DEFAULT_TAB, TAB_IDS, type Detail, type Langs, type StageApi, type StageMap, type StageProps, type Tab, type View } from "./types";
import { findItem, prefersReducedMotion, storeLang, typingTarget, writeUrlLang } from "./util";

export type { StageProps, StageMap, Tab } from "./types";
export type AppProps = {
  /** The one content model (with a folio: the language `lang`'s, already loaded). Defaults to the demo persona. */
  profile?: Profile;
  /**
   * The person in several languages (src/profile/folio.ts): with two or more the page shows the language switch and changes
   * language in place — the booklet, the open cover, the page and the case stay; the words, the print on the booklets and the URL's
   * ?lang= follow.
   */
  folio?: Folio;
  /** The folio's language `profile` is in (default: its own `lang`'s key). */
  lang?: string;
  /** The 3D stages (default: the lazy-loaded book and folio stages). A booklet left out of a custom map shows the printed version. */
  stages?: Partial<StageMap>;
};

const isTab = (v: string): v is Tab => (TAB_IDS as readonly string[]).includes(v);
const readTab = (): Tab => {
  const h = window.location.hash.replace(/^#/, "");
  return isTab(h) ? h : DEFAULT_TAB;
};
function readView(): View {
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "text" || v === "json" ? v : "folio";
}
const HINT_KEY = "sasshi:hinted";
function readHinted(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** A stage that throws while rendering counts as "cannot render": fall back to the printed version instead of a blank page. */
class StageBoundary extends Component<{ onFail(): void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[sasshi] stage failed, falling back to the printed version", error, info.componentStack);
    this.props.onFail();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Daybreak (§1.6.13): the desk and the words paint first; the window light rises with the first load, never faster than 600 ms
 * and never slower than 1.6 s. Returns the light (0 … 1) and the load progress for the line in the book box.
 */
function useDaybreak(ready: boolean, done: boolean): { day: number; progress: number } {
  const [s, set] = useState(() => (prefersReducedMotion() ? { day: 1, progress: 1 } : { day: 0, progress: 0.05 }));
  const start = useRef(0);
  const readyRef = useRef(ready);
  readyRef.current = ready || done;
  useEffect(() => {
    if (s.day >= 1) return;
    if (!start.current) start.current = performance.now();
    let raf = 0;
    const tick = () => {
      const t = performance.now() - start.current;
      const load = readyRef.current ? 1 : 0.85 * (1 - Math.exp(-t / 900));
      const day = Math.min(1, t / 600, Math.max(load, t / 1600));
      set({ day, progress: load });
      if (day < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one dawn per page load
  }, []);
  return ready || done ? { day: s.day, progress: 1 } : s;
}

/**
 * Whether the scene's ambient motion may run (brief r3 D2: the twig's sway): never while a dialog is up (a held thing, the Profile
 * sheet; a held thing's close un-blurs the stage while its veil fades: app.css) nor for a moment after one has closed, never while
 * the tab is hidden. The page behind a dialog is then still, so the veil over it is painted once.
 */
function useAmbient(detail: boolean): boolean {
  const [dialog, setDialog] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    const read = () => setDialog(!!document.querySelector("dialog[open]"));
    const mo = new MutationObserver(read);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    const vis = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", vis);
    read();
    return () => {
      mo.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  const busy = detail || dialog;
  useEffect(() => {
    if (busy) {
      setSettling(true);
      return;
    }
    const t = window.setTimeout(() => setSettling(false), 420);
    return () => window.clearTimeout(t);
  }, [busy]);
  return !busy && !settling && !hidden;
}

/** A language switch: the changing words fade out this long, the new ones in over LANG_IN (app.css data-lang-out / data-lang-in). */
const LANG_OUT = 160;
const LANG_IN = 180;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
/** "out": the words that change with the language are fading out; "in": the new ones are fading in. */
export type LangFade = "out" | "in" | null;

/**
 * The folio's language on view and the switch (brief r4 E1). A switch loads the language's profile (its chunk, the first time) and
 * the faces of the words the desk sets in it, then fades out the words that change (the identity, the bio, the booklet names, the
 * printed controls: app.css), sets `<html lang>` meanwhile (src/fonts re-weights its Chinese faces by it, so the new words' faces
 * are loaded in the weights they will be set in), puts the new words in and fades them in at once — in the same commit, as a CSS
 * animation the compositor runs, so a busy main thread cannot hold the desk wordless — writes ?lang= with replaceState and remembers
 * the choice. The booklet on the desk (`stage`) follows only once the words are back in full: whatever its print costs (a repaint,
 * or a rebuild with the case's own words), the words stay on view meanwhile, so no frame shows neither. A later click wins.
 */
function useLanguage(first: Profile, folio: Folio | undefined, firstLang: string | undefined) {
  const [shown, setShown] = useState(() => ({ lang: firstLang ?? langKey(first.lang), profile: first }));
  const [fade, setFade] = useState<LangFade>(null);
  const [stage, setStage] = useState(first);
  const gen = useRef(0);
  const current = useRef(shown);
  current.current = shown;
  const list = useMemo(() => (folio ? folioLangs(folio) : []), [folio]);
  // the booklet's print follows the words whenever they are not mid-fade
  useEffect(() => {
    if (fade === null) setStage(shown.profile);
  }, [fade, shown.profile]);
  const set = useCallback(
    (next: string) => {
      if (!folio || !list.includes(next)) return;
      const my = ++gen.current;
      if (next === current.current.lang) {
        // (back to the words on view before the other language arrived: they come back in)
        storeLang(next);
        writeUrlLang(next);
        document.documentElement.lang = dictFor(current.current.profile).htmlLang;
        setFade((f) => (f === "out" ? "in" : f));
        void wait(LANG_IN + 40).then(() => my === gen.current && setFade(null));
        return;
      }
      void (async () => {
        let p: Profile;
        try {
          p = await loadProfile(folio, next);
        } catch (err) {
          console.warn(`[sasshi] the "${next}" profile did not load`, err);
          if (my === gen.current) setFade(null);
          return;
        }
        if (my !== gen.current) return;
        // the new words' faces before they are shown (capped: a slow network shows them with font-display swap instead), the
        // switch's own names in both its weights (it stays on view throughout)
        const t = dictFor(p);
        const runs = [...pageRuns(p, t), ...list.flatMap((l) => [400, 500].flatMap((w) => run("sans", w, hanLangOf(langName(l), l), langName(l))))];
        loadDomFaces(p, t.lang === "zh");
        await Promise.race([ensureFonts(runs).catch(() => {}), wait(1500)]);
        if (my !== gen.current) return;
        const motion = !prefersReducedMotion();
        if (motion) setFade("out");
        // the page's language first: the Chinese faces take its weight bands, and what that changes loads while the words are out
        document.documentElement.lang = t.htmlLang;
        await Promise.all([motion ? wait(LANG_OUT) : null, Promise.race([ensureFonts(runs).catch(() => {}), wait(motion ? 600 : 300)])]);
        if (my !== gen.current) return;
        // (remembered only once it is on view: a language whose chunk fails to load is not tried again on every visit)
        writeUrlLang(next);
        storeLang(next);
        setShown({ lang: next, profile: p });
        if (!motion) return setFade(null);
        setFade("in");
        // (counted from the frame that shows them, not from the commit: a long task between the two is not fade-in time)
        await Promise.race([new Promise((r) => requestAnimationFrame(r)), wait(100)]);
        await wait(LANG_IN + 40);
        if (my === gen.current) setFade(null);
      })();
    },
    [folio, list],
  );
  const langs = useMemo<Langs | undefined>(() => (list.length > 1 ? { list, current: shown.lang, set } : undefined), [list, shown.lang, set]);
  return { profile: shown.profile, stageProfile: stage, langs, fade };
}

export function App({ profile: firstProfile = sample, folio, lang: firstLang, stages = STAGES }: AppProps) {
  const { profile, stageProfile, langs, fade } = useLanguage(firstProfile, folio, firstLang);
  const t = useMemo(() => dictFor(profile), [profile]);
  /** The booklet's own words (its labels, the slip): they follow the page's once a switch's new words are in (useLanguage). */
  const st = useMemo(() => dictFor(stageProfile), [stageProfile]);
  const han = profileHan(profile);
  const view = useMemo(readView, []);
  const frame = useFrame();
  const [tab, setTabState] = useState<Tab>(readTab);
  /** The booklet the visitor just picked while the one on the desk fades out. */
  const [leaving, setLeaving] = useState<Tab | null>(null);
  const leaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const [detail, setDetail] = useState<Detail>(null);
  const [unsupported, setUnsupported] = useState<Partial<Record<Tab, boolean>>>({});
  const [materials, setMaterials] = useState(readMaterials);
  const [stage, setStage] = useState<StageApi | null>(null);
  const [hinted, setHinted] = useState(readHinted);
  const { toggle: toggleSound } = useMuted();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageApi | null>(null);
  stageRef.current = stage;

  // The page's language and faces follow the profile
  useLayoutEffect(() => {
    document.documentElement.lang = t.htmlLang;
    applyFontVars(han);
    loadDomFaces(profile, t.lang === "zh");
  }, [t, han, profile]);

  // Hash <-> booklet. The default is written with replaceState so Back does not land on an empty hash.
  useEffect(() => {
    if (view === "folio" && !isTab(window.location.hash.replace(/^#/, ""))) window.history.replaceState(null, "", `${window.location.search}#${DEFAULT_TAB}`);
    const on = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (!isTab(h)) return; // foreign anchors never change the booklet
      window.clearTimeout(leaveTimer.current);
      setLeaving(null);
      setTabState(h);
      setDetail(null);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [view]);
  // The text version opened with a booklet's hash (#resume from "Read as text"): start at that section
  useLayoutEffect(() => {
    if (view !== "text") return;
    const h = window.location.hash.replace(/^#/, "");
    if (isTab(h)) document.getElementById(`pv-${h}`)?.scrollIntoView({ block: "start" });
  }, [view]);
  // The page's one sound kit: created now so it can listen for the first gesture (it plays nothing before one)
  useEffect(() => void soundKit(), []);

  const setTab = useCallback(
    (next: Tab) => {
      if (view !== "folio") {
        document.getElementById(`pv-${next}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
        return;
      }
      window.clearTimeout(leaveTimer.current);
      const commit = () => {
        setLeaving(null);
        setTabState(next);
        setDetail(null);
        setStage(null);
        if (window.location.hash !== `#${next}`) window.location.hash = next;
      };
      if (next === readTab()) return commit();
      play("tab");
      // the booklet on the desk fades out (a 4 px blur), then the next one comes up in its place
      if (prefersReducedMotion()) return commit();
      setLeaving(next);
      leaveTimer.current = window.setTimeout(commit, 240);
    },
    [view],
  );

  useEffect(() => {
    document.title = t.meta.title(profile, view);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = t.meta.description(profile);
  }, [profile, view, t]);

  const onPickItem = useCallback(
    (id: string) => {
      if (findItem(profile, id)) setDetail({ type: "item", id });
    },
    [profile],
  );
  const onPickCard = useCallback(
    (kind: "cards" | "postcards", id: string) => {
      if (!profile.albums[kind].some((c) => c.id === id)) return;
      play("pickUp", { gain: 0.5 });
      setDetail({ type: "album", kind, id });
    },
    [profile],
  );
  const closeDetail = useCallback(() => {
    play("drop", { gain: 0.35 });
    setDetail(null);
  }, []);
  const fallbackFocus = useCallback(() => (panelRef.current ?? document.getElementById("stage"))?.focus({ preventScroll: true }), []);
  const markUnsupported = useCallback((x: Tab) => setUnsupported((u) => (u[x] ? u : { ...u, [x]: true })), []);

  const material = materials[tab];
  const setMaterial = useCallback(
    (m: CoverMaterial) => {
      if (materials[tab] === m) return;
      play("tab", { gain: 0.5 });
      setMaterials((cur) => ({ ...cur, [tab]: m }));
      writeMaterial(tab, m);
    },
    [tab, materials],
  );

  // Keys (§1.8): 1 2 3 booklets; ← → pages; Space opens a closed booklet; S shake; M sound. Never while typing, with a
  // modifier, or while a dialog (a held object, the Profile sheet) is up: those handle their own keys.
  useEffect(() => {
    if (view !== "folio") return;
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e)) return;
      if (detail || document.querySelector("dialog[open]")) return;
      const api = stageRef.current;
      const k = e.key;
      const n = Number(k);
      if (!e.repeat && n >= 1 && n <= TAB_IDS.length) {
        const x = TAB_IDS[n - 1];
        if (x) setTab(x);
      } else if ((k === "ArrowRight" || k === "ArrowLeft") && api?.ready && api.open && api.page) {
        if (k === "ArrowRight") api.next?.();
        else if (!e.repeat || api.page.index > 0) api.prev?.();
      } else if (k === " " && api?.ready && !api.open && !(e.target as HTMLElement | null)?.closest?.("button, a")) {
        api.toggle?.();
      } else if (!e.repeat && (k === "s" || k === "S") && api?.ready && api.open && api.shake) api.shake();
      else if (!e.repeat && (k === "m" || k === "M")) toggleSound();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [view, detail, setTab, toggleSound]);

  // The first touch on the stage retires the phone hint for good
  const onStagePointer = (_: ReactPointerEvent) => {
    if (hinted) return;
    setHinted(true);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const item = detail?.type === "item" ? findItem(profile, detail.id) : null;
  const Stage = stages[tab];
  const fallback = !!unsupported[tab] || !Stage;
  const onUnsupported = useCallback(() => markUnsupported(tab), [markUnsupported, tab]);
  const onStage = useCallback((api: StageApi | null) => setStage(api), []);
  const chromeHan = t.lang === "zh" ? "zh-Hans" : "ja";
  const stageHan = st.lang === "zh" ? "zh-Hans" : "ja";
  const labels = useMemo(() => {
    // the book's keyboard links and page counter speak the page's language too (its defaults are English)
    const common = { prev: st.controls.prevPage, next: st.controls.nextPage, pageOf: st.controls.pageOf, openCard: st.controls.openCard };
    return tab === "resume"
      ? { ...common, region: st.lang === "zh" ? st.booklet.resume.name : st.booklet.resume.latin, openBook: st.controls.openFolio, closeBook: st.controls.closeFolio, loading: st.loading.folio, cardsHere: st.booklet.resume.name }
      : { ...common, region: st.booklet[tab].name, openBook: st.controls.openAlbum, closeBook: st.controls.closeAlbum, loading: st.loading.album, cardsHere: st.booklet[tab].name };
  }, [st, tab]);
  const slip = useMemo(() => ({ title: st.booklet[tab].local, han: stageHan }) as const, [st, tab, stageHan]);
  // the albums' open spreads are width-bound: on a desk they reach into the 間 column, a margin clear of the words (layout.ts wide)
  const insets = tab === "resume" ? frame.insets : tab === "cards" ? frame.wideCards : frame.wide;
  // the phone turns one page at a time, the tablet in portrait too (an iPad's 3:4 sits exactly on the engine's own threshold); a
  // tablet-sized window held landscape (900 × 600) shows the open spread
  const narrow = frame.cls === "p" || (frame.cls === "t" && frame.H >= frame.W) ? true : frame.cls === "t" ? false : undefined;
  const ambient = useAmbient(!!detail);
  const stageProps: StageProps = { profile: stageProfile, material, insets, ...(narrow !== undefined ? { narrow } : {}), slip, labels, onPickItem, onPickCard, active: true, ambient, onUnsupported, onStage };

  const ready = !!stage?.ready || fallback;
  const dawn = useDaybreak(!!stage?.ready, fallback || view !== "folio");
  const flat = !!stage?.flat;
  const handling = fallback
    ? t.handling.printed
    : stage && stage.ready && !stage.open
      ? t.handling.closed
      : tab === "resume"
        ? t.handling.resume
        : tab === "cards"
          ? t.handling.cards
          : t.handling.postcards(profile.albums.postcards.length);
  // the phone hint is about the 3D booklet (tap the closed cover; tilt, swipe a page until the first touch): not over the flat
  // book or the printed version. A tablet-sized window driven by a mouse reads the desk's handling line instead (no swipes, no tilt).
  const hint = fallback || flat || !stage?.ready ? "" : !stage.open ? (frame.coarse ? t.hint.closed : t.handling.closed) : hinted ? "" : !frame.coarse ? handling : t.hint[tab];

  let body: ReactNode;
  if (view === "json") body = <JsonView profile={profile} />;
  else if (view === "text") body = <Letter profile={profile} onOpenItem={onPickItem} onOpenCard={onPickCard} />;
  else
    body = (
      <>
        <div id="panel" className="panel" tabIndex={-1} ref={panelRef} key={tab} data-fallback={fallback || undefined} data-leaving={leaving ? "" : undefined} onPointerDownCapture={onStagePointer}>
          {fallback ? (
            Stage ? (
              <Letter profile={profile} focus={tab} onOpenItem={onPickItem} onOpenCard={onPickCard} compact />
            ) : (
              <StagePlaceholder tab={tab} profile={profile} onPickItem={onPickItem} onPickCard={onPickCard} />
            )
          ) : (
            <StageBoundary onFail={() => markUnsupported(tab)}>
              <Stage {...stageProps} />
            </StageBoundary>
          )}
        </div>
        {/* Readable twin of whatever the stage draws: screen readers and crawlers. Omitted while the printed version stands in. */}
        {fallback ? null : <ProfileView profile={profile} />}
      </>
    );

  return (
    <I18n.Provider value={t}>
      <Shell
        profile={profile}
        langs={langs}
        fade={fade}
        tab={tab}
        next={leaving}
        onTab={setTab}
        view={view}
        stage={fallback ? null : stage}
        printed={fallback}
        material={material}
        onMaterial={setMaterial}
        detail={!!detail}
        handling={handling}
        hint={hint}
        day={dawn.day}
        loading={view === "folio" && !ready && !leaving ? { label: tab === "resume" ? t.loading.folio : t.loading.album, progress: dawn.progress } : null}
        {...(view !== "folio" ? { hashira: { local: t.text.hashira.local, latin: t.text.hashira.latin, han: chromeHan } } : {})}
      >
        {body}
      </Shell>
      {item ? (
        <ItemDetail
          profile={profile}
          index={item.index}
          snapshot={stageRef.current?.snapshot}
          onIndex={(i) => setDetail({ type: "item", id: profile.items[i]?.id ?? item.item.id })}
          onClose={closeDetail}
          fallbackFocus={fallbackFocus}
        />
      ) : null}
      {detail?.type === "album" ? <AlbumDetail profile={profile} kind={detail.kind} id={detail.id} onSelect={(id) => setDetail({ type: "album", kind: detail.kind, id })} onClose={closeDetail} fallbackFocus={fallbackFocus} /> : null}
    </I18n.Provider>
  );
}
