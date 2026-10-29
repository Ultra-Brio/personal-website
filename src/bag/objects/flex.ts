/*
 * Cheap card flex: a spring-damped scalar, fed by acceleration, bends the geometry along its long axis in the
 * vertex shader. One uniform set is shared by every material of an object, and all patched materials share one program
 * (customProgramCacheKey), so the cost is one extra vertex-shader snippet.
 */
import * as THREE from "three";
import { clamp } from "./shared";

export type FlexUniforms = {
  uFlex: { value: number };
  /** unit in-plane axis the card bends along (the long axis) */
  uFlexAxis: { value: THREE.Vector2 };
  /** half length along that axis (m) */
  uFlexHalf: { value: number };
  /** displacement (m) at the ends for uFlex = 1 */
  uFlexAmp: { value: number };
};

export function createFlexUniforms(axis: "x" | "y", half: number, amp: number): FlexUniforms {
  return {
    uFlex: { value: 0 },
    uFlexAxis: { value: axis === "x" ? new THREE.Vector2(1, 0) : new THREE.Vector2(0, 1) },
    uFlexHalf: { value: half },
    uFlexAmp: { value: amp },
  };
}

/** Patch a MeshPhysicalMaterial (or any Mesh*Material built on the common chunks) to bend with the shared uniforms. */
export function patchFlex(mat: THREE.Material, u: FlexUniforms) {
  if (mat.userData.bfFlex) return; // a material shared by several slabs is patched once
  mat.userData.bfFlex = true;
  const prev = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uFlex = u.uFlex;
    shader.uniforms.uFlexAxis = u.uFlexAxis;
    shader.uniforms.uFlexHalf = u.uFlexHalf;
    shader.uniforms.uFlexAmp = u.uFlexAmp;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uFlex;
uniform vec2 uFlexAxis;
uniform float uFlexHalf;
uniform float uFlexAmp;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
{
  float fxN = dot( position.xy, uFlexAxis ) / uFlexHalf;
  float slope = uFlexAmp * uFlex * 2.0 * fxN / uFlexHalf;
  objectNormal.xy -= uFlexAxis * slope * objectNormal.z;
  objectNormal = normalize( objectNormal );
}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  float fxP = dot( position.xy, uFlexAxis ) / uFlexHalf;
  transformed.z += uFlexAmp * uFlex * ( fxP * fxP - 0.3333 );
}`,
      );
  };
  mat.customProgramCacheKey = () => "bf-flex";
}

/**
 * Spring-damped driver. `drive` is the target bend (about -1..1); k = 120, c = 13 as in the reference.
 * Integrated with fixed substeps so a slow frame cannot blow it up.
 */
export class FlexSpring {
  value = 0;
  private vel = 0;
  k = 120;
  c = 13;

  step(dt: number, drive: number) {
    if (dt <= 0) return;
    const sub = Math.min(12, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.vel += (this.k * (drive - this.value) - this.c * this.vel) * h;
      this.value += this.vel * h;
    }
    this.value = clamp(this.value, -1.4, 1.4);
  }

  reset() {
    this.value = 0;
    this.vel = 0;
  }
}
