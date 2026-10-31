import type { Profile } from "../src/profile/schema";

/*
 * 向博（这是 primary 语言；英文版在 en.ts，访客点「English」时才加载）。所有事实都来自他自己的页面
 * （关于 / 足迹 / 随笔 / 相册 / 联络），没有一处是编的。袋里的五件东西各带一个 `href`：点一件，就到它对应的那一页——
 * 五件东西对五个模块，一一对应：
 *   名片 → 联络 · 简历 → 关于 · 门票 → 足迹 · 拍立得 → 相册 · 便笺 → 随笔
 * 图片路径相对页面（"photos/…"，开头不加斜杠），域名根目录和子路径（GitHub Pages 的 /<repo>/）都能用。
 * 两本册子暂时空着：选好真实的照片之前，桌上只摆简历夹。
 */

export const profileZh: Profile = {
  lang: "zh-CN",
  name: "Xiang Bo",
  nameLocal: "向博",
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
      href: "contact.html",
      links: [{ label: "打开「联络」页", href: "contact.html" }],
      anecdote: "一张还没拿去印的名片：上面的每一行，都是找到我的方式。",
      story: "无论是交流投研、医学、公益，还是单纯想聊聊——欢迎写信给我。每一封我都回。",
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
      href: "about.html",
      links: [{ label: "打开「关于」页", href: "about.html" }],
      anecdote: "简历只有一页；装不下的，都在「关于」里。",
      story: "从交大医学院起步，转入安泰读经管；宜宾的山路与江河，塑造了我看待世界的方式。我是谁、我关心什么，都在「关于」那一页。",
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
          from: "2026.09",
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
      href: "journey.html",
      links: [{ label: "打开「足迹」页", href: "journey.html" }],
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
      href: "gallery.html",
      links: [{ label: "打开「相册」", href: "gallery.html" }],
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
      href: "essays.html",
      links: [{ label: "打开「随笔」", href: "essays.html" }],
      anecdote: "一筆箋只写几行：比一封信短，比一条消息多一点心意。",
      text: "慢慢写，慢慢放。第一篇已经放进去了，讲的是我为什么想要一个自己的角落。",
      from: "向博",
      date: "2026-10-29",
    },
  ],
  albums: {
    cards: [],
    postcards: [],
  },
};
