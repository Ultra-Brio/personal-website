# Foley and the room's sound · 音效与环境声

How the page sounds: generated foley for every gesture and a quiet morning ambience, picked by ear and levelled by measurement. Use it to make your own, or to work on sasshi's (`scripts/sounds/`, `src/sound/`, `public/sounds/`).

页面的声音：每个动作都有生成出来的拟音，再加一层安静的清晨环境声；靠耳朵挑选，靠测量定音量。可以用来做你自己的，也可以用来改 sasshi 的（`scripts/sounds/`、`src/sound/`、`public/sounds/`）。

## English

```text
Make the sounds of a web page whose objects are paper, PVC sleeves, a hardcover case and a plastic zip pouch, with the
ElevenLabs Sound Effects API (eleven_text_to_sound_v2). The key is read from the environment or a dotenv file and never printed
or written anywhere.

Prompts:
- Lead every prompt with the recording situation (dry, close-miked, a quiet room, a wooden desk), then the object, then the
  gesture: "Turning one page of a clear plastic sleeve in a ring binder: the soft PVC sheet flexes with a gentle crinkle …".
- Short events (ticks, taps, drops, page lands): ask for "four separate …, silence between" in one 2–3 s clip and cut them
  apart, so one request gives several natural variants. Continuous gestures: one clip per request.
- A script that skips existing files, logs every request, stops at the first failure and refuses to pass a request cap.

Picking and levels:
- Pick takes by ear and on a spectrogram (no hum, no whine, no clicks); trim, fade, normalise to a target loudness per slot;
  write a manifest with each file's trim in dB.
- Ambience: a looped bed (a breeze in leaves, cut before any gust at its end) and sparse bird phrases dropped in at random
  every 10–24 s, their loudest moments about 9 dB over the bed's median. Quiet: the bed's median around −29 LUFS.
- Verify by recording what the page really plays (tap the audio graph into a MediaRecorder, then ebur128), never by reading
  the schedule.

In the page: Web Audio, unlocked on the first gesture, a sound switch, nothing before the visitor touches the page, gains
following the gesture's speed, slight random pitch and pan. Deliver the scripts, the files (AAC, small), the manifest and an
audition page.
```

## 中文

```text
用 ElevenLabs 音效 API（eleven_text_to_sound_v2）给一个网页做声音，页面里的东西是纸、PVC 内页、硬壳封面和一只塑料拉链袋。
密钥从环境变量或 dotenv 文件读取，绝不打印，也不写进任何文件。

提示词：
- 每段提示词先写录音条件（干声、近距离收音、安静的房间、木桌），再写物件，最后写动作：「在活页夹里翻过一张透明塑料内页：
  柔软的 PVC 弯折时发出轻微的窸窣……」。
- 短促的声音（轻点、轻敲、掉落、落页）：在一段 2–3 秒的音频里要「四次分开的……，中间留静音」，再切开，一次请求就能得到几个
  自然的变体。持续的动作：一次请求一段。
- 生成脚本要能跳过已经存在的文件，记录每次请求，遇到第一个失败就停，并且不超过请求次数上限。

挑选与音量：
- 靠耳朵和频谱图挑（不要嗡声、啸叫、爆音）；裁剪、淡入淡出，按每个用途的目标响度归一化；写一份清单，记下每个文件的增益（dB）。
- 环境声：一段循环的底噪（树叶间的微风，在结尾的阵风之前截断），加上稀疏的鸟鸣片段，每隔 10–24 秒随机出现一次，最响处比底噪的中位响度
  高约 9 dB。要安静：底噪的中位响度约 −29 LUFS。
- 验证时录下页面实际播出来的声音（把音频图接到 MediaRecorder，再用 ebur128 测量），不要只看排程。

在页面里：用 Web Audio，在第一次交互时解锁，提供声音开关；访客碰页面之前不发出任何声音；音量跟着动作的速度走，音高和声像
带一点随机。交付生成和处理脚本、音频文件（AAC，体积小）、清单，以及一个试听页面。
```
