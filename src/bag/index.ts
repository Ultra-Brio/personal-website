/*
 * The pouch: a clear zip pouch of personal objects under 2D rigid-body physics.
 *   addon.ts   createPouchAddon: the pouch as a book scene addon (anchor "back-inside")
 *   motion.ts  enableMotion: DeviceMotion as the pouch's gravity (call from a tap handler)
 *   sim/       createBagSim: planck world, pure TS (no three, no DOM)
 *   objects/   buildObject / createPouch: the procedural meshes, in pouch-plane metres
 */
export { createPouchAddon, POUCH_FEEL } from "./addon";
export type { AddonContext, PouchAddon, PouchAddonOptions, SceneAddon } from "./addon";
export type { SnapshotImage, SnapshotOptions } from "./snapshot";
export { enableMotion, disableMotion, motionEnabled, motionReading, subscribeMotion } from "./motion";
export type { MotionReading, MotionStatus } from "./motion";
export { createBagSim, createFrameTracker, frameFromMatrices } from "./sim";
export type { BagSim, BagSimOptions, BodyShape, BodySpec, BodyState, Frame, FrameOptions, LayerId, Matrix4Like } from "./sim";
export { buildObject, createPouch, createStudioEnv, POUCH_BOUNDS } from "./objects";
export type { BuiltObject, FontStacks, ObjectCtx, Owner, Pouch, PouchCtx } from "./objects";
