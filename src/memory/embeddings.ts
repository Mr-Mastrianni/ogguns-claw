import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export class EmbeddingClient {
  private provider: "jina" | "openai" | "nomic";
  private apiKey: string | undefined;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.provider = config.EMBEDDING_PROVIDER;
    this.apiKey =
      this.provider === "jina"
        ? config.JINA_API_KEY
        : this.provider === "openai"
          ? config.OPENAI_API_KEY
          : config.NOMIC_API_KEY;

    if (this.provider === "jina") {
      this.model = config.JINA_MODEL;
      this.baseUrl = "https://api.jina.ai/v1";
    } else if (this.provider === "openai") {
      this.model = config.OPENAI_EMBEDDING_MODEL;
      this.baseUrl = "https://api.openai.com/v1";
    } else {
      this.model = config.NOMIC_MODEL;
      this.baseUrl = "https://api.nomic.ai/v1";
    }

    logger.info(`Embedding client: ${this.provider} (${this.model})`);
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const trimmed = texts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (trimmed.length === 0) return [];

    logger.debug("Embedding batch", {
      provider: this.provider,
      count: trimmed.length,
      totalChars: trimmed.reduce((sum, t) => sum + t.length, 0),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        input: trimmed,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Embedding API error (${this.provider}): ${response.status} ${response.statusText} — ${errorBody}`
      );
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
      usage?: { total_tokens: number };
    };

    // Sort by index to preserve input order
    const embeddings = data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    logger.debug("Embedding complete", {
      provider: this.provider,
      count: embeddings.length,
      dimensions: embeddings[0]?.length,
      tokens: data.usage?.total_tokens,
    });

    return embeddings;
  }
}

export const embeddingClient = new EmbeddingClient();
