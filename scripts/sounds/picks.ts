/*
 * Which raw candidates (generate.ts, analysed by `process.ts analyse`) ship, and why. One entry per shipped file, in the
 * order of the files: `src` is the raw take, `at` the span (s) that holds the wanted event; process.ts trims inside it to the
 * onset and the tail. These ids and spans belong to the takes in the raw cache that the shipped files came from: after a
 * regeneration, re-analyse and re-pick.
 *
 * Every take was checked on its spectrogram (no harmonic ladders = no music or voice, no smeared tail = no room, no flat
 * floor = no hiss) and its envelope before it got here.
 */
import type { SoundName } from "../../src/sound";

export type Pick = {
  src: string;
  at: [number, number];
  note: string;
  /** Extra ffmpeg filters after the 70 Hz high-pass (timbre matching inside a slot) */
  af?: string;
  /** Where the kept sound starts: the first frame within this many dB of the span's loudest (default 24; raise it to keep a quiet lead-in) */
  onsetDb?: number;
  /** Raised-cosine fades (s). Defaults: 2 ms in, 12-40 ms out (a quarter of the length). */
  fadeIn?: number;
  fadeOut?: number;
  /** Hard cap on the kept length (s), the fade-out ending exactly there */
  maxDur?: number;
};

export type Tier = "soft" | "medium" | "hard";
export type Picks = { sounds: Partial<Record<SoundName, Pick[]>>; impacts: Record<"paper" | "card", Record<Tier, Pick[]>> };

export const PICKS: Picks = {
  sounds: {
    pageTurn: [
      { src: "pageTurn-a-3", at: [0.06, 0.7], fadeIn: 0.06, fadeOut: 0.04, maxDur: 0.64, note: "PVC-sleeve swish that swells for 250 ms and ends on a small crinkle as the page goes over" },
      { src: "pageTurn-a-2", at: [0, 0.62], fadeIn: 0.06, fadeOut: 0.16, maxDur: 0.5, note: "brighter swish (centroid 5.5 kHz) with a lift at 150 ms; its flat 600 ms run shortened and faded into a turn" },
      { src: "pageTurn-a-4", at: [0.04, 0.62], fadeIn: 0.08, fadeOut: 0.16, maxDur: 0.5, note: "a swish that swells over 200 ms; the evenest level of the takes, no crackle spikes" },
    ],
    pageLand: [
      { src: "pageLand-b-1", at: [0.29, 0.55], note: "one flat slap of a sleeve page, -40 dB in 110 ms; the cleanest onset of the takes" },
      { src: "pageLand-b-3", at: [0.15, 0.42], note: "a slap, a little brighter (3.2 kHz)" },
      { src: "pageLand-a-1", at: [1.27, 1.48], note: "the one isolated flap after that take's riffle; the shortest (130 ms)" },
      { src: "pageLand-b-2", at: [0.3, 0.55], note: "the darkest landing (2 kHz), for variety" },
    ],
    coverOpen: [
      { src: "coverOpen-a-3", at: [0.1, 0.5], onsetDb: 40, fadeIn: 0.01, fadeOut: 0.12, note: "a faint flex, then a muted low thump (centroid 410 Hz) as the board comes off the stack" },
      { src: "coverOpen-a-2", at: [0.5, 0.95], fadeOut: 0.12, note: "a padded low knock (260 Hz) without ring" },
    ],
    coverClose: [
      { src: "coverClose-a-3", at: [0.3, 0.78], onsetDb: 50, fadeIn: 0.04, fadeOut: 0.12, note: "200 ms of the board's whoosh rising into a padded thump" },
      { src: "coverClose-a-1", at: [0.08, 0.5], fadeOut: 0.12, note: "a firm, dry board thump with a short lead; -40 dB in 100 ms" },
      { src: "coverClose-a-2", at: [0.24, 0.7], fadeOut: 0.12, note: "a brush of the cover's edge, then the thump; the take's later bounce left out" },
    ],
    zip: [
      { src: "zip-a-1", at: [0, 0.62], fadeIn: 0.05, note: "a pull that speeds up into the stop (level rises 25 dB over 450 ms)" },
      { src: "zip-a-2", at: [0.05, 0.66], fadeIn: 0.05, note: "a slower pull to the same stop" },
    ],
    pickUp: [
      { src: "pickUp-b-1", at: [2.42, 2.62], fadeIn: 0.01, note: "a short paper slide ending in a light tick (3 kHz): the most literal lift" },
      { src: "pickUp-b-1", at: [1.07, 1.24], fadeIn: 0.01, note: "a soft papery slide, no tick" },
      { src: "pickUp-b-1", at: [1.55, 1.7], fadeIn: 0.01, note: "a slide that swells for 90 ms and lets go" },
    ],
    drop: [
      { src: "drop-b-1", at: [1.05, 1.21], note: "a card landing flat on PVC: a soft slap, 100 ms decay" },
      { src: "drop-b-1", at: [1.71, 1.83], note: "the shortest, driest slap of the take" },
      { src: "drop-b-1", at: [2.03, 2.18], note: "a firmer slap with a small settle after it" },
    ],
    cardUnfold: [
      { src: "cardUnfold-a-2", at: [0.03, 0.58], fadeOut: 0.08, note: "the crease letting go, a short swish, a second softer crease" },
      { src: "cardUnfold-a-3", at: [0.12, 0.62], fadeIn: 0.02, fadeOut: 0.08, note: "a smoother opening of thick stock, no crackle peaks" },
    ],
    paperRustle: [
      { src: "paperRustle-a-1", at: [0, 0.5], fadeIn: 0.04, note: "thick paper flexing, one crisp crackle at 250 ms" },
      { src: "paperRustle-a-2", at: [0, 0.6], fadeIn: 0.04, note: "longer handling, two small crackles near the end" },
      { src: "paperRustle-a-3", at: [0.1, 0.56], fadeIn: 0.04, note: "the smoothest of the three, for small drags" },
    ],
    shake: [
      { src: "shake-a-2", at: [0.05, 0.7], fadeIn: 0.03, fadeOut: 0.1, note: "four even swells of film and cards, about 7 a second" },
      { src: "shake-a-1", at: [0, 0.62], fadeIn: 0.03, fadeOut: 0.1, note: "four swells, a little darker" },
      { src: "shake-a-3", at: [0, 0.58], fadeIn: 0.03, fadeOut: 0.1, note: "two broad swells: a lazier shake" },
    ],
    tab: [
      { src: "tab-a-1", at: [0.74, 0.85], maxDur: 0.06, note: "a small paper-button press, -40 dB in 30 ms" },
      { src: "tab-a-2", at: [0.93, 1.07], maxDur: 0.06, note: "a softer press of the same button" },
      { src: "tab-a-2", at: [1.28, 1.42], maxDur: 0.06, note: "a third press, between the two" },
    ],
    copy: [
      { src: "copy-b-2", at: [0, 0.2], fadeOut: 0.03, note: "two small ticks 100 ms apart, the second a touch brighter: the only take with a quick, even double" },
    ],
  },
  impacts: {
    paper: {
      soft: [
        { src: "impactPaper-a-3", at: [1.9, 1.98], note: "a soft dull tap (centroid 300 Hz)" },
        { src: "impactPaper-a-3", at: [2.265, 2.33], note: "a soft dull tap" },
        { src: "impactPaper-a-3", at: [1.535, 1.615], note: "a soft dull tap" },
      ],
      medium: [
        { src: "impactPaper-a-2", at: [0.675, 0.8], note: "a paper knock on film (450 Hz)" },
        { src: "impactPaper-a-2", at: [1.765, 1.87], note: "a paper knock on film" },
        { src: "impactPaper-a-3", at: [1.28, 1.4], note: "a paper knock, duller" },
      ],
      hard: [
        { src: "impactPaper-a-3", at: [0.935, 1.06], note: "a firm paper slap (1.5 kHz)" },
        { src: "impactPaper-a-3", at: [1.635, 1.75], note: "a firm paper slap" },
        { src: "impactPaper-a-2", at: [1.555, 1.72], note: "a firm slap with a short settle" },
      ],
    },
    card: {
      // A light card contact only ticks its edge (bright); a hard one sets the whole card going (the low "tock").
      soft: [
        { src: "impactCard-a-1", at: [1.235, 1.31], note: "a light edge tick (6 kHz)" },
        { src: "impactCard-a-1", at: [1.38, 1.45], note: "a light edge tick" },
        { src: "impactCard-a-1", at: [1.515, 1.6], note: "a light edge tick, a touch softer" },
      ],
      medium: [
        { src: "impactCard-a-3", at: [0.565, 0.675], note: "a corner knock (3.7 kHz)" },
        { src: "impactCard-a-3", at: [0.885, 0.98], note: "a corner knock" },
        { src: "impactCard-a-3", at: [0.228, 0.33], note: "a corner knock, warmer" },
      ],
      hard: [
        { src: "impactCard-a-1", at: [0.205, 0.28], note: "a card landing flat: a full tock (900 Hz); the take's second bounce 65 ms later left out" },
        { src: "impactCard-a-1", at: [0.43, 0.52], note: "a card landing flat, bounce left out" },
        { src: "impactCard-a-1", at: [0.66, 0.75], note: "a card landing flat, a little rounder, bounce left out" },
      ],
    },
  },
};
