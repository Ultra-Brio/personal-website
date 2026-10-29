import type { Profile } from "../src/profile/schema";
import { profile } from "./en";
import { seal } from "./seal";

/*
 * The same demo persona as en.ts, written in Simplified Chinese (`?sample=zh`): the page chrome turns Chinese and every
 * Han character is set in the SC faces. Fictional person, fictional companies; every message, anecdote and number is sample copy.
 * The photos are the same files. The colour cards keep their Japanese names (romaji and 和色 kanji); only the notes are Chinese.
 */

/** The thirty-two 和色 of the card album, with Chinese notes (same order and colours as the English sample). */
const colourNotes = [
  "月亮升起之前，天空那一层极淡的蓝。",
  "蓝染缸里最浅的一染：浸一次就拿出来。",
  "「往缸里瞧一眼」：布只浸了一下，刚刚有点蓝。",
  "兑了水的浅葱色，像浅溪里的石头。",
  "青瓷的釉色：偏冷的绿，里面带一点灰。",
  "安静下来的青瓷，像是经过了风雨。",
  "发白的灰，银粉的颜色。",
  "银灰，江户「四十八茶百鼠」里的一种。",
  "底下透着蓝的灰。",
  "藏青色的灰，傍晚过后街道的颜色。",
  "暗沉的蓝灰，从前宫中服丧时穿的颜色。",
  "白色里带着一丝蓝染的气息。",
  "淡到几乎发白的缥色。",
  "薄云的灰，白里带一点绿。",
  "灰多于青，像远远望见的冬天的海。",
  "带灰的千草绿，像落了霜的草。",
  "从前只为皇帝烧制的青瓷「秘色」：淡淡的、带雾的蓝。",
  "锡的颜色：比银更暗、更哑的灰。",
  "港口的灰，阴天里码头边的水。",
  "安静下来的浅葱色，发灰的蓝绿。",
  "掺了灰、变柔和的缥色。",
  "御纳户色（储物间的蓝），像生了锈一样暗哑。",
  "加了铁色、暗下来的御纳户色，近乎石板。",
  "安静的灰，底下透着一点蓝绿，像淋湿的屋瓦。",
  "孔雀石研得极细，几乎成了白色：掺了乳白的绿。",
  "研得又细又淡的石青，旧寺壁画上的那种蓝绿。",
  "浅浅的缥色，像棉布在蓝染缸里只浸过几次。",
  "以江户水乡深川命名的灰绿。",
  "带着绿意的灰，借了茶人千利休的名字。",
  "淡淡的缥色，掺了一点灰，像下雨前的天。",
  "深沉的青绿，名字来自将军爱穿的御召绉绸。",
  "蓝染本身的颜色，也是这本作品集除了黑色之外唯一的印色。",
];

/** The twelve postcards, in the English sample's order; place names and messages in Chinese, the Japanese captions as they are. */
const postcardText = [
  { label: "龙安寺", place: "京都，龙安寺", message: "十五块石头，坐在哪儿都只能看见十四块。每一块上都落着雪。" },
  { label: "美瑛", place: "北海道，美瑛", message: "一棵树，一片雪原，方圆一公里没有别人。我在那儿站了二十分钟。" },
  { label: "芦之湖", place: "箱根，芦之湖", message: "雾一直没散。船还是在 9:40 开了。" },
  { label: "直岛", place: "香川，直岛", message: "海滩上一座石鸟居，潮水正从它下面涨上来。" },
  { label: "尾道", place: "广岛，尾道", message: "渡船过一次水道要四分钟。我来回坐了六趟。" },
  { label: "稻村崎", place: "镰仓，稻村崎", message: "这里的蓝调时刻大约只有二十分钟。那天的光一直是红的。" },
  { label: "白川乡", place: "岐阜，白川乡", message: "雪埋到屋檐，每个屋顶都在太阳下微微冒着热气。" },
  { label: "宫岛", place: "广岛，宫岛", message: "退潮的时候能一直走到鸟居下面。我还是留在岸上，等潮水回来。" },
  { label: "河口湖", place: "山梨，河口湖", message: "一座十步就能走完的小岛，一只鸭子绕着它游。我数到第十二圈就不数了。" },
  { label: "岚山", place: "京都，岚山", message: "渡月桥长 155 米。我在雪里慢慢走了两个来回。" },
  { label: "富士山", place: "富士山", message: "一个人坐在小船上钓鱼，富士山就在他身后。一个小时里，他一次也没回过头。" },
  { label: "新宿", place: "东京，新宿", message: "从三十楼往外看，6:40 整座城市变成蓝色，然后灯一盏盏亮了。" },
];

export const profileZh: Profile = {
  lang: "zh-CN",
  name: "向博",
  handle: "@Ultra-Brio",
  role: "经济管理试验班 · 上海交通大学",
  location: "上海",
  timezone: "Asia/Shanghai",
  bio: "我来自四川宜宾——长江第一城。2025 年进交大学临床医学，2026 年转入安泰读经济与管理；写作、公益和金融市场是我生活的三条线索。这个网站是我为自己搭的一个角落：放经历，放照片，也放一些认真的想法。",
  coverTitle: "向博 · 个人主页",
  seal: null,
  source: "https://github.com/Ultra-Brio/personal-website",
  links: [
    { label: "邮箱", href: "mailto:xangbo@163.com" },
    { label: "GitHub", href: "https://github.com/Ultra-Brio" },
  ],
  items: [
    {
      kind: "card",
      id: "card",
      label: "名片",
      href: "/about.html",
      links: [{ label: "打开「关于」页", href: "/about.html" }],
      anecdote: "一张还没拿去印的名片，先把内容放在这里。",
      story: "从临床医学起步，现在在安泰读经管；从长江边的小城出发，往更大的世界去。这一页，是我给自己写的一个介绍。",
      specs: [
        { k: "专业", v: "经济管理试验班" },
        { k: "年级", v: "2025 级" },
        { k: "坐标", v: "上海 · 四川宜宾人" },
      ],
      front: { name: "向博", role: "安泰经济与管理学院", tagline: "生于此，归于斯" },
      inside: [
        { k: "邮箱", v: "xangbo@163.com" },
        { k: "GitHub", v: "github.com/Ultra-Brio" },
        { k: "所在", v: "上海 · UTC+8" },
      ],
      insideNote: "写作、公益和金融市场，是我生活的三条线索。",
    },
    {
      kind: "resume",
      id: "resume",
      label: "简历",
      href: "/journey.html",
      links: [{ label: "打开「足迹」页", href: "/journey.html" }],
      anecdote: "两段投研实习，一次转型，还在继续写。",
      story: "从交大医学院起步，转入安泰读经管；在兴业证券看 AI 与算力，在金鼎资本做 CVC 投资，在华夏基金的训练营里拿了一次优秀营员。每一行都得站得住脚。",
      specs: [
        { k: "更新", v: "2026" },
        { k: "语言", v: "中文 · 英文" },
      ],
      summary: "安泰经济与管理学院在读，带着医学的底子做行业研究与投资。",
      experience: [
        {
          org: "金鼎资本",
          role: "CVC 基金投资实习生",
          from: "2026.06",
          to: "2026.08",
          bullets: ["研究上游 AI 算力产业，拆解 3D AI 推理芯片与存算一体公司的技术路线与竞争格局。", "参与两家公司的立项与投决材料撰写。"],
        },
        {
          org: "兴业证券经济与金融研究院",
          role: "行业研究实习生",
          from: "2026.02",
          to: "2026.06",
          bullets: ["跟踪 AI 大模型、算力基础设施及行业应用动态。", "搭建基金知识库与投研专用 AI Skills，参与周报、点评与路演材料撰写。"],
        },
        {
          org: "上海交通大学医学院团委",
          role: "组织部与人事管理中心 部长",
          from: "2025.09",
          to: "至今",
          bullets: ["策划并主持「青马工程」活动，覆盖学院 100+ 人，获评校优秀案例。", "「耳机病」科普推文获医学院科普大赛一等奖。"],
        },
      ],
      education: [{ school: "上海交通大学 安泰经济与管理学院", degree: "经济管理试验班（GPA 4.0/4.3，专业排名 1/39）", from: "2026", to: "2030" }],
      skills: ["行业研究", "公司分析", "投资材料撰写", "Python（NumPy、Pandas）", "公众号运营", "科普写作"],
      languages: ["中文", "英语（CET-6 609）"],
    },
    {
      kind: "ticket",
      id: "ticket",
      label: "返校宣讲门票",
      href: "/journey.html",
      links: [{ label: "打开「足迹」页", href: "/journey.html" }],
      anecdote: "作为队长回了 5 次母校宣讲，8 个班，400 多个学弟学妹进了社群。",
      story: "高中母校的讲台，我前后站过五次。讲交大、讲医学、讲转专业的选择，也讲怎么把一件事从想法做成一支队伍。",
      event: "优秀学子返校宣讲",
      date: "2026-01-16",
      time: "14:00",
      venue: "母校报告厅",
      city: "宜宾",
      seat: "队长 / 讲者",
      serial: "No. 0526",
    },
    {
      kind: "polaroid",
      id: "polaroid",
      label: "拍立得",
      href: "/gallery.html",
      links: [{ label: "打开「相册」", href: "/gallery.html" }],
      anecdote: "主页背景就是这张照片：一架飞机正好落在霓虹招牌上面。",
      story: "我想要的主页气氛全在这张图里——天色将暗未暗，城市的灯刚亮起来。把这张照片放在门口，其余的照片都在相册里。",
      caption: "洛杉矶 · 暮色",
      image: "photos/polaroid-dusk.jpg",
      tint: "#c9d3da",
      place: "洛杉矶",
      date: "2026-10-29",
      back: "相册里放的都是这样的瞬间。",
    },
    {
      kind: "note",
      id: "note",
      label: "便笺",
      href: "/essays.html",
      links: [{ label: "打开「随笔」", href: "/essays.html" }],
      anecdote: "一筆箋只写几行：比一封信短，比一条消息多一点心意。",
      text: "慢慢写，慢慢放。第一篇已经放进去了，讲的是我为什么想要一个自己的角落。",
      from: "向博",
      date: "2026-10-29",
    },
  ],
  albums: {
    cards: profile.albums.cards.map((c, i) => ({ ...c, note: colourNotes[i] ?? c.note })),
    postcards: profile.albums.postcards.map((p, i) => {
      const t = postcardText[i];
      return t ? { ...p, label: t.label, place: t.place, message: t.message, from: "向博", ...(p.credit && { credit: p.credit.replace(/^Photo: /, "摄影：") }) } : p;
    }),
  },
};
