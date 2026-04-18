import { ToolDefinition } from "../tools/types.js";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface LLMResponse {
  text: string;
  toolUses: ToolUseBlock[];
  stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
}

export interface LLMClient {
  sendMessage(
    messages: LLMMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse>;
}
