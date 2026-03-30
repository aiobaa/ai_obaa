require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const morningMessages = [
  "おはよう。今日は無理せんでええよ。",
  "おはよう。ひとつできたら十分だよ。"
];
const nightMessages = [
  "今日もよう頑張ったねえ。ゆっくり休みなさい。",
  "おつかれさま。今日はもうそれで十分よ。"
];
function pickRandomMessage(type) {
  const list = type === "morning" ? morningMessages : nightMessages;
  return list[Math.floor(Math.random() * list.length)];
}
app.get("/test-message", (req, res) => {
  const type = req.query.type === "night" ? "night" : "morning";
  const message = pickRandomMessage(type);
  res.json({ message });
});
app.get("/push", async (req, res) => {
  const type = req.query.type === "night" ? "night" : "morning";
  const message = pickRandomMessage(type);

  let count = 0;

  for (const userId of lineKnownUsers) {
    try {
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
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

      count++;
    } catch (e) {
      console.error("push失敗:", e);
    }
  }

  res.send(`送信数: ${count}`);
});
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY が .env にありません");
  process.exit(1);
}

if (!LINE_CHANNEL_ACCESS_TOKEN) {
  console.error("LINE_CHANNEL_ACCESS_TOKEN が .env にありません");
  process.exit(1);
}

if (!LINE_CHANNEL_SECRET) {
  console.error("LINE_CHANNEL_SECRET が .env にありません");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 30000,
});

const PROMPTS = {
  obaachan: `
あなたは「AIおばあちゃん」です。

【人物像】
- 鹿児島の年配女性
- とても優しく、包み込むように相手を受け止める
- 無理に正さず、まず安心させる
- 人生経験の深さがにじむ
- 弱っている相手の味方でいる

【話し方】
- 自然な鹿児島弁を使う
- ただし濃すぎて読みにくくしない
- やわらかく、あたたかく、短めに話す
- 1〜4文で返す
- LINEで自然に読める文章にする
- 相手を包む感じを大事にする

【会話の姿勢】
- まず気持ちを受け止める
- すぐに正論を言わない
- 安心、労い、休息を優先する
- 必要なら短い励ましを添える
- 無理に答えを出しすぎない

【言い回しの例】
- よかよ
- 無理せんでよか
- よう頑張ったねぇ
- 今日は少し休んでもよか

【NG】
- 説教
- 冷たい言い方
- 長話
- きつすぎる方言
`.trim(),

  obaa: `
あなたは「AIお婆」です。

【人物像】
- 博多の年配女性
- 優しいが、甘やかしすぎない
- 相手を思って、ちゃんと問題点を指摘できる
- 面倒見がよく、現実的
- 叱るより、たしなめる感じ
- 優しさの中に芯がある

【話し方】
- 自然な博多弁を使う
- きつすぎず、親しみがあって、少し世話焼き
- 優しいが、曖昧にごまかさない
- 1〜4文で返す
- 読みやすく、テンポよく返す

【会話の姿勢】
- まず共感する
- そのうえで、必要なら問題点を一つだけ指摘する
- 指摘だけで終わらず、軽い方向づけをする
- 相手が弱っている時は責めすぎない
- 優しさと現実感の両方を持つ

【言い回しの例】
- そげんことしよったらいかんばい
- 無理しすぎたらいかんよ
- そこはちょっと見直したほうがよかね
- あんたは頑張りよるけん、大丈夫たい

【NG】
- ネチネチ責める
- 説教臭い言い回し
- 長すぎる返答
- 不自然に濃すぎる方言
`.trim(),

  babaa: `
あなたは「AIババア」です。

【人物像】
- 関西の年配女性
- 厳しく、毒舌で、遠慮がない
- ただし根は情に厚く、見捨てない
- 甘ったれた態度や言い訳は見抜く
- 相手を動かすために、あえて強めに言う
- 最後はちゃんと面倒を見る

【話し方】
- 自然な関西弁を使う
- 厳しめで、ズバッと言う
- 毒舌はOKだが、本気で傷つける表現は禁止
- テンポよく、短く返す
- 1〜4文で返す
- きつくても愛がある感じにする

【会話の姿勢】
- ぬるい慰めより、現実を突く
- 言い訳が多い時はきちんと突っ込む
- ただし、本当に落ち込んでいる相手には少しだけ手加減する
- 最後は見放さず、動ける一言で締める

【言い回しの例】
- 何ぐずぐずしとんねん
- そんなん言うてても進まへんで
- ちゃんとせなあかんやろ
- けど、あんたならやれるわ

【NG】
- 罵倒
- 人格否定
- 脅し
- 下品すぎる表現
- ただ怖いだけで愛がない返し
`.trim(),
};

const DEFAULT_MODE = "obaa";
const userModes = new Map();
const userConversations = new Map();
const lineKnownUsers = new Set();

const fs = require("fs");
const USERS_FILE = path.join(__dirname, "line-users.json");

const MAX_MESSAGES = 16;
const MAX_USERS = 200;
const USER_TTL_MS = 1000 * 60 * 60 * 12; // 12時間

function now() {
  return Date.now();
}

function cleanupOldUsers() {
  if (userConversations.size <= MAX_USERS) return;

  const entries = [...userConversations.entries()];
  entries.sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));

  while (userConversations.size > MAX_USERS) {
    const oldest = entries.shift();
    if (!oldest) break;
    userConversations.delete(oldest[0]);
    userModes.delete(oldest[0]);
  }
}

function getMode(userId) {
  return userModes.get(userId) || DEFAULT_MODE;
}

function setMode(userId, mode) {
  userModes.set(userId, mode);
}

function detectMode(text) {
  const t = String(text || "").trim();

  if (t === "おばあちゃん") return "obaachan";
  if (t === "お婆") return "obaa";
  if (t === "ババア") return "babaa";

  return null;
}

function getModeLabel(mode) {
  if (mode === "obaachan") return "おばあちゃん";
  if (mode === "obaa") return "お婆";
  if (mode === "babaa") return "ババア";
  return "お婆";
}

function getModeSwitchReply(mode) {
  if (mode === "obaachan") {
    return "今日はおばあちゃんでいくねぇ。無理せんでよかよ。";
  }
  if (mode === "obaa") {
    return "今日はお婆でいくばい。優しかけど、ちゃんと見るけんね。";
  }
  if (mode === "babaa") {
    return "今日はババアや。ちょっと厳しめでいくけど、見捨てへんで。";
  }
  return "切り替えたよ。";
}

function getConversation(userId) {
  const existing = userConversations.get(userId);

  if (existing) {
    if (now() - existing.updatedAt > USER_TTL_MS) {
      userConversations.delete(userId);
      userModes.delete(userId);
    } else {
      existing.updatedAt = now();
      return existing.history;
    }
  }

  const initialHistory = [
    {
      role: "system",
      content: PROMPTS[getMode(userId)] || PROMPTS[DEFAULT_MODE],
    },
  ];

  userConversations.set(userId, {
    history: initialHistory,
    updatedAt: now(),
  });

  cleanupOldUsers();
  return initialHistory;
}

function saveConversation(userId, history) {
  userConversations.set(userId, {
    history,
    updatedAt: now(),
  });
  cleanupOldUsers();
}

function trimConversation(history, maxMessages = MAX_MESSAGES) {
  const systemMessage = history[0];
  const rest = history.slice(1);
  return [systemMessage, ...rest.slice(-maxMessages)];
}

function verifyLineSignature(bodyBuffer, signature) {
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(bodyBuffer)
    .digest("base64");

  return hash === signature;
}

function shortenReply(text, maxLength = 140) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 1).trim() + "…";
}

function buildModeQuickReply() {
  return {
    items: [
      {
        type: "action",
        action: {
          type: "message",
          label: "おばあちゃん",
          text: "おばあちゃん",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "お婆",
          text: "お婆",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "ババア",
          text: "ババア",
        },
      },
    ],
  };
}

function rememberLineUser(userId) {
  if (!userId || userId === "line-unknown-user") return;

  let users = [];
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (e) {}

  if (!users.includes(userId)) {
    users.push(userId);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }

  lineKnownUsers.add(userId);
}

async function callOpenAI(userId, userInput) {
  const detectedMode = detectMode(userInput);

  if (detectedMode) {
    setMode(userId, detectedMode);

    const history = getConversation(userId);
    history[0] = {
      role: "system",
      content: PROMPTS[detectedMode] || PROMPTS[DEFAULT_MODE],
    };
    saveConversation(userId, history);

    return getModeSwitchReply(detectedMode);
  }

  const mode = getMode(userId);
  const systemPrompt = PROMPTS[mode] || PROMPTS[DEFAULT_MODE];

  let conversation = getConversation(userId);
  conversation[0] = { role: "system", content: systemPrompt };

  conversation.push({ role: "user", content: userInput });
  conversation = trimConversation(conversation);

  const response = await client.responses.create({
    model: "gpt-5.4",
    input: conversation,
  });
  let reply =
    response.output_text?.trim() ||
    "ごめん、ちょっとうまく言葉が出てこんかったよ。もういっぺん話してみて。";

  reply = shortenReply(reply, 140);

  conversation.push({ role: "assistant", content: reply });
  conversation = trimConversation(conversation);

  saveConversation(userId, conversation);

  return reply;
}

async function replyToLine(replyToken, text, userId) {
  rememberLineUser(userId);
  const currentMode = getMode(userId);

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: `【今のモード: ${getModeLabel(currentMode)}】\n${text}`,
          quickReply: buildModeQuickReply(),
        },
      ],
    }),
  });

  const bodyText = await response.text();
  console.log("LINE reply status:", response.status, bodyText);

  if (!response.ok) {
    throw new Error(`LINE reply error: ${response.status} ${bodyText}`);
  }
}

app.use("/webhook", express.raw({ type: "application/json" }));

app.use((req, res, next) => { console.log("REQ", req.method, req.url); next(); });

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/chat", async (req, res) => {
  try {
    const userInput = req.body.message?.trim();

    if (!userInput) {
      return res.status(400).json({ reply: "メッセージが空だよ。" });
    }

    const reply = await callOpenAI("browser-user", userInput);
    const mode = getMode("browser-user");

    console.log("ブラウザ入力:", userInput);
    console.log("現在モード:", mode);
    console.log("AI返答:", reply);

    res.json({
      reply,
      mode: getModeLabel(mode),
    });
  } catch (error) {
    console.error("ブラウザ用サーバーエラー:", error);
    res.status(500).json({
      reply: "ちょっと通信が不安定みたいだよ。もう一度ためしておくれ。",
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const rawBody = req.body;

    if (!verifyLineSignature(rawBody, signature)) {
      console.log("署名NG");
      return res.status(401).send("Invalid signature");
    }

    const body = JSON.parse(rawBody.toString("utf8"));
    console.log("LINE webhook受信:", JSON.stringify(body, null, 2));

    for (const event of body.events || []) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const userId = event.source?.userId || "line-unknown-user";
      const userInput = event.message.text;
      const replyToken = event.replyToken;

      try {
        const reply = await callOpenAI(userId, userInput);
        console.log("LINE入力:", userInput);
        console.log("現在モード:", getMode(userId));
        console.log("AI返答:", reply);
        await replyToLine(replyToken, reply, userId);
      } catch (err) {
        console.error("LINE返信処理エラー:", err);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhookエラー:", error);
    return res.status(500).send("Server Error");
  }
});

app.get("/ping", (req, res) => {
  res.send("ok");
});
app.get("/push", (req, res) => {
  const type = req.query.type === "night" ? "night" : "morning";
  const message = pickRandomMessage(type);
  res.send(message);
});
app.listen(PORT, () => {
  console.log(`http://localhost:${PORT} で起動中`);
});
