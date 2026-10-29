# Morning light · 窗光与房间

The room the booklets lie in: a still page layer under the canvas, and a window's shadow cast for real in the 3D scene. Use it to build one, or to work on sasshi's (`src/app/Room.tsx`, `src/book/window-light.ts`, the light in `src/book/scene.ts`, `lightFade` in `src/app/layout.ts`).

册子所在的房间：画布下面一层静止的页面背景，以及在 3D 场景里真正投射出来的窗影。可以从零做一个，也可以用来改 sasshi 的（`src/app/Room.tsx`、`src/book/window-light.ts`、`src/book/scene.ts` 里的光照、`src/app/layout.ts` 里的 `lightFade`）。

## English

```text
Light a 3D object on a web page so it looks like it lies on a real desk by a window in the early morning. The light must be
real light in the scene, not a translucent film over the canvas.

The room (DOM, painted once, under a transparent WebGL canvas):
- The desk colour with paper fibres, the corner away from the window falling into shade, the lit patch from the window with a
  soft shade round it and a faint glow, a paper tooth. Nothing of the page lies over the canvas, nothing blends over it, nothing
  animates for ever. On first load the light rises with the load ("daybreak").

The window's shadow (three.js):
- The window bars and a twig with leaves are flat occluders hanging far above the desk on the window's side: no camera sees
  them and they write neither colour nor depth; only the sun's shadow map has them. Their shadow falls on the desk (a shadow
  catcher) and goes on over the book with parallax, and every surface shades it as its own — strong on pale paper, faint on dark
  leather, a highlight on a clear film.
- The pattern is planned in view pixels from the same art as the DOM room and laid onto the desk through the camera, so it keeps
  its place on screen while the book moves under it; re-lay it whenever the camera moves.
- Fade the light on the desk before the words column and the controls (the page passes their edges to the engine).
- The twig may sway a little, a few renders a second at most, never in a hidden tab, never while a dialog is up, never with
  reduced motion.

Deliver the room component, the occluders, the shadow settings (map size, radius, samples per class of device), and
screenshots at 1440 × 900 and 390 × 844 with the light on pale paper, leather and a clear film.
```

## 中文

```text
给网页上的一个 3D 物件打光，让它看起来就躺在清晨窗边一张真实的书桌上。光必须是场景里真实的光，而不是盖在画布上的一层半透明
薄膜。

房间（DOM，只画一次，放在透明的 WebGL 画布下面）：
- 桌面颜色加纸纤维，远离窗户的那个角落落进阴影，窗口照进来的一块光斑，周围一圈柔和的暗部和一点淡淡的光晕，再加纸面的
  颗粒。页面上没有任何东西盖在画布上，没有混合图层叠在它上面，没有永远循环的动画。首次加载时光随着加载慢慢亮起来（「破晓」）。

窗影（three.js）：
- 窗框和一根带叶子的树枝做成平面遮挡物，悬在窗户那一侧、桌面上方很高的地方：任何相机都看不到它们，它们既不写颜色也不写
  深度，只出现在太阳的阴影贴图里。它们的影子落在桌面上（阴影接收面），再带着视差延续到书上；每种表面按自己的材质来表现它：
  浅色纸上明显，深色皮面上很淡，透明膜上反而出现高光。
- 图案按视口像素规划，和 DOM 房间用同一套美术，再通过相机铺到桌面上，所以书在下面移动时，窗影在屏幕上保持不动；相机一动就
  重新铺一次。
- 光在桌面上要在文字栏和控件之前淡出（页面把它们的边界传给引擎）。
- 树枝可以轻轻摆动，最多一秒渲染几次；标签页隐藏时、有对话框打开时、开了减少动态效果时都不摆。

交付房间组件、遮挡物、阴影参数（按设备档位分别给出贴图尺寸、半径、采样数），以及 1440 × 900 和 390 × 844 下，光落在浅色纸、
皮面和透明膜上的截图。
```
