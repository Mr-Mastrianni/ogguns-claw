import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Auto-detect Railway: if RAILWAY_PUBLIC_DOMAIN exists, default to webhook mode
const isRailway = !!process.env.RAILWAY_PUBLIC_DOMAIN;

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  ALLOWED_USER_IDS: z
    .string()
    .min(1, "ALLOWED_USER_IDS is required")
    .transform((val) =>
      val
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => {
          const num = Number(id);
          if (Number.isNaN(num)) {
            throw new Error(`Invalid user ID: "${id}"`);
          }
          return num;
        })
    ),
  LLM_MODEL: z.string().default("minimax/minimax-m2.5:free"),
  MAX_AGENT_ITERATIONS: z
    .string()
    .default("10")
    .transform((val) => {
      const num = Number(val);
      if (Number.isNaN(num) || num < 1 || num > 50) {
        throw new Error("MAX_AGENT_ITERATIONS must be between 1 and 50");
      }
      return num;
    }),
  BOT_MODE: z
    .enum(["webhook", "polling"])
    .default(isRailway ? "webhook" : "polling"),
  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_PATH: z.string().default("/webhook"),
  PORT: z
    .string()
    .default("3000")
    .transform((val) => {
      const num = Number(val);
      if (Number.isNaN(num)) throw new Error("PORT must be a number");
      return num;
    }),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map(
    (i) => `  • ${i.path.join(".")}: ${i.message}`
  );
  console.error("\n❌ Configuration errors:\n");
  console.error(issues.join("\n"));
  console.error("\nCopy .env.example to .env and fill in your secrets.\n");
  process.exit(1);
}

export const config = parsed.data;
