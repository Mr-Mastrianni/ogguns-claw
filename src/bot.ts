import { Bot, webhookCallback } from "grammy";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { AgentLoop } from "./agent/loop.js";
import { OpenRouterClient } from "./llm/client.js";
import { memory } from "./memory/turso.js";

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const llm = new OpenRouterClient();
  const agent = new AgentLoop(llm, memory);

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

    logger.info(`Message from ${userId}: ${text}`);

    // Send "typing" action
    await ctx.replyWithChatAction("typing");

    try {
      const result = await agent.run(userId, text);

      let replyText = result.responseText;
      if (result.stoppedDueToLimit) {
        replyText +=
          "\n\n_(⚠️ Hit the safety iteration limit — this response may be incomplete.)_";
      }

      await ctx.reply(replyText, { parse_mode: "Markdown" });

      logger.info("Reply sent", {
        userId,
        iterations: result.iterationsUsed,
        inputTokens: result.totalInputTokens,
        outputTokens: result.totalOutputTokens,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Error processing message", { userId, error: errorMessage });
      await ctx.reply(
        "❌ Something went wrong processing your message. Please try again."
      );
    }
  });

  // Handle non-text messages gracefully
  bot.on("message", async (ctx) => {
    if (!ctx.message.text) {
      await ctx.reply(
        "📝 I only understand text messages right now. Voice and other media are coming in a future level!"
      );
    }
  });

  return bot;
}

export function createWebhookHandler(bot: Bot) {
  return webhookCallback(bot, "http");
}
