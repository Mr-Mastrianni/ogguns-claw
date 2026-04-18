export interface AgentTurnResult {
  responseText: string;
  iterationsUsed: number;
  stoppedDueToLimit: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
}
