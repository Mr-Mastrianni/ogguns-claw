import { Bot, webhookCallback, InputFile } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { AgentLoop } from "./agent/loop.js";
import { OpenAICompatibleClient } from "./llm/client.js";
import { memory } from "./memory/turso.js";
import { supabaseMemory } from "./memory/supabase.js";
import { transcriptionClient } from "./voice/transcription.js";
import { elevenlabs } from "./voice/elevenlabs.js";

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const llm = new OpenAICompatibleClient();
  const agent = new AgentLoop(llm, memory, supabaseMemory);

  // Middleware: whitelist check — silently ignore unauthorized users
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return; // No user info, ignore

    if (!config.ALLOWED_USER_IDS.includes(userId)) {
      logger.warn("Blocked unauthorized user", {
        userId,
        username: ctx.from?.username,
        chatId: ctx.chat?.id,
      });
      return; // Silently ignore
    }

    await next();
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    logger.info(`Text message from ${userId}: ${text}`);
    await ctx.replyWithChatAction("typing");

    try {
      const result = await agent.run(userId, text);
      await sendAgentReply(ctx, result);
      if (result.profileQuestion) {
        await ctx.reply(result.profileQuestion);
      }
    } catch (err) {
      await handleError(ctx, err);
    }
  });

  // Handle voice messages
  bot.on("message:voice", async (ctx) => {
    const userId = ctx.from.id;
    const voice = ctx.message.voice;

    logger.info(`Voice message from ${userId}`, {
      duration: voice.duration,
      fileSize: voice.file_size,
    });

    await ctx.replyWithChatAction("typing");

    try {
      // Download voice file from Telegram
      const file = await ctx.api.getFile(voice.file_id);
      if (!file.file_path) {
        await ctx.reply("❌ Could not download voice message.");
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      // Transcribe
      const transcription = await transcriptionClient.transcribe(fileUrl);

      if (!transcription || transcription.trim().length === 0) {
        await ctx.reply("🎙️ I couldn't make out what you said. Try again?");
        return;
      }

      // Repeat back what was said
      await ctx.reply(`🎙️ You said: "${transcription}"`);

      // Now process through agent
      await ctx.replyWithChatAction("typing");
      const result = await agent.run(userId, transcription);

      // If ElevenLabs is enabled, reply with voice; otherwise text
      if (elevenlabs.isEnabled()) {
        try {
          const audioPath = await elevenlabs.synthesize(result.responseText);
          await ctx.replyWithVoice(new InputFile(audioPath));
          elevenlabs.cleanup(audioPath);
          logger.info("Voice reply sent", {
            userId,
            iterations: result.iterationsUsed,
          });
        } catch (ttsErr) {
          logger.error("TTS failed, falling back to text reply", {
            error:
              ttsErr instanceof Error ? ttsErr.message : String(ttsErr),
          });
          await sendAgentReply(ctx, result);
        }
      } else {
        await sendAgentReply(ctx, result);
      }

      // Ask profile question if we have one (separate message so it feels natural)
      if (result.profileQuestion) {
        await ctx.reply(result.profileQuestion);
      }
    } catch (err) {
      await handleError(ctx, err);
    }
  });

  // Handle non-text, non-voice messages gracefully
  bot.on("message", async (ctx) => {
    if (!ctx.message.text && !ctx.message.voice) {
      await ctx.reply(
        "📝 I understand text and voice messages. Photos, videos, and other media coming in a future level!"
      );
    }
  });

  return bot;
}

async function sendAgentReply(
  ctx: any,
  result: {
    responseText: string;
    stoppedDueToLimit: boolean;
    iterationsUsed: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }
) {
  let replyText = result.responseText;
  if (result.stoppedDueToLimit) {
    replyText +=
      "\n\n_(⚠️ Hit the safety iteration limit — this response may be incomplete.)_";
  }

  await ctx.reply(replyText, { parse_mode: "Markdown" });

  logger.info("Reply sent", {
    userId: ctx.from.id,
    iterations: result.iterationsUsed,
    inputTokens: result.totalInputTokens,
    outputTokens: result.totalOutputTokens,
  });
}

async function handleError(ctx: any, err: unknown) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  logger.error("Error processing message", {
    userId: ctx.from?.id,
    error: errorMessage,
  });
  await ctx.reply(
    `❌ Error: ${errorMessage}\n\n_If this persists, check Railway logs._`,
    { parse_mode: "Markdown" }
  );
}

export function createWebhookHandler(bot: Bot) {
  return webhookCallback(bot, "http");
}
