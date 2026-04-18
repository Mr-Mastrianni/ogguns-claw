import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
// MCP result types are handled inline to avoid SDK version mismatches
import { logger } from "../utils/logger.js";
import { McpServerConfig } from "./types.js";

export class McpServerConnection {
  private client: Client;
  private transport:
    | StdioClientTransport
    | SSEClientTransport
    | null = null;
  private config: McpServerConfig;
  connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.client = new Client(
      { name: "gravity-claw", version: "0.1.0" },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    if (this.config.transport === "stdio") {
      if (!this.config.command) {
        throw new Error(`MCP server "${this.config.name}" missing command`);
      }
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || [],
        env: this.config.env
          ? { ...process.env, ...this.config.env } as Record<string, string>
          : undefined,
      });
    } else if (
      this.config.transport === "sse" ||
      this.config.transport === "http"
    ) {
      if (!this.config.url) {
        throw new Error(`MCP server "${this.config.name}" missing URL`);
      }
      this.transport = new SSEClientTransport(new URL(this.config.url));
    } else {
      throw new Error(
        `Unknown MCP transport: ${this.config.transport}`
      );
    }

    await this.client.connect(this.transport);
    this.connected = true;
    logger.info(`MCP server connected: ${this.config.name}`);
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.connected = false;
      logger.info(`MCP server disconnected: ${this.config.name}`);
    }
  }

  async listTools() {
    if (!this.connected) {
      throw new Error(`MCP server "${this.config.name}" not connected`);
    }
    return this.client.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.connected) {
      throw new Error(`MCP server "${this.config.name}" not connected`);
    }
    logger.debug(`Calling MCP tool: ${this.config.name}/${name}`, { args });
    const result = await this.client.callTool({
      name,
      arguments: args,
    });

    // Extract text content from result
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content
      .map((item) => {
        if (item.type === "text") {
          return item.text || "";
        }
        return `[${item.type} content]`;
      })
      .join("\n");

    return text;
  }
}
