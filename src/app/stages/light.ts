import { useCallback, useEffect, useRef } from "react";
import type { Book } from "../../book/scene";
import { lightFade, useFrame } from "../layout";

/**
 * The book's window light (brief r3 D2): whether the twig may sway (`ambient`, App useAmbient) and where its light keeps off the
 * words (layout.ts lightFade). Returns BookView's `onBook`: every book the view builds gets the current values at once.
 */
export function useWindowLight(ambient: boolean): (book: Book | null) => void {
  const fade = lightFade(useFrame());
  const book = useRef<Book | null>(null);
  const live = useRef({ ambient, fade });
  live.current = { ambient, fade };
  const apply = useCallback(() => {
    const b = book.current;
    b?.setAmbient(live.current.ambient);
    b?.setLightFade(live.current.fade);
  }, []);
  const key = `${ambient}|${JSON.stringify(fade)}`;
  useEffect(apply, [key, apply]);
  return useCallback(
    (b: Book | null) => {
      book.current = b;
      apply();
    },
    [apply],
  );
}
