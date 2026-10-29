/*
 * Noto Serif SC, the three weights Chinese serif text is set in (src/fonts SC_FILES.serif: 400 / 500 / 600, Shippori's own): the
 * unicode-range slices (the 400 CSS; the other files have the same slices) and the URLs of all three weights' files. Imported
 * lazily by src/fonts the first time a string needs the face, so an English page never loads this chunk; a 500 or 600 slice
 * downloads only when text at that weight needs it.
 */
import css from "@fontsource/noto-serif-sc/400.css?raw";

const files = import.meta.glob("/node_modules/@fontsource/noto-serif-sc/files/noto-serif-sc-[0-9]*-{400,500,600}-normal.woff2", { query: "?url", import: "default", eager: true, exhaustive: true }) as Record<string, string>;

export default { css, files };
