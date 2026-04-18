import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { ToolDefinition } from "../tools/types.js";
import { LLMClient, LLMMessage, LLMResponse, ToolUseBlock } from "./types.js";

export class OpenAICompatibleClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    if (config.LLM_PROVIDER === "nvidia") {
      if (!config.NVIDIA_API_KEY) {
        throw new Error(
          "NVIDIA_API_KEY is required when LLM_PROVIDER=nvidia. Get one at https://build.nvidia.com"
        );
      }
      this.client = new OpenAI({
        apiKey: config.NVIDIA_API_KEY,
        baseURL: "https://integrate.api.nvidia.com/v1",
      });
      this.model = config.NVIDIA_MODEL;
      logger.info(`NVIDIA NIM client initialized with model: ${this.model}`);
    } else {
      if (!config.OPENROUTER_API_KEY) {
        throw new Error(
          "OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter. Get one at https://openrouter.ai/keys"
        );
      }
      this.client = new OpenAI({
        apiKey: config.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/gravity-claw",
          "X-Title": "Gravity Claw",
        },
      });
      this.model = config.OPENROUTER_MODEL;
      logger.info(`OpenRouter client initialized with model: ${this.model}`);
    }
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

    logger.debug("Sending LLM request", {
      provider: config.LLM_PROVIDER,
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

    logger.debug("Received LLM response", {
      provider: config.LLM_PROVIDER,
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
