type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (shouldLog("debug")) {
      console.log(`[${timestamp()}] 🐛 DEBUG: ${msg}`, meta ? JSON.stringify(meta) : "");
    }
  },
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (shouldLog("info")) {
      console.log(`[${timestamp()}] ℹ️  INFO: ${msg}`, meta ? JSON.stringify(meta) : "");
    }
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    if (shouldLog("warn")) {
      console.warn(`[${timestamp()}] ⚠️  WARN: ${msg}`, meta ? JSON.stringify(meta) : "");
    }
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (shouldLog("error")) {
      console.error(`[${timestamp()}] ❌ ERROR: ${msg}`, meta ? JSON.stringify(meta) : "");
    }
  },
};
