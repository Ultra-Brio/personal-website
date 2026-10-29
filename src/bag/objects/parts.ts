/*
 * Small builders shared by the flat paper-like objects (card, résumé, ticket, polaroid).
 */
import * as THREE from "three";
import { patchFlex, type FlexUniforms } from "./flex";
import { buildSlab, maskCanvas, type SlabOpts } from "./slab";
import { colorTexture, dataTexture, makeCanvas, type Tracker, type V2 } from "./shared";
import type { ObjectCtx } from "./types";

export type SlabMeshOpts = SlabOpts & {
  front: THREE.Material;
  back: THREE.Material;
  edge: THREE.Material;
  flex?: FlexUniforms;
  name?: string;
};

/** One mesh, three materials (front cap / back cap / rolled edge), optional shared flex uniforms. */
export function slabMesh(T: Tracker, o: SlabMeshOpts): { mesh: THREE.Mesh; outline: V2[] } {
  const { geometry, outline } = buildSlab(o);
  T.add(geometry);
  if (o.flex) for (const m of [o.front, o.back, o.edge]) patchFlex(m, o.flex);
  const mesh = new THREE.Mesh(geometry, [o.front, o.back, o.edge]);
  mesh.frustumCulled = false;
  if (o.name) mesh.name = o.name;
  return { mesh, outline };
}

/** Coverage mask texture (alphaMap) for a footprint, with optional extra cut-outs. */
export function maskTexture(
  T: Tracker,
  ctx: Pick<ObjectCtx, "anisotropy">,
  outline: readonly V2[],
  w: number,
  h: number,
  pxPerM: number,
  cut?: Parameters<typeof maskCanvas>[4],
): THREE.CanvasTexture {
  const t = dataTexture(maskCanvas(outline, w, h, pxPerM, cut), { anisotropy: Math.min(4, ctx.anisotropy) });
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return T.add(t);
}

/** A 1 x n gradient strip used as the colour of an edge wall (v runs across the thickness, rear to front). */
export function edgeStrip(T: Tracker, ctx: Pick<ObjectCtx, "anisotropy">, stops: [number, string][]): THREE.CanvasTexture {
  const { c, g } = makeCanvas(4, 32);
  const grad = g.createLinearGradient(0, 32, 0, 0);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 32);
  const t = colorTexture(c, ctx);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  return T.add(t);
}

/** Planar decal (alpha-blended, sits a hair above a surface). */
export function decal(T: Tracker, tex: THREE.Texture, w: number, h: number, z: number, mat?: Partial<THREE.MeshStandardMaterialParameters>): THREE.Mesh {
  const m = T.add(
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.6,
      metalness: 0,
      ...mat,
    }),
  );
  const g = T.add(new THREE.PlaneGeometry(w, h));
  const mesh = new THREE.Mesh(g, m);
  mesh.position.z = z;
  mesh.renderOrder = 3;
  return mesh;
}
