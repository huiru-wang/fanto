import type { AgentRuntime, CreateAgentRuntimeOptions } from "./runtime.js";

interface Thread {
  userId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  runtime: AgentRuntime;
}

export class SessionManager {
  private threads = new Map<string, Thread>();

  constructor(private makeRuntime: (opts: CreateAgentRuntimeOptions) => Promise<AgentRuntime>) {}

  async getOrCreate(userId: string, sessionId: string, opts: CreateAgentRuntimeOptions): Promise<Thread> {
    const key = `${userId}:${sessionId}`;
    const existing = this.threads.get(key);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing;
    }
    const runtime = await this.makeRuntime(opts);
    const thread: Thread = { userId, sessionId, createdAt: Date.now(), updatedAt: Date.now(), runtime };
    this.threads.set(key, thread);
    return thread;
  }

  cleanupAll() {
    for (const thread of this.threads.values()) thread.runtime.cleanup();
    this.threads.clear();
  }
}
