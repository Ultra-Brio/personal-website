/*
 * Image-based lighting for the pouch objects. The brass key, the USB connector, the foil on the card and the clear film all
 * need a scene.environment to read; this builds a neutral studio one (three's RoomEnvironment, prefiltered) for hosts that do not
 * have their own. Returns a texture the caller owns (dispose it with the renderer).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function createStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new RoomEnvironment();
  // RoomEnvironment has a bright panel almost straight behind a front-on camera, which a flat film mirrors as a white-out; turn the room.
  room.rotation.set(0.25, Math.PI * 0.55, 0);
  room.updateMatrixWorld(true);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(room, 0.04).texture;
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  pmrem.dispose();
  return tex;
}
