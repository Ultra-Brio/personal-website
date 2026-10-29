import { describe, expect, test } from "bun:test";
import { LAYERS } from "../constants";
import { FlexSpring } from "./flex";
import { layerZ } from "./rig";
import { hashStr, rng, valueNoise } from "./shared";
import { buildSlab, densify, roundedRectOutline } from "./slab";

function area(p: readonly (readonly [number, number])[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

describe("determinism", () => {
  test("hashStr and rng repeat exactly", () => {
    expect(hashStr("ticket")).toBe(hashStr("ticket"));
    expect(hashStr("ticket")).not.toBe(hashStr("card"));
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});

describe("value noise", () => {
  /** The noise as it was computed whole before the paper stocks were made in steps: the stepped rows must give the same values. */
  function reference(w: number, h: number, cellsX: number, cellsY: number, rand: () => number): Float32Array {
    const lat = new Float32Array(cellsX * cellsY);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cellsY;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cellsX;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const at = (cx: number, cy: number) => lat[(cy % cellsY) * cellsX + (cx % cellsX)]!;
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * w + x] = top + (bot - top) * sy;
      }
    }
    return out;
  }
  test("is the same field, value for value, and draws the same random numbers", () => {
    for (const [w, h, cx, cy] of [
      [173, 91, 4, 4],
      [256, 362, 12, 17],
      [97, 240, 32, 80],
    ] as const) {
      const a = rng(w * 31 + cy);
      const b = rng(w * 31 + cy);
      expect(Array.from(valueNoise(w, h, cx, cy, a))).toEqual(Array.from(reference(w, h, cx, cy, b)));
      expect(a()).toBe(b());
    }
  });
});

describe("layerZ", () => {
  test("hits the layer heights and is monotonic in between and clamped outside", () => {
    expect(layerZ(0)).toBe(LAYERS[0].z);
    expect(layerZ(1)).toBe(LAYERS[1].z);
    expect(layerZ(2)).toBe(LAYERS[2].z);
    expect(layerZ(-3)).toBe(LAYERS[0].z);
    expect(layerZ(9)).toBe(LAYERS[2].z);
    let prev = layerZ(0);
    for (let l = 0.1; l <= 2; l += 0.1) {
      const z = layerZ(l);
      expect(z).toBeGreaterThanOrEqual(prev);
      prev = z;
    }
  });
});

describe("outlines and slabs", () => {
  test("rounded rectangle is CCW with the expected area", () => {
    const w = 0.09;
    const h = 0.054;
    const r = 0.0016;
    const o = roundedRectOutline(w, h, r, 8);
    expect(area(o)).toBeGreaterThan(0);
    expect(area(o)).toBeCloseTo(w * h - (4 - Math.PI) * r * r, 5);
  });

  test("densify keeps every segment under the limit", () => {
    const d = densify(roundedRectOutline(0.09, 0.054, 0.0016, 4), 0.0035);
    for (let i = 0; i < d.length; i++) {
      const a = d[i]!;
      const b = d[(i + 1) % d.length]!;
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(0.0035 + 1e-9);
    }
  });

  test("slab groups tile the index buffer, normals are unit, z stays within [0, thickness]", () => {
    const t = 0.0011;
    const { geometry } = buildSlab({ outline: roundedRectOutline(0.09, 0.054, 0.0016, 4), w: 0.09, h: 0.054, thickness: t, nx: 6, ny: 3 });
    const index = geometry.index!;
    let covered = 0;
    for (const g of geometry.groups) {
      expect(g.start).toBe(covered);
      covered += g.count;
    }
    expect(covered).toBe(index.count);
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2]);
    const pos = geometry.attributes.position!;
    const nor = geometry.attributes.normal!;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(-1e-12);
      expect(pos.getZ(i)).toBeLessThanOrEqual(t + 1e-12);
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5);
    }
    // front cap faces the viewer
    expect(nor.getZ(0)).toBe(1);
  });
});

describe("flex spring", () => {
  test("settles on its target and survives a 100 ms frame", () => {
    const s = new FlexSpring();
    for (let i = 0; i < 90; i++) s.step(1 / 60, 0.8);
    expect(s.value).toBeCloseTo(0.8, 1);
    const wild = new FlexSpring();
    wild.step(0.1, 2.5);
    expect(Number.isFinite(wild.value)).toBe(true);
    expect(Math.abs(wild.value)).toBeLessThanOrEqual(1.4);
  });
});

describe("receiveSun", () => {
  test("every mesh receives the window's sun, casts nothing and writes nothing into a shadow map; the contact shadow is left alone", async () => {
    const THREE = await import("three");
    const { receiveSun } = await import("./shared");
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    contact.name = "contact-shadow";
    b.add(contact);
    g.add(a, b);
    a.castShadow = true;
    receiveSun(g);
    for (const m of [a, b]) {
      expect(m.receiveShadow).toBe(true);
      expect(m.castShadow).toBe(false);
      const d = m.customDepthMaterial!;
      expect(d).toBe(a.customDepthMaterial!);
      expect(d.colorWrite).toBe(false);
      expect(d.depthWrite).toBe(false);
    }
    expect(contact.receiveShadow).toBe(false);
    expect(contact.customDepthMaterial).toBeUndefined();
  });
  test("three's per-draw writes of alphaTest / map do not change the depth material (no program switch per draw)", async () => {
    const THREE = await import("three");
    const { receiveSun } = await import("./shared");
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
    receiveSun(m);
    const d = m.customDepthMaterial as InstanceType<typeof THREE.MeshDepthMaterial>;
    const v = d.version;
    // what WebGLShadowMap.getDepthMaterial does before each draw, alternating an alpha-tested face and a plain edge
    for (const t of [0.5, 0, 0.5, 0]) {
      d.alphaTest = t;
      d.map = new THREE.Texture();
    }
    expect(d.version).toBe(v);
    expect(d.alphaTest).toBe(0);
    expect(d.map).toBeNull();
  });
});
