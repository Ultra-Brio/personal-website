import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import type { StageMap, StageProps } from "../types";

/*
 * The three 3D stages, code-split: the shell paints from the entry chunk, each stage's module (BookView, the pouch, three,
 * planck) loads when its booklet is first shown. The host is full-bleed (the canvas fills the viewport; the book is framed into
 * the book box by the camera insets). While it loads, the shell shows the daybreak line in the book box (§1.6.13); the booklet
 * fades in last (opacity and a 6 px blur, app.css).
 */

function stage(load: () => Promise<{ default: ComponentType<StageProps> }>): ComponentType<StageProps> {
  const Lazy = lazy(load);
  function Stage(props: StageProps) {
    const host = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    // BookView marks its root data-ready once the first spread is painted (or at once in its flat fallback). A rebuild (a new
    // case) drops it for a moment: the booklet fades back out and in.
    useEffect(() => {
      const el = host.current;
      if (!el) return;
      const check = () => setReady(!!el.querySelector(".folio-book[data-ready]"));
      check();
      const mo = new MutationObserver(check);
      mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ready"] });
      return () => mo.disconnect();
    }, []);
    return (
      <div className="stage-host" ref={host} data-ready={ready || undefined}>
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      </div>
    );
  }
  return Stage;
}

export const STAGES: StageMap = {
  resume: stage(() => import("./ResumeStage")),
  cards: stage(() => import("./AlbumStage").then((m) => ({ default: m.CardsStage }))),
  postcards: stage(() => import("./AlbumStage").then((m) => ({ default: m.PostcardsStage }))),
};
