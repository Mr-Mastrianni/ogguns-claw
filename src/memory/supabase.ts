import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { embeddingClient } from "./embeddings.js";

export interface EpisodicMemory {
  id: string;
  content: string;
  role: string;
  similarity: number;
  created_at: string;
}

export interface UserFact {
  id: string;
  fact_type: string;
  fact_key: string;
  fact_value: string;
  updated_at: string;
}

export class SupabaseMemory {
  private client: SupabaseClient | null = null;
  enabled = false;

  constructor() {
    if (config.SUPABASE_URL && config.SUPABASE_SERVICE_KEY) {
      this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
      this.enabled = true;
      logger.info("Supabase semantic memory initialized");
    } else {
      logger.warn(
        "Supabase credentials not configured. Semantic memory disabled. Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable episodic + fact memory."
      );
    }
  }

  // ─── Episodic Memory ───

  async storeMemory(
    userId: number,
    role: "user" | "assistant",
    content: string
  ): Promise<void> {
    if (!this.enabled || !this.client) return;

    try {
      const embedding = await embeddingClient.embed(content);
      const { error } = await this.client.from("memories").insert({
        user_id: userId,
        role,
        content,
        embedding,
      });

      if (error) {
        logger.error("Failed to store memory", { error: error.message });
      } else {
        logger.debug("Memory stored", { userId, role, contentLength: content.length });
      }
    } catch (err) {
      logger.error("Error storing memory", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async searchMemories(
    userId: number,
    query: string,
    limit = 5,
    threshold = 0.5
  ): Promise<EpisodicMemory[]> {
    if (!this.enabled || !this.client) return [];

    try {
      const embedding = await embeddingClient.embed(query);
      const { data, error } = await this.client.rpc("match_memories", {
        query_embedding: embedding,
        match_user_id: userId,
        match_count: limit,
        similarity_threshold: threshold,
      });

      if (error) {
        logger.error("Failed to search memories", { error: error.message });
        return [];
      }

      return (data || []) as EpisodicMemory[];
    } catch (err) {
      logger.error("Error searching memories", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // ─── Semantic Memory (Facts) ───

  async getUserFacts(userId: number): Promise<UserFact[]> {
    if (!this.enabled || !this.client) return [];

    try {
      const { data, error } = await this.client.rpc("get_user_facts", {
        match_user_id: userId,
      });

      if (error) {
        logger.error("Failed to get user facts", { error: error.message });
        return [];
      }

      return (data || []) as UserFact[];
    } catch (err) {
      logger.error("Error getting user facts", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async searchFacts(
    userId: number,
    query: string,
    limit = 5,
    threshold = 0.5
  ): Promise<UserFact[]> {
    if (!this.enabled || !this.client) return [];

    try {
      const embedding = await embeddingClient.embed(query);
      const { data, error } = await this.client.rpc("match_facts", {
        query_embedding: embedding,
        match_user_id: userId,
        match_count: limit,
        similarity_threshold: threshold,
      });

      if (error) {
        logger.error("Failed to search facts", { error: error.message });
        return [];
      }

      return (data || []) as UserFact[];
    } catch (err) {
      logger.error("Error searching facts", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async upsertFact(
    userId: number,
    factType: string,
    factKey: string,
    factValue: string
  ): Promise<void> {
    if (!this.enabled || !this.client) return;

    try {
      const embedding = await embeddingClient.embed(`${factKey}: ${factValue}`);

      // Check if a fact with this key already exists
      const { data: existing } = await this.client
        .from("user_facts")
        .select("id")
        .eq("user_id", userId)
        .eq("fact_key", factKey)
        .single();

      if (existing) {
        // Update existing fact
        const { error } = await this.client
          .from("user_facts")
          .update({
            fact_value: factValue,
            fact_type: factType,
            embedding,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (error) {
          logger.error("Failed to update fact", { error: error.message });
        } else {
          logger.debug("Fact updated", { userId, factKey });
        }
      } else {
        // Insert new fact
        const { error } = await this.client.from("user_facts").insert({
          user_id: userId,
          fact_type: factType,
          fact_key: factKey,
          fact_value: factValue,
          embedding,
        });

        if (error) {
          logger.error("Failed to insert fact", { error: error.message });
        } else {
          logger.debug("Fact inserted", { userId, factKey });
        }
      }
    } catch (err) {
      logger.error("Error upserting fact", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const supabaseMemory = new SupabaseMemory();
