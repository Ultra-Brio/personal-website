import * as THREE from "three";

/*
 * sasshi (round 3, D2): the window's shadow as real occluders. The window light on the desk — the window bar and a twig with
 * leaves, from the upper right — is cast by flat meshes (the bars: thin strips; the twig: an alpha-tested quad) that hang in the world
 * far above the desk on the window's side: no camera sees them (out of the view, and they draw neither colour nor depth), and they lie
 * beyond the key light's shadow camera, so only the sun's shadow map has them (scene.ts). So the leaves fall on the desk (the catcher),
 * go on over the book with parallax, and every surface shades them as its own: pale paper more, dark leather less, the pouch's film
 * catching the light between them.
 *
 * The art is the morning-light room's (src/app/Room.tsx: the same twig path, leaf shape and leaf placings; the bars and the twig's
 * place per layout class, src/app/layout.ts lightOf REF): it is planned in view px (layout) and laid on the desk through the camera as
 * it is (place). The page's desk (its fibres, the sunlit patch) is the DOM's and never moves; so the window's pattern on the desk keeps
 * its place on screen too while the camera moves (the cover's swing, a phone's pan between the pages) — the book moves under the
 * leaves, as a book moved on a desk would — and scene.ts lays it again whenever the camera moved. The occluders are parallel to the
 * desk at OCCLUDER_HEIGHT: a directional light carries a parallel plane's shadow down unchanged, shifted along the light.
 */

/** Height of the occluder plane above the desk (scene units; 1 mm = 0.01) */
export const OCCLUDER_HEIGHT = 6;

/** The twig (view px of the 1440 × 900 art, before the class's transform), its leaves (x, y, rotate°, scale) and the leaf (Room.tsx) */
const TWIG = "M905 20 C 770 110, 650 200, 530 380 S 390 630, 320 880";
const LEAF = "M0 0 C 22 -17, 64 -19, 92 0 C 64 17, 22 15, 0 0 Z";
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
/** The twig's own box (twig px): the stroke and every leaf inside it */
const TWIG_BOX = { x0: 250, y0: -40, x1: 960, y1: 940 };
/** The twig's attachment (twig px): it sways about this point (Room.tsx's transform-origin 96 % 2 % of the view, on the twig) */
const TWIG_PIVOT: [number, number] = [905, 20];

type Ref = { w: number; h: number; bars: [number, number, number, number, number][]; twig: [number, number, number] };
/**
 * Per layout class (src/app/layout.ts classOf / REF): the reference viewport, the window bars (x1, y1, x2, y2, width; view px: a
 * line, run past the view at both ends, see BAR_PAST) and the twig's translate and scale. As the page's art: one bar (the mullion) on
 * desks and on a phone held sideways, the mullion and the transom on a phone.
 */
const REF: Record<"d" | "s" | "p" | "l", Ref> = {
  d: { w: 1440, h: 900, bars: [[910, -60, 730, 960, 16]], twig: [560, -14, 1] },
  s: { w: 1280, h: 720, bars: [[800, -60, 650, 780, 14]], twig: [500, -14, 0.85] },
  p: { w: 390, h: 844, bars: [[322, -40, 214, 900, 12], [60, 300, 470, 250, 10]], twig: [70, 96, 0.4] },
  l: { w: 844, h: 390, bars: [[600, -40, 520, 420, 10]], twig: [390, -6, 0.42] },
};
/** Most bars a class has (the meshes are made once) */
const BARS = 2;
/** src/app/layout.ts classOf */
function classOf(W: number, H: number): keyof typeof REF {
  if (H <= 500 && W > H) return "l";
  if (W <= 960) return "p";
  if (W < 1360) return "s";
  return "d";
}
/** A bar runs past every edge of the view by this share of the view's longer side: its ends never land on the desk or the book in view */
const BAR_PAST = 0.08;

/**
 * The occluders against the page's art: the twig's stroke a little heavier (the soft shadow map eats a hairline); the bars wider
 * than drawn (≈ 25 px across at half depth at 1440, as the art's blurred bar) but a screen of a quarter (one texel in each 2 × 2 of
 * the sun's map: ≈ 8 % deep against a leaf's 12 %) — the art blurred its bar by 10 px at .9 against the leaves' 2 px, so a bar is a
 * broad, faint band and a leaf a crisp, deeper one. The sun's blur (scene.ts SUN) spans an even number of texels, so the screen
 * averages out exactly.
 */
const STROKE = { twig: 8, bar: 1.6 };

export type WindowLight = {
  /** World-level: add to the scene (never under the book: a tilted book must not turn the window) */
  group: THREE.Group;
  /** Plan the pattern for a W × H view and paint the twig (once per layout: a resize, new insets) */
  layout(W: number, H: number): void;
  /**
   * Lay the planned pattern on the desk under the camera as it is: toDesk(x, y, out) is the point of the desk plane under view px
   * (x, y); dir the unit direction toward the light. The twig keeps its sway pose.
   */
  place(toDesk: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3, dir: THREE.Vector3): void;
  /** The planned pattern's corners on the desk under toDesk (the bars' ends, the twig's box), pushed onto out: the sun's frustum */
  corners(toDesk: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3, out: THREE.Vector3[]): void;
  /**
   * The twig's sway at t (s on the sway's own clock: scene.ts runs it only while the twig may sway, so a pause holds the pose and it
   * goes on from there): about its attachment, ≤ 1.2° and a few px (Room.tsx's 13 s alternate). Returns whether it moved.
   */
  sway(t: number): boolean;
  dispose(): void;
};

/** The planned pattern in view px: each bar's line through the view (a, d: from a, along d for t ∈ [t0, t1]) and half width; the twig */
type Plan = { bars: { ax: number; ay: number; dx: number; dy: number; nx: number; ny: number; t0: number; t1: number; half: number }[]; T: { tx: number; ty: number; s: number }; k: number };

/** Where a line (a + t d) runs inside the rect [x0, x1] × [y0, y1]: its t range (Liang–Barsky); null when it misses it */
function clipLine(ax: number, ay: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ] as const) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  return t0 < t1 ? [t0, t1] : null;
}

export function createWindowLight(): WindowLight {
  const group = new THREE.Group();
  group.name = "window-light";
  // nothing is ever drawn in colour or depth; the shadow pass draws them with its own depth material (alphaTest: three clones it with
  // the twig's alpha map, so the leaves cast leaf-shaped shadows)
  const hidden = { colorWrite: false, depthWrite: false, side: THREE.DoubleSide } as const;
  const twigCanvas = document.createElement("canvas");
  const twigTex = new THREE.CanvasTexture(twigCanvas);
  twigTex.generateMipmaps = false;
  twigTex.minFilter = THREE.LinearFilter;
  const SEG = 8;
  const barMat = new THREE.MeshBasicMaterial(hidden);
  const barDepth = new THREE.MeshDepthMaterial();
  barDepth.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("void main() {", "void main() {\n\tif (mod(floor(gl_FragCoord.x), 2.0) + mod(floor(gl_FragCoord.y), 2.0) > 0.5) discard;");
  };
  barDepth.customProgramCacheKey = () => "window-bar-screen";
  const bars = Array.from({ length: BARS }, () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, SEG), barMat));
  const twig = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, SEG, SEG), new THREE.MeshBasicMaterial({ ...hidden, alphaMap: twigTex, alphaTest: 0.5 }));
  const pivot = new THREE.Group();
  pivot.add(twig);
  group.add(...bars, pivot);
  for (const m of [...bars, twig]) {
    m.castShadow = true;
    m.receiveShadow = false;
    m.visible = false;
  }
  for (const b of bars) b.customDepthMaterial = barDepth;
  /** The sway's px translate in world units (under the camera the pattern was last placed with) */
  const swayPx = new THREE.Vector3();
  /** The sway's pose as applied (0 … 1 of the way to its far end); kept through every layout and placing */
  let pose = 0;
  const v = new THREE.Vector3();
  const o = new THREE.Vector3();
  const a = new THREE.Vector3();
  const lift = new THREE.Vector3();
  let plan: Plan | null = null;

  /** Lays a grid mesh's vertices over view px through `at(u, w)` (uv of the vertex → view px), lifted along the light, relative to origin */
  function lay(mesh: THREE.Mesh, at: (u: number, w: number) => [number, number], toDesk: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3, origin: THREE.Vector3) {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const [x, y] = at(uv.getX(i), uv.getY(i));
      toDesk(x, y, v).add(lift).sub(origin);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
  /** The twig's box edges in view px (u, w: 0 … 1 across it; w = 0 its bottom) */
  const boxX = (T: Plan["T"], u: number) => T.tx + (TWIG_BOX.x0 + (TWIG_BOX.x1 - TWIG_BOX.x0) * u) * T.s;
  const boxY = (T: Plan["T"], w: number) => T.ty + (TWIG_BOX.y1 - (TWIG_BOX.y1 - TWIG_BOX.y0) * w) * T.s;
  function applyPose() {
    // clockwise on screen (the view's y runs down, the desk's up): about the desk's z, negative
    pivot.rotation.z = -THREE.MathUtils.degToRad(1.2) * pose;
    twig.position.copy(swayPx).multiplyScalar(pose);
  }

  return {
    group,
    layout(W, H) {
      const cls = classOf(W, H);
      const ref = REF[cls];
      const sx = W / ref.w;
      const sy = H / ref.h;
      const k = Math.sqrt(sx * sy);
      const small = cls === "p" || cls === "l";
      /* the bars: each line through the view, run past it on both ends (the window is bigger than the page) */
      const m = BAR_PAST * Math.max(W, H);
      const planned: Plan["bars"] = [];
      for (const [x1, y1, x2, y2, w] of ref.bars) {
        const ax = x1 * sx;
        const ay = y1 * sy;
        const dx = x2 * sx - ax;
        const dy = y2 * sy - ay;
        const len = Math.hypot(dx, dy);
        const span = clipLine(ax, ay, dx, dy, -m, -m, W + m, H + m);
        if (!span) continue;
        planned.push({ ax, ay, dx, dy, nx: -dy / len, ny: dx / len, t0: span[0], t1: span[1], half: (STROKE.bar * w * Math.min(1.25, k)) / 2 });
      }
      const [tx, ty, ts] = ref.twig;
      const T = { tx: tx * sx, ty: ty * sy, s: ts * k };
      plan = { bars: planned, T, k };

      /* the twig: its own canvas over its box */
      const tw = small ? 512 : 768;
      const th = Math.round((tw * (TWIG_BOX.y1 - TWIG_BOX.y0)) / (TWIG_BOX.x1 - TWIG_BOX.x0));
      twigCanvas.width = tw;
      twigCanvas.height = th;
      const tctx = twigCanvas.getContext("2d")!;
      tctx.fillStyle = "#000";
      tctx.fillRect(0, 0, tw, th);
      const tk = tw / (TWIG_BOX.x1 - TWIG_BOX.x0);
      tctx.setTransform(tk, 0, 0, tk, -TWIG_BOX.x0 * tk, -TWIG_BOX.y0 * tk);
      tctx.strokeStyle = "#fff";
      tctx.fillStyle = "#fff";
      tctx.lineCap = "round";
      tctx.lineWidth = STROKE.twig / Math.max(0.35, T.s);
      tctx.stroke(new Path2D(TWIG));
      const leaf = new Path2D(LEAF);
      for (const [x, y, r, sc] of LEAVES) {
        tctx.save();
        tctx.translate(x, y);
        tctx.rotate((r * Math.PI) / 180);
        tctx.scale(sc, sc);
        tctx.fill(leaf);
        tctx.restore();
      }
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      twigTex.needsUpdate = true;
    },
    place(toDesk, dir) {
      const p = plan;
      if (!p) return;
      // the lift: straight up to OCCLUDER_HEIGHT and sideways along the light (a parallel plane's shadow is a pure shift)
      lift.set(dir.x, dir.y, dir.z).multiplyScalar(OCCLUDER_HEIGHT / Math.max(0.2, dir.z));
      o.set(0, 0, 0);
      bars.forEach((mesh, i) => {
        const b = p.bars[i];
        mesh.visible = !!b;
        if (!b) return;
        lay(mesh, (u, t) => {
          const along = b.t0 + (b.t1 - b.t0) * t;
          const across = (u * 2 - 1) * b.half;
          return [b.ax + b.dx * along + b.nx * across, b.ay + b.dy * along + b.ny * across];
        }, toDesk, o);
      });
      // the pivot on the twig's attachment in the occluder plane; the twig's vertices relative to it (unturned: the pivot turns them).
      // uv (0, 0) is the canvas's bottom left (flipY): view px y grows downward
      const T = p.T;
      toDesk(T.tx + TWIG_PIVOT[0] * T.s, T.ty + TWIG_PIVOT[1] * T.s, o).add(lift);
      pivot.position.copy(o);
      lay(twig, (u, w) => [boxX(T, u), boxY(T, w)], toDesk, o);
      twig.visible = true;
      // the sway's few px, in world units (Room.tsx: translate(-5px, 3px) at the end of the swing, with the 1.2° turn)
      toDesk(0, 0, a);
      swayPx.copy(toDesk(-5 * p.k, 3 * p.k, v)).sub(a);
      applyPose();
    },
    corners(toDesk, out) {
      const p = plan;
      if (!p) return;
      for (const b of p.bars) for (const t of [b.t0, b.t1]) for (const s of [-1, 1]) out.push(toDesk(b.ax + b.dx * t + b.nx * b.half * s, b.ay + b.dy * t + b.ny * b.half * s, new THREE.Vector3()));
      for (const [u, w] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) out.push(toDesk(boxX(p.T, u), boxY(p.T, w), new THREE.Vector3()));
    },
    sway(t) {
      if (!plan) return false;
      // 13 s each way, eased (CSS ease-in-out between the ends)
      const x = (Math.max(0, t) / 13) % 2;
      const q = x < 1 ? x : 2 - x;
      const e = q * q * (3 - 2 * q);
      if (Math.abs(e - pose) < 0.004) return false;
      pose = e;
      applyPose();
      return true;
    },
    dispose() {
      for (const b of bars) b.geometry.dispose();
      barMat.dispose();
      barDepth.dispose();
      twig.geometry.dispose();
      (twig.material as THREE.Material).dispose();
      twigTex.dispose();
    },
  };
}
