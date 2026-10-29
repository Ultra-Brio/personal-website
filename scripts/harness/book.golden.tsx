import { PALETTE, drawSheetNormal, drawSide, drawWindowPocket, sideCanvas, type SideCard } from "../../src/book/textures";

/*
 * Texture golden for the card binder: paints side canvases, the shared sheet normal map and the cover window with fixed inputs and
 * publishes SHA-256 hashes of their pixels (window.__golden). Run before and after a refactor of textures.ts: the card preset must
 * produce identical pixels. Driven by scripts/harness/book.golden.ts.
 */

function picture(i: number, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 202;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 320, 202);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "#ffffff");
  g.fillStyle = grad;
  g.fillRect(0, 0, 320, 202);
  g.fillStyle = "rgba(0,0,0,0.2)";
  g.beginPath();
  g.arc(60 + ((i * 47) % 200), 100, 60, 0, Math.PI * 2);
  g.fill();
  return c;
}
const COLORS = ["#e8d9c4", "#c9d6cf", "#d9c3c0", "#cbd1e3", "#e6dcb8", "#c4d9dc", "#dccbe0", "#d8d4cc", "#bfd0c0", "#e2cdb8", "#c8cbd6", "#e0c8c8"];
const card = (i: number, img: boolean): SideCard => ({ img: img ? (picture(i, COLORS[i % 12]!) as unknown as HTMLImageElement) : null, color: COLORS[i % 12]!, seed: i + 1 });

async function hash(c: HTMLCanvasElement) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const h = await crypto.subtle.digest("SHA-256", d);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24) + `@${c.width}x${c.height}`;
}

const out: Record<string, string> = {};
for (const width of [1280, 1024, 512]) {
  for (const mirrored of [false, true]) {
    for (const [name, cards] of [
      ["empty", [] as SideCard[]],
      ["flat6", [0, 1, 2, 3, 4, 5].map((i) => card(i + (mirrored ? 6 : 0), false))],
      ["img6", [0, 1, 2, 3, 4, 5].map((i) => card(i + 12, true))],
      ["part3", [card(30, true), null, card(31, false), card(32, true), null, null]],
    ] as const) {
      const c = sideCanvas(width);
      drawSide(c, cards as SideCard[], mirrored, PALETTE);
      out[`side:${width}:${mirrored ? "back" : "front"}:${name}`] = await hash(c);
    }
  }
}
out["normal:768"] = await hash(drawSheetNormal(768));
out["window:color"] = await hash(drawWindowPocket(null, "#c9d6cf", 85.6 + 7, 54 + 7));
out["window:img"] = await hash(drawWindowPocket(picture(3, "#cbd1e3") as unknown as HTMLImageElement, "#cbd1e3", 85.6 + 7, 54 + 7));
(window as unknown as { __golden: Record<string, string> }).__golden = out;
