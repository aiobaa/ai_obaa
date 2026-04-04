require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const OpenAI = require("openai");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const userModes = new Map();
const userConversations = new Map();
const userCoins = new Map();
const userStreak = new Map();
const userTodayQuest = new Map();

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
`
};

/* =========================
   ユーティリティ
========================= */

function getMorningMessage(userId, mode = "obaa", name = "") {
  const messages = {
    obaachan: [
      "おはよう。朝になったよ。無理にしゃんとせんでもよかけん、まず起きてお水ばひとくち飲もか。",
      "おはようさん。よう眠れたね。まだ体が重たかなら、布団の中で背伸びしてからでよかよ。",
      "朝やよ。いっぺんに頑張らんでよか。まず顔ば上げて、今日を始めてみよか。",
      "おはよう。起きるのがつらい朝もあるもんねぇ。そいでも、カーテンば少し開けたら朝が入りこんでくるよ。"
    ],
    obaa: [
      "おはよう。朝やけん、まず起きよ。気分が乗らんでも、顔洗って水飲んだら少し流れが変わるけん。",
      "おはようさん。だるくても、まず布団から出るとこまででよか。朝は勢いより段取りたい。",
      "朝やね。考えごとは起きてからでよかけん、まず座って、深呼吸して、今日を始めよ。",
      "おはよう。しんどい朝ほど、一気に立て直そうとせんでよか。起きる、飲む、顔洗う。その3つで十分たい。"
    ],
    babaa: [
      "朝やで。しんどいのはわかるけど、ずっと寝とっても気分はようならへん。まず起き。",
      "おはようさん。気合いはいらん。布団から出る、それだけや。そこから先は起きてから考えたらええ。",
      "朝や。重たい日ほど、頭より先に体を動かし。水飲んで、顔洗って、今日を始めるんや。",
      "起きや。完璧な朝なんかいらんねん。起きたらもう半分勝ちや。"
    ]
  };

  const list = messages[mode] || messages.obaa;
  const msg = list[Math.floor(Math.random() * list.length)];

  const questList = [
    "今日のクエスト：顔を洗う",
    "今日のクエスト：カーテンを開ける",
    "今日のクエスト：水を一口飲む"
  ];

  const quest = questList[Math.floor(Math.random() * questList.length)];
  userTodayQuest.set(userId, quest);

  if (name) {
    return `${name}、${msg}\n\n📌 ${quest}\n（終わったら「やった」でOK）`;
  }

  return `${msg}\n\n📌 ${quest}\n（終わったら「やった」でOK）`;
}

function getMode(userId) {
  return userModes.get(userId) || "obaa";
}

function setMode(userId, mode) {
  userModes.set(userId, mode);
}

function getUserName(userId) {
  return userModes.get(userId + "_name") || "";
}

function setUserName(userId, name) {
  if (!name) return;
  userModes.set(userId + "_name", name);
}

function addHistory(userId, role, text) {
  const history = userConversations.get(userId) || [];
  history.push({ role, content: text });
  userConversations.set(userId, history.slice(-12));
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
    /しょうごです$/
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
                { type: "action", action: { type: "message", label: "ばばあ", text: "ばばあ" } }
              ]
            }
          }
        : {})
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
    { role: "user", content: text }
  ];

  const res = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: mode === "babaa" ? 0.65 : 0.55,
    messages
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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ replyToken: token, messages })
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

    if (text.includes("くじ")) {
      const current = userCoins.get(userId) || 0;

      if (current < 10) {
        await reply(event.replyToken, buildMessages(["コインが足りんね", "10コイン必要たい"]));
        continue;
      }

      userCoins.set(userId, current - 10);

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

      await reply(
        event.replyToken,
        buildMessages([
          "ようやったね",
          `${streak}日連続やね`,
          bonus > 0 ? `ボーナス +${bonus}` : quest,
          `コイン：${nextCoins}`
        ])
      );
      continue;
    }

    /* モード切替 */
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
      message = name
        ? `${name}、今日も一日おつかれさん。ようやったね。`
        : "今日も一日おつかれさん。ようやったね。";
    } else {
      message = getMorningMessage(userId, mode, name);
    }

    try {
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.LINE_CHANNEL_ACCESS_TOKEN
        },
        body: JSON.stringify({
          to: userId,
          messages: [
            {
              type: "text",
              text: message
            }
          ]
        })
      });
    } catch (e) {
      console.error("push error:", e);
    }
  }

  res.send("全員送信OK");
});

app.listen(PORT, () => {
  console.log("AIおばあ起動:", PORT);
});