import { createClient, Client } from "@libsql/client";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { MemoryEntry, MemoryStore } from "./types.js";

export class TursoMemory implements MemoryStore {
  private client: Client | null = null;
  private enabled = false;

  constructor() {
    if (config.TURSO_DATABASE_URL && config.TURSO_AUTH_TOKEN) {
      this.client = createClient({
        url: config.TURSO_DATABASE_URL,
        authToken: config.TURSO_AUTH_TOKEN,
      });
      this.enabled = true;
      this.init().catch((err) => {
        logger.error("Failed to initialize Turso memory", { error: String(err) });
        this.enabled = false;
      });
    } else {
      logger.warn(
        "Turso credentials not configured. Memory will be disabled. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to enable persistent memory."
      );
    }
  }

  private async init(): Promise<void> {
    if (!this.client) return;
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_memories_user_created 
      ON memories(user_id, created_at DESC)
    `);
    logger.info("Turso memory initialized");
  }

  async addEntry(entry: MemoryEntry): Promise<void> {
    if (!this.enabled || !this.client) return;
    await this.client.execute({
      sql: "INSERT INTO memories (user_id, role, content) VALUES (?, ?, ?)",
      args: [entry.userId, entry.role, entry.content],
    });
  }

  async getRecentHistory(
    userId: number,
    limit = 20
  ): Promise<MemoryEntry[]> {
    if (!this.enabled || !this.client) return [];
    const result = await this.client.execute({
      sql: `SELECT id, user_id, role, content, created_at 
            FROM memories 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?`,
      args: [userId, limit],
    });
    return result.rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      role: row.role as "user" | "assistant",
      content: String(row.content),
      createdAt: String(row.created_at),
    }));
  }

  async search(
    userId: number,
    _query: string,
    limit = 10
  ): Promise<MemoryEntry[]> {
    // For now, return recent history as fallback.
    // Full-text search can be added with Turso's FTS5 extension later.
    return this.getRecentHistory(userId, limit);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const memory = new TursoMemory();
