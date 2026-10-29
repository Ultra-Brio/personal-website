import { resolveLayout, type BookLayout } from "./layout";
import { PHYSICS, type Physics } from "./physics";

/*
 * Per-book physics: a deep copy of PHYSICS (never the module-level object itself) scaled to the layout's sheet.
 * physics.ts was tuned on the card binder's page (209.8 × 192.4 mm). For a bigger page:
 *  - pvc (the mass of one sheet's two PVC layers) scales with the page area;
 *  - card is the layout's item mass;
 *  - the absolute forces that lift and carry a page — finger.torque and hand.maxF — scale with mass × length (the gravity torque of the
 *    page about its root). Measured on the postcard page (area ×1.935, mass·length ×3.09): the default finger stalls at ~10° and never
 *    lands; ×3 lands in ~1.1 s with the seam folding −24…+28° (research audit, "generalisation"). physics-profile.test.ts keeps it so.
 * The card preset gets an exact copy (every number unchanged).
 */

const CARD = resolveLayout("idCard2x3");

export function physicsFor(L: BookLayout): Physics {
  const P = structuredClone(PHYSICS) as Physics;
  if (L.hash === CARD.hash) return P;
  const area = (L.pageW * L.pageH) / (CARD.pageW * CARD.pageH);
  const length = L.pageW / CARD.pageW;
  P.pvc = PHYSICS.pvc * area;
  P.card = L.itemMass;
  const mL = area * length;
  P.finger.torque = PHYSICS.finger.torque * mL;
  P.hand.maxF = PHYSICS.hand.maxF * mL;
  return P;
}
