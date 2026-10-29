/*
 * The book engine's studio environment, verbatim (src/book/scene.ts studioScene), shared by the pouch harnesses so the pouch and
 * its objects are judged under the light they get in the folio; STUDIO is the engine's light-only studio colours (spec §2.2).
 */
import * as THREE from "three";

export const STUDIO = { key: 0xfaf9f6, sky: 0xeef3f8, ground: 0xd2dbe3, shadow: 0x15233a } as const;

export function studioScene() {
  const env = new THREE.Scene();
  const dome = new THREE.SphereGeometry(10, 48, 24);
  const pos = dome.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / 10;
    const v = z > 0 ? 0.16 + 0.1 * z : 0.16 * (1 + z) + 0.03;
    col[i * 3] = v;
    col[i * 3 + 1] = v * 1.01;
    col[i * 3 + 2] = v * 1.04;
  }
  dome.setAttribute("color", new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w: number, h: number, dir: [number, number, number], power: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power * 0.98), side: THREE.DoubleSide }));
    m.position.set(...dir).normalize().multiplyScalar(8);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(5.2, 3.6, [-0.5, 0.45, 0.74], 7);
  panel(1.2, 6, [0.85, -0.15, 0.5], 2.2);
  panel(7, 1.2, [0.1, -0.9, 0.42], 0.9);
  return env;
}
