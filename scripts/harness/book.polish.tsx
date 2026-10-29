import "@fontsource/shippori-mincho/400.css";
import "@fontsource/shippori-mincho/500.css";
import "@fontsource/shippori-mincho/600.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";

/* The book harness (book.tsx) on a page with the site's fonts and desk tokens. ?shot=1 hides BookView's own controls. */
if (new URLSearchParams(location.search).get("shot") === "1") document.body.dataset.shot = "";
await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
await import("./book");
