/*
 * Physics of a turning sheet (no three dependency).
 *
 * A sheet in motion is a chain of rigid bodies in its plane of rotation (xz, z up, the desk below): inner column pocket board → seam →
 * outer column pocket board. A column holding cards is one stiff board (the cards fill its pockets); a column empty throughout is split
 * into flex.segs links, the bending stiffness between links taken from the EI of two thin PVC layers (very soft).
 * The heat seal between the two columns is a soft hinge, torque = k·β·(1 + (β/β0)²): at small angles it is softer than the critical
 * stiffness at which a full outer column standing upright is pushed over by its own weight (with the inner column upright the outer one
 * tips over first); folded to about β0 it is already stiff enough to hold the outer column out level (just after lifting, the outer
 * column trails behind folded about 30° instead of dragging along the stack the whole time); the damping follows the current tangent
 * stiffness, so the further it folds the more it damps, and what the bend has stored does not spring back all at once.
 * The root is the end of the punched strip: the hole hangs on the ring and slides round it after the inner column's angle, with
 * friction (a first-order lag), so a quick turn pulls the strip into a bend (the strip itself is not integrated on its own: its shape
 * is the shader's arc from the hole angle φ to the inner column angle θ). The root moves with the hole and counts as a fixed pivot
 * within each substep.
 *
 * Forces: each link's own weight (mass of card + PVC), air drag (normal velocity squared), the air cushion over the last stretch down
 * onto the stack (stronger the closer to the stack, only while falling), joint springs and damping, the hand, the finger.
 * Hand (a drag): the grabbed point is pulled onto the direction the pointer gives, whatever its distance from the root — how far the
 * sheet bends is up to gravity and the seam; the hand carries the sheet's weight.
 * When a release counts as a turn the hand is not swapped for anything else: it keeps hold of the same point and carries it on over
 * the top at that point's angular speed at release (clamped to carry.min … carry.max), letting go only once the whole sheet's centre
 * of mass is past vertical — rather than switching to a push from the spine the moment it is let go, the outer column first collapsing
 * back and then being whipped up.
 * Finger (a tap / key turn): a hand lifts the sheet from below with a capped torque, trying to turn the links at the hand's speed; a
 * heavy sheet cannot be pushed that fast, a light one keeps up.
 * Just after lifting the hand is under the inner column (the outer column trailing); once the sheet is up the hand slides outward
 * along it and holds the seam-side half of the outer column — the outer column passes vertical first and goes over first.
 * It lets go once the whole sheet's centre of mass is past vertical.
 * Speed caps (cap): the hand's target direction chases the pointer with a softly saturating top angular speed (on a quick flick the
 * finger slides along the sheet for a while and the sheet catches up after), and every point also has a damping that rises steeply as
 * its speed nears the cap — however hard the flick, the sheet does not turn over in one or two frames; all are continuous forces, no
 * hard clamp, so no speed jumps.
 * Contact: no joint point and no sheet edge may pass into the top faces of the left and right stacks — impulses (restitution +
 * Coulomb friction) plus position projection.
 *
 * The generalised coordinates are the links' absolute angles a (0 lying flat on the right, π lying flat on the left):
 * M(a)·ä = Q − C(a, ȧ) (Lagrange's equations, M the N×N coupled mass matrix), integrated at a fixed substep (480 Hz): springs and
 * damping linearly implicit (stable even for the very light links of empty pockets), the rest semi-implicit Euler; the result depends
 * only on the input sequence and is reproducible.
 * Stiffness and damping are read from the parameter table every step, so editing PHYSICS during development takes effect at once.
 * Units: scene units (1 = 100 mm), kg, seconds.
 */

export const PHYSICS = {
  /** Substep rate (Hz) */
  hz: 480,
  /** Gravitational acceleration (scene units / s²; 9.81 m/s²) */
  g: 98.1,
  /** Mass of a sheet's two PVC layers (kg), split between the two columns by width */
  pvc: 0.0134,
  /** One card (kg) */
  card: 0.00485,
  /**
   * Seam: small-angle stiffness k (torque per radian; a full outer column held out level has a gravity torque of about 1.7 and k is
   * below it: with the inner column upright the outer one is pushed over by its own weight), damping ratio, the stiffening angle
   * stiffen (β0, rad; torque = k·β·(1 + (β/β0)²), about 1.7 at a 30° fold, just enough to hold the outer column out level), maximum
   * fold angle
   */
  seam: { k: 1.3, zeta: 0.3, stiffen: 0.42, max: 2.6 },
  /**
   * A column of empty pockets: how many links, the bending stiffness EI of two 0.1 mm PVC layers (kg·unit³ / s²; ≈ 1.6e-4 N·m²),
   * damping ratio.
   * sasshi (round 4, E6): max — the most two neighbouring links of an empty column fold against each other (rad): a film bends,
   * it does not fold back over itself (past it a stop as stiff as the seam's). Without it a quick drag held at the free edge could whip
   * the last link round under the page (≈ 170°): landed so, the film's own spring pushed it into the stack — never at rest, a hard
   * crease on screen. 1.35 rad keeps every link of a page coming down on a stack pointing away from the fold, so it opens as it lands.
   */
  flex: { segs: 3, EI: 0.16, zeta: 0.3, max: 1.35 },
  /**
   * Air: density (kg / unit³), flat-plate drag coefficient; while falling the drag is further multiplied by 1 + (h0 / gap)² (squeeze
   * film: the air has to escape sideways through the gap, at roughly fall speed × half the sheet width / gap, so h0 is about half the
   * sheet width), at most 1 + cap times
   */
  air: { rho: 1.2e-3, cd: 1.15, h0: 1, cap: 300 },
  /**
   * Air cushion: over the last stretch down onto the stack (less than gap units above it, while falling) every point feels a
   * mass-scaled drag (m/2)·k·(1 − clearance / gap)²·|v|·v — the squeeze film plus a little give in the pockets' PVC, so even a full
   * sheet lands softly (the last 10° take four or five frames) instead of slapping flat in one frame; next to nothing when slow
   */
  cushion: { gap: 0.5, k: 30 },
  /** Contact: coefficient of restitution (only in fast impacts), friction coefficient (PVC on PVC, slides easily) */
  contact: { e: 0.25, mu: 0.15 },
  /** Time constant of the hole sliding along the ring (s) */
  hole: { tau: 0.02 },
  /** Hand: equivalent frequency about the root (Hz), damping ratio, maximum pull */
  hand: { hz: 7, zeta: 0.85, maxF: 80 },
  /**
   * Speed caps for a turn (rad / s, all soft, no hard clamp):
   * hand: how fast the hand's target direction may turn during a drag — while the pointer is slow the target sits on the pointer; on
   * too quick a flick the target saturates and catches up gradually (the finger slid along the sheet for a while);
   * handStart, handRamp: just after the grab the hand's top speed is only handStart × hand, released smoothly over handRamp seconds
   * (the hand has inertia too: it first takes up the slack, so the sheet edge is not yanked up at once);
   * air: the knee of the speed-cap damping, k: its strength (1 / s) — every point on the sheet feels a drag of
   * −(m/2)·k·(|v| / (air·r))⁴·v (r its distance from the root), next to nothing when slow, rising steeply as the speed nears the
   * knee: neither flying off after a release nor falling by itself gets faster than it (a full sheet lands at about air rad / s);
   * seam: the knee of the relative angular speed across the seam (rad / s), seamK: its strength (1 / s) — the seam torque gets a
   * further −I·seamK·(|ω_rel| / seam)⁴·ω_rel (I the outer column's moment of inertia about the seam): grabbing the sheet edge does
   * not yank the outer column up at once (the inner column not yet moving while the outer one is already folded thirty degrees);
   * however hard the flick, the seam folds over bit by bit
   */
  cap: { hand: 6, handStart: 0.3, handRamp: 0.14, air: 8, k: 10, seam: 4, seamK: 12 },
  /**
   * Finger (a tap / key turn: a hand lifts the sheet from below): maximum push torque (absolute; a full sheet lying flat has a
   * gravity torque of about 6.6), the hand's wanted angular speed (rad / s; slowing down after slow rad of travel, wTop at vertical;
   * after taking over, eased up smoothly from the sheet's own speed over ramp seconds), tracking gain (torque / angular speed
   * difference), the share of the push given to the outer column's link next to the seam: just after lifting the hand is under the
   * inner column (outer; the outer column trailing, the sheet bent into a tent), and while the inner column turns through
   * outerFrom … outerTo (rad) the hand slides outward along the sheet up to outerTop (the inner column's share giving up outerTake
   * times that rise), the hand under the outer column going (1 + outerLead) times as fast as under the inner one —
   * the outer column, held up, passes vertical first and goes over first, and lands a little later instead;
   * the stiffness multiplier between the links of an empty inner column while the palm holds it; the hand lets go only once the
   * whole sheet's centre of mass is margin (rad) past vertical
   */
  finger: { torque: 8, w: 5, wTop: 2.4, slow: 0.75, ramp: 0.15, gain: 4, outer: 0.1, outerTop: 0.7, outerFrom: 0.24, outerTo: 0.87, outerTake: 0.5, outerLead: 0.7, palm: 30, margin: 0.08 },
  /**
   * A drag released as a turn: the hand keeps hold of the same point and carries it on at that point's angular speed at release,
   * clamped to min … max (rad / s) and eased there smoothly over ramp seconds; it lets go only once the whole sheet's centre of mass
   * is finger.margin past vertical
   */
  carry: { min: 3, max: 4.5, ramp: 0.12 },
  /**
   * Sleep: every angular speed below w (rad / s) for time seconds; within ang (rad) of lying flat it is laid back flat.
   * sasshi (round 4, E6): stuck — a page nobody holds that has not come to rest within this long (s) is laid down on the side its
   * inner column is on (a free page lands in well under two seconds; one that does not is caught in a pose the model cannot leave, and
   * would keep the book drawing every frame)
   */
  sleep: { w: 0.06, ang: 0.03, time: 0.1, stuck: 4 },
};

export type Physics = typeof PHYSICS;

/**
 * Each sheet's geometry: the lengths from the root to the seam's centre line and from the seam's centre line to the sheet edge (scene
 * units), the sheet height
 */
export type PageGeom = { inner: number; outer: number; height: number };

/**
 * The environment the scene provides: the root position (hole angle φ, inner column angle θ → end of the punched strip), the hole's
 * resting angle on the ring (right / left), the heights of the two stacks' top faces, the pivot's x
 */
export type PageEnv = {
  root(phi: number, theta: number): [number, number];
  phR: number;
  phL: number;
  zR: number;
  zL: number;
  axisX: number;
};

/**
 * Finger: which side it turns to, when it starts; the sheet's own angular speed at the moment it takes over (t0, −1 until then;
 * positive toward the turn)
 */
type Finger = { to: 0 | 1; start: number; t0: number; w0: number };
/** The hand carrying on after release: which side it turns to, the wanted angular speed, the current one (rad / s) */
type Carry = { to: 0 | 1; w: number; v: number };
/**
 * t0: the moment of the grab (s; from then on the hand's top speed is released gradually over cap.handRamp; −1 until started).
 * reach: optional distance from the root (scene units) the hand pulls the grabbed point to. Unset = direction only (the
 * original behaviour: the distance is whatever it currently is). Set it when the pointer gives distance too, e.g. unfolding a
 * folded card, where direction alone cannot open the crease.
 */
type Hand = { link: number; s: number; th: number; goal: number; soft: number; carry: Carry | null; t0: number; reach?: number };

export type PageBody = {
  n: number;
  /** The side this sheet is to end up on (set by a turn; flung back to the other side, it is lifted again) */
  goal: 0 | 1 | null;
  /** Sheet height (the area for air drag) */
  h: number;
  /** How many links the inner column takes, the rest being the outer column's; whether the inner and outer columns are each one stiff board */
  nIn: number;
  L: Float64Array;
  m: Float64Array;
  /**
   * Moment of inertia about joint j (between links j−1 and j) of the chain outboard of it (the damping is derived from it and the
   * damping ratio)
   */
  Iout: Float64Array;
  /** Which joint the seam is */
  seam: number;
  /** The mass matrix's constant part μ, each link's own moment of inertia m L² / 12, gravity factor m/2 + mass of the links after it */
  mu: Float64Array;
  I: Float64Array;
  gm: Float64Array;
  /** The whole sheet's moment of inertia about the root (straightened out) */
  Ipage: number;
  a: Float64Array;
  w: Float64Array;
  /** The hole's angle on the ring (lagging behind the inner column) */
  phi: number;
  finger: Finger | null;
  hand: Hand | null;
  asleep: boolean;
  quiet: number;
  /** sasshi (round 4, E6): how long (s) it has been moving with nobody holding it (sleep.stuck) */
  free: number;
  /** Peak seam fold in the latest turn (rad, for watching during development) */
  peak: number;
};

/**
 * Build a sheet: cardsIn / cardsOut are how many cards the inner and outer columns hold (both faces together), 0–6.
 * A column with any card in it is one stiff board; only a wholly empty column is split into links and can bend
 */
export function createPage(geom: PageGeom, cardsIn: number, cardsOut: number, P: Physics = PHYSICS): PageBody {
  const W = geom.inner + geom.outer;
  const segs: { L: number; m: number }[] = [];
  const col = (len: number, cards: number) => {
    // A zero-length column (single-panel paper: outer = 0) adds no segments; zero-length links would give EI / 0 joints and NaN.
    if (!(len > 0)) return;
    const mass = (P.pvc * len) / W + cards * P.card;
    const k = cards > 0 ? 1 : Math.max(1, Math.min(3, Math.round(P.flex.segs)));
    for (let i = 0; i < k; i++) segs.push({ L: len / k, m: mass / k });
  };
  col(geom.inner, cardsIn);
  const nIn = segs.length;
  col(geom.outer, cardsOut);
  const n = segs.length;
  const L = new Float64Array(segs.map((s) => s.L));
  const m = new Float64Array(segs.map((s) => s.m));
  const tail = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) tail[i] = tail[i + 1]! + m[i]!;
  const mu = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const hi = Math.max(i, j);
      mu[i * n + j] = i === j ? m[i]! / 4 + tail[i + 1]! : m[hi]! / 2 + tail[hi + 1]!;
    }
  const I = new Float64Array(n);
  const gm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    I[i] = (m[i]! * L[i]! * L[i]!) / 12;
    gm[i] = m[i]! / 2 + tail[i + 1]!;
  }
  // moment of inertia of the chain outboard of joint j about that joint (straightened out); j = 0 is the whole sheet about the root
  const Iout = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let xs = 0;
    for (let i = j; i < n; i++) {
      const cx = xs + L[i]! / 2;
      Iout[j]! += I[i]! + m[i]! * cx * cx;
      xs += L[i]!;
    }
  }
  return {
    n,
    h: geom.height,
    nIn,
    L,
    m,
    Iout,
    seam: nIn,
    mu,
    I,
    gm,
    Ipage: Iout[0]!,
    a: new Float64Array(n),
    w: new Float64Array(n),
    goal: null,
    phi: 0,
    finger: null,
    hand: null,
    asleep: true,
    quiet: 0,
    free: 0,
    peak: 0,
  };
}

/** Lying flat on one side (0 right, 1 left), at rest */
export function restPage(b: PageBody, side: 0 | 1, env: PageEnv) {
  b.a.fill(side * Math.PI);
  b.w.fill(0);
  b.phi = side ? env.phL : env.phR;
  b.finger = null;
  b.hand = null;
  b.goal = null;
  b.asleep = true;
  b.quiet = 0;
  b.free = 0;
}

/**
 * Posed directly at an angle (carried back with the front board when closing, development screenshots): the whole sheet straight,
 * the hole in its matching place
 */
export function posePage(b: PageBody, theta: number, env: PageEnv, seam = 0, strip = 0) {
  for (let i = 0; i < b.n; i++) b.a[i] = theta + (i >= b.nIn ? seam : 0);
  b.w.fill(0);
  b.phi = holeAngle(theta - strip, env);
  b.finger = null;
  b.hand = null;
  b.asleep = true;
}

/** The hole's angle on the ring: slides with the inner column's angle from its resting place on the right to the one on the left */
export function holeAngle(theta: number, env: PageEnv) {
  const p = Math.min(1, Math.max(0, theta / Math.PI));
  return env.phR + (env.phL - env.phR) * p;
}

/** The shape for the shader: hole angle φ, inner column start angle θ, inner column bend, seam fold, outer column bend */
export function pageShape(b: PageBody): [phi: number, theta: number, bendIn: number, seam: number, bendOut: number] {
  return pageShapeInto(b, [0, 0, 0, 0, 0]);
}
/**
 * sasshi: pageShape into `out` (the renderer calls it for every sheet on every frame: no garbage). Each column (inner, outer) is
 * read as one even arc: its start tangent and its whole bend — every link's angle is the tangent at the link's middle,
 * a_i = start + bend · (i + ½) / k (one link: no bend).
 */
export function pageShapeInto<T extends [number, number, number, number, number]>(b: PageBody, out: T): T {
  const a = b.a;
  const n0 = b.nIn;
  const b0 = n0 < 2 ? 0 : ((a[n0 - 1]! - a[0]!) * n0) / (n0 - 1);
  const s0 = n0 < 2 ? a[0]! : a[0]! - b0 / (2 * n0);
  out[0] = b.phi;
  out[1] = s0;
  out[2] = b0;
  // Single column (outer length 0): no seam, the outer column is empty and continues straight from the inner one.
  if (n0 >= b.n) {
    out[3] = 0;
    out[4] = 0;
    return out;
  }
  const k = b.n - n0;
  const b1 = k < 2 ? 0 : ((a[n0 + k - 1]! - a[n0]!) * k) / (k - 1);
  const s1 = k < 2 ? a[n0]! : a[n0]! - b1 / (2 * k);
  out[3] = s1 - (s0 + b0);
  out[4] = b1;
  return out;
}

/**
 * sasshi (round 4, E6): the album sheet's shape for the renderer (sheet.ts sheetPath) into `out` (9 numbers, no garbage): the
 * hole's angle φ, then for the inner and for the outer column its tangent at the start, at a third, at two thirds and at the end.
 * Along a column the tangent runs straight between the links' own angles: from the first link's angle at the start (never past it),
 * through the mean of each two neighbours where they meet, to the last link's angle at the end — so a column drawn from it never turns
 * further than its links do. pageShape's one even arc per column could not: an empty column lying on a stack and curling up toward its
 * free edge (a finger lifting it) started that arc pointing down into the stack, up to a few mm below the sheet's resting plane, while
 * the sheet under it lies 0.15 mm lower — the owner's strip of the sheet below showing through. A single column (outer length 0)
 * continues straight from the inner one.
 */
export function pageKnotsInto<T extends { [i: number]: number }>(b: PageBody, out: T): T {
  out[0] = b.phi;
  knots(b.a, 0, b.nIn, out, 1);
  if (b.nIn >= b.n) for (let i = 0; i < 4; i++) out[5 + i] = out[4]!;
  else knots(b.a, b.nIn, b.n - b.nIn, out, 5);
  return out;
}
/** The tangent of k links from a[i0] at 0, a third, two thirds and the end of the column, into out[o … o + 3] */
function knots(a: Float64Array, i0: number, k: number, out: { [i: number]: number }, o: number) {
  for (let j = 0; j < 4; j++) {
    // position along the column in links (0 … k); the tangent at a link boundary b is a[b − 1] / a[b] averaged, a[0] / a[k − 1] at the ends
    const s = (j * k) / 3;
    const lo = Math.min(k - 1, Math.floor(s));
    const t = s - lo;
    const at = (m: number) => (m <= 0 ? a[i0]! : m >= k ? a[i0 + k - 1]! : (a[i0 + m - 1]! + a[i0 + m]!) / 2);
    out[o + j] = at(lo) + (at(lo + 1) - at(lo)) * t;
  }
}

/** Seam fold (the outer column's first link − the inner column's last link); 0 when the page has a single column */
export const seamFold = (b: PageBody) => (b.nIn > 0 && b.nIn < b.n ? b.a[b.nIn]! - b.a[b.nIn - 1]! : 0);

/** Progress (0 lying flat on the right, 1 lying flat on the left): the inner column's angle */
export const pageProgress = (b: PageBody) => Math.min(1, Math.max(0, b.a[0]! / Math.PI));

/** A tap / key turn: from start (s) on, the finger pushes the sheet at the inner column's root over to side `to` */
export function turnPage(b: PageBody, to: 0 | 1, start: number) {
  b.hand = null;
  b.goal = to;
  b.finger = { to, start, t0: -1, w0: 0 };
  b.asleep = false;
  b.quiet = 0;
  b.free = 0;
  b.peak = 0;
}

/** Let go, no more pushing: it falls freely */
export function freePage(b: PageBody) {
  b.hand = null;
  b.finger = null;
  b.goal = null;
  b.asleep = false;
  b.quiet = 0;
  b.free = 0;
}

/**
 * Grab the point on the sheet u from the root (scene units, measured along the sheet); goal is the direction angle from the root to
 * the grabbed point (rad). soft: on hover only a light lift (0–1, 1 is the normal hand)
 */
export function grabPage(b: PageBody, u: number, goal: number, soft = 1) {
  let link = 0;
  let s = u;
  while (link < b.n - 1 && s > b.L[link]!) {
    s -= b.L[link]!;
    link++;
  }
  s = Math.min(Math.max(s, 0.02), b.L[link]!);
  b.hand = { link, s, th: goal, goal, soft, carry: null, t0: -1 };
  b.finger = null;
  b.goal = null;
  b.asleep = false;
  b.quiet = 0;
  b.free = 0;
  b.peak = 0;
}

/**
 * The direction angle the hand pulls the grabbed point to (root to grabbed point; direction only, whatever the distance from the root).
 * reach (optional): also pull the grabbed point to this distance from the root (scene units); null goes back to direction only,
 * undefined leaves the current setting alone.
 */
export function pullPage(b: PageBody, goal: number, reach?: number | null) {
  const hd = b.hand;
  if (!hd) return;
  let moved = false;
  if (Math.abs(goal - hd.goal) > 1e-6) {
    hd.goal = goal;
    moved = true;
  }
  if (reach !== undefined) {
    const r = reach === null ? undefined : Math.max(0.01, reach);
    if (r !== hd.reach && (r === undefined || hd.reach === undefined || Math.abs(r - hd.reach) > 1e-6)) moved = true;
    hd.reach = r;
  }
  if (moved) {
    b.asleep = false;
    b.quiet = 0;
  }
}

/**
 * A drag released as a turn (to side `to`): the hand does not let go but keeps hold of the same point and carries it on — at that
 * point's current angular speed about the root (clamped to carry.min … carry.max), letting go only once the whole sheet's centre of
 * mass is past vertical. Nothing held: the finger instead
 */
export function carryPage(b: PageBody, env: PageEnv, to: 0 | 1, start: number, P: Physics = PHYSICS) {
  const hd = b.hand;
  if (!hd) return turnPage(b, to, start);
  positions(b, env);
  jacobian(b, hd.link, hd.s, Jt, J);
  const a = b.a[hd.link]!;
  const dx = px[hd.link]! + hd.s * Math.cos(a) - px[0]!;
  const dz = pz[hd.link]! + hd.s * Math.sin(a) - pz[0]!;
  // the grabbed point's angular speed about the root (positive toward side `to`): r × v / r²
  const sign = to === 1 ? 1 : -1;
  const om = (sign * (dx * dot(b.n, J, b.w) - dz * dot(b.n, Jt, b.w))) / Math.max(1e-4, dx * dx + dz * dz);
  const v = Math.max(0, om);
  // the hand's direction carries on from the grabbed point's current direction (no longer leading, nor pulling back), its speed easing
  // from the current one into [min, max]
  hd.th = Math.atan2(dz, dx);
  // Carrying over the top is direction only, as before reach existed
  hd.reach = undefined;
  hd.carry = { to, v, w: Math.min(P.carry.max, Math.max(P.carry.min, v)) };
  hd.goal = to === 1 ? Math.PI + 0.06 : -0.06;
  b.goal = to;
  b.finger = null;
  b.asleep = false;
  b.quiet = 0;
  b.free = 0;
}

/** Current positions (xz) of the root and of the point the hand holds; the sheet edge when nothing is held */
export function grabPoint(b: PageBody, env: PageEnv): [rx: number, rz: number, gx: number, gz: number] {
  positions(b, env);
  const hd = b.hand;
  if (!hd) return [px[0]!, pz[0]!, px[b.n]!, pz[b.n]!];
  const a = b.a[hd.link]!;
  return [px[0]!, pz[0]!, px[hd.link]! + hd.s * Math.cos(a), pz[hd.link]! + hd.s * Math.sin(a)];
}

/* ── Small linear algebra (N ≤ 6) ── */
const MAXN = 6;
const Mm = new Float64Array(MAXN * MAXN);
const Km = new Float64Array(MAXN * MAXN);
const Dm = new Float64Array(MAXN * MAXN);
const Am = new Float64Array(MAXN * MAXN);
const Minv = new Float64Array(MAXN * MAXN);
const Ainv = new Float64Array(MAXN * MAXN);
const work = new Float64Array(MAXN * MAXN);
const Q = new Float64Array(MAXN);
const rhs = new Float64Array(MAXN);
const dw = new Float64Array(MAXN);
const J = new Float64Array(MAXN);
const Jt = new Float64Array(MAXN);
const tmp = new Float64Array(MAXN);
const prev = new Float64Array(MAXN);
const px = new Float64Array(MAXN + 1);
const pz = new Float64Array(MAXN + 1);

/** Gauss–Jordan inverse (symmetric positive definite: stable without pivoting) */
function invert(src: Float64Array, dst: Float64Array, n: number) {
  const a = work;
  for (let i = 0; i < n * n; i++) a[i] = src[i]!;
  dst.fill(0, 0, n * n);
  for (let i = 0; i < n; i++) dst[i * n + i] = 1;
  for (let col = 0; col < n; col++) {
    const d = 1 / a[col * n + col]!;
    for (let j = 0; j < n; j++) {
      a[col * n + j]! *= d;
      dst[col * n + j]! *= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r * n + col]!;
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r * n + j]! -= f * a[col * n + j]!;
        dst[r * n + j]! -= f * dst[col * n + j]!;
      }
    }
  }
}

/** y = B x (B is n×n) */
function mul(B: Float64Array, n: number, x: Float64Array, y: Float64Array) {
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += B[i * n + j]! * x[j]!;
    y[i] = s;
  }
}

/** S += k · u uᵀ */
function addOuter(S: Float64Array, n: number, k: number, u: Float64Array) {
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i * n + j]! += k * u[i]! * u[j]!;
}

/** Adds the torsion spring / damper of joint j (between links j−1 and j) into the matrix */
function addJoint(S: Float64Array, n: number, j: number, k: number) {
  S[j * n + j]! += k;
  S[(j - 1) * n + j - 1]! += k;
  S[j * n + j - 1]! -= k;
  S[(j - 1) * n + j]! -= k;
}

/** Jacobian, with respect to every angle, of the point on link `link` at s from the link's start (two rows, x and z) */
function jacobian(b: PageBody, link: number, s: number, jx: Float64Array, jz: Float64Array) {
  for (let i = 0; i < b.n; i++) {
    const len = i < link ? b.L[i]! : i === link ? s : 0;
    jx[i] = -len * Math.sin(b.a[i]!);
    jz[i] = len * Math.cos(b.a[i]!);
  }
}

function positions(b: PageBody, env: PageEnv) {
  const [rx, rz] = env.root(b.phi, b.a[0]!);
  px[0] = rx;
  pz[0] = rz;
  for (let i = 0; i < b.n; i++) {
    px[i + 1] = px[i]! + b.L[i]! * Math.cos(b.a[i]!);
    pz[i + 1] = pz[i]! + b.L[i]! * Math.sin(b.a[i]!);
  }
}

/**
 * Direction angle of the whole sheet's centre of mass from the root, in [−π/2, 3π/2): lying flat on the left, a little below the
 * root, it is just over π and never wraps round to −π
 */
function comAngle(b: PageBody) {
  let mx = 0;
  let mz = 0;
  let M = 0;
  for (let i = 0; i < b.n; i++) {
    mx += b.m[i]! * (px[i]! + px[i + 1]!) * 0.5;
    mz += b.m[i]! * (pz[i]! + pz[i + 1]!) * 0.5;
    M += b.m[i]!;
  }
  const ang = Math.atan2(mz / M - pz[0]!, mx / M - px[0]!);
  return ang < -Math.PI / 2 ? ang + 2 * Math.PI : ang;
}

const surface = (x: number, env: PageEnv) => (x > env.axisX ? env.zR : env.zL);
const dot = (n: number, u: Float64Array, v: Float64Array) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += u[i]! * v[i]!;
  return s;
};

/** Stiffness of joint j: seam.k at the seam, EI / link length inside empty pockets */
const jointK = (b: PageBody, j: number, P: Physics) => (j === b.seam ? P.seam.k : P.flex.EI / b.L[j]!);

/**
 * Advance one substep h (s); t is the time at the end of this step (s, for the finger's start time). Returns whether this sheet is
 * still awake.
 * Springs and damping (joints, finger, hand, air) are taken linearly implicit: (M + hD + h²K)·Δȧ = h·(Q − hK·ȧ), stable even for the
 * very light links of empty pockets
 */
export function stepPage(b: PageBody, env: PageEnv, h: number, t: number, P: Physics = PHYSICS): boolean {
  if (b.asleep) return false;
  const n = b.n;
  const nn = n * n;
  const a = b.a;
  const w = b.w;
  // the finger is not due yet: stay put
  if (b.finger && t < b.finger.start) return true;
  positions(b, env);
  Km.fill(0, 0, nn);
  Dm.fill(0, 0, nn);

  /* Mass matrix, Coriolis / centrifugal terms, gravity */
  for (let i = 0; i < n; i++) {
    let ci = 0;
    for (let j = 0; j < n; j++) {
      const lij = b.L[i]! * b.L[j]! * b.mu[i * n + j]!;
      const d = a[i]! - a[j]!;
      Mm[i * n + j] = lij * Math.cos(d) + (i === j ? b.I[i]! : 0);
      ci += lij * Math.sin(d) * w[j]! * w[j]!;
    }
    Q[i] = -ci - P.g * b.L[i]! * Math.cos(a[i]!) * b.gm[i]!;
  }

  /* Joint springs and damping */
  for (let j = 1; j < n; j++) {
    const r = a[j]! - a[j - 1]!;
    // while the finger lifts the sheet, the palm holds an empty inner column flat as one board too
    const k = jointK(b, j, P) * (b.finger && j < b.nIn ? P.finger.palm : 1);
    let tau = k * r;
    let kd = k;
    if (j === b.seam) {
      // seam: torque k·β·(1 + (β/β0)²), tangent stiffness k·(1 + 3(β/β0)²) — stiffening smoothly, no kink; past the maximum fold it
      // is as if it hit a stop
      const q = r / P.seam.stiffen;
      tau *= 1 + q * q;
      kd *= 1 + 3 * q * q;
      const over = Math.abs(r) - P.seam.max;
      if (over > 0) {
        tau += Math.sign(r) * over * k * 40;
        kd += k * 40;
      }
    } else {
      // sasshi (round 4, E6): an empty column's links fold against each other at most flex.max (a stop as stiff as the seam's)
      const over = Math.abs(r) - P.flex.max;
      if (over > 0) {
        tau += Math.sign(r) * over * P.seam.k * 40;
        kd += P.seam.k * 40;
      }
    }
    // damping from the current tangent stiffness (damping ratio unchanged): the further it folds the stiffer and the more viscous, so
    // what it has stored comes out slowly
    let c = 2 * (j === b.seam ? P.seam.zeta : P.flex.zeta) * Math.sqrt(kd * b.Iout[j]!);
    const rel = w[j]! - w[j - 1]!;
    tau = -tau - c * rel;
    if (j === b.seam) {
      // the seam's speed cap: a resisting torque that rises steeply once the relative angular speed passes the knee (the implicit part
      // uses its derivative, 5 times the coefficient)
      const gov = b.Iout[j]! * P.cap.seamK * (Math.abs(rel) / P.cap.seam) ** 4;
      tau -= gov * rel;
      c += 5 * gov;
    }
    Q[j]! += tau;
    Q[j - 1]! -= tau;
    addJoint(Km, n, j, kd);
    addJoint(Dm, n, j, c);
  }

  /* Air drag: two points per link, normal velocity squared; grows by (h0 / gap)² close to the stack below (squeeze film: the last
   * bit of the fall is held up) */
  const air = 0.5 * P.air.rho * P.air.cd;
  for (let k = 0; k < n; k++) {
    const nx = -Math.sin(a[k]!);
    const nz = Math.cos(a[k]!);
    for (const f of [0.3, 0.8]) {
      const s = b.L[k]! * f;
      jacobian(b, k, s, Jt, J);
      for (let i = 0; i < n; i++) tmp[i] = nx * Jt[i]! + nz * J[i]!;
      const vn = dot(n, tmp, w);
      const x = px[k]! + s * Math.cos(a[k]!);
      const z = pz[k]! + s * Math.sin(a[k]!);
      const gap = Math.max(0, z - surface(x, env));
      // squeeze only while falling: the air has to escape through the gap between the sheet and the stack (on the way up air flows in
      // from all four sides: not counted)
      const q = dot(n, J, w) < 0 ? P.air.h0 / (gap + 0.004) : 0;
      const coef = air * (1 + Math.min(P.air.cap, q * q)) * b.L[k]! * 0.5 * b.h;
      // speed-cap damping: rises steeply once the normal speed passes the knee (turned into a linear speed by the distance from the
      // root), F = −(m/2)·k·(|v| / vc)⁴·v; the implicit part uses its derivative in v, 5·(m/2)·k·(|v| / vc)⁴, stable at 480 Hz too
      const vc = P.cap.air * Math.max(0.2, Math.hypot(x - px[0]!, z - pz[0]!));
      const av = Math.abs(vn);
      const gov = 0.5 * b.m[k]! * P.cap.k * (av / vc) ** 4;
      // air cushion: falling and less than cushion.gap above the stack, a mass-scaled drag proportional to the speed squared, stronger
      // the closer — a fast fall is held up and slowed over its last stretch, a slow one is barely touched (it does not hover over the
      // stack and creep down)
      const cg = q > 0 ? Math.max(0, 1 - gap / P.cushion.gap) : 0;
      const cush = 0.5 * b.m[k]! * P.cushion.k * cg * cg * av;
      const F = -coef * av * vn - gov * vn - cush * vn;
      for (let i = 0; i < n; i++) Q[i]! += F * tmp[i]!;
      addOuter(Dm, n, 2 * coef * av + 5 * gov + 2 * cush, tmp);
    }
  }

  /* Finger: a capped torque at the inner column's root, trying to turn the inner column at the hand's speed; it lets go once the
   * whole sheet's centre of mass is past vertical, gravity does the rest */
  const fg = b.finger;
  if (fg) {
    const sign = fg.to === 1 ? 1 : -1;
    const past = sign * (comAngle(b) - Math.PI / 2) > P.finger.margin;
    if (past) b.finger = null;
    else {
      const F = P.finger;
      // the hand takes the sheet at its own speed and eases up to the hand's wanted speed over ramp seconds (a sheet falling back the
      // other way is not yanked round within a frame or two)
      if (fg.t0 < 0) {
        fg.t0 = t;
        fg.w0 = sign * w[0]!;
      }
      // angle turned so far (measured from the starting side): fast at first, the hand slows down near vertical
      const x = fg.to === 1 ? a[0]! : Math.PI - a[0]!;
      const k = Math.min(1, Math.max(0, (x - F.slow) / (Math.PI / 2 - F.slow)));
      const r = Math.min(1, (t - fg.t0) / F.ramp);
      const prof = F.w + (F.wTop - F.w) * k * k * (3 - 2 * k);
      const want = sign * (fg.w0 + (prof - fg.w0) * r * r * (3 - 2 * r));
      // the palm under the middle of the sheet: every link of the inner column (an empty inner column too is held flat as it lifts,
      // no V fold at the root) and the outer column's link next to the seam are pushed toward want, the outer column getting
      // F.outer, the total torque within the cap. Only pushing forward, never pulling back: when gravity takes the outer column over
      // first, the palm does not hold it back.
      // linearly implicit damping form: torque = g·(want − ȧ), g chosen so the torque just stays within the cap; a light sheet
      // catches up with the hand in one step and does not overshoot
      // the hand slides outward along the sheet: while the inner column turns through outerFrom … outerTo, the outer column's share
      // rises smoothly from outer to outerTop
      const ko = Math.min(1, Math.max(0, (x - F.outerFrom) / (F.outerTo - F.outerFrom)));
      const outer = F.outer + (F.outerTop - F.outer) * ko * ko * (3 - 2 * ko);
      for (let i = 0; i <= b.nIn && i < n; i++) {
        // the part of the hand under the outer column moves faster than under the inner one (the hand is further out, lifting): the
        // outer column's wanted speed is (1 + outerLead) times as high
        const err = want * (i < b.nIn ? 1 : 1 + F.outerLead * ko * ko * (3 - 2 * ko)) - w[i]!;
        if (sign * err <= 0) continue;
        const share = i < b.nIn ? (1 - F.outer - F.outerTake * (outer - F.outer)) / b.nIn : outer;
        const g = share * Math.min(F.gain, F.torque / Math.abs(err));
        Q[i]! += g * err;
        Dm[i * n + i]! += g;
      }
    }
  }

  /* A side to land on is set and nobody holds the sheet: if its centre of mass is back on the other side (flung back), lift it again */
  if (b.goal !== null && !b.finger && !b.hand) {
    const sign = b.goal === 1 ? 1 : -1;
    if (sign * (comAngle(b) - Math.PI / 2) < -P.finger.margin - 0.05) b.finger = { to: b.goal, start: t, t0: -1, w0: 0 };
  }

  /* Hand: the grabbed point is pulled onto the ray from the root at direction angle th (at its current distance from the root:
   * neither pushing out nor pulling in, gravity decides how far the sheet bends) */
  // carrying on after release: let go once the whole sheet's centre of mass is past vertical (goal stays: should it be flung back, the
  // block above lifts it again)
  if (b.hand?.carry && (b.hand.carry.to === 1 ? 1 : -1) * (comAngle(b) - Math.PI / 2) > P.finger.margin) b.hand = null;
  const hd = b.hand;
  if (hd) {
    const th0 = hd.th;
    const cr = hd.carry;
    if (cr) {
      // carrying on: the speed eases from the speed at release to the wanted one, the direction always heading toward side `to`
      cr.v += (cr.w - cr.v) * (1 - Math.exp(-h / P.carry.ramp));
      hd.th = cr.to === 1 ? Math.min(hd.goal, hd.th + cr.v * h) : Math.max(hd.goal, hd.th - cr.v * h);
    } else {
      // the hand's target direction chases the pointer: at most cap.hand·h per step, softly saturated with tanh — on a slow drag it
      // is on the pointer within a substep or two, on a quick flick it catches up at a steady rate, its speed continuous, no kinks
      // in the first handRamp seconds after the grab the top speed eases from handStart × to 1 ×: the hand first takes up the slack,
      // so the sheet edge is not yanked up at once
      if (hd.t0 < 0) hd.t0 = t;
      const q = Math.min(1, (t - hd.t0) / P.cap.handRamp);
      const lim = P.cap.hand * h * (P.cap.handStart + (1 - P.cap.handStart) * q * q * (3 - 2 * q));
      hd.th += lim * Math.tanh((hd.goal - hd.th) / lim);
    }
    jacobian(b, hd.link, hd.s, Jt, J);
    const gx = px[hd.link]! + hd.s * Math.cos(a[hd.link]!);
    const gz = pz[hd.link]! + hd.s * Math.sin(a[hd.link]!);
    // Direction only unless the caller also gave a reach (then the pointer sets direction and distance)
    const r = hd.reach ?? Math.max(0.05, Math.hypot(gx - px[0]!, gz - pz[0]!));
    const tx = px[0]! + r * Math.cos(hd.th);
    const tz = pz[0]! + r * Math.sin(hd.th);
    // the target's velocity counts only its rotation: the hand sets only the direction (no spring along the radius), but the
    // gripping fingers damp along the radius too — the sheet does not slide back and forth in the hand
    const om = (hd.th - th0) / h;
    const vtx = -r * Math.sin(hd.th) * om;
    const vtz = r * Math.cos(hd.th) * om;
    const vx = dot(n, Jt, w);
    const vz = dot(n, J, w);
    // the equivalent stiffness about the root does not change with where the sheet is held: the closer to the ring the grab, the
    // harder the hand has to pull
    const wh = 2 * Math.PI * P.hand.hz;
    const krot = b.Ipage * wh * wh * hd.soft;
    const kh = krot / (r * r);
    const ch = (2 * P.hand.zeta * Math.sqrt(krot * b.Ipage)) / (r * r);
    // the hand carries the sheet's weight: first a tangential lift at the grabbed point from the whole sheet's gravity torque (about
    // the root), the spring only handles the remaining error — on a slow drag the grabbed point does not lag behind the pointer
    // under the sheet's weight
    let mg = 0;
    for (let i = 0; i < n; i++) mg += b.m[i]! * ((px[i]! + px[i + 1]!) * 0.5 - px[0]!);
    const hold = (P.g * mg * hd.soft) / r;
    const ux = (gx - px[0]!) / r;
    const uz = (gz - pz[0]!) / r;
    let fx = kh * (tx - gx) + ch * (vtx - vx) - hold * uz;
    let fz = kh * (tz - gz) + ch * (vtz - vz) + hold * ux;
    const fm = Math.hypot(fx, fz);
    const cap = P.hand.maxF * hd.soft;
    const sc = fm > cap ? cap / fm : 1;
    fx *= sc;
    fz *= sc;
    for (let i = 0; i < n; i++) Q[i]! += fx * Jt[i]! + fz * J[i]!;
    addOuter(Km, n, kh * sc, Jt);
    addOuter(Km, n, kh * sc, J);
    addOuter(Dm, n, ch * sc, Jt);
    addOuter(Dm, n, ch * sc, J);
  }

  /* Velocities: (M + hD + h²K) Δȧ = h (Q − h K ȧ) */
  for (let i = 0; i < nn; i++) Am[i] = Mm[i]! + h * Dm[i]! + h * h * Km[i]!;
  mul(Km, n, w, tmp);
  for (let i = 0; i < n; i++) rhs[i] = h * (Q[i]! - h * tmp[i]!);
  invert(Am, Ainv, n);
  mul(Ainv, n, rhs, dw);
  for (let i = 0; i < n; i++) w[i]! += dw[i]!;
  invert(Mm, Minv, n);

  /* Contact: velocity-level impulses (normal + friction) */
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k <= n; k++) {
      const pen = surface(px[k]!, env) - pz[k]!;
      if (pen < -0.002) continue;
      jacobian(b, k - 1, b.L[k - 1]!, Jt, J);
      const vn = dot(n, J, w);
      if (vn >= 0) continue;
      mul(Minv, n, J, tmp);
      const kn = dot(n, J, tmp);
      if (kn < 1e-12) continue;
      const e = pass === 0 && vn < -0.6 ? P.contact.e : 0;
      const ln = (-(1 + e) * vn) / kn;
      for (let i = 0; i < n; i++) w[i]! += tmp[i]! * ln;
      // friction: sliding along the desk
      const vt = dot(n, Jt, w);
      mul(Minv, n, Jt, tmp);
      const kt = dot(n, Jt, tmp);
      if (kt < 1e-12) continue;
      const cap = P.contact.mu * ln;
      const lt = Math.max(-cap, Math.min(cap, -vt / kt));
      for (let i = 0; i < n; i++) w[i]! += tmp[i]! * lt;
    }
  }

  /* Positions (the angles from before this step are kept: sleep is judged on the real change in angle, so the little velocity the
   * velocity level leaves while the sheet lies on the stack does not count) */
  for (let i = 0; i < n; i++) {
    prev[i] = a[i]!;
    a[i]! += w[i]! * h;
  }
  // the hole slides along the ring (with friction, lagging a little)
  b.phi += (holeAngle(a[0]!, env) - b.phi) * (1 - Math.exp(-h / P.hole.tau));

  /* Position projection: points that have passed in are pushed out through the mass matrix */
  for (let it = 0; it < 2; it++) {
    positions(b, env);
    for (let k = 1; k <= n; k++) {
      const pen = surface(px[k]!, env) - pz[k]!;
      if (pen <= 0) continue;
      jacobian(b, k - 1, b.L[k - 1]!, Jt, J);
      mul(Minv, n, J, tmp);
      const kn = dot(n, J, tmp);
      if (kn < 1e-12) continue;
      for (let i = 0; i < n; i++) a[i]! += (tmp[i]! * pen) / kn;
      positions(b, env);
    }
  }

  /* Watching: peak seam fold */
  const fold = Math.abs(seamFold(b));
  if (fold > b.peak) b.peak = fold;

  /* sasshi (round 4, E6): free and still not at rest after sleep.stuck seconds: laid down on its inner column's side */
  if (b.finger || b.hand) b.free = 0;
  else if ((b.free += h) >= P.sleep.stuck) {
    restPage(b, a[0]! > Math.PI / 2 ? 1 : 0, env);
    return false;
  }

  /* Sleep: nobody pushing, nobody pulling, everything almost still */
  let wmax = 0;
  for (let i = 0; i < n; i++) wmax = Math.max(wmax, Math.abs(a[i]! - prev[i]!) / h);
  if (!b.finger && wmax < P.sleep.w && (!b.hand || Math.abs(b.hand.goal - b.hand.th) < 1e-3)) {
    b.quiet += h;
    if (b.quiet >= P.sleep.time) {
      let near0 = true;
      let nearPi = true;
      for (let i = 0; i < n; i++) {
        near0 &&= Math.abs(a[i]!) < P.sleep.ang;
        nearPi &&= Math.abs(a[i]! - Math.PI) < P.sleep.ang;
      }
      if (!b.hand && (near0 || nearPi)) restPage(b, near0 ? 0 : 1, env);
      else if (b.hand) {
        // held in the hand and stopped: no more integrating; it wakes again once the target moves
        w.fill(0);
        b.asleep = true;
      }
    }
  } else b.quiet = 0;
  return !b.asleep;
}
