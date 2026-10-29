import { useCallback, useSyncExternalStore } from "react";
import type { ItemKind } from "../profile/schema";
import { createSoundKit, materialOf, type PlayOptions, type SoundKit, type SoundName } from "../sound";

/*
 * One sound kit per page (src/sound): created on first use and never disposed, so tab switches and dialog mounts all share
 * one AudioContext. The kit itself waits for the first gesture before it makes any sound, and makes none while muted.
 */
let kit: SoundKit | null = null;
const subs = new Set<() => void>();

export function soundKit(): SoundKit {
  kit ??= createSoundKit();
  return kit;
}

export function play(name: SoundName, o?: PlayOptions): void {
  soundKit().play(name, o);
}

/** A pouch contact: `speed` m/s along the normal, the material from the item's kind, pan -1 … 1. */
export function impact(speed: number, kind: ItemKind, pan?: number): void {
  soundKit().impact(speed, materialOf(kind), pan);
}

/** Muted state for the header toggle; the toggle must call `toggle` from its click handler (it may create the context). */
export function useMuted(): { muted: boolean; toggle(): void } {
  const muted = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => soundKit().muted,
    () => true,
  );
  const toggle = useCallback(() => {
    const k = soundKit();
    k.setMuted(!k.muted);
    if (!k.muted) k.play("tab");
    for (const fn of subs) fn();
  }, []);
  return { muted, toggle };
}
