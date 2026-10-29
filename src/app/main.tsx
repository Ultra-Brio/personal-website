import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { profileHan } from "../fonts";
import { folioLangs, loadProfile, pickLang } from "../profile/folio";
import { folio } from "../../profile";
import type { Profile } from "../profile/schema";
import { App } from "./App";
import { applyFontVars, preloadLatin } from "./fonts";
import { dictFor } from "./i18n";
import { initFrame } from "./layout";
import { storedLang, urlLang } from "./util";
import "./app.css";

/*
 * Entry: the grid's numbers and the font stacks go on <html> before React renders anything, so the first paint is already laid
 * out; the two Latin files every page needs are preloaded. The folio is the page's content (profile/index.ts: the demo persona in
 * English and in Simplified Chinese, the Chinese one its own chunk). The language shown first (brief r4 E1): ?lang= (or the older
 * ?sample=zh), else the visitor's last choice, else English (never the browser's language); the page's switch changes it in place.
 */

initFrame();
preloadLatin();

async function first(): Promise<{ lang: string; profile: Profile }> {
  const lang = pickLang(folio, { param: urlLang(), stored: storedLang() });
  try {
    return { lang, profile: await loadProfile(folio, lang) };
  } catch (err) {
    const primary = folioLangs(folio)[0] ?? folio.primary;
    console.warn(`[sasshi] the "${lang}" profile did not load, showing "${primary}"`, err);
    return { lang: primary, profile: await loadProfile(folio, primary) };
  }
}

void first().then(({ lang, profile }) => {
  document.documentElement.lang = dictFor(profile).htmlLang;
  applyFontVars(profileHan(profile));
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<StrictMode><App folio={folio} lang={lang} profile={profile} /></StrictMode>);
});
