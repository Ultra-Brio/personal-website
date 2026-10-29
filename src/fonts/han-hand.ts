/*
 * LXGW WenKai Regular, the handwriting for Chinese text: its unicode-range slices and their URLs. Imported lazily by src/fonts the
 * first time a string needs the face.
 */
import css from "lxgw-wenkai-webfont/lxgwwenkai-regular.css?raw";

const files = import.meta.glob("/node_modules/lxgw-wenkai-webfont/files/lxgwwenkai-regular-subset-*.woff2", { query: "?url", import: "default", eager: true, exhaustive: true }) as Record<string, string>;

export default { css, files };
