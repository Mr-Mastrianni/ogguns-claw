import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { LLMClient, LLMMessage, ToolResultBlock } from "../llm/types.js";
import { toolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/types.js";
import { SupabaseMemory } from "../memory/supabase.js";
import { AgentTurnResult } from "./types.js";

const SYSTEM_PROMPT_BASE = `You are Gravity Claw, a personal AI assistant. You help the user with tasks by thinking step by step and using tools when needed.

Rules:
- Be concise but helpful.
- Use tools when they can provide accurate information or perform actions.
- If a tool returns an error, explain it to the user and suggest fixes.
- Never make up information — use tools or say you don't know.
- Today's date context will be provided via tools if needed.`;

export class AgentLoop {
  private llm: LLMClient;
  private memory: MemoryStore;
  private semanticMemory: SupabaseMemory;

  constructor(llm: LLMClient, memory: MemoryStore, semanticMemory: SupabaseMemory) {
    this.llm = llm;
    this.memory = memory;
    this.semanticMemory = semanticMemory;
  }

  async run(userId: number, userMessage: string): Promise<AgentTurnResult> {
    // 1. Load recent short-term memory (Turso)
    const recentHistory = await this.memory.getRecentHistory(userId, 10);
    const historyMessages: LLMMessage[] = recentHistory
      .reverse()
      .map((h) => ({ role: h.role, content: h.content }));

    // 2. Semantic retrieval: find relevant past conversations
    let memoryContext = "";
    if (this.semanticMemory.enabled) {
      const [relevantMemories, userFacts] = await Promise.all([
        this.semanticMemory.searchMemories(userId, userMessage, 5, 0.5),
        this.semanticMemory.getUserFacts(userId),
      ]);

      const memoryLines: string[] = [];

      if (userFacts.length > 0) {
        memoryLines.push("Facts about the user:");
        for (const f of userFacts.slice(0, 10)) {
          memoryLines.push(`- ${f.fact_key}: ${f.fact_value}`);
        }
      }

      if (relevantMemories.length > 0) {
        memoryLines.push("Relevant past conversations:");
        for (const m of relevantMemories) {
          const date = new Date(m.created_at).toLocaleDateString();
          memoryLines.push(`- [${date}] ${m.role}: ${m.content}`);
        }
      }

      if (memoryLines.length > 0) {
        memoryContext = memoryLines.join("\n");
      }
    }

    // 3. Build system prompt with memories
    let systemPrompt = SYSTEM_PROMPT_BASE;
    if (memoryContext) {
      systemPrompt += `\n\n${memoryContext}`;
    }

    const messages: LLMMessage[] = [
      ...historyMessages,
      { role: "user", content: userMessage },
    ];

    let iterations = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let stoppedDueToLimit = false;
    let finalResponse = "";

    const tools = toolRegistry.getDefinitions();

    while (iterations < config.MAX_AGENT_ITERATIONS) {
      iterations++;
      logger.info(`Agent iteration ${iterations}/${config.MAX_AGENT_ITERATIONS}`);

      const response = await this.llm.sendMessage(
        [
          { role: "user", content: systemPrompt },
          ...messages,
        ],
        tools
      );

      if (response.usage) {
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      if (response.text) {
        finalResponse = response.text;
        messages.push({ role: "assistant", content: response.text });
      }

      if (response.toolUses.length === 0) {
        logger.info("Agent finished: no more tool calls");
        break;
      }

      const toolResultBlocks: ToolResultBlock[] = [];
      for (const toolUse of response.toolUses) {
        logger.info(`Tool call: ${toolUse.name}`, { toolUseId: toolUse.id });

        const tool = toolRegistry.get(toolUse.name);
        if (!tool) {
          logger.warn(`Unknown tool requested: ${toolUse.name}`);
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: Tool "${toolUse.name}" is not available.`,
            is_error: true,
          });
          continue;
        }

        try {
          const result = await tool.handler(toolUse.input);
          logger.info(`Tool result: ${toolUse.name}`, {
            isError: result.isError,
            contentLength: result.content.length,
          });
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result.content,
            is_error: result.isError,
          });
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          logger.error(`Tool error: ${toolUse.name}`, { error: errorMessage });
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error executing tool: ${errorMessage}`,
            is_error: true,
          });
        }
      }

      const toolResultsContent = toolResultBlocks
        .map(
          (block) =>
            `<tool_result tool_use_id="${block.tool_use_id}" is_error="${block.is_error ?? false}">\n${block.content}\n</tool_result>`
        )
        .join("\n");

      messages.push({ role: "user", content: toolResultsContent });

      if (iterations >= config.MAX_AGENT_ITERATIONS) {
        stoppedDueToLimit = true;
        logger.warn("Agent stopped: max iterations reached");
      }
    }

    // 4. Persist to short-term memory (Turso)
    await this.memory.addEntry({
      userId,
      role: "user",
      content: userMessage,
    });
    if (finalResponse) {
      await this.memory.addEntry({
        userId,
        role: "assistant",
        content: finalResponse,
      });
    }

    // 5. Persist to episodic semantic memory (Supabase)
    if (this.semanticMemory.enabled) {
      await Promise.all([
        this.semanticMemory.storeMemory(userId, "user", userMessage),
        this.semanticMemory.storeMemory(userId, "assistant", finalResponse),
      ]);

      // 6. Extract and store facts (lightweight, non-blocking)
      this.extractFacts(userId, userMessage, finalResponse).catch((err) => {
        logger.error("Fact extraction failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return {
      responseText: finalResponse,
      iterationsUsed: iterations,
      stoppedDueToLimit,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  private async extractFacts(
    userId: number,
    userMessage: string,
    assistantResponse: string
  ): Promise<void> {
    if (!this.semanticMemory.enabled) return;

    const extractionPrompt = `Extract any new facts about the user from this conversation turn. Only output facts that are genuinely new or updated. Output as a JSON array of objects with fields: fact_type (preference|biography|goal|relationship|habit), fact_key (short label), fact_value (the fact).

If no new facts, output an empty array [].

User: ${userMessage}
Assistant: ${assistantResponse}`;

    try {
      const result = await this.llm.sendMessage(
        [{ role: "user", content: extractionPrompt }],
        []
      );

      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const facts = JSON.parse(jsonMatch[0]) as Array<{
        fact_type: string;
        fact_key: string;
        fact_value: string;
      }>;

      for (const fact of facts) {
        if (fact.fact_key && fact.fact_value) {
          await this.semanticMemory.upsertFact(
            userId,
            fact.fact_type,
            fact.fact_key,
            fact.fact_value
          );
        }
      }

      logger.info("Facts extracted", { count: facts.length, userId });
    } catch (err) {
      // Silent fail — fact extraction is best-effort
      logger.debug("Fact extraction error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
