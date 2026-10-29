import type { Folio } from "../src/profile/folio";
import { profile } from "./en";

/*
 * Your page's content: this folder and the pictures in public/photos are all you need to change (README, "Make it yours").
 * The demo is one persona in two languages: English (en.ts, in the entry chunk) and Simplified Chinese (zh.ts, its own chunk,
 * fetched the first time a visitor picks 中文 or arrives with ?lang=zh). One language only: export
 * `{ primary: "en", profiles: { en: profile } }` and delete zh.ts; the page then shows no language switch.
 */
export const folio: Folio = {
  primary: "zh",
  profiles: {
    zh: () => import("./zh").then((m) => m.profileZh),
  },
};
