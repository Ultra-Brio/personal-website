/*
 * Pouch physics core: pure TypeScript (planck only), no three, no DOM. See world.ts for the model.
 *
 * Host loop (per rendered frame):
 *   const frame = tracker.push(pouch.matrixWorld.elements, dt);   // createFrameTracker({ unit: metresPerSceneUnit })
 *   sim.step(dt, frame);                                          // fixed 120 Hz substeps inside; returns at once while idle()
 *   for (const s of sim.state()) { ...update the meshes... }      // live array: read it, do not keep references
 * Keep calling step() while idle(): that is how the sim notices a changed frame and wakes up; it costs nothing at rest.
 * Pointer: sim.grab(id, x, y) on press (pouch-plane metres), sim.drag(x, y) on move, sim.release(vx, vy) on lift.
 *
 * planck runs at 1 unit = 0.1 m with its default tolerances: nothing else in the page may change planck's global `Settings`.
 */
export { CONTACT_MIN_SPEED, CONTACT_RISE, createBagSim } from "./world";
export type { BagSim, BagSimOptions, BodyShape, BodySpec, BodyState, LayerId, Placement, SimStats } from "./types";
export { apparentAccelInto, createFrameTracker, frameFromMatrices, pocketAccel, restFrame } from "./frame";
export type { Frame, FrameOptions, Matrix4Like, Vec3 } from "./frame";
export { coulombScale, coulombSpin, surfaceDecel } from "./friction";
