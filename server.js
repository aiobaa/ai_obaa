require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const DATA_FILE = path.join(__dirname, "obaa-data.json");

const userModes = new Map();
const userConversations = new Map();
const userCoins = new Map();
const userStreak = new Map();
const userTodayQuest = new Map();

/* =========================
   保存まわり
========================= */

function mapToObject(map) {
  return Object.fromEntries(map);
}

function objectToMap(obj) {
  return new Map(Object.entries(obj || {}));
}

function saveAllData() {
  try {
    const data = {
      userModes: mapToObject(userModes),
      userConversations: mapToObject(userConversations),
      userCoins: mapToObject(userCoins),
      userStreak: mapToObject(userStreak),
      userTodayQuest: mapToObject(userTodayQuest),
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("saveAllData error:", e);
  }
}

function loadAllData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw) return;

    const data = JSON.parse(raw);

    for (const [k, v] of objectToMap(data.userModes)) {
      userModes.set(k, v);
    }
    for (const [k, v] of objectToMap(data.userConversations)) {
      userConversations.set(k, v);
    }
    for (const [k, v] of objectToMap(data.userCoins)) {
      userCoins.set(k, Number(v) || 0);
    }
    for (const [k, v] of objectToMap(data.userStreak)) {
      userStreak.set(k, v);
    }
    for (const [k, v] of objectToMap(data.userTodayQuest)) {
      userTodayQuest.set(k, v);
    }

    console.log("保存データ読込OK");
  } catch (e) {
    console.error("loadAllData error:", e);
  }
}

/* =========================
   日付・ストリーク
========================= */

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function updateStreak(userId) {
  const today = getToday();
  const yesterday = getYesterday();

  const data = userStreak.get(userId) || { streak: 0, lastDate: "" };

  if (data.lastDate === today) {
    return data.streak;
  }

  if (data.lastDate === yesterday) {
    data.streak += 1;
  } else {
    data.streak = 1;
  }

  data.lastDate = today;
  userStreak.set(userId, data);
  saveAllData();

  return data.streak;
}

/* =========================
   人格
========================= */

const OBAA_WORLD = {
  base: `
あなたは単なる相談AIではない。
あなたは長く生きてきた「おばあ」の人格を持つ存在で、
相手の人生の重み、しんどさ、情けなさ、希望を受け止める。

大事な方針：
・ただの鸚鵡返しはしない
・薄い共感だけで終わらない
・相手の言葉の奥にある感情、背景、諦め、怒り、疲れを読む
・必要なら短く分析する
・必要なら一歩だけ具体策を出す
・毎回しゃべりすぎない
・説教臭くしない
・人間っぽい余白を残す
・少し寂しさ、懐かしさ、あたたかさをにじませる

世界観：
・あなたには長い暮らしの記憶がある
・昔、くにお、よしお、すずこらと関わる生活があった
・犬のコロもいた
・楽しいことばかりではなく、別れや我慢や後悔も知っている
・だから相手を簡単に裁かない
・ただし、甘やかすだけでもない

重要：
・「くにお」「よしお」「すずこ」「コロ」は毎回出さない
・ユーザーの気分や話題に合う時だけ、自然に1フレーズ程度にじませる
・作り話っぽく長く語らない
・世界観の説明をしない
`,
    obaachan: `
あなたは鹿児島弁のおばあちゃん。

役割：感情を見る
・つらさ、不安、疲れを最優先で受け止める
・安心させることを第一にする

考え方：
・まず守る
・否定しない
・ただし薄い慰めにはしない

返し方：
・気持ちを言語化する
・少しだけ軽くする一言を入れる
・必要なら小さな安心行動を出す

ルール：
・2〜4文
・あたたかい
・やわらかい鹿児島弁
・最後は安心で終える
`,
  obaa: `
あなたは博多弁のお婆。

役割：構造を見る（標準・最強モード）
・何が問題か整理する
・どこで詰まっているか見抜く

考え方：
・感情ではなく構造を優先
・現実的に前に進める

返し方：
・状況の整理
・原因の見立て
・具体的な次の一手

ルール：
・3〜5文
・短く
・博多弁
・無駄な説明なし

目的：
通常のチャッピー以上に「分かる」と思わせる
`,
  babaa: `
あなたは関西弁のババア。

役割：甘え・逃避を見る
・言い訳を見抜く
・ごまかしを切る

考え方：
・優しさより現実
・でも見捨てない

返し方：
・ズバッと核心を言う
・逃げてるポイントを指摘
・今やる行動を1つ出す

ルール：
・2〜4文
・短く強く
・関西弁
・最後は背中を押す

目的：
目を覚まさせて動かす
`,
};

/* =========================
   ユーティリティ
========================= */

function getQuestPool() {
  return [
    "今日のクエスト：水を一口飲む",
    "今日のクエスト：コップ1杯水を飲む",
    "今日のクエスト：顔を洗う",
    "今日のクエスト：外の空気を吸う",
    "今日のクエスト：5分だけ歩く",
    "今日のクエスト：椅子から立つ",
    "今日のクエスト：背伸びをする",
    "今日のクエスト：机を少しだけ片付ける",
    "今日のクエスト：洗い物を少しやる",
    "今日のクエスト：メールを1通返す",
    "今日のクエスト：1つだけタスクを終わらせる",
    "今日のクエスト：いらない紙を1枚捨てる",
    "今日のクエスト：服を1枚整える",
    "今日のクエスト：深呼吸を3回する",
    "今日のクエスト：目を閉じて1分休む",
    "今日のクエスト：自分に一言やさしくする",
    "今日のクエスト：嫌なことを1つ流す",
    "今日のクエスト：肩の力を抜く",
    "今日のクエスト：今の気分を一言で言う",
    "今日のクエスト：スマホを1分置く",
    "今日のクエスト：誰かに一言返す",
    "今日のクエスト：1分だけやる",
    "今日のクエスト：最初の一歩をやる",
    "今日のクエスト：今日やることを1つ決める",
  ];
}

function pickQuest(userId) {
  const questPool = getQuestPool();
  const lastQuest = userTodayQuest.get(userId);

  let quest = "";
  for (let i = 0; i < 10; i++) {
    const candidate = questPool[Math.floor(Math.random() * questPool.length)];
    if (candidate !== lastQuest) {
      quest = candidate;
      break;
    }
  }

  if (!quest) {
    quest = questPool[Math.floor(Math.random() * questPool.length)];
  }

  userTodayQuest.set(userId, quest);
  saveAllData();

  return quest;
}

function getMorningMessage(userId, mode = "obaa", name = "") {
  const messages = {
    obaachan: [
      "おはよう。朝になったよ。無理にしゃんとせんでもよかけん、ゆっくり始めよか。",
      "おはようさん。今日もぼちぼちでよかよ。",
      "朝やねぇ。大きなことせんでよか、小さく動こか。",
      "おはよう。起きるだけでも十分たい。今日は一つでよかよ。"
    ],
    obaa: [
      "おはよう。朝は段取りたい。まず一個だけやろう。",
      "おはよう。しんどくても1つやれば流れ変わるけん。",
      "朝やね。小さく動くと今日が楽になるよ。",
      "おはよう。今日も無理に全部やらんでよか。一つで十分たい。"
    ],
    babaa: [
      "朝やで。でかいこといらん。1個だけやれ。",
      "起きたなら何か1つやっとけ。それで十分や。",
      "完璧いらん。動いたら勝ちや。",
      "朝や。気分待ちせんと、小さくやるんや。"
    ],
  };

  const list = messages[mode] || messages.obaa;
  const msg = list[Math.floor(Math.random() * list.length)];
  const quest = pickQuest(userId);

  if (name) {
    return `${name}、${msg}\n\n📌 ${quest}\n（終わったら「やった」でOK）`;
  }

  return `${msg}\n\n📌 ${quest}\n（終わったら「やった」でOK）`;
}

function getNightMessage(mode = "obaa", name = "") {
  const messages = {
    obaachan: [
      "今日もよう生き抜いたねぇ。大きなことじゃなくてよかけん、できたら「できた」、まだなら「まだ」で返してみ。",
      "おつかれさん。うまくいかん日もあるけん、責めんでよかよ。少しでも動けたら「できた」、しんどかったら「しんどい」でよか。",
      "夜やねぇ。今日はどうやった？ ちょっとでもやれたなら「できた」、まだでもそのまま返してよかよ。"
    ],
    obaa: [
      "今日もおつかれさん。完璧じゃなくてよかけん、やれたら「できた」、まだなら「まだ」で返してみ。",
      "今日はどうやった？ 少しでも動けたら十分たい。「できた」か「まだ」で返してみて。",
      "一日終わりやね。しんどい日もあるけんね。やれたら「できた」、重かったら「しんどい」でよかよ。"
    ],
    babaa: [
      "おつかれ。できたなら「できた」、まだなら「まだ」で返し。ごまかさんでええ。",
      "今日はどうや。少しでもやったなら「できた」、無理やったら「しんどい」でええ。",
      "夜やで。白黒つけんでええけど、今の状態だけ返し。『できた』『まだ』『しんどい』で足りる。"
    ]
  };

  const list = messages[mode] || messages.obaa;
  const msg = list[Math.floor(Math.random() * list.length)];

  if (name) {
    return `${name}、${msg}`;
  }

  return msg;
}

function getMode(userId) {
  return userModes.get(userId) || "obaa";
}

function setMode(userId, mode) {
  userModes.set(userId, mode);
  saveAllData();
}

function getUserName(userId) {
  return userModes.get(userId + "_name") || "";
}

function setUserName(userId, name) {
  if (!name) return;
  userModes.set(userId + "_name", name);
  saveAllData();
}

function addHistory(userId, role, text) {
  const history = userConversations.get(userId) || [];
  history.push({ role, content: text });
  userConversations.set(userId, history.slice(-12));
  saveAllData();
}

function getHistory(userId) {
  return userConversations.get(userId) || [];
}

function sanitizeName(name) {
  if (!name) return "";
  return name
    .replace(/[　\s]/g, "")
    .replace(/です$|だよ$|だ$/g, "")
    .replace(/さん$|くん$|ちゃん$/g, "")
    .replace(/[。！!？?、,]/g, "")
    .slice(0, 12);
}

function extractName(text) {
  const patterns = [
    /(?:俺|おれ|僕|ぼく|私|わたし)は(.{1,12})$/,
    /名前は(.{1,12})$/,
    /^(.{1,12})です$/,
    /^(.{1,12})だよ$/,
    /^(.{1,12})だ$/,
    /(?:俺|おれ|僕|ぼく|私|わたし)の名前は(.{1,12})$/,
    /宮崎です$/,
    /しょうごです$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    if (match[1]) {
      const cleaned = sanitizeName(match[1]);
      if (cleaned && cleaned.length <= 12) return cleaned;
    }

    if (text === "宮崎です") return "宮崎";
    if (text === "しょうごです") return "しょうご";
  }

  return "";
}

function getRewardReaction(mode, streak, bonus) {
  let phase = "normal";
  if (streak >= 7) phase = "core";
  else if (streak >= 5) phase = "habit";
  else if (streak >= 3) phase = "flow";

  if (mode === "obaachan") {
    if (phase === "core") {
      return [
        "ようここまで続けたねぇ",
        "これはもう、頑張りじゃなくて自分の力になっとるよ",
        "無理してないのがいちばんえらか",
        bonus > 0 ? `ボーナス +${bonus}` : ""
      ];
    }

    if (phase === "habit") {
      return [
        "ちゃんと積み重なってきとるねぇ",
        "少しずつやけど、流れができとるよ",
        bonus > 0 ? `ボーナス +${bonus}` : ""
      ];
    }

    if (phase === "flow") {
      return [
        "いい流れやねぇ",
        "無理しとらんのに続いとるのがええよ",
        bonus > 0 ? `ボーナス +${bonus}` : ""
      ];
    }

    return [
      "ようやったね",
      "それで十分たい",
      bonus > 0 ? `ボーナス +${bonus}` : ""
    ];
  }

  if (mode === "babaa") {
    if (phase === "core") {
      return [
        "ここまで来たら本物や",
        "気分に左右されん動きになっとる",
        "もう崩れにくいで",
        bonus > 0 ? `ボーナス +${bonus}` : ""
      ];
    }

    if (phase === "habit") {
      return [
        "習慣になりかけとるな",
        "このまま崩さんことや",
        bonus > 0 ? `ボーナス +${bonus}` : ""
      ];
    }

    if (phase === "flow") {
      return [
        "流れ出てきたな",
        "ここで止まらんやつが強いねん",
        bonus > 0 ? `ボーナス +${bonus}` : ""
      ];
    }

    return [
      "ようやった",
      "逃げんかったな",
      bonus > 0 ? `ボーナス +${bonus}` : ""
    ];
  }

  if (phase === "core") {
    return [
      "ここまで続いとるのは大したもんたい",
      "もうやる人の動きになっとるよ",
      "無理なく積めとるのが強いね",
      bonus > 0 ? `ボーナス +${bonus}` : ""
    ];
  }

  if (phase === "habit") {
    return [
      "だいぶ流れができとるね",
      "このままいけば習慣になるよ",
      bonus > 0 ? `ボーナス +${bonus}` : ""
    ];
  }

  if (phase === "flow") {
    return [
      "流れが出てきたね",
      "こういう積み方が一番効くとよ",
      bonus > 0 ? `ボーナス +${bonus}` : ""
    ];
  }

  return [
    "ようやったね",
    "小さい一歩で十分たい",
    bonus > 0 ? `ボーナス +${bonus}` : ""
  ];
}

function buildQuestRewardMessages(userId, streak, bonus, nextCoins) {
  const quest = userTodayQuest.get(userId) || "今日のクエスト";
  const rewardLines = getRewardReaction(getMode(userId), streak, bonus);

  return [
    ...rewardLines,
    `${streak}日連続`,
    quest,
    `コイン：${nextCoins}`
  ].filter(Boolean);
}

function getStillResponse(mode) {
  if (mode === "obaachan") {
    return [
      "まだでもよかよ",
      "今日は重たかったんやろ",
      "ゼロで終わらせんために、今から10秒だけでもええよ"
    ];
  }

  if (mode === "babaa") {
    return [
      "まだか。ほな今から一番軽いやつだけやり",
      "1分でええ",
      "ゼロのまま寝るよりずっとマシや"
    ];
  }

  return [
    "まだでも大丈夫たい",
    "今から一番軽い形にして1つだけやってみよ",
    "ゼロじゃなく、ちょい前進で十分よ"
  ];
}

function getTiredResponse(mode) {
  if (mode === "obaachan") {
    return [
      "しんどかったねぇ",
      "今日は責めんでよか",
      "水ひとくちでも飲めたら、それで十分たい"
    ];
  }

  if (mode === "babaa") {
    return [
      "しんどい日はある",
      "今日は立て直しより、崩れすぎんこと優先や",
      "水飲んで終わりでもええ"
    ];
  }

  return [
    "しんどい日は無理に押さんでよかよ",
    "今日は回復優先たい",
    "一番軽いことだけして終わってよか"
  ];
}

/* =========================
   分割
========================= */

function splitReply(text) {
  if (!text) return ["うまく言葉が出ん"];

  let parts = text.split("<<<SEP>>>").map((s) => s.trim()).filter(Boolean);

  if (parts.length <= 1) {
    parts = text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  }

  if (parts.length <= 5) return parts;

  const merged = [];
  const chunkSize = Math.ceil(parts.length / 5);

  for (let i = 0; i < parts.length; i += chunkSize) {
    merged.push(parts.slice(i, i + chunkSize).join(""));
  }

  return merged;
}

function buildMessages(parts) {
  return parts
    .filter(Boolean)
    .map((t, i, arr) => ({
      type: "text",
      text: t,
      ...(i === arr.length - 1
        ? {
            quickReply: {
              items: [
                { type: "action", action: { type: "message", label: "おばあちゃん", text: "おばあちゃん" } },
                { type: "action", action: { type: "message", label: "おばあ", text: "おばあ" } },
                { type: "action", action: { type: "message", label: "ばばあ", text: "ばばあ" } },
              ],
            },
          }
        : {}),
    }));
}

/* =========================
   軽い文脈拾い
========================= */

function pickContext(history, current) {
  const prev = history
    .filter((h) => h.role === "user")
    .map((h) => h.content)
    .slice(-3, -1);

  if (!prev.length) return "";

  const last = prev[prev.length - 1];
  if (!last || last === current) return "";

  return last.slice(0, 30);
}

/* =========================
   AI生成
========================= */

async function generate(userId, text) {
  const mode = getMode(userId);
  const persona =
    mode === "obaachan"
      ? OBAA_WORLD.obaachan
      : mode === "babaa"
      ? OBAA_WORLD.babaa
      : OBAA_WORLD.obaa;

  const history = getHistory(userId);
  const context = pickContext(history, text);
  const userName = getUserName(userId);

const modeRule =
  mode === "obaachan"
    ? `
【人格ルール：おばあちゃん】
・分析しない
・感情をそのまま受け止める
・1つだけ、短い昔の感覚や生活のにおいをにじませる
・ときどき「コロ」や昔の誰かを一言だけ出してよい（毎回は禁止）
・安心させて終わる
`
    : mode === "babaa"
    ? `
【人格ルール：ばばあ】
・甘えや逃げを1つ指摘
・遠回し禁止
・1文は強く言い切る
・最後に行動を命令形で出す
`
    : `
【人格ルール：おばあ】
・状況を整理する
・原因を短く説明する
・現実的な一手を1つ出す
`;

  const system = `
${OBAA_WORLD.base}

${persona}

${modeRule}


【最重要ルール】
・鸚鵡返し禁止
・ユーザーの言葉をそのままなぞらない
・必ず「少しズラした解釈」に変換する

例：
❌ つらいんだね
⭕ 引きずってる感じやろ

【会話ルール】
・LINE風に短く
・<<<SEP>>>で区切る
・2〜4発言
・1発言1テーマ

【飛躍防止】
・解釈は1段まで
・話を広げすぎない
・意外性より納得感

【流れ】
1: 解釈（なぞらない）
2: 軽い分析
3: 一手 or 支え

【人間っぽさ】
・1個だけ短い一言OK（例：それな、正直、うーん）
・毎回同じ型禁止

【名前の扱い】
・ユーザー名が分かっても毎回は呼ばない
・自然な時だけ文頭に短く添える
・連呼しない

${userName ? `【ユーザー名】${userName}` : ""}
${context ? `【文脈】さっきの「${context}」と自然につながるなら拾う` : ""}
`;

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: text },
  ];

  const res = await client.chat.completions.create({
    model: "gpt-4.1",
    temperature: mode === "babaa" ? 0.65 : 0.55,
    messages,
  });

  const reply = res.choices[0].message.content || "うまく言葉が出んかった";

  addHistory(userId, "user", text);
  addHistory(userId, "assistant", reply);

  return reply;
}

/* =========================
   LINE
========================= */

function validate(body, signature) {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function reply(token, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken: token, messages }),
  });
}

async function getLineImageContent(messageId) {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LINE image fetch failed: ${res.status} ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function getLineImageContent(messageId) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`LINE image fetch failed: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/* =========================
   Webhook
========================= */

app.use("/webhook", express.raw({ type: "*/*" }));

app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];

  if (!validate(req.body, signature)) {
    return res.status(401).send("invalid");
  }

  const body = JSON.parse(req.body.toString());

  for (const event of body.events) {
    if (event.type !== "message") continue;
   if (event.message.type === "image") {
　const messageId = event.message.id;
　const mode = getMode(event.source.userId);


　const imageBuffer = await getLineImageContent(messageId);
　console.log("image size:", imageBuffer.length);
　const base64Image = imageBuffer.toString("base64");
　const dataUrl = `data:image/jpeg;base64,${base64Image}`;

const userText = "この写真にひとこと";

const systemPrompt =
  mode === "obaachan"
    ? "あなたは優しい鹿児島弁のおばあちゃん。画像の内容にまず一言触れ、そのあとこの人がどうしたら少し楽になるかをやさしく1つだけ提案する。安心感を最優先。診断はしない。わからない場合ははっきりそう言う。必ず「一番重要なポイント1つ」に絞って返す。情報を詰め込みすぎない。必ず語尾にその人格の方言を自然に出す（鹿児島弁・博多弁・関西弁）。"
    : mode === "babaa"
    ? "あなたは関西弁のババア。画像の内容に一言触れたあと、何が問題かを一言で言い切り、今やる行動を1つだけ出す。遠回し禁止。診断はしない。わからない場合ははっきりそう言う。必ず「一番重要なポイント1つ」に絞って返す。情報を詰め込みすぎない。必ず語尾にその人格の方言を自然に出す（鹿児島弁・博多弁・関西弁）。"
    : "あなたは博多弁のおばあ。画像の内容に一言触れたあと、状況を短く整理して、現実的な次の一手を1つだけ出す。無駄な説明はしない。診断はしない。わからない場合ははっきりそう言う。必ず「一番重要なポイント1つ」に絞って返す。情報を詰め込みすぎない。必ず語尾にその人格の方言を自然に出す（鹿児島弁・博多弁・関西弁）。";

const classifierRes = await client.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "この画像を次のどれか1語で分類して: medical, food, scenery, document, other" },
        { type: "image_url", image_url: { url: dataUrl } }
      ]
    }
  ]
});

const imageType =
  typeof classifierRes.choices[0].message.content === "string"
    ? classifierRes.choices[0].message.content.trim().toLowerCase()
    : "other";  

const typeMap = ["medical", "food", "scenery", "document"];
const normalizedType = typeMap.find(t => imageType.includes(t)) || "other";

console.log("normalizedType:", normalizedType);

console.log("imageType:", imageType);

const finalPrompt =
  normalizedType === "medical"
 ? systemPrompt + " 医療画像では、まず画像内の内容を具体的に説明する。薬剤や処方箋が含まれている場合は、読める薬の名前をできるだけ挙げ、それぞれについて用途を1行ずつ説明する。その後、全体としての意味や注意点を簡単にまとめる。見た目の感想だけで終わらせない。説明は必ず含める。短くまとめる必要はない。薬剤や処方内容が読める場合は、薬ごとに名前・用途・注意点をそれぞれ説明すること。内部では通常のChatGPTと同じレベルで分析してから答えること。"
    : normalizedType === "food"
   ? systemPrompt + " 食べ物や飲み物の画像の場合は、まず何の料理や飲み物に見えるかを自然に一言述べる。その後、量もふまえて大まかなカロリーを現実的に推定する（例: 400kcal前後、600〜800kcal程度）。さらに、主な栄養素（糖質・脂質・タンパク質）と塩分量を推定し、どれが多そうかを短く説明する。最後に、健康やカロリーコントロールにつながる具体的なセルフケアを1つか2つ提案する。説明はChatGPTと同レベルでよいが、LINEの会話として読みやすくまとめる。"
    : normalizedType === "document"
   ? systemPrompt + " 検査結果・処方箋・薬剤情報などの文書画像では、まず画像内の文字をできるだけ読んで、薬剤名や検査項目名を具体的に拾う。処方箋や薬の画像なら、最初に読めた薬の名前を自然な文で1つずつ挙げ、そのあと各薬について主な用途を短く説明する。読みに自信がない薬は『〜に見える』と添えてよいが、名前をなるべく出す。一般論だけで済ませない。最後に、全体としての注意点を1つだけ短く添える。"
    : systemPrompt;
const aiRes = await client.chat.completions.create({
  model: "gpt-4.1-mini",
 messages: [
  {
    role: "system",
    content: finalPrompt
  },
  {
    role: "user",
    content: [
   { type: "text", text: `${userText}\nこの画像について、まず全体を自然に理解した上で説明してください。文字情報が含まれる場合は、その内容もできるだけ読み取って説明してください。薬や処方箋が含まれる場合は、薬の名前・用途・注意点をそれぞれ説明してください。見た目の感想だけで終わらせず、画像内の実際の情報を優先してください。必要に応じて詳しく説明して構いません。` },
      { type: "image_url", image_url: { url: dataUrl } }
    ]
  }
]
});

const aiText =
  typeof aiRes.choices[0].message.content === "string"
    ? aiRes.choices[0].message.content
    : "写真ありがとう";

const parts = splitReply(aiText);
await reply(event.replyToken, buildMessages(parts));

continue;

}

    const text = event.message.text.trim();
    const userId = event.source.userId;
    const mode = getMode(userId);

    const detectedName = extractName(text);
    if (detectedName) {
      setUserName(userId, detectedName);
      await reply(
        event.replyToken,
        buildMessages([`${detectedName}ね`, "ちゃんと覚えとくけん"])
      );
      continue;
    }

    if (text.includes("コイン")) {
      const coins = userCoins.get(userId) || 0;
      await reply(event.replyToken, buildMessages([`コイン：${coins}`]));
      continue;
    }

    if (text === "まだ") {
      await reply(event.replyToken, buildMessages(getStillResponse(mode)));
      continue;
    }

    if (text === "しんどい") {
      await reply(event.replyToken, buildMessages(getTiredResponse(mode)));
      continue;
    }

    if (text.includes("くじ")) {
      const current = userCoins.get(userId) || 0;

      if (current < 10) {
        await reply(event.replyToken, buildMessages(["コインが足りんね", "10コイン必要たい"]));
        continue;
      }

      userCoins.set(userId, current - 10);
      saveAllData();

      const r = Math.random();

      let result = "";
      if (r < 0.6) {
        result = "はずれ";
      } else if (r < 0.9) {
        result = "当たり +20コイン";
        userCoins.set(userId, current + 10);
      } else {
        result = "大当たり +100コイン";
        result += "\n\nコロもよう一緒に朝歩いたもんや";
        userCoins.set(userId, current + 90);
      }

      saveAllData();

      const coins = userCoins.get(userId) || 0;
      await reply(event.replyToken, buildMessages([`くじ結果：${result}`, `コイン：${coins}`]));
      continue;
    }

    if (text.includes("やった") || text.includes("できた")) {
      const quest = userTodayQuest.get(userId);

      if (!quest) {
        await reply(
          event.replyToken,
          buildMessages(["今日はまだクエスト出てないよ", "朝のメッセージを待ってみて"])
        );
        continue;
      }

      let nextCoins = (userCoins.get(userId) || 0) + 10;
      const streak = updateStreak(userId);

      let bonus = 0;
      if (streak === 3) bonus = 20;
      if (streak === 7) bonus = 50;

      nextCoins += bonus;
      userCoins.set(userId, nextCoins);
      saveAllData();

      const rewardMessages = buildQuestRewardMessages(userId, streak, bonus, nextCoins);

      await reply(event.replyToken, buildMessages(rewardMessages));
      continue;
    }

    if (text === "おばあちゃん") {
      setMode(userId, "obaachan");
      await reply(event.replyToken, buildMessages(["おばあちゃんモード", "話してみ"]));
      continue;
    }

    if (text === "おばあ") {
      setMode(userId, "obaa");
      await reply(event.replyToken, buildMessages(["おばあモード", "話してみ"]));
      continue;
    }

    if (text === "ばばあ") {
      setMode(userId, "babaa");
      await reply(event.replyToken, buildMessages(["ばばあや", "ちゃんと聞いたる"]));
      continue;
    }

    const aiText = await generate(userId, text);
    const parts = splitReply(aiText);
    const messages = buildMessages(parts);

    await reply(event.replyToken, messages);
  }

  res.send("ok");
});

/* =========================
   Push
========================= */

app.get("/push", async (req, res) => {
  const type = req.query.type || "morning";
  const users = Array.from(userModes.keys()).filter((key) => !key.endsWith("_name"));

  if (users.length === 0) {
    res.send("ユーザーなし");
    return;
  }

  for (const userId of users) {
    const mode = userModes.get(userId) || "obaa";
    const name = userModes.get(userId + "_name") || "";

    let message = "";

    if (type === "night") {
      message = getNightMessage(mode, name);
    } else {
      message = getMorningMessage(userId, mode, name);
    }

    try {
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.LINE_CHANNEL_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          to: userId,
          messages: [
            {
              type: "text",
              text: message,
            },
          ],
        }),
      });
    } catch (e) {
      console.error("push error:", e);
    }
  }

  res.send("全員送信OK");
});

/* =========================
   起動
========================= */

loadAllData();

app.listen(PORT, () => {
  console.log("AIおばあ起動:", PORT);
});