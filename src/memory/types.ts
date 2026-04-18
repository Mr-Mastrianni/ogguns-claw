export interface MemoryEntry {
  id?: number;
  userId: number;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export interface MemoryStore {
  addEntry(entry: MemoryEntry): Promise<void>;
  getRecentHistory(userId: number, limit?: number): Promise<MemoryEntry[]>;
  search(userId: number, query: string, limit?: number): Promise<MemoryEntry[]>;
}
