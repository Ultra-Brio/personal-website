import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { folio } from "./profile";
import { dictFor } from "./src/app/i18n";
import { loadProfile } from "./src/profile/folio";

/**
 * The fontsource CSS gives every slice a .woff fallback after its .woff2 (`url(…woff2) format("woff2"), url(…woff) format("woff")`),
 * and the build emits every file a CSS url() names: about 700 .woff files (≈ 21 MB) that no browser able to run the folio (WebGL 2)
 * would ever fetch. The fallbacks are dropped before Vite resolves the URLs, so only the woff2 ship. (`?raw` CSS is read by src/fonts
 * itself, which takes the woff2 only.)
 */
function woff2Only(): Plugin {
  return {
    name: "folio:woff2-only",
    enforce: "pre",
    transform(code, id) {
      const [path, query = ""] = id.split("?");
      if (!/\/node_modules\/(@fontsource\/|lxgw-wenkai-webfont\/)[^?]*\.css$/.test(path!) || /(^|&)raw(&|$)/.test(query)) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(\s*["']?woff["']?\s*\)/g, ""), map: null };
    },
  };
}

/**
 * index.html's language, title and description (and their Open Graph twins) from the folio's first profile, so a link preview, which
 * runs no script, shows the person rather than the project. The page sets the title and language again as it runs.
 */
function profileMeta(): Plugin {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    name: "folio:profile-meta",
    async transformIndexHtml(html) {
      const p = await loadProfile(folio, folio.primary);
      const t = dictFor(p);
      const title = esc(t.meta.title(p, "folio"));
      const description = esc(t.meta.description(p));
      return html
        .replace(/<html lang="[^"]*">/, `<html lang="${t.htmlLang}">`)
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*/g, `$1${description}`)
        .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`);
    },
  };
}

/** `base: "./"`: every URL the build writes is relative, so the same files work at a domain's root and under a sub-path (GitHub Pages' /<repo>/). */
export default defineConfig({ base: "./", plugins: [woff2Only(), profileMeta(), react()], server: { port: 5188, host: "127.0.0.1" } });
