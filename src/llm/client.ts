import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { ToolDefinition } from "../tools/types.js";
import { LLMClient, LLMMessage, LLMResponse, ToolUseBlock } from "./types.js";

export class OpenRouterClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/gravity-claw",
        "X-Title": "Gravity Claw",
      },
    });
    this.model = config.LLM_MODEL;
    logger.info(`OpenRouterClient initialized with model: ${this.model}`);
  }

  async sendMessage(
    messages: LLMMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    const formattedTools = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const apiMessages = messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    logger.debug("Sending request to OpenRouter", {
      model: this.model,
      messageCount: messages.length,
      toolCount: tools.length,
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: apiMessages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    const message = choice.message;

    const text = message.content || "";
    const toolCalls = message.tool_calls || [];

    const toolUses: ToolUseBlock[] = toolCalls.map((tc) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const usage = response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        }
      : null;

    logger.debug("Received response from OpenRouter", {
      finishReason: choice.finish_reason,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      textLength: text.length,
      toolUseCount: toolUses.length,
    });

    return {
      text,
      toolUses,
      stopReason:
        choice.finish_reason === "tool_calls"
          ? "tool_use"
          : choice.finish_reason === "stop"
            ? "end_turn"
            : choice.finish_reason === "length"
              ? "max_tokens"
              : null,
      usage,
    };
  }
}
