import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/app/App";
import { profile as sample } from "../../profile/en";
import type { Profile } from "../../src/profile/schema";
import type { StageMap, StageProps } from "../../src/app/types";
import { initFrame } from "../../src/app/layout";
import "../../src/app/app.css";

/*
 * Test page for the stage contract: three stub stages exercise onPickCard, onUnsupported and the render-error boundary
 * without any WebGL. Served by the dev server at /scripts/harness/app-fallback.html (see app-shots.ts --only=fallback).
 */

function StubCards({ onPickCard, profile, active }: StageProps) {
  const c = profile.albums.cards[1];
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", gap: 12, alignContent: "center" }}>
      <p className="mono">stub cards stage / active={String(active)}</p>
      {c ? (
        <button type="button" className="btn" onClick={() => onPickCard("cards", c.id)}>
          stub: pick card {c.id}
        </button>
      ) : null}
    </div>
  );
}

/** A stage that finds it cannot render and says so. */
function StubUnsupported({ onUnsupported }: StageProps) {
  useEffect(() => {
    onUnsupported();
  }, [onUnsupported]);
  return <p className="mono">no webgl here</p>;
}

/** A stage that throws while rendering. */
function StubThrows(): never {
  throw new Error("stub stage exploded");
}

const stages: StageMap = { cards: StubCards, postcards: StubUnsupported, resume: StubThrows };

// ?stages=none uses the built-in flat placeholders (no 3D stages); ?pdf=1 gives the resume item a pdf so the download link can be checked
const q = new URLSearchParams(location.search);
const profile: Profile = q.has("pdf") ? { ...sample, items: sample.items.map((i) => (i.kind === "resume" ? { ...i, pdf: "/resume.pdf" } : i)) } : sample;

initFrame();
const root = document.getElementById("root");
if (root) createRoot(root).render(q.get("stages") === "none" ? <App profile={profile} stages={{}} /> : <App profile={profile} stages={stages} />);
