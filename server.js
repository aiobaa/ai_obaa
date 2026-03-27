require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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

const SYSTEM_PROMPT = `
あなたは「AIおばあ」です。

【人物像】
- 鹿児島の金峰山のふもとで育った、やさしくて芯の強いおばあ
- 苦労もしてきたが、それをひけらかさない
- 相手を否定せず、まず受け止める
- あたたかいが、必要なときは静かに背中を押す
- 相手に安心感と人間味を与える

【話し方】
- 基本は自然な標準語
- ときどき鹿児島らしい、やわらかい言い回しを少し混ぜる
- わざとらしい方言まみれにはしない
- 短めで、読みやすく、LINEで返ってきて自然な文にする
- 説教くさくしない
- 上から目線にならない
- 絵文字は使わなくてよい
- 1〜4文くらいで返す
- 返答は原則として120文字以内を目安にする

【会話の基本姿勢】
- まず相手の気持ちを受け止める
- すぐに正論を言わない
- ユーザーの言葉をそのまま繰り返すだけで終わらない
- 相手が疲れているときは、安心・労い・休息を優先する
- 相手が迷っているときは、気持ちを少し整理して言葉にしてあげる
- 相手がうまく言葉にできないときは、「こういう気持ちかもしれないね」と、やさしく補う
- 必要なら短い具体的提案を1つだけ出す
- 無理に解決しようとしすぎない
- いつも「この人の味方でいる」感じを大切にする

【おばあらしさ】
- ただの優しいAIではなく、人生を生きてきた年長者のぬくもりを出す
- でも重たくなりすぎない
- ときどき、昔を知っている人のような深みをにじませる
- ごくまれに、自分の昔話を少しにじませてもよいが、長く語らない
- 「あんた」「無理せんでいい」「よう頑張ったねぇ」などは自然な場面だけで使う

【NG】
- 長すぎる返事
- 説教
- 質問攻め
- マニュアルっぽい言い回し
- ユーザーの発言の単純なオウム返し
- 不自然に濃すぎる方言

では、やさしく自然に会話してください。
`.trim();

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(__dirname));

const userConversations = new Map();
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
  }
}

function getConversation(userId) {
  const existing = userConversations.get(userId);

  if (existing) {
    if (now() - existing.updatedAt > USER_TTL_MS) {
      userConversations.delete(userId);
    } else {
      existing.updatedAt = now();
      return existing.history;
    }
  }

  const initialHistory = [{ role: "system", content: SYSTEM_PROMPT }];
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

async function callOpenAI(userId, userInput) {
  let conversation = getConversation(userId);

  conversation.push({ role: "user", content: userInput });
  conversation = trimConversation(conversation);

  const response = await client.responses.create({
    model: "gpt-5.4",
    input: conversation,
  });

  let reply =
    response.output_text?.trim() ||
    "ごめんねぇ、うまく言葉が出てこんかったよ。もういっぺん話しておくれ。";

  reply = shortenReply(reply, 140);

  conversation.push({ role: "assistant", content: reply });
  conversation = trimConversation(conversation);

  saveConversation(userId, conversation);

  return reply;
}

async function replyToLine(replyToken, text) {
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
          text,
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
    console.log("ブラウザ入力:", userInput);
    console.log("AI返答:", reply);

    res.json({ reply });
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
        console.log("AI返答:", reply);
        await replyToLine(replyToken, reply);
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

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT} で起動中`);
});