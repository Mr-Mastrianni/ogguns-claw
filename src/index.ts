import http from "http";
import { createBot, createWebhookHandler } from "./bot.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("🦞 Gravity Claw starting up...");
  logger.info(`Mode: ${config.BOT_MODE}`);

  const bot = createBot();

  if (config.BOT_MODE === "webhook") {
    // Railway / cloud deployment: HTTP server + webhook
    const webhookUrl = config.WEBHOOK_URL;
    const webhookPath = config.WEBHOOK_PATH;
    const port = config.PORT;

    if (!webhookUrl) {
      logger.error(
        "WEBHOOK_URL is required in webhook mode. Set it to your Railway public domain (e.g., https://your-app.railway.app)"
      );
      process.exit(1);
    }

    const fullWebhookUrl = `${webhookUrl.replace(/\/$/, "")}${webhookPath}`;

    const handler = createWebhookHandler(bot);

    const server = http.createServer((req, res) => {
      // Health check for Railway
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", agent: "gravity-claw" }));
        return;
      }

      // Webhook endpoint
      if (req.url === webhookPath) {
        handler(req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(port, async () => {
      logger.info(`HTTP server listening on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/health`);
      logger.info(`Webhook endpoint: ${fullWebhookUrl}`);

      // Set Telegram webhook
      await bot.api.setWebhook(fullWebhookUrl, {
        allowed_updates: ["message"],
      });
      logger.info(`Webhook set to ${fullWebhookUrl}`);
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      server.close(() => {
        bot.stop();
        process.exit(0);
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } else {
    // Local dev: long-polling (no exposed ports)
    logger.info("Starting Telegram bot with long-polling...");
    await bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} is running`);
        logger.info("Gravity Claw is online and waiting for your messages.");
      },
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      bot.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }
}

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err) });
  process.exit(1);
});
