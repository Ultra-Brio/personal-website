/*
 * PouchAddon.snapshot: one pouch object alone, rendered by the host's renderer into an offscreen target, for the lightbox.
 * The object is a copy of the very model in the pouch (BuiltObject.still: its meshes share the object's geometry, materials and
 * textures, so nothing is painted or uploaded again), lying flat at angle 0 and seen square on with an orthographic camera cropped to
 * it; `side: "back"` turns it over about its vertical axis first, to show its printed back. Light: the host scene's environment and
 * its directional and hemisphere lights (the key and the window's sun alike), copied as they are but casting nothing (the folio's back
 * board lies in the world's xy plane, so the object faces the same light it has in the pouch; the bars and leaves belong to the desk,
 * not to a thing held up to look at).
 * Three does not tone-map or encode when it renders to a target, so the object goes to a half-float linear target (4x MSAA, 2x
 * supersampled when small) and a second pass on the GPU does what the canvas would — exposure, the renderer's Neutral tone mapping,
 * sRGB — plus the still's own lift (STILL_GAIN), into an 8-bit target read back without a stall.
 * `shadow: true` bakes the page's lift shadow into the still (SHADOW): cast from the object's own alpha, with its holes (the ticket's
 * punch, perforation and tear) cut out of both shadow layers, so the desk shows through them; on a transparent margin, `pad` says how
 * wide it is, so the page can keep the object itself at the size and place it had.
 * Never a long task: shaders compile in parallel (compileAsync), the readback is asynchronous, the PNG is encoded by toBlob, and the
 * steps in between yield to the page's frames.
 */
import * as THREE from "three";
import type { BuiltObject } from "./objects";

/**
 * The still is lifted out of the pouch into the morning light (the detail view's veil is #e9eef1): a little more light on it than
 * it gets lying in the folio's shade, so the paper reads as paper, not newsprint — the ticket's #eef0ed board comes out at about
 * #eff1ed — and a soft fall-off from the window at the top right (±3 %, linear). The lift fades out in the darks, so ink stays ink.
 */
const STILL_GAIN = 1.3;
const WINDOW_FALLOFF = 0.06;
/** Supersampling on top of 4x MSAA, while the target stays under this many pixels (a big still is drawn at 2–3x the CSS size anyway). */
const SUPER_MAX_PX = 8e6;

/**
 * The baked lift shadow, in mm of the object (so every object is lifted the same height above the desk, whatever its size): the soft
 * cast (canvas shadowBlur / offsetY; about 26 / 19 px on a ticket rendered 1000 px wide, ≈ the page's 22 / 16 CSS px at the size the
 * detail view shows it) and the contact line under the edges. Ink: --sh (21 35 58).
 */
const SHADOW = { soft: { blur: 4, dy: 2.9, alpha: 0.16 }, contact: { blur: 0.3, dy: 0.3, alpha: 0.12 } } as const;

export type SnapshotOptions = { side?: "front" | "back"; shadow?: boolean };
/**
 * A still: a PNG data URL, and the transparent margin round the object on every side as a fraction of the image's width (0 without
 * `shadow`). The object itself is the image minus `pad · width` on each side (top and bottom too: the margin is the same in px).
 */
export type SnapshotImage = { url: string; pad: number };

/** The host's view of the GPU: a still taken while the context is lost would be blank. */
export type Studio = { renderer: THREE.WebGLRenderer; scene: THREE.Scene };

const yieldFrame = () => new Promise<void>((go) => setTimeout(go, 0));

/* ── the GPU finish: downsample, un-premultiply, lift, tone-map, encode; rows written top-down so the readback is the image ── */
const POST_VERT = /* glsl */ `
void main() {
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;
const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uOut;
uniform float uExposure;
uniform float uGain;
uniform float uFall;
uniform bool uTone;
// three's NeutralToneMapping (Khronos PBR Neutral), after exposure
vec3 neutral( vec3 c ) {
  const float start = 0.76;
  const float desat = 0.15;
  float x = min( c.r, min( c.g, c.b ) );
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float peak = max( c.r, max( c.g, c.b ) );
  if ( peak < start ) return c;
  float d = 1.0 - start;
  float np = 1.0 - d * d / ( peak + d - start );
  c *= np / peak;
  float g = 1.0 - 1.0 / ( desat * ( peak - np ) + 1.0 );
  return mix( c, vec3( np ), g );
}
vec3 srgb( vec3 v ) {
  return mix( 12.92 * v, 1.055 * pow( v, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), v ) );
}
void main() {
  ivec2 o = ivec2( gl_FragCoord.xy );
  int W = int( uOut.x ), H = int( uOut.y );
  // the image row from the top that this GL row holds (read back bottom-up, it comes out top-down), and its block in the source
  int row = o.y;
  int by = H - 1 - row;
  vec4 s = vec4( 0.0 );
  for ( int sy = 0; sy < SUPER; sy ++ ) {
    for ( int sx = 0; sx < SUPER; sx ++ ) {
      // the MSAA resolve left colour and alpha premultiplied by coverage (uncovered samples are the clear, 0)
      vec4 t = texelFetch( tSrc, ivec2( o.x * SUPER + sx, by * SUPER + sy ), 0 );
      s.rgb += t.rgb;
      s.a += clamp( t.a, 0.0, 1.0 );
    }
  }
  if ( s.a <= 1e-4 ) {
    gl_FragColor = vec4( 0.0 );
    return;
  }
  float cov = s.a / float( SUPER * SUPER );
  vec3 px = max( vec3( 0.0 ), s.rgb / max( 1e-6, s.a ) ) * uExposure;
  // the lift goes to the paper, not the ink: full gain from mid-grey up, none in the darks (smoothstep on luminance); the window is
  // at the top right: 0 at the bottom left … 1 at the top right
  float win = ( float( o.x ) / max( 1.0, uOut.x - 1.0 ) + 1.0 - float( row ) / max( 1.0, uOut.y - 1.0 ) ) * 0.5;
  float lum = clamp( ( dot( px, vec3( 0.2126, 0.7152, 0.0722 ) ) - 0.08 ) / 0.5, 0.0, 1.0 );
  px *= ( 1.0 + ( uGain - 1.0 ) * lum * lum * ( 3.0 - 2.0 * lum ) ) * ( 1.0 + uFall * ( win - 0.5 ) );
  vec3 c = uTone ? neutral( px ) : px;
  gl_FragColor = vec4( clamp( srgb( max( c, vec3( 0.0 ) ) ), 0.0, 1.0 ), min( 1.0, cov ) );
}`;

type Post = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; scene: THREE.Scene; camera: THREE.Camera };
const posts = new WeakMap<THREE.WebGLRenderer, Map<number, Post>>();
/** One finishing pass per renderer and supersampling factor (its program is compiled once). */
function postFor(renderer: THREE.WebGLRenderer, superS: number): Post {
  let byS = posts.get(renderer);
  if (!byS) posts.set(renderer, (byS = new Map()));
  let p = byS.get(superS);
  if (!p) {
    const mat = new THREE.ShaderMaterial({
      defines: { SUPER: superS },
      uniforms: { tSrc: { value: null }, uOut: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uGain: { value: STILL_GAIN }, uFall: { value: WINDOW_FALLOFF }, uTone: { value: true } },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    p = { mesh, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    byS.set(superS, p);
  }
  return p;
}

/** The host's light: the environment, then every directional and hemisphere light, as they are (fresh copies: no shadow maps). */
function lightLike(host: THREE.Scene, scene: THREE.Scene) {
  scene.environment = host.environment;
  scene.environmentIntensity = host.environmentIntensity;
  scene.environmentRotation.copy(host.environmentRotation);
  let lights = 0;
  host.traverse((n) => {
    const l = n as THREE.DirectionalLight | THREE.HemisphereLight;
    if ((l as THREE.DirectionalLight).isDirectionalLight) {
      const d = l as THREE.DirectionalLight;
      d.updateMatrixWorld(true);
      const dir = new THREE.Vector3().setFromMatrixPosition(d.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(d.target.matrixWorld)).normalize();
      const k = new THREE.DirectionalLight(d.color, d.intensity);
      k.position.copy(dir);
      scene.add(k);
      lights++;
    } else if ((l as THREE.HemisphereLight).isHemisphereLight) {
      const h = l as THREE.HemisphereLight;
      const k = new THREE.HemisphereLight(h.color, h.groundColor, h.intensity);
      k.position.copy(h.position);
      scene.add(k);
      lights++;
    }
  });
  if (!lights) {
    // the folio's studio: the window is top right
    const k = new THREE.DirectionalLight(0xf3f7fb, 1.35);
    k.position.set(2.9, 0.75, 4.2).normalize();
    scene.add(k, new THREE.HemisphereLight(0xeef3f8, 0xd2d9de, 0.18));
  }
}

/** A canvas as a PNG data URL, encoded off the page's frames (toBlob) instead of toDataURL's one long task. */
function pngURL(c: HTMLCanvasElement): Promise<string | null> {
  return new Promise((done) => {
    c.toBlob((b) => {
      if (!b) return done(null);
      const r = new FileReader();
      r.onload = () => done(typeof r.result === "string" ? r.result : null);
      r.onerror = () => done(null);
      r.readAsDataURL(b);
    }, "image/png");
  });
}

/**
 * The still on a transparent margin with its lift shadow under it (SHADOW, at `ppm` px per mm of the object). Each shadow is drawn
 * alone — the object itself far off the canvas, its shadow thrown back into place — then its holes are cut out of both (`holes`: the
 * object's footprint, unshifted, minus its own alpha), and the object's pixels are drawn once, on top.
 */
function withShadow(obj: HTMLCanvasElement, ppm: number, holes: HTMLCanvasElement | null): HTMLCanvasElement | null {
  const s = SHADOW.soft;
  // the soft shadow reaches about 1.5 × its blur beyond the offset silhouette (σ = blur / 2)
  const m = Math.ceil((s.dy + 1.5 * s.blur) * ppm) + 1;
  const c = document.createElement("canvas");
  c.width = obj.width + 2 * m;
  c.height = obj.height + 2 * m;
  const g = c.getContext("2d");
  if (!g) return null;
  const far = c.width + obj.width + 64;
  for (const k of [SHADOW.soft, SHADOW.contact]) {
    g.save();
    g.shadowColor = `rgba(21,35,58,${k.alpha})`;
    g.shadowBlur = k.blur * ppm;
    g.shadowOffsetX = far;
    g.shadowOffsetY = k.dy * ppm;
    g.drawImage(obj, m - far, m);
    g.restore();
  }
  if (holes) {
    g.globalCompositeOperation = "destination-out";
    g.drawImage(holes, m, m);
    g.globalCompositeOperation = "source-over";
  }
  g.drawImage(obj, m, m);
  return c;
}

/**
 * The holes through the object, in the still's pixels: its footprint (`outline`, body frame, metres → the still's box; mirrored for
 * the back) drawn filled and pulled in by `inset` px — so the anti-aliased rim of the outline itself never counts as a hole — then
 * the object's own alpha taken out of it.
 */
function holeMask(obj: HTMLCanvasElement, outline: readonly (readonly [number, number])[], box: { minX: number; maxX: number; minY: number; maxY: number }, back: boolean, inset: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = obj.width;
  c.height = obj.height;
  const g = c.getContext("2d");
  if (!g || outline.length < 3) return null;
  const sx = obj.width / (box.maxX - box.minX), sy = obj.height / (box.maxY - box.minY);
  g.beginPath();
  outline.forEach(([x, y], i) => {
    const px = ((back ? -x : x) - box.minX) * sx, py = (box.maxY - y) * sy;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  });
  g.closePath();
  g.fillStyle = "#000";
  g.fill();
  g.globalCompositeOperation = "destination-out";
  g.lineWidth = 2 * inset;
  g.lineJoin = "round";
  g.stroke();
  g.drawImage(obj, 0, 0);
  return c;
}

/** The still's targets: the object drawn linear (half float, 4x MSAA), then finished into 8 bits for the readback. */
const srcTarget = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true });
const outTarget = (w: number, h: number) =>
  new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

/**
 * compileAsync for a render into `target`: three picks a program's tone mapping and output encoding by the render target current when
 * it compiles, so programs compiled for the canvas would be compiled again, at once and blocking, in the still's first render.
 */
function compileInto(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, target: THREE.WebGLRenderTarget): Promise<unknown> {
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    return renderer.compileAsync(scene, camera);
  } finally {
    renderer.setRenderTarget(prev);
  }
}

/**
 * The stills' programs ahead of the first ask (call it in an idle moment once the objects are built): every object as a still, under the
 * stills' light, and both finishing passes, compiled in parallel. The first detail view then only renders. Resolves when they are in.
 */
export async function prewarmStills(host: Studio, objects: readonly BuiltObject[]): Promise<void> {
  const { renderer } = host;
  if (renderer.getContext().isContextLost() || !objects.length) return;
  const scene = new THREE.Scene();
  const models = objects.map((o) => o.still().model);
  for (const m of models) scene.add(m);
  lightLike(host.scene, scene);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1);
  const src = srcTarget(4, 4);
  const out = outTarget(4, 4);
  try {
    const posts = [1, 2].map((S) => postFor(renderer, S));
    await Promise.all([compileInto(renderer, scene, cam, src), ...posts.map((p) => compileInto(renderer, p.scene, p.camera, out))]);
  } catch {
    // the first still compiles them instead
  } finally {
    for (const m of models) m.removeFromParent();
    scene.clear();
    src.dispose();
    out.dispose();
  }
}

export async function renderSnapshot(host: Studio, live: BuiltObject, width: number, opts: SnapshotOptions = {}): Promise<SnapshotImage | null> {
  const { renderer } = host;
  const lost = () => renderer.getContext().isContextLost();
  const { model, flat } = live.still();
  const scene = new THREE.Scene();
  const rts: THREE.WebGLRenderTarget[] = [];
  try {
    // the picture (the polaroid's photo) is in the print before the still is taken: the detail shows what lies in the pouch
    await live.ready;
    // the back: turned over like a card in the hand (about its vertical axis), so its top stays at the top
    if (opts.side === "back") model.rotation.y = Math.PI;
    scene.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    if (box.isEmpty() || lost()) return null;
    const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y;
    const height = Math.max(1, Math.round((width * bh) / bw));
    const cam = new THREE.OrthographicCamera(box.min.x, box.max.x, box.max.y, box.min.y, 0.001, 1);
    // looking straight down -z from x = y = 0, camera space is the object's own x / y: the frustum above is its box
    cam.position.set(0, 0, box.max.z + 0.1);
    cam.lookAt(0, 0, box.max.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    lightLike(host.scene, scene);
    const S = width * height * 4 <= SUPER_MAX_PX ? 2 : 1;
    const post = postFor(renderer, S);
    const src = srcTarget(width * S, height * S);
    const out = outTarget(width, height);
    rts.push(src, out);
    // its programs for this light and the finishing pass, compiled in parallel (KHR_parallel_shader_compile), not in the first render
    await Promise.all([compileInto(renderer, scene, cam, src), compileInto(renderer, post.scene, post.camera, out)]);
    if (lost()) return null;

    const u = post.mesh.material.uniforms;
    u.tSrc!.value = src.texture;
    (u.uOut!.value as THREE.Vector2).set(width, height);
    u.uExposure!.value = renderer.toneMapping === THREE.NoToneMapping ? 1 : renderer.toneMappingExposure;
    u.uTone!.value = renderer.toneMapping === THREE.NeutralToneMapping;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    try {
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.setRenderTarget(src);
      renderer.clear(true, true, true);
      flat(() => renderer.render(scene, cam));
      renderer.setRenderTarget(out);
      renderer.render(post.scene, post.camera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = prevAuto;
      u.tSrc!.value = null;
    }
    const px = new Uint8ClampedArray(width * height * 4);
    await renderer.readRenderTargetPixelsAsync(out, 0, 0, width, height, px);
    // a context lost while the GPU worked gives zeros: no still rather than a blank one
    if (lost()) return null;
    for (const rt of rts.splice(0)) rt.dispose();
    await yieldFrame();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.putImageData(new ImageData(px, width, height), 0, 0);
    if (!opts.shadow) {
      const url = await pngURL(canvas);
      return url ? { url, pad: 0 } : null;
    }
    await yieldFrame();
    const ppm = width / (bw * 1000);
    const holes = live.holes ? holeMask(canvas, live.outline, { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y }, opts.side === "back", 1.5) : null;
    const shot = withShadow(canvas, ppm, holes);
    if (!shot) return null;
    await yieldFrame();
    const url = await pngURL(shot);
    return url ? { url, pad: (shot.width - canvas.width) / 2 / shot.width } : null;
  } catch (e) {
    console.error("[sasshi] pouch snapshot failed", e);
    return null;
  } finally {
    for (const rt of rts) rt.dispose();
    model.removeFromParent();
    scene.clear();
  }
}
