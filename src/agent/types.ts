export interface AgentTurnResult {
  responseText: string;
  iterationsUsed: number;
  stoppedDueToLimit: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  profileQuestion?: string; // Optional follow-up question to build user profile
}
