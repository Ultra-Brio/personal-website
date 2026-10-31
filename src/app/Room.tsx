import type { CSSProperties } from "react";
import { lightOf, useFrame, type LightGeo } from "./layout";

/*
 * The room (spec §1.4, brief r3 D2): a pale blue-grey desk at six in the morning, low sun through a window at the top right.
 * Everything here lies UNDER the transparent 3D canvas and never moves: one fixed layer (.desk, its own blending group), painted
 * once, no animation; nothing of the room is over the book.
 *   .desk      朝霧 with washi fibres, the corner away from the window falling into shade (.falloff), the lit patch with the shade
 *              round it (.sun, multiply) and its glow (.lift, colour-dodge), paper tooth
 *   .cast      the window bar and a twig with leaves, still — only under the flat book and the printed version (no WebGL, the
 *              text views). On the 3D desk the engine casts them: real occluders in the scene, so the leaves fall on the
 *              desk and go on over the book with parallax and its own shading (src/book).
 * The geometry is recomputed per viewport (layout.ts lightOf). `day` (0 … 1) is the daybreak: the light rises with the first load
 * (§1.6.13).
 */

/** (x, y, rotate°, scale) of each leaf on the twig (src/book/window-light.ts cuts the 3D twig from the same shapes) */
const LEAVES: [number, number, number, number][] = [
  [842, 62, -8, 0.8],
  [772, 118, -38, 1.05],
  [706, 186, 24, 1.1],
  [650, 246, -58, 0.95],
  [590, 322, 14, 1.15],
  [536, 408, -70, 1],
  [486, 494, 20, 1.1],
  [430, 590, -46, 0.9],
  [380, 676, 30, 0.85],
  [612, 268, 150, 0.7],
  [724, 150, 140, 0.75],
];
const TWIG = "M905 20 C 770 110, 650 200, 530 380 S 390 630, 320 880";
const LEAF = "M0 0 C 22 -17, 64 -19, 92 0 C 64 17, 22 15, 0 0 Z";
const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function Twig({ leaf }: { leaf: string }) {
  return (
    <>
      <path d={TWIG} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {LEAVES.map(([x, y, r, s], i) => (
        <use key={i} href={`#${leaf}`} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} />
      ))}
    </>
  );
}

/** The window bar and the twig inside the blurred patch: the still shadow of the fallback desk (see the header). */
function Cast({ g, W, H }: { g: LightGeo; W: number; H: number }) {
  return (
    <svg className="cast" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <filter id="room-pb" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={g.blur.patch} />
        </filter>
        <filter id="room-bb" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={g.blur.bar} />
        </filter>
        <filter id="room-um">
          <feGaussianBlur stdDeviation={g.blur.umbra} />
        </filter>
        <filter id="room-pe" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={g.blur.penumbra} />
        </filter>
        <path id="room-leaf" d={LEAF} />
        <mask id="room-m" maskUnits="userSpaceOnUse" x={-200} y={-200} width={W + 400} height={H + 400}>
          <polygon points={pts(g.patch)} fill="#fff" filter="url(#room-pb)" />
        </mask>
      </defs>
      <g mask="url(#room-m)" color="#22344a" fill="#22344a">
        <g filter="url(#room-bb)" opacity=".9">
          {g.bars.map(([x1, y1, x2, y2, w], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#22344a" strokeWidth={w} />
          ))}
        </g>
        <g transform={g.twig}>
          <g filter="url(#room-um)">
            <Twig leaf="room-leaf" />
          </g>
          <g filter="url(#room-pe)" opacity=".55" transform="translate(16 12)">
            <Twig leaf="room-leaf" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** The lit patch: the shade round it (multiply, the patch left white) … */
function Sun({ g, W, H }: { g: LightGeo; W: number; H: number }) {
  const small = g.blur.patch < 16;
  return (
    <svg className="sun" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <filter id="room-sb" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={g.blur.patch} />
        </filter>
        <linearGradient id="room-sg" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="rgb(250 251 252)" />
          <stop offset={small ? 0 : 0.17} stopColor="rgb(248 250 251)" />
          <stop offset={small ? 0.2 : 0.3} stopColor="rgb(240 243 246)" />
          <stop offset="1" stopColor="rgb(238 242 245)" />
        </linearGradient>
      </defs>
      <rect x={-10} y={-10} width={W + 20} height={H + 20} fill="url(#room-sg)" />
      <polygon points={pts(g.patch)} fill="#fff" filter="url(#room-sb)" />
    </svg>
  );
}

/** … and its glow (colour-dodge). */
function Lift({ g, W, H }: { g: LightGeo; W: number; H: number }) {
  return (
    <svg className="lift" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <filter id="room-lb" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={g.blur.patch} />
        </filter>
      </defs>
      <polygon points={pts(g.patch)} fill="rgb(19 20 21)" filter="url(#room-lb)" />
    </svg>
  );
}

/**
 * `cast`: draw the still window bar and twig too (the fallback desk; on the 3D desk the engine casts them). `day`: the daybreak.
 * The desk's own backdrop is the person's photo (the homepage's 大图), set inline so the URL stays document-relative and works
 * at a domain root and under a sub-path; the CSS keeps 朝霧 as what shows while it loads.
 */
export function Room({ day, cast }: { day: number; cast: boolean }) {
  const f = useFrame();
  const g = lightOf(f);
  const style = { "--day": day.toFixed(3) } as CSSProperties;
  return (
    <div className="room" data-lit={day >= 1 || undefined} style={style} aria-hidden="true">
      <div className="desk">
        <i className="bg-photo" style={{ backgroundImage: "url(photos/home-bg.jpg)" }} />
        <i className="fl fl-a" />
        <i className="fl fl-b" />
        <i className="fl fl-c" />
        <i className="fl fl-s" />
        <i className="falloff" />
        <Sun g={g} W={f.W} H={f.H} />
        <Lift g={g} W={f.W} H={f.H} />
        {cast ? <Cast g={g} W={f.W} H={f.H} /> : null}
        <i className="tooth" />
      </div>
    </div>
  );
}
