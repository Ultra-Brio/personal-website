/*
 * Visuals of the pouch: a clear zip pouch plus the paper things in it — business card, stapled résumé, ticket, polaroid and a
 * 一筆箋 note (three.js and 2D canvas; the only assets are the profile's own pictures).
 *
 *   buildObject(item, ctx)  -> { object, body: BodySpec, update(state, t), setDark(d), repaint(), dispose() }
 *   bodySpec(item)          -> the BodySpec buildObject will give, without building (the sim is made before the objects)
 *   createPouch(ctx)        -> { group, update(t), setDark(d), dispose(), bounds }
 *   createStudioEnv(renderer) -> a prefiltered neutral environment (the film, the gloss and the slider need scene.environment)
 *
 * Coordinates: pouch plane x right, y up, origin at the centre of the usable area, z toward the viewer, metres.
 * Films at z = 0 (back) and z = POUCH_DEPTH (front, over the usable area); every object's rear face rests at LAYERS[layer].z.
 */
import type { PocketItem } from "../../profile/schema";
import { buildCard, CARD_BODY } from "./card";
import { buildNote, NOTE_BODY } from "./note";
import { buildPolaroid, POLAROID_BODY } from "./polaroid";
import { buildResume, RESUME_BODY } from "./resume";
import { assemble, type ObjectDef } from "./rig";
import { buildTicket, TICKET_BODY } from "./ticket";
import type { BodySpec, BuiltObject, ObjectCtx } from "./types";

export type { BodySpec, BodyState, BuiltObject, FontStacks, ObjectCtx, Owner, Pouch, PouchCtx } from "./types";
export { createPouch, POUCH_BOUNDS } from "./pouch";
export { createStudioEnv } from "./env";

function define(item: PocketItem, ctx: ObjectCtx): ObjectDef {
  switch (item.kind) {
    case "card":
      return buildCard(item, ctx);
    case "resume":
      return buildResume(item, ctx);
    case "ticket":
      return buildTicket(item, ctx);
    case "polaroid":
      return buildPolaroid(item, ctx);
    case "note":
      return buildNote(item, ctx);
    default: {
      const never: never = item;
      throw new Error(`unknown pocket item kind: ${JSON.stringify(never)}`);
    }
  }
}

/** The sim's body of an item, without building it (the very spec its builder gives). */
export function bodySpec(item: PocketItem): BodySpec {
  const body = { card: CARD_BODY, resume: RESUME_BODY, ticket: TICKET_BODY, polaroid: POLAROID_BODY, note: NOTE_BODY }[item.kind];
  return { id: item.id, ...body };
}

export function buildObject(item: PocketItem, ctx: ObjectCtx): BuiltObject {
  return assemble(define(item, ctx));
}
