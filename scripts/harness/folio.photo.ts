/*
 * A procedural photograph for the liner's tipped-in portrait path (harness only; the site never ships a picture): dusk over a ridge
 * seen through a window — a warm sky, the sun low and soft, two ranges of hills, film grain. A picture, not a person: it only proves
 * the tip-in with its photo corners.
 */
export function photo(w = 480, h = 600): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, "#6f7f97");
  sky.addColorStop(0.55, "#d8a98a");
  sky.addColorStop(1, "#f1d2a8");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(w * 0.62, h * 0.52, 0, w * 0.62, h * 0.52, w * 0.5);
  sun.addColorStop(0, "rgba(255, 242, 214, 0.95)");
  sun.addColorStop(0.08, "rgba(255, 236, 200, 0.7)");
  sun.addColorStop(1, "rgba(255, 220, 180, 0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  const ridge = (y: number, amp: number, col: string, ph: number) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) g.lineTo(x, y + Math.sin(x / (w * 0.21) + ph) * amp + Math.sin(x / (w * 0.07) + ph * 2) * amp * 0.25);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  };
  ridge(h * 0.6, h * 0.035, "#8a6f6a", 1.3);
  ridge(h * 0.7, h * 0.03, "#4d3f3e", 0.2);
  // the window's mullion, soft and out of focus
  g.fillStyle = "rgba(32, 26, 22, 0.55)";
  g.filter = "blur(6px)";
  g.fillRect(w * 0.12, -10, w * 0.05, h + 20);
  g.filter = "none";
  // grain
  const im = g.getImageData(0, 0, w, h);
  for (let i = 0; i < im.data.length; i += 4) {
    const n = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const d = (n - Math.floor(n) - 0.5) * 14;
    for (let ch = 0; ch < 3; ch++) im.data[i + ch] = im.data[i + ch]! + d;
  }
  g.putImageData(im, 0, 0);
  return c;
}
