import type { Profile } from "../src/profile/schema";
import { seal } from "./seal";

/*
 * Demo persona. Fictional person, fictional companies — safe to ship in the open-source repo. The contact links (email, GitHub,
 * Read.cv, source) are the author's own.
 * Every message, anecdote and number below is sample copy for that persona, not a real record.
 * The demo photos live in public/photos under the Unsplash License (credits in public/photos/CREDITS.md);
 * replace them with your own. Picture paths are relative to the page ("photos/…", no leading slash), so the site also works
 * under a sub-path such as GitHub Pages' /<repo>/. Without `src` / `image` every object falls back to a procedural look.
 */

/**
 * Thirty-two cool Japanese colours (和色) for the card album: four full sides of eight. The first eleven are the album's own; the
 * twenty-one after them take their names and hexes as published in the 和色大辞典 (colordic.org/w), light to dark in two runs.
 */
const colours = [
  { label: "Geppaku", nameLocal: "月白", color: "#e6eef3", note: "The pale blue of the sky just before the moon rises." },
  { label: "Shiroai", nameLocal: "白藍", color: "#c1dfe4", note: "The lightest dip in the indigo vat: one pass, then out." },
  { label: "Kamenozoki", nameLocal: "瓶覗", color: "#a3cdd3", note: "“A peek into the jar”: cloth dipped once, barely blue." },
  { label: "Mizuasagi", nameLocal: "水浅葱", color: "#86aaa8", note: "Pale leek green thinned with water, like stones in a shallow river." },
  { label: "Seiji", nameLocal: "青磁", color: "#8db7a6", note: "The glaze of celadon: a cool green with grey in it." },
  { label: "Sabiseiji", nameLocal: "錆青磁", color: "#8ea398", note: "Celadon gone quiet, as if it had weathered." },
  { label: "Shironezumi", nameLocal: "白鼠", color: "#d9dbdb", note: "A white grey, the colour of silver dust." },
  { label: "Ginnezumi", nameLocal: "銀鼠", color: "#aeb2b4", note: "Silver grey, one of Edo’s “forty-eight browns and a hundred greys”." },
  { label: "Ainezumi", nameLocal: "藍鼠", color: "#6d8590", note: "Grey with indigo underneath." },
  { label: "Konnezumi", nameLocal: "紺鼠", color: "#46607a", note: "Navy grey, the colour of the street after dusk." },
  { label: "Aonibi", nameLocal: "青鈍", color: "#4f5a62", note: "A dull blue-grey, once worn at court in mourning." },
  { label: "Aijiro", nameLocal: "藍白", color: "#ebf6f7", note: "White with a breath of indigo in it." },
  { label: "Shirahana", nameLocal: "白花色", color: "#e8ecef", note: "Hanada blue thinned until it is almost white." },
  { label: "Usukumonezumi", nameLocal: "薄雲鼠", color: "#d4dcda", note: "The grey of a thin cloud, with a little green in its white." },
  { label: "Haiao", nameLocal: "灰青", color: "#c0c6c9", note: "More grey than blue, like a winter sea seen from far off." },
  { label: "Chigusanezumi", nameLocal: "千草鼠", color: "#bed3ca", note: "Chigusa green with grey in it, like grass under frost." },
  { label: "Hisoku", nameLocal: "秘色", color: "#abced8", note: "The “secret colour” of the celadon once made for the emperor alone: a pale, misty blue." },
  { label: "Suzu", nameLocal: "錫色", color: "#9ea1a3", note: "Tin: a duller, darker grey than silver." },
  { label: "Minatonezumi", nameLocal: "湊鼠", color: "#80989b", note: "Harbour grey, the water by the quay on a cloudy day." },
  { label: "Sabiasagi", nameLocal: "錆浅葱", color: "#5c9291", note: "Asagi gone quiet: a greyed blue-green." },
  { label: "Masuhana", nameLocal: "舛花色", color: "#5b7e91", note: "Hanada blue softened with grey." },
  { label: "Sabionando", nameLocal: "錆御納戸", color: "#53727d", note: "Onando, the storeroom blue, dulled as if by rust." },
  { label: "Tetsuonando", nameLocal: "鉄御納戸", color: "#455765", note: "Onando darkened with iron, close to slate." },
  { label: "Sabinezumi", nameLocal: "錆鼠", color: "#47585c", note: "A quiet grey with blue-green underneath, like a wet roof tile." },
  { label: "Byakuroku", nameLocal: "白緑", color: "#d6e9ca", note: "Malachite ground so fine it is almost white: a green with milk in it." },
  { label: "Byakugun", nameLocal: "白群", color: "#83ccd2", note: "Azurite ground fine and pale, the blue-green of old temple paintings." },
  { label: "Asahanada", nameLocal: "浅縹", color: "#84b9cb", note: "A light hanada blue, like cotton after a few dips in the indigo vat." },
  { label: "Fukagawanezumi", nameLocal: "深川鼠", color: "#97a791", note: "A green-grey named for Fukagawa, the river quarter of Edo." },
  { label: "Rikyunezumi", nameLocal: "利休鼠", color: "#888e7e", note: "Grey with green in it, named after the tea master Sen no Rikyū." },
  { label: "Usuhana", nameLocal: "薄花色", color: "#698aab", note: "Pale hanada blue with a little grey in it, like the sky before rain." },
  { label: "Omeshicha", nameLocal: "御召茶", color: "#43676b", note: "A deep blue-green named after omeshi, the crepe silk a shogun liked to wear." },
  { label: "Ai", nameLocal: "藍色", color: "#165e83", note: "Indigo itself, the one colour this folio prints in besides black." },
];

/** Twelve postcards, two full sheets of six; the first side holds the calmest pictures. Places and credits follow public/photos/manifest.json. */
const postcards = [
  { label: "Ryōan-ji", place: "Ryōan-ji, Kyoto", placeLocal: "雪の龍安寺", file: "kyoto-ryoanji-snow", credit: "Leongsan", date: "2019-01-27", message: "Fifteen stones, and from any seat you only ever see fourteen. Snow on all of them." },
  { label: "Biei", place: "Biei, Hokkaido", placeLocal: "雪原の一本木、美瑛", file: "biei-lone-tree-snow", credit: "Sung Jin Cho", date: "2024-02-03", message: "One tree, one field, nobody else for a kilometre. I stood there twenty minutes." },
  { label: "Lake Ashi", place: "Lake Ashi, Hakone", placeLocal: "霧の芦ノ湖", file: "hakone-lake-ashi-mist", credit: "Joanna Liu", date: "2023-03-18", message: "The mist never lifted. The boat went out anyway, at 9:40." },
  { label: "Naoshima", place: "Naoshima, Kagawa", placeLocal: "直島、浜辺の鳥居", file: "naoshima-torii-beach", credit: "Victor Lu", date: "2022-04-29", message: "A stone torii on the beach, and the tide coming in under it." },
  { label: "Onomichi", place: "Onomichi, Hiroshima", placeLocal: "霞む尾道水道", file: "onomichi-channel-haze", credit: "ganma", date: "2024-03-09", message: "The ferry across the channel takes four minutes. I took it six times." },
  { label: "Inamuragasaki", place: "Inamuragasaki, Kamakura", placeLocal: "ブルーアワーの稲村ヶ崎", file: "kamakura-inamuragasaki-blue-hour", credit: "taro ohtani", date: "2023-05-20", message: "Blue hour lasts about twenty minutes here. The light stayed red the whole time." },
  { label: "Shirakawa-gō", place: "Shirakawa-gō, Gifu", placeLocal: "雪の白川郷", file: "shirakawago-snow-village", credit: "Hyungman Jeon", date: "2025-01-12", message: "Snow to the eaves, and every roof steaming a little in the sun." },
  { label: "Miyajima", place: "Miyajima, Hiroshima", placeLocal: "宮島、海に立つ鳥居", file: "miyajima-torii-low-tide", credit: "WANG Tianfang", date: "2023-07-29", message: "At low tide you can walk out to the torii. I waited for the water to come back instead." },
  { label: "Kawaguchiko", place: "Lake Kawaguchi, Yamanashi", placeLocal: "朝霧の河口湖", file: "kawaguchiko-islet-mist", credit: "C. Stone", date: "2024-10-19", message: "An islet you could cross in ten steps, and a duck going round it. I stopped counting at twelve." },
  { label: "Arashiyama", place: "Arashiyama, Kyoto", placeLocal: "雪の渡月橋", file: "arashiyama-togetsukyo-snow", credit: "Duong Thinh", date: "2025-02-08", message: "The bridge is 155 metres long. I crossed it twice, slowly, in the snow." },
  { label: "Fuji", place: "Mount Fuji", placeLocal: "富士と釣り舟", file: "mount-fuji-fisherman", credit: "Gregoire Jeanneau", date: "2024-11-16", message: "One man in a small boat, fishing, with Fuji at his back. In an hour he never once turned round." },
  { label: "Shinjuku", place: "Shinjuku, Tokyo", placeLocal: "霞む新宿", file: "tokyo-shinjuku-haze", credit: "Tokyo Kohaku", date: "2025-06-14", message: "From the thirtieth floor at 6:40 the whole city turned blue, then the lights came on." },
];
const postcardTints = ["#d5dbe0", "#dde1e4", "#ccd5d8", "#cdd8dc", "#c9d1dd", "#c7ccd4", "#d9dde2", "#c6d0da", "#d3dad6", "#d6dce1", "#cbd2d8", "#c4ccd5"];

export const profile: Profile = {
  name: "Lin Wen",
  nameLocal: "林文",
  handle: "@linwen",
  role: "Design engineer",
  location: "Shanghai",
  timezone: "Asia/Shanghai",
  bio: "I build small, tactile interfaces — the kind you want to pick up. Eight years across product design and front-end engineering.",
  coverTitle: "Lin Wen — Folio",
  seal,
  source: "https://github.com/qzz0518/sasshi",
  links: [
    { label: "Email", href: "mailto:i@zerah.cc" },
    { label: "GitHub", href: "https://github.com/qzz0518" },
    { label: "Read.cv", href: "https://read.cv/zerah" },
  ],
  items: [
    {
      kind: "card",
      id: "card",
      label: "Business card",
      anecdote: "Printed on 600 gsm cotton, 120 of them, and I have given away 114.",
      story: "Letterpressed by a two-person shop in Jing’an, one colour, one pass. The small disc is the only ink that isn’t black. It folds once, so the inside is for the people who actually write back.",
      specs: [
        { k: "Stock", v: "600 gsm cotton" },
        { k: "Print", v: "Letterpress, one colour" },
        { k: "Size", v: "91 × 55 mm, folded" },
      ],
      front: { name: "Lin Wen", role: "Design engineer", tagline: "Things you want to pick up" },
      inside: [
        { k: "Email", v: "i@zerah.cc" },
        { k: "Web", v: "read.cv/zerah" },
        { k: "Based", v: "Shanghai · UTC+8" },
      ],
      insideNote: "Open to small, careful projects from spring 2027.",
    },
    {
      kind: "resume",
      id: "resume",
      label: "Résumé",
      anecdote: "Two pages, set in one weekend, edited for three weeks.",
      story: "One page for the work and one for everything else. Every line had to earn its place; the first draft was five pages long.",
      specs: [
        { k: "Pages", v: "2" },
        { k: "Updated", v: "2026" },
        { k: "Languages", v: "English · 中文" },
      ],
      summary: "Design engineer who ships the whole thing — from the first sketch to the last pixel of motion.",
      experience: [
        {
          org: "Paperplane Labs",
          role: "Staff design engineer",
          from: "2022",
          to: "Now",
          bullets: ["Led the tactile UI system used by 6 product teams.", "Cut interaction latency from 140 ms to 38 ms on mid-range phones.", "Mentored 5 engineers into design-engineering roles."],
        },
        {
          org: "Northwind Type Co.",
          role: "Senior front-end engineer",
          from: "2019",
          to: "2022",
          bullets: ["Built the variable-font specimen engine behind 40+ release pages.", "Shipped a WebGL page-curl viewer — 2.1M sessions in year one."],
        },
        {
          org: "Little Kiln Studio",
          role: "Product designer",
          from: "2017",
          to: "2019",
          bullets: ["Designed and launched 3 consumer apps from zero.", "Ran 60+ usability sessions."],
        },
      ],
      education: [{ school: "Tongji University", degree: "B.Des, Industrial Design", from: "2013", to: "2017" }],
      skills: ["TypeScript", "WebGL / three.js", "Motion design", "Design systems", "Rust (hobby)", "Figma"],
      languages: ["English", "中文"],
    },
    {
      kind: "ticket",
      id: "ticket",
      label: "Conference ticket",
      anecdote: "My first conference talk: 400 people, 22 minutes, one live demo that worked.",
      story: "The talk was about making interfaces behave like paper: weight, friction, the way a page lands. The live demo was the first page turn of this folio, running on a borrowed laptop.",
      event: "Frontend Weekend",
      date: "2024-09-14",
      time: "09:30",
      venue: "Riverside Hall",
      city: "Shanghai",
      seat: "Speaker",
      talk: "Paper that moves",
      serial: "No. 0142",
      links: [{ label: "Slides", href: "https://example.com/linwen/paper-that-moves" }],
    },
    {
      kind: "polaroid",
      id: "polaroid",
      label: "Polaroid",
      anecdote: "The window of a café over the sea in Kamakura, where the first sketch of this folio happened.",
      story: "Waiting for the next Enoden train, I sat at the counter under this window. Two students stood at the railing the whole time, taking turns photographing the sea. The page you are looking at started on that counter.",
      caption: "kamakura, 11:40",
      image: "photos/polaroid-kamakura-window.jpg",
      tint: "#c9d3da",
      place: "Kamakura",
      date: "2025-11-04",
      back: "Second day of the trip. An iced coffee, and the folio drawn on the back of a receipt.",
    },
    {
      kind: "note",
      id: "note",
      label: "A note",
      anecdote: "A 一筆箋 is a narrow sheet for a few lines: too short for a letter, too kind for a text.",
      text: "Thank you for opening this. If anything in here made you curious, write to me. I answer every letter, slowly but always.",
      from: "Lin",
      date: "2026-10-19",
    },
  ],
  albums: {
    cards: colours.map((c, i) => ({ id: `c${i + 1}`, label: c.label, nameLocal: c.nameLocal, color: c.color, note: c.note })),
    postcards: postcards.map((p, i) => ({
      id: `p${i + 1}`,
      label: p.label,
      src: `photos/${p.file}.jpg`,
      color: postcardTints[i],
      message: p.message,
      from: "Lin",
      place: p.place,
      placeLocal: p.placeLocal,
      credit: `Photo: ${p.credit} / Unsplash`,
      date: p.date,
    })),
  },
};
