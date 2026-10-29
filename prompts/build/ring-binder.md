# The 3D album · 3D 活页册

The engine behind the card album and the postcard album: a ring binder whose clear sleeves turn under real physics. Use it to build one from scratch, or to work on sasshi's (`src/book/`: `physics.ts`, `sheet.ts`, `binder.ts`, `frost.ts`, `scene.ts`, `layout.ts`, `content/`).

卡册和明信片册背后的引擎：一本活页夹，透明内页在真实的物理下翻动。可以从零做一个，也可以用来改 sasshi 的引擎（`src/book/`：`physics.ts`、`sheet.ts`、`binder.ts`、`frost.ts`、`scene.ts`、`layout.ts`、`content/`）。

## English

```text
Build a 3D ring binder for the web with three.js, TypeScript and no physics library: clear PVC sleeve pages holding cards (or
A6 postcards) that turn under real physics, in a hardcover case that opens and shuts. It must feel like the object, run at 60 fps
on a mid-range phone, and render only while something moves.

Physics (pure TS, unit-tested, no three):
- A sheet is a chain of rigid bodies in its plane of rotation: punched strip → inner pocket column → heat-sealed seam → outer
  pocket column. A column holding cards is one stiff board; an empty column bends (EI of two thin PVC layers).
- The seam is a soft hinge, torque = k·β·(1 + (β/β0)²), damping following its tangent stiffness, so a lifted outer column trails
  about 30° and does not spring back all at once.
- The hole hangs on the ring and slides round it with friction (a first-order lag), so a quick turn bends the strip.
- Forces: weight, air drag on the normal velocity, an air cushion just above the stack, joint springs. Integrate at 480 Hz with
  substeps; clamp the frame time.
- Input: a drag pulls the grabbed point towards the pointer's direction and carries the sheet's weight; a release past the turn
  threshold keeps carrying the same point over the top at its release speed; a click or key lifts the sheet with a capped torque.

Rendering:
- One draw call per sheet: the shape varies only across the page, so the mesh is two rows, deformed in the vertex shader as a
  chain of circular arcs, with analytic normals; the depth material runs the same deformation so shadows bend.
- Two PVC layers with a clearcoat; roughness rises with angular speed as motion blur of the highlight; the rim exactly one pitch
  thick so a stack never aliases into a dashed line.
- The case: three rigid boards, two creases bent live by angle. Cloth or leather as one wrapped sheet; frosted polypropylene as a
  screen-space frost (blur levels chosen by the analytic distance to what is behind, no refraction, no jitter, so nothing
  flickers as it moves).
- Pages are painted to canvases from a content source (a pocket grid: any layout of slots; postcards double-sided — picture
  through the front film, message through the back).
- On-demand rendering, a pixel budget for the canvas (about 8 Mpx), one WebGL context, textures uploaded in small slices.

Deliver: the physics module with tests, the sheet shader, the case, a harness page, headless screenshots at 1440 × 900 and
390 × 844, and a sound hook for page turn, page land, cover open and close.
```

## 中文

```text
用 three.js 和 TypeScript 做一本网页上的 3D 活页夹，不用物理库：透明 PVC 内页装着卡片（或 A6 明信片），在真实的物理下翻动；
外面是一个能开合的硬壳封面。要像真的东西，在中端手机上跑满 60 fps，只在有东西动的时候才渲染。

物理（纯 TS，有单元测试，不依赖 three）：
- 一张内页是它旋转平面里的一串刚体：打孔条 → 内侧卡袋 → 热封缝 → 外侧卡袋。装了卡的那一栏是一块硬板；空着的那一栏会弯
  （刚度取两层薄 PVC 的 EI）。
- 热封缝是一个软铰链，扭矩 = k·β·(1 + (β/β0)²)，阻尼跟着当前的切线刚度走，所以提起来时外侧那栏会拖后约 30°，弯曲存下的
  能量也不会一下子弹回来。
- 孔挂在环上，带着摩擦绕环滑动（一阶滞后），翻得快时打孔条会被拉弯。
- 受力：重力，沿法向速度的空气阻力，落到页堆上方最后一段的气垫，关节弹簧。以 480 Hz 子步积分，限制单帧时长。
- 输入：拖动时，被抓住的点朝指针方向拉，并承担整页的重量；松手时超过翻页阈值，就以松手时的速度继续带着同一个点翻过顶点；
  点击或按键时，用有上限的扭矩把页面托起来。

渲染：
- 每张内页一次绘制：形状只沿页面宽度方向变化，所以网格只要两行，在顶点着色器里按一串圆弧变形，法线用解析式求；深度材质做
  同样的变形，阴影跟着弯。
- 两层 PVC 加清漆层；角速度越大粗糙度越高，相当于高光的运动模糊；页边正好一个层距厚，叠起来时不会锯齿成虚线。
- 封面：三块刚性板，两条按角度实时弯折的折痕。布面或皮面是一整张包裹的面料；磨砂 PP 用屏幕空间磨砂（按到后方物体的解析距离
  选模糊层级，不折射，不抖动，所以开合时不闪烁）。
- 内页由内容源画到 canvas 上（卡袋网格：任意布局的卡位；明信片是双面的，前膜看图，后膜看字）。
- 按需渲染，画布有像素预算（约 800 万像素），只用一个 WebGL 上下文，纹理分小块上传。

交付：带测试的物理模块、内页着色器、封面、一个调试页面、1440 × 900 和 390 × 844 的无头截图，以及翻页、落页、开封面、合封面
的音效钩子。
```
