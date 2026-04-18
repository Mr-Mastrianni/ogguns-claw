export interface ToolParameter {
  type: string;
  description: string;
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}
