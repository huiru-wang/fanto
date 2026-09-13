import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "../../infrastructure/schema.js";
import { nowIso } from "../../infrastructure/time.js";

export type TaskType = "proactive_creation";
export type TaskSession = { role: "update_planner" | "create_planner" | "thread_proposal"; agentId: string; sessionId: string; proposalId?: string };
type TaskPayload = { schemaVersion: 1; trigger: "manual" | "heartbeat" };
type Task = { id: string; userId: string; type: TaskType; payload: TaskPayload };
const payloadSchema = z.object({ schemaVersion: z.literal(1), trigger: z.enum(["manual", "heartbeat"]) }).strict();
const metadataSchema = z.object({ schemaVersion: z.literal(1), sessions: z.array(z.object({ role: z.enum(["update_planner", "create_planner", "thread_proposal"]), agentId: z.string(), sessionId: z.string().uuid(), proposalId: z.string().uuid().optional() }).strict()) }).strict();

export class SqliteTaskRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async create(userId: string, type: TaskType, payload: TaskPayload): Promise<string> {
    const taskId = randomUUID();
    const now = nowIso();
    await this.db.insertInto("tasks").values({ task_id: taskId, user_id: userId, type, status: "queued", payload: JSON.stringify(payload), execution_metadata: JSON.stringify({ schemaVersion: 1, sessions: [] }), error_code: null, error_message: null, created_at: now, updated_at: now }).execute();
    return taskId;
  }

  async claim(taskId: string): Promise<Task | null> {
    return this.db.transaction().execute(async trx => {
      const row = await trx.selectFrom("tasks").selectAll().where("task_id", "=", taskId).where("status", "=", "queued").executeTakeFirst();
      if (!row) return null;
      const claimed = await trx.updateTable("tasks").set({ status: "running", updated_at: nowIso() }).where("task_id", "=", taskId).where("status", "=", "queued").executeTakeFirst();
      if (Number(claimed.numUpdatedRows) !== 1) return null;
      return { id: row.task_id, userId: row.user_id, type: row.type as TaskType, payload: payloadSchema.parse(JSON.parse(row.payload)) };
    });
  }

  async addSession(taskId: string, session: TaskSession) {
    const row = await this.db.selectFrom("tasks").select("execution_metadata").where("task_id", "=", taskId).executeTakeFirstOrThrow();
    const metadata = metadataSchema.parse(JSON.parse(row.execution_metadata));
    await this.db.updateTable("tasks").set({ execution_metadata: JSON.stringify({ schemaVersion: 1, sessions: [...metadata.sessions, session] }), updated_at: nowIso() }).where("task_id", "=", taskId).where("status", "=", "running").execute();
  }

  async complete(taskId: string) { await this.db.updateTable("tasks").set({ status: "completed", updated_at: nowIso() }).where("task_id", "=", taskId).where("status", "=", "running").execute(); }
  async fail(taskId: string, errorCode: string, errorMessage: string) { await this.db.updateTable("tasks").set({ status: "failed", error_code: errorCode, error_message: errorMessage, updated_at: nowIso() }).where("task_id", "=", taskId).where("status", "=", "running").execute(); }
}
