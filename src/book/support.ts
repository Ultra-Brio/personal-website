// probed once per page: a browser can only hold so many contexts at once (Safari keeps counting released ones until it collects
// them), so going back and forth cannot open a new one every time
let capable: boolean | null = null;
/**
 * Whether this device is worth loading the 3D for (about 1 MB, and initialising it holds the main thread for a few hundred ms): it
 * needs WebGL2 with hardware rendering; Data Saver mode, devices with ≤ 2 GB of memory, and software rendering (SwiftShader,
 * llvmpipe, Microsoft Basic Display Driver: a few hundred ms a frame) all get the fallback only
 * (Copied from CardArt's can3d(); the result is cached for the page's lifetime.)
 */
export function canRender3d() {
  if (capable !== null) return capable;
  capable = false;
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    if (nav.connection?.saveData || (nav.deviceMemory ?? 8) <= 2) return capable;
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return capable;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    capable = !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    // a failed probe counts as unsupported
  }
  return capable;
}
