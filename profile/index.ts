import type { Folio } from "../src/profile/folio";

/*
 * The page's content: this folder and the pictures in public/photos are all you need to change (README, "Make it yours").
 * 向博 in two languages, like his own site's 中 / EN switch: Chinese first (zh.ts), English (en.ts) loaded the first time a
 * visitor picks English or arrives with ?lang=en. One language only: drop the other line here; the switch then disappears.
 */
export const folio: Folio = {
  primary: "zh",
  profiles: {
    zh: () => import("./zh").then((m) => m.profileZh),
    en: () => import("./en").then((m) => m.profile),
  },
};
