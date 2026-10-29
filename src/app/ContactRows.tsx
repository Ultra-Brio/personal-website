import type { Profile } from "../profile/schema";
import { linkText } from "./util";

/* Contact helpers shared by the colophon, the detail views and the text version. */

/** The profile's email address (from its first mailto: link), or null. */
export function emailOf(profile: Profile): string | null {
  const l = profile.links.find((x) => x.href.startsWith("mailto:"));
  return l ? linkText(l.href) : null;
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* insecure context or denied: try the legacy path */
  }
  // select() moves focus into the temporary textarea; give it back afterwards so keyboard users keep their place
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    prev?.focus({ preventScroll: true });
    return ok;
  } catch {
    prev?.focus({ preventScroll: true });
    return false;
  }
}
