import express, { type Request, type Response } from "express";
import cors from "cors";
import "dotenv/config";
import { Agent, run, OpenAIConversationsSession } from "@openai/agents";
import Zod from "zod";
import crypto from "crypto";
import { OpenAI } from "openai";
import { CALL_INSTRUCATION_PROMPT, SYSTEM_PROMPT, VOICE_INSTRUCTIONS } from "./sys";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
  allowedHeaders: "*",
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= OUTPUT SCHEMA =================
const defaultOutputSchema = Zod.object({
  message: Zod.string(),
  emotion: Zod.enum([
    "normal",
    "happy",
    "sad",
    "romantic",
    "playful",
    "caring",
    "excited",
  ]),
  status: Zod.enum(["success", "error"]).default("success"),
});

// ================= OPENAI =================
const openAI = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================= VOICE FORMAT =================
function formatVoiceText(text: string) {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/!/g, ".")
    .replace(/\?/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

// ================= TTS =================
async function generateVoice(text: string) {
  const response = await openAI.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "shimmer",
    input: formatVoiceText(text),
    instructions:VOICE_INSTRUCTIONS
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

// ================= AGENT =================
const ariaAgent = new Agent({
  name: "Aria Agent",
  instructions: SYSTEM_PROMPT,
  outputType: defaultOutputSchema,
});

// ================= SESSION =================
const agentSession: Record<string, OpenAIConversationsSession> = {};

const getSession = (token: string) => {
  if (!agentSession[token]) {
    agentSession[token] = new OpenAIConversationsSession();
  }
  return agentSession[token];
};

const generateToken = () => crypto.randomUUID();

// ================= RANDOM VOICE DECISION =================
function shouldUseVoice(): boolean {
  const rand = Math.floor(Math.random() * 5) + 1; // 1 to 5

  return rand >= 3; // 3,4,5 = voice
}
// ================= API =================
app.post("/", async (req: Request, res: Response) => {
  try {
    const { userQury, token } = req.body;

    const sessionToken = token ?? generateToken();


    const result = await run(ariaAgent, userQury, {
      session: getSession(sessionToken),
    });

    const output = result.finalOutput;

    // ================= SMART VOICE LOGIC =================
    const useVoice = shouldUseVoice();

    if (useVoice && output) {
      const audioBase64 = await generateVoice(output.message);

      fs.writeFileSync(
        "test.mp3",
        Buffer.from(audioBase64, "base64")
      );

      return res.json({
        token: sessionToken,
        ...output,
        responseType: "voice",
        audio: audioBase64,
      });
    }

    // ================= TEXT RESPONSE =================
    return res.json({
      token: sessionToken,
      ...output,
      responseType: "text",
    });

  } catch (error) {
    return res.status(500).json({
      error: "An error occurred while processing the request.",
      errorDetails: error instanceof Error ? error.message : String(error),
    });
  }
});
// ================= REALTIME SESSION =================
app.post("/realtime/session", async (_req: Request, res: Response) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",

            model: "gpt-realtime-2",

            instructions: CALL_INSTRUCATION_PROMPT,

            audio: {
              input: {
                turn_detection: {
                  type: "semantic_vad",
                  interrupt_response: true,
                  create_response: true,
                },
              },
            },
          },
        }),
      }
    );

    const data = await response.json();

    return res.json(data);
  } catch (error) {
    console.error("Realtime session error:", error);

    return res.status(500).json({
      error: "Failed to create realtime session",
    });
  }
});
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});