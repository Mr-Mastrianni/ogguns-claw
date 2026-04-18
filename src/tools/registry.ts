import { RegisteredTool } from "./types.js";
import {
  getCurrentTimeDefinition,
  getCurrentTimeHandler,
} from "./getCurrentTime.js";

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor() {
    this.register({
      definition: getCurrentTimeDefinition,
      handler: getCurrentTimeHandler,
    });
  }

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" is already registered`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions() {
    return this.getAll().map((t) => t.definition);
  }
}

export const toolRegistry = new ToolRegistry();
