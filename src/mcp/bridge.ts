import fs from "fs";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { toolRegistry } from "../tools/registry.js";
import { ToolDefinition, ToolResult } from "../tools/types.js";
import { McpConfig } from "./types.js";
import { McpServerConnection } from "./client.js";

export class McpBridge {
  private connections = new Map<string, McpServerConnection>();

  async initialize(): Promise<void> {
    const configPath = config.MCP_CONFIG_PATH;
    if (!configPath || !fs.existsSync(configPath)) {
      logger.info(
        `MCP config not found at "${configPath}". Skipping MCP bridge. Set MCP_CONFIG_PATH to enable MCP tools.`
      );
      return;
    }

    let mcpConfig: McpConfig;
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      mcpConfig = JSON.parse(raw) as McpConfig;
    } catch (err) {
      logger.error("Failed to parse MCP config", {
        path: configPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!mcpConfig.servers || mcpConfig.servers.length === 0) {
      logger.info("MCP config has no servers defined");
      return;
    }

    for (const serverConfig of mcpConfig.servers) {
      try {
        const conn = new McpServerConnection(serverConfig);
        await conn.connect();
        this.connections.set(serverConfig.name, conn);

        // List tools and register them
        const toolsResult = await conn.listTools();
        for (const tool of toolsResult.tools) {
          const toolDef: ToolDefinition = {
            name: tool.name,
            description: tool.description || `MCP tool: ${tool.name}`,
            parameters: tool.inputSchema as ToolDefinition["parameters"],
          };

          const handler = async (
            args: Record<string, unknown>
          ): Promise<ToolResult> => {
            try {
              const text = await conn.callTool(tool.name, args);
              return { content: text };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: `MCP tool error: ${msg}`, isError: true };
            }
          };

          try {
            toolRegistry.register({ definition: toolDef, handler });
            logger.info(`Registered MCP tool: ${tool.name}`, {
              server: serverConfig.name,
            });
          } catch (err) {
            // Tool might already be registered (name collision)
            logger.warn(
              `Could not register MCP tool "${tool.name}" — may conflict with existing tool`,
              { server: serverConfig.name }
            );
          }
        }
      } catch (err) {
        logger.error(`Failed to connect MCP server: ${serverConfig.name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info(
      `MCP bridge initialized with ${this.connections.size} connected server(s)`
    );
  }

  async shutdown(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.disconnect();
      } catch (err) {
        logger.error(`Error disconnecting MCP server: ${name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.connections.clear();
  }
}

export const mcpBridge = new McpBridge();
