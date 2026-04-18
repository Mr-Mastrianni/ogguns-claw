export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http";
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse / http
  url?: string;
}

export interface McpConfig {
  servers: McpServerConfig[];
}
