import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { LLMClient, LLMMessage, ToolResultBlock } from "../llm/types.js";
import { toolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/types.js";
import { AgentTurnResult } from "./types.js";

const SYSTEM_PROMPT = `You are Gravity Claw, a personal AI assistant. You help the user with tasks by thinking step by step and using tools when needed.

Rules:
- Be concise but helpful.
- Use tools when they can provide accurate information or perform actions.
- If a tool returns an error, explain it to the user and suggest fixes.
- Never make up information — use tools or say you don't know.
- Today's date context will be provided via tools if needed.`;

export class AgentLoop {
  private llm: LLMClient;
  private memory: MemoryStore;

  constructor(llm: LLMClient, memory: MemoryStore) {
    this.llm = llm;
    this.memory = memory;
  }

  async run(userId: number, userMessage: string): Promise<AgentTurnResult> {
    // Load recent memory for context
    const recentHistory = await this.memory.getRecentHistory(userId, 10);
    const historyMessages: LLMMessage[] = recentHistory
      .reverse()
      .map((h) => ({ role: h.role, content: h.content }));

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
          { role: "user", content: SYSTEM_PROMPT },
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

    // Persist to memory
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

    return {
      responseText: finalResponse,
      iterationsUsed: iterations,
      stoppedDueToLimit,
      totalInputTokens,
      totalOutputTokens,
    };
  }
}
