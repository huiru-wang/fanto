import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type AgentTaskStatus = "pending" | "running" | "completed" | "failed";
export type AgentTask = {
  id: string;
  sessionId: string;
  agentId: string;
  status: AgentTaskStatus;
  input: string;
  output: string | null;
  error: string | null;
  traceId: string | null;
  timeZone: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskRow = {
  id: string;
  session_id: string;
  agent_id: string;
  status: AgentTaskStatus;
  input: string;
  output: string | null;
  error: string | null;
  trace_id: string | null;
  time_zone: string | null;
  created_at: string;
  updated_at: string;
};

export class AgentTaskRepository {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        input TEXT NOT NULL,
        output TEXT,
        error TEXT,
        trace_id TEXT,
        time_zone TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_tasks_status_created_at ON agent_tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS agent_tasks_session_id ON agent_tasks(session_id);
    `);
    const columns = this.database.prepare("PRAGMA table_info(agent_tasks)").all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === "time_zone")) this.database.exec("ALTER TABLE agent_tasks ADD COLUMN time_zone TEXT");
  }

  create(input: { sessionId: string; agentId: string; message: string; traceId?: string; timeZone?: string }): AgentTask {
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: randomUUID(), sessionId: input.sessionId, agentId: input.agentId, status: "pending", input: input.message,
      output: null, error: null, traceId: input.traceId ?? null, timeZone: input.timeZone ?? null, createdAt: now, updatedAt: now,
    };
    this.database.prepare(`INSERT INTO agent_tasks
      (id, session_id, agent_id, status, input, output, error, trace_id, time_zone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task.id, task.sessionId, task.agentId, task.status, task.input, task.output, task.error, task.traceId, task.timeZone, task.createdAt, task.updatedAt);
    return task;
  }

  get(id: string): AgentTask | undefined {
    return this.map(this.database.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id) as TaskRow | undefined);
  }

  claimNext(): AgentTask | undefined {
    const now = new Date().toISOString();
    const row = this.database.prepare(`UPDATE agent_tasks
      SET status = 'running', updated_at = ?
      WHERE id = (SELECT id FROM agent_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1)
        AND status = 'pending'
      RETURNING *`).get(now) as TaskRow | undefined;
    return this.map(row);
  }

  retry(id: string): void {
    this.database.prepare("UPDATE agent_tasks SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'running'").run(new Date().toISOString(), id);
  }

  complete(id: string, output: string): void {
    this.database.prepare("UPDATE agent_tasks SET status = 'completed', output = ?, error = NULL, updated_at = ? WHERE id = ? AND status = 'running'").run(output, new Date().toISOString(), id);
  }

  fail(id: string, error: string): void {
    this.database.prepare("UPDATE agent_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(error.slice(0, 4_000), new Date().toISOString(), id);
  }

  recoverInterrupted(): void {
    this.database.prepare("UPDATE agent_tasks SET status = 'failed', error = 'Agent service restarted while task was running', updated_at = ? WHERE status = 'running'").run(new Date().toISOString());
  }

  close(): void {
    this.database.close();
  }

  private map(row: TaskRow | undefined): AgentTask | undefined {
    if (!row) return undefined;
    return {
      id: row.id, sessionId: row.session_id, agentId: row.agent_id, status: row.status, input: row.input,
      output: row.output, error: row.error, traceId: row.trace_id, timeZone: row.time_zone, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
