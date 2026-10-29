/*
 * The pouch world: a closed box of walls, a handful of loose objects, three depth layers.
 *
 * Per fixed 120 Hz substep:
 *   1. every free body gets the apparent acceleration of the frame (uniform part, plus Euler / centrifugal / Coriolis
 *      terms when the pouch spins), then Coulomb friction from the film, in velocity space (see friction.ts);
 *   2. planck solves contacts and integrates positions (all bodies are bullets: continuous collision, no tunnelling;
 *      no gravity inside planck, no sleeping, no FrictionJoint);
 *   3. last-resort guards (non-finite state, body centre outside the pouch, speed cap), state output;
 *   4. ghosts try to re-join their layer, only when they overlap nothing in it;
 *   5. idle bookkeeping.
 *
 * Layers: same layer collides, different layers pass through each other (collision filter bits, switched at runtime).
 * A grabbed body, and a released one that has not found a free spot yet, is a ghost: it collides with walls only and is
 * reported on the top layer. Switching a body into a layer it overlaps would make the solver push it out within one
 * step (9-27 mm pops, measured), so it never happens.
 */
import { G, MU, SIM_HZ, SIM_MAX_DT } from "../constants";
import { Box, MouseJoint, Settings, Vec2, World, WorldManifold } from "planck";
import type { Body, Contact, Fixture, Shape } from "planck";
import { apparentAccelInto, type Frame } from "./frame";
import { coulombScale, coulombSpin, spinRadius, surfaceDecel } from "./friction";
import { boundRadius, mulberry32, scatter } from "./layout";
import { S, gapBetween, makeShapes, massOf } from "./shapes";
import type { BagSim, BagSimOptions, BodySpec, BodyState, LayerId, Placement, SimStats } from "./types";

const H = 1 / SIM_HZ;
const VEL_ITERS = 8;
const POS_ITERS = 3;
const TOP_LAYER = 2;

// collision bits
const CAT_LAYER = [1, 2, 4] as const;
const CAT_WALL = 8;
const CAT_GHOST = 16;
const FILTER_WALL = { groupIndex: 0, categoryBits: CAT_WALL, maskBits: 0xffff };
const FILTER_GHOST = { groupIndex: 0, categoryBits: CAT_GHOST, maskBits: CAT_WALL };
const layerFilter = (l: number) => ({ groupIndex: 0, categoryBits: CAT_LAYER[l] ?? 1, maskBits: (CAT_LAYER[l] ?? 1) | CAT_WALL });

const WALL_THICKNESS = 0.5; // planck units (50 mm)
const FRICTION = 0.3; // body-body contact friction (planck)
const RESTITUTION = 0.1;
const LINEAR_DAMPING = 0.02;
const ANGULAR_DAMPING = 0.02;
const HELD_ANGULAR_DAMPING = 4; // a body dangling from a finger does not spin freely

// rest / wake thresholds
const IDLE_SPEED = 5e-4; // m/s: 0.5 mm/s
const IDLE_HOLD = 24; // substeps (0.2 s) of rest before idle() turns true
const FRAME_EPS = 0.005 * G; // frame change that wakes the sim: 0.5 % g
const FRAME_REACH = 0.2; // m: converts omega / alpha changes to an acceleration at the pouch edge

// drag (planck MouseJoint on the grabbed point)
const DRAG_HZ = 20;
const DRAG_DAMPING = 1;
const DRAG_ACCEL = 600; // planck units/s^2 of force per kg: 6 g

const READMIT_GAP = 0.001 * S; // required clear gap to re-join a layer: 1 mm
const STICK_V2 = (0.002 * S) ** 2; // below 2 mm/s a body counts as resting for static friction (planck units, squared)
const MAX_A = 12 * G;
const MAX_OMEGA = 60;
const MAX_ALPHA = 400;
const SHAKE_SPEED = 1.6; // m/s for strength 1
const SHAKE_SPREAD = 1.2; // rad: default spread of the per-body directions around the shared one
const RELAX_STEPS = 240;

// contact reports (BagSimOptions.onContact)
/** m/s: slower contacts are not reported (a body resting under 1 g approaches its support at g / 120 = 0.08 m/s per substep). */
export const CONTACT_MIN_SPEED = 0.1;
/** m/s within one substep: a persistent contact whose approach speed jumps by this much was struck again (a shake into a wall). */
export const CONTACT_RISE = 0.1;
/** Substeps a pair must have been apart before a touch counts as a new one (a resting contact that flickers is not a hit). */
const CONTACT_APART = 2;
/** Substeps (50 ms) between two reports of the same pair. */
const CONTACT_DEBOUNCE = Math.round(0.05 * SIM_HZ);
/** Reports queued per substep at most (the rest are dropped: they would be lost in the noise anyway). */
const CONTACT_QUEUE = 32;
const NEVER = -1e9;

type Item = {
  spec: BodySpec;
  body: Body;
  fixtures: Fixture[];
  shapes: Shape[];
  home: LayerId;
  ghost: boolean;
  held: boolean;
  joint: MouseJoint | null;
  rBound: number; // m, bounding circle around the centre
  rSpin: number; // m, equivalent disk radius for spin friction
  mu: number; // per-body friction factor (1 unless options.friction.spread)
  gx: number; // last good pose, planck units / rad
  gy: number;
  ga: number;
  out: BodyState;
};

export function createBagSim(o: BagSimOptions): BagSim {
  const hw = o.width / 2, hh = o.height / 2;
  const seed = o.seed ?? 1;
  const maxTravel = o.maxTravel ?? 0.02;
  const vRelease = maxTravel * SIM_HZ; // m/s
  const vCap = Math.max(10, vRelease * 3);
  const vHeld = Math.max(vRelease - (DRAG_ACCEL / S) * H, vRelease / 2); // the joint adds up to DRAG_ACCEL * H on top of this within a substep
  const muK = Math.max(0, o.friction?.kinetic ?? MU);
  const muS = Math.max(muK, o.friction?.static ?? muK);
  const muSpread = Math.min(0.5, Math.max(0, o.friction?.spread ?? 0));
  const world = new World({ gravity: new Vec2(0, 0) });
  /** Contact nodes for the reports: body i is node i, the four walls are nodes N … N + 3 (fixture user data). */
  const N = o.bodies.length;

  // --- walls (static; also the ground body of the drag joint)
  const walls = world.createBody({ type: "static" });
  {
    const skin = Settings.polygonRadius; // the core sits one skin beyond the pouch edge so the rounded face is flush with it
    const w = hw * S, h = hh * S, t = WALL_THICKNESS;
    let side = 0;
    const box = (hx: number, hy: number, cx: number, cy: number) => walls.createFixture({ shape: new Box(hx, hy, new Vec2(cx, cy), 0), friction: 0.2, restitution: 0, filterGroupIndex: 0, filterCategoryBits: FILTER_WALL.categoryBits, filterMaskBits: FILTER_WALL.maskBits, userData: N + side++ });
    box(t / 2, h + t, w + skin + t / 2, 0);
    box(t / 2, h + t, -w - skin - t / 2, 0);
    box(w + t, t / 2, 0, h + skin + t / 2);
    box(w + t, t / 2, 0, -h - skin - t / 2);
  }

  const items: Item[] = o.bodies.map((spec, index) => {
    const body = world.createBody({ type: "dynamic", bullet: true, allowSleep: false, linearDamping: LINEAR_DAMPING, angularDamping: ANGULAR_DAMPING });
    const shapes = makeShapes(spec);
    const density = massOf(spec) / Math.max(shapes.reduce((a, s) => a + unitMass(s), 0), 1e-9);
    const f0 = layerFilter(spec.layer);
    const fixtures = shapes.map((shape) =>
      body.createFixture({ shape, density, friction: FRICTION, restitution: RESTITUTION, filterGroupIndex: 0, filterCategoryBits: f0.categoryBits, filterMaskBits: f0.maskBits, userData: index }),
    );
    body.resetMassData();
    return {
      spec, body, fixtures, shapes, home: spec.layer, ghost: false, held: false, joint: null,
      rBound: boundRadius(spec), rSpin: spinRadius(spec), mu: muSpread > 0 ? 1 + muSpread * (2 * hash01(spec.id) - 1) : 1, gx: 0, gy: 0, ga: 0,
      out: { id: spec.id, x: 0, y: 0, angle: 0, vx: 0, vy: 0, w: 0, layer: spec.layer, held: false },
    };
  });
  const byId = new Map(items.map((it) => [it.spec.id, it] as const));
  const states: BodyState[] = items.map((it) => it.out);

  // --- mutable sim state
  const fr: Frame = { ax: 0, ay: 0, gn: G, omega: 0, alpha: 0 };
  const ref: Frame = { ax: 0, ay: 0, gn: G, omega: 0, alpha: 0 };
  let refSet = false;
  let acc = 0;
  let idleSteps = 0;
  let held: Item | null = null;
  let layoutCounter = 0;
  const shakeRng = mulberry32((seed ^ 0x5bd1e995) | 0);
  const stats: SimStats = { substeps: 0, wallClamps: 0, nanResets: 0 };
  const tmp = new Vec2(0, 0);
  const aOut = { ax: 0, ay: 0 };
  const cv = new Float64Array(3);

  // --- contact reports: per pair of nodes (lo * M + hi), allocated once; nothing in the hot path allocates
  const onContact = o.onContact;
  const M = N + 4;
  const pairs = onContact ? M * M : 0;
  const touchedAt = new Int32Array(pairs).fill(NEVER); // last substep the pair touched
  const reportedAt = new Int32Array(pairs).fill(NEVER); // last substep the pair was reported
  const prevVn = new Float64Array(pairs); // approach speed in the pair's last touching substep (planck units / s)
  const curVn = new Float64Array(pairs); // this substep: the fastest approach over the pair's contact points, its point and its striker
  const curX = new Float64Array(pairs);
  const curY = new Float64Array(pairs);
  const curA = new Int32Array(pairs);
  const curMark = new Int32Array(pairs).fill(NEVER); // substep the pair was first seen in (dedupes `touched`)
  const touched = new Int32Array(pairs); // pairs seen this substep
  let nTouched = 0;
  const qa = new Int32Array(CONTACT_QUEUE), qb = new Int32Array(CONTACT_QUEUE);
  const qv = new Float64Array(CONTACT_QUEUE), qx = new Float64Array(CONTACT_QUEUE), qy = new Float64Array(CONTACT_QUEUE);
  let nQueued = 0;
  /** Substep counter of the contact bookkeeping (counts the layout's relaxation steps too) */
  let sub = 0;
  const wm = new WorldManifold();
  const kg = items.map((it) => massOf(it.spec));
  /** Velocity of node i at the world point (px, py), planck units; walls are still. Result in cv[0], cv[1]. */
  function pointVelocity(i: number, px: number, py: number) {
    if (i >= N) {
      cv[0] = 0;
      cv[1] = 0;
      return;
    }
    const b = items[i]!.body, v = b.getLinearVelocity(), c = b.getWorldCenter(), w = b.getAngularVelocity();
    cv[0] = v.x - w * (py - c.y);
    cv[1] = v.y + w * (px - c.x);
  }
  /** planck "pre-solve": every touching contact, every step, before the solver changes the velocities */
  function preSolve(c: Contact) {
    const ia = c.getFixtureA().getUserData() as number, ib = c.getFixtureB().getUserData() as number;
    if (!(ia >= 0 && ib >= 0) || ia === ib) return;
    c.getWorldManifold(wm);
    const nx = wm.normal.x, ny = wm.normal.y; // from A to B
    let best = 0, bx = 0, by = 0;
    for (let k = 0; k < wm.pointCount; k++) {
      const p = wm.points[k]!;
      pointVelocity(ia, p.x, p.y);
      const ax = cv[0]!, ay = cv[1]!;
      pointVelocity(ib, p.x, p.y);
      const vn = (ax - cv[0]!) * nx + (ay - cv[1]!) * ny; // > 0: A and B close in along the normal
      if (vn > best || k === 0) {
        best = vn;
        bx = p.x;
        by = p.y;
      }
    }
    const lo = ia < ib ? ia : ib, hi = ia < ib ? ib : ia;
    const key = lo * M + hi;
    // the striker: a body against a wall; of two bodies, the one with more momentum
    let striker = lo;
    if (hi < N) {
      const va = items[lo]!.body.getLinearVelocity(), vb = items[hi]!.body.getLinearVelocity();
      if (kg[hi]! * Math.hypot(vb.x, vb.y) > kg[lo]! * Math.hypot(va.x, va.y)) striker = hi;
    }
    if (curMark[key] !== sub) {
      curMark[key] = sub;
      curVn[key] = -Infinity;
      touched[nTouched++] = key;
    }
    // a capsule (several fixtures) or a TOI re-touch can visit a pair twice in one step: keep the hardest
    if (best > curVn[key]!) {
      curVn[key] = best;
      curX[key] = bx;
      curY[key] = by;
      curA[key] = striker;
    }
  }
  if (onContact) world.on("pre-solve", preSolve);
  /** After a world.step: decide which touching pairs struck; `report` false while dealing (bookkeeping only). */
  function settleContacts(report: boolean) {
    if (!onContact) return;
    const min = CONTACT_MIN_SPEED * S, rise = CONTACT_RISE * S;
    for (let k = 0; k < nTouched; k++) {
      const key = touched[k]!;
      const lo = Math.floor(key / M), hi = key - lo * M;
      const vn = curVn[key]!;
      const fresh = touchedAt[key]! < sub - CONTACT_APART;
      const persisting = touchedAt[key] === sub - 1;
      const heldBody = items[lo]!.held || (hi < N && items[hi]!.held);
      const struck = vn >= min && (fresh || (!heldBody && persisting && vn - prevVn[key]! >= rise));
      if (report && struck && sub - reportedAt[key]! >= CONTACT_DEBOUNCE && nQueued < CONTACT_QUEUE) {
        reportedAt[key] = sub;
        const a = curA[key]!;
        qa[nQueued] = a;
        qb[nQueued] = a === lo ? hi : lo;
        qv[nQueued] = vn / S;
        qx[nQueued] = curX[key]! / S;
        qy[nQueued] = curY[key]! / S;
        nQueued++;
      }
      prevVn[key] = vn;
      touchedAt[key] = sub;
    }
    nTouched = 0;
    sub++;
  }
  /** Hand the queued reports to the host (outside planck's step: the callback may call grab / shake / … safely). */
  function dispatchContacts() {
    if (!onContact || nQueued === 0) return;
    const n = nQueued;
    nQueued = 0;
    for (let k = 0; k < n; k++) onContact(items[qa[k]!]!.spec.id, qb[k]! >= N ? "wall" : items[qb[k]!]!.spec.id, qv[k]!, qx[k]!, qy[k]!);
  }

  // --- helpers
  function setFilter(it: Item, f: { groupIndex: number; categoryBits: number; maskBits: number }) {
    for (const fx of it.fixtures) fx.setFilterData(f);
  }
  function setGhost(it: Item) {
    if (it.ghost) return;
    it.ghost = true;
    setFilter(it, FILTER_GHOST);
    it.out.layer = TOP_LAYER;
  }
  /** Re-join the home layer if nothing in it is within READMIT_GAP. Returns whether the body is now a normal one. */
  function tryAdmit(it: Item): boolean {
    if (!it.ghost) return true;
    if (it.held) return false;
    const pa = it.body.getPosition();
    for (const o2 of items) {
      if (o2 === it || o2.ghost || o2.home !== it.home) continue;
      const pb = o2.body.getPosition();
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > (it.rBound + o2.rBound) * S + READMIT_GAP) continue;
      if (gapBetween(it.shapes, it.body.getTransform(), o2.shapes, o2.body.getTransform()) < READMIT_GAP) return false;
    }
    it.ghost = false;
    setFilter(it, layerFilter(it.home));
    it.out.layer = it.home;
    return true;
  }
  function wake() {
    idleSteps = 0;
  }
  function writeState(it: Item) {
    const b = it.body, p = b.getPosition(), v = b.getLinearVelocity(), out = it.out;
    out.x = p.x / S;
    out.y = p.y / S;
    out.angle = b.getAngle();
    out.vx = v.x / S;
    out.vy = v.y / S;
    out.w = b.getAngularVelocity();
    out.held = it.held;
  }
  function setVelocity(b: Body, vx: number, vy: number, w: number) {
    tmp.x = vx;
    tmp.y = vy;
    b.setLinearVelocity(tmp);
    b.setAngularVelocity(w);
  }
  /** Limit linear speed to `cap` m/s and the rim speed of the spin likewise; result in `cv` (planck units, rad/s). */
  function capSpeed(it: Item, vx: number, vy: number, w: number, cap: number) {
    const sp = Math.hypot(vx, vy), lim = cap * S;
    if (sp > lim) {
      vx *= lim / sp;
      vy *= lim / sp;
    }
    const wl = cap / Math.max(it.rBound, 1e-3);
    cv[0] = vx;
    cv[1] = vy;
    cv[2] = w > wl ? wl : w < -wl ? -wl : w;
  }
  function dropJoint(it: Item) {
    if (it.joint) world.destroyJoint(it.joint);
    it.body.setAngularDamping(ANGULAR_DAMPING);
    it.joint = null;
    it.held = false;
    it.out.held = false;
    if (held === it) held = null;
  }

  // --- layout
  function relax() {
    let prev = items.map((it) => [it.body.getPosition().x, it.body.getPosition().y]);
    for (let n = 0; n < RELAX_STEPS; n++) {
      world.step(H, VEL_ITERS, POS_ITERS);
      // dealing is not an impact: only keep the contact bookkeeping current (what touches now is a resting contact later)
      settleContacts(false);
      let moved = 0;
      items.forEach((it, i) => {
        const p = it.body.getPosition(), q = prev[i]!;
        moved = Math.max(moved, Math.hypot(p.x - q[0]!, p.y - q[1]!));
        q[0] = p.x;
        q[1] = p.y;
        setVelocity(it.body, 0, 0, 0);
      });
      if (n >= 2 && moved < 2e-4) break;
    }
  }
  function deal() {
    if (held) dropJoint(held);
    let fixed: readonly (Placement | null | undefined)[] | undefined;
    try {
      fixed = o.deal?.(layoutCounter);
    } catch {
      fixed = undefined; // a broken composer must not break the pouch: fall back to the scatter
    }
    const plc = scatter(o.bodies, o.width, o.height, seed + layoutCounter * 7919, fixed);
    items.forEach((it, i) => {
      const p = plc[i]!;
      it.home = it.spec.layer;
      it.ghost = false;
      setFilter(it, layerFilter(it.home));
      it.out.layer = it.home;
      it.body.setTransform(new Vec2(p.x * S, p.y * S), p.angle);
      setVelocity(it.body, 0, 0, 0);
    });
    relax();
    for (const it of items) {
      const p = it.body.getPosition();
      it.gx = p.x;
      it.gy = p.y;
      it.ga = it.body.getAngle();
      writeState(it);
    }
    acc = 0;
    wake();
  }

  // --- the substep
  function substep() {
    const decel = surfaceDecel(fr.gn, muK) * S; // planck units/s^2
    const decelS = muS === muK ? decel : surfaceDecel(fr.gn, muS) * S;
    const rotating = fr.omega !== 0 || fr.alpha !== 0;
    const ux = fr.ax * S, uy = fr.ay * S;
    for (const it of items) {
      const b = it.body, lv = b.getLinearVelocity();
      let vx = lv.x, vy = lv.y, w = b.getAngularVelocity();
      // a body at rest has to break static friction; once it slides, kinetic friction holds it back
      const dv = (vx * vx + vy * vy < STICK_V2 ? decelS : decel) * it.mu * H;
      let ax = ux, ay = uy;
      if (rotating) {
        const p = b.getPosition();
        apparentAccelInto(aOut, fr, p.x / S, p.y / S, vx / S, vy / S);
        ax = aOut.ax * S;
        ay = aOut.ay * S;
        w -= fr.alpha * H; // the pouch turns under the body
      }
      vx += ax * H;
      vy += ay * H;
      const k = coulombScale(Math.hypot(vx, vy), dv);
      vx *= k;
      vy *= k;
      w = coulombSpin(w, decel * it.mu, H, it.rSpin * S);
      capSpeed(it, vx, vy, w, it.held ? vHeld : it.ghost ? vRelease : vCap);
      setVelocity(b, cv[0]!, cv[1]!, cv[2]!);
    }

    world.step(H, VEL_ITERS, POS_ITERS);
    stats.substeps++;
    settleContacts(true);

    const lx = hw * S, ly = hh * S;
    let moving = held !== null;
    for (const it of items) {
      const b = it.body, p = b.getPosition(), v = b.getLinearVelocity();
      const px = p.x, py = p.y, a = b.getAngle(), w = b.getAngularVelocity();
      if (!Number.isFinite(px + py + a + v.x + v.y + w)) {
        // last resort: put the body back where it was last seen in good health
        stats.nanResets++;
        tmp.x = it.gx;
        tmp.y = it.gy;
        b.setTransform(tmp, it.ga);
        setVelocity(b, 0, 0, 0);
      } else if (px > lx || px < -lx || py > ly || py < -ly) {
        stats.wallClamps++;
        tmp.x = px > lx ? lx : px < -lx ? -lx : px;
        tmp.y = py > ly ? ly : py < -ly ? -ly : py;
        b.setTransform(tmp, a);
        setVelocity(b, px > lx || px < -lx ? 0 : v.x, py > ly || py < -ly ? 0 : v.y, w);
      } else {
        capSpeed(it, v.x, v.y, w, it.ghost ? vRelease : vCap);
        if (cv[0] !== v.x || cv[1] !== v.y || cv[2] !== w) setVelocity(b, cv[0]!, cv[1]!, cv[2]!);
        it.gx = px;
        it.gy = py;
        it.ga = a;
      }
      writeState(it);
      if (!moving && (Math.hypot(it.out.vx, it.out.vy) > IDLE_SPEED || Math.abs(it.out.w) * it.rSpin > IDLE_SPEED)) moving = true;
    }
    for (const it of items) if (it.ghost && !it.held) tryAdmit(it);
    idleSteps = moving ? 0 : idleSteps + 1;
    dispatchContacts();
  }

  function frameChanged(f: Frame, r: Frame): boolean {
    if (!refSet) return true;
    return (
      Math.abs(f.ax - r.ax) > FRAME_EPS || Math.abs(f.ay - r.ay) > FRAME_EPS || Math.abs(f.gn - r.gn) > FRAME_EPS ||
      Math.abs(f.omega * f.omega - r.omega * r.omega) * FRAME_REACH > FRAME_EPS || Math.abs(f.alpha - r.alpha) * FRAME_REACH > FRAME_EPS
    );
  }
  const lim = (v: number, m: number) => (Number.isFinite(v) ? (v > m ? m : v < -m ? -m : v) : 0);

  deal();
  idleSteps = 0;

  return {
    step(dt, frame) {
      fr.ax = lim(frame.ax, MAX_A);
      fr.ay = lim(frame.ay, MAX_A);
      fr.gn = Number.isFinite(frame.gn) ? lim(frame.gn, MAX_A) : G;
      fr.omega = lim(frame.omega, MAX_OMEGA);
      fr.alpha = lim(frame.alpha, MAX_ALPHA);
      if (frameChanged(fr, ref)) {
        Object.assign(ref, fr);
        refSet = true;
        wake();
      }
      if (idleSteps >= IDLE_HOLD) {
        acc = 0;
        return;
      }
      acc += Number.isFinite(dt) && dt > 0 ? Math.min(dt, SIM_MAX_DT) : 0;
      while (acc >= H - 1e-9) {
        substep();
        acc -= H;
      }
      if (acc < 0) acc = 0;
    },
    state: () => states,
    grab(id, x, y) {
      const it = byId.get(id);
      if (!it || !Number.isFinite(x + y) || held === it) return;
      if (held) {
        const was = held;
        dropJoint(was);
        tryAdmit(was);
      }
      it.held = true;
      held = it;
      setGhost(it);
      it.out.held = true;
      it.out.layer = TOP_LAYER;
      // collideConnected: the joint's ground is the wall body, and a held body must still hit the walls
      const j = new MouseJoint({ maxForce: it.body.getMass() * DRAG_ACCEL, frequencyHz: DRAG_HZ, dampingRatio: DRAG_DAMPING, collideConnected: true }, walls, it.body, new Vec2(x * S, y * S));
      it.joint = world.createJoint(j);
      it.body.setAngularDamping(HELD_ANGULAR_DAMPING);
      wake();
    },
    drag(x, y) {
      if (!held?.joint || !Number.isFinite(x + y)) return;
      held.joint.setTarget(new Vec2(Math.max(-hw, Math.min(hw, x)) * S, Math.max(-hh, Math.min(hh, y)) * S));
      wake();
    },
    release(vx = 0, vy = 0) {
      const it = held;
      if (!it) return;
      dropJoint(it);
      if (!Number.isFinite(vx + vy)) vx = vy = 0;
      capSpeed(it, vx * S, vy * S, it.body.getAngularVelocity(), vRelease);
      setVelocity(it.body, cv[0]!, cv[1]!, cv[2]!);
      it.out.held = false;
      tryAdmit(it);
      writeState(it);
      wake();
    },
    idle: () => idleSteps >= IDLE_HOLD,
    shake(strength = 1, spread = SHAKE_SPREAD) {
      const s = Number.isFinite(strength) ? Math.max(0, strength) : 1;
      const sp = Number.isFinite(spread) ? Math.max(0, Math.min(2 * Math.PI, spread)) : SHAKE_SPREAD;
      const dir = shakeRng() * Math.PI * 2;
      for (const it of items) {
        if (it.held) continue;
        const ang = dir + (shakeRng() - 0.5) * sp, mag = SHAKE_SPEED * s * (0.7 + 0.6 * shakeRng());
        const v = it.body.getLinearVelocity();
        capSpeed(it, v.x + Math.cos(ang) * mag * S, v.y + Math.sin(ang) * mag * S, it.body.getAngularVelocity() + (shakeRng() - 0.5) * 12 * s, vCap);
        setVelocity(it.body, cv[0]!, cv[1]!, cv[2]!);
        writeState(it);
      }
      wake();
    },
    resetLayout() {
      layoutCounter++;
      deal();
    },
    setLayer(id, layer) {
      const it = byId.get(id);
      if (!it || (layer !== 0 && layer !== 1 && layer !== 2)) return;
      if (it.home === layer && !it.ghost) return;
      it.home = layer;
      if (!it.held) {
        setGhost(it);
        tryAdmit(it);
        writeState(it);
      }
      wake();
    },
    push(id, vx, vy, w = 0) {
      const it = byId.get(id);
      if (!it || it.held || !Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(w)) return;
      const v = it.body.getLinearVelocity();
      capSpeed(it, v.x + vx * S, v.y + vy * S, it.body.getAngularVelocity() + w, vCap);
      setVelocity(it.body, cv[0]!, cv[1]!, cv[2]!);
      writeState(it);
      wake();
    },
    stats: () => ({ ...stats }),
    ghosts: () => items.filter((it) => it.ghost).map((it) => it.spec.id),
  };
}

/** Deterministic hash of a string to [0, 1). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100003) / 100003;
}

/** Mass of a shape at density 1 (its area in planck units). */
function unitMass(s: Shape): number {
  const md = { mass: 0, center: new Vec2(0, 0), I: 0 };
  s.computeMass(md, 1);
  return md.mass;
}
