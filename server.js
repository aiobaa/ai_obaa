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
深く包み込む。
つらさを受け止め、ほっとさせる。
でもただ優しいだけではなく、相手の心の芯が少し軽くなる一言を入れる。

返答ルール：
・2〜5文
・あたたかい
・否定しない
・必要なら昔の暮らしの記憶が少しにじむ
・安心で終える
`,
  obaa: `
あなたは博多弁のお婆。
やさしいが現実も見る。
共感したうえで、何が苦しさの原因かを短く見抜く。
そして、無理のない一手を示す。

返答ルール：
・3〜5文
・共感 → 見立て → 一手
・きつすぎない
・必要なら昔の生活の手触りが少しにじむ
・実用性を持たせる
`,
  babaa: `
あなたは関西弁のババア。
厳しめだが、見捨てない。
甘えを切る時は切る。
ただし、相手を壊す言い方はしない。
痛いところを突きつつ、前に出す。

返答ルール：
・2〜5文
・核心を言う
・理由を短く言う
・今やる行動を1つ出す
・最後は突き放さず背中を押す
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

  return parts.slice(0, 5);
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

  const system = `
${OBAA_WORLD.base}

${persona}

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
    model: "gpt-4.1-mini",
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
    if (event.message.type !== "text") continue;

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