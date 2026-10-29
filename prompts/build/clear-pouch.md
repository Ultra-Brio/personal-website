# The clear pouch · 透明拉链袋

The résumé folio's zip pouch: real things lying in it, sliding when the folder tilts, picked up and flung by hand. Use it to build one, or to work on sasshi's (`src/bag/`: `sim/`, `objects/`, `addon.ts`, `snapshot.ts`; the contract in `src/book/addon.ts`).

简历夹里的拉链袋：袋子里躺着真实的物件，文件夹一倾斜就会滑动，也能用手抓起来甩出去。可以从零做一个，也可以用来改 sasshi 的（`src/bag/`：`sim/`、`objects/`、`addon.ts`、`snapshot.ts`；接口约定在 `src/book/addon.ts`）。

## English

```text
Build a clear zip pouch fixed to the inside of a 3D folder (three.js), holding a person's things — a folded business card, a
résumé, a ticket, a polaroid, a short note — under 2D rigid-body physics in the pouch's plane.

Simulation (pure TS with planck.js, no three, no DOM, unit-tested):
- Bodies in pouch-plane metres, three collision layers so things overlap like paper does, bullet bodies (no tunnelling).
- Driven by the folder: from the pouch's world matrix history compute the apparent acceleration in its plane, the normal load
  and the angular velocity, and feed them each frame. Tilt the folder and things slide; shake it and they jump.
- Fixed 120 Hz substeps, frame time clamped. Write Coulomb friction yourself and apply it before planck integrates (planck's
  FrictionJoint creeps; friction applied after the step drifts). Idle detection, so a pouch at rest costs nothing.
- Grab: the held body becomes a ghost that only touches the walls, raised to the top layer; on release it is re-admitted to a
  free layer only where it does not overlap; the release speed is capped.
- Device motion on phones (permission on the first tap) and a Shake button for everyone else.

Objects: procedural meshes with printed canvas textures in the page's type and colours (letterpress card, A4 résumé, ticket with
a perforated stub, polaroid, a narrow 一筆箋 note), a film with a press-seal zipper and the owner's name printed on it. Paint
first in fonts already loaded and repaint once in the web fonts, before the folder opens. Make a still of any object for the
detail view from the same model.

Integration: a scene addon (anchor on the back board's inside, update(dt, t, anchorWorld) returns true while anything moves,
pointer routing, setOpen(openness), printed() resolving when the print is final, dispose). A click under 6 px and 250 ms opens
the detail; anything longer is a grab. Deliver the sim with tests, a stand-in host page, and headless checks of resting,
tilting, shaking, grabbing and flinging.
```

## 中文

```text
在一个 3D 文件夹（three.js）的内侧固定一只透明拉链袋，里面装着一个人的随身物件：对折的名片、简历、门票、拍立得、一张便笺。
它们在袋子所在的平面里受二维刚体物理驱动。

模拟（纯 TS + planck.js，不依赖 three 和 DOM，有单元测试）：
- 物体以袋面平面的米为单位，分三层碰撞，让东西能像纸一样叠在一起；用 bullet 刚体（不会穿透）。
- 由文件夹驱动：从袋子世界矩阵的历史算出它平面内的视加速度、法向载荷和角速度，每帧喂给模拟。文件夹一斜，东西就滑；一晃，
  东西就跳。
- 固定 120 Hz 子步，限制单帧时长。库仑摩擦自己写，并且在 planck 积分之前施加（planck 的 FrictionJoint 会蠕动；积分之后再
  施加摩擦会漂移）。要有静止检测，袋子静止时不花任何开销。
- 抓取：被抓住的物体变成只和袋壁碰撞的“幽灵”，提到最上层；松手时只在不重叠的地方放回一个空闲层；松手速度有上限。
- 手机上用设备运动（第一次点击时请求权限），其他设备提供一个“晃一晃”按钮。

物件：程序生成的网格，配上用页面字体和颜色印在 canvas 上的纹理（凸版印刷的名片、A4 简历、带撕口的门票、拍立得、窄长的
一筆箋便笺），外加一层带按压式拉链、印着主人名字的袋膜。先用已经加载好的字体画，网页字体到了再重画一次，并且要在文件夹
翻开之前画完。详情视图里用的静态图，从同一个模型生成。

接入：做成一个场景插件（锚在后板内侧；update(dt, t, anchorWorld) 在有东西动时返回 true；处理指针；setOpen(开合程度)；
printed() 在印刷内容定稿时 resolve；dispose）。按下不超过 6 px、250 ms 算点击，打开详情；超过就是抓取。交付带测试的模拟、
一个替身宿主页面，以及静止、倾斜、摇晃、抓取、甩出这几种情况的无头检查。
```
