import { z } from "zod";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import { runAgent, runAgentSkill } from "../agent/harness/run.js";
import type { RecordService } from "../domain/records/index.js";
import { logAgent, logError } from "../infrastructure/logging/logger.js";
import { CreativeError, type CreativeAuthority } from "./model.js";
import type { CreativeService } from "./service.js";
import type { WorkRole } from "./repository.js";

export type CreativeRunnerConfig = { intervalMs: number; workers: number; proposalTimeoutMs: number; creatorTimeoutMs: number };
const assessment = z.object({ decision: z.literal("no_proposal"), reason: z.string().trim().min(1).max(2000) }).strict();
export class CreativeRunner {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  private work = new Map<AbortController, Promise<void>>();
  constructor(private readonly service: CreativeService, private readonly records: RecordService, private readonly agent: AgentRuntime, private readonly config: CreativeRunnerConfig, private readonly run: typeof runAgent = runAgent, private readonly runSkill: typeof runAgentSkill = runAgentSkill) {}
  start() {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.config.intervalMs);
    this.timer.unref();
    void this.tick();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.work.keys()) controller.abort();
    await Promise.allSettled(this.work.values());
    // Let a tick that is already claiming work reach its stopped check.
    while (this.ticking) await new Promise(resolve => setTimeout(resolve, 10));
    await Promise.allSettled(this.work.values());
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.service.reconcileAccepted();
      for (const role of ["creator", "proposal"] as const) {
        for (let claimed = 0; claimed < this.config.workers && !this.stopped && this.work.size < this.config.workers; claimed++) {
          const row = await this.service.repository.claim(role);
          if (!row) break;
          const controller = new AbortController();
          if (this.stopped) controller.abort();
          const promise = this.execute(role, row, controller).catch(() => logError("creative-runner", "Execution persistence failed", { role, runId: row.run_id })).finally(() => this.work.delete(controller));
          this.work.set(controller, promise);
        }
      }
    } catch { logError("creative-runner", "Dispatch failed", { code: "CREATIVE_DISPATCH_FAILED" }); }
    finally { this.ticking = false; }
  }
  private async execute(role: WorkRole, row: NonNullable<Awaited<ReturnType<CreativeService["repository"]["claim"]>>>, controller: AbortController) {
    const repo = this.service.repository, token = row.lease_token!;
    let session: Awaited<ReturnType<AgentRuntime["sessions"]["create"]>> | undefined;
    let reservation: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const current = () => role === "proposal" ? repo.analysis(row.user_id, row.run_id) : repo.creation(row.user_id, row.run_id);
    let code = role === "proposal" ? "PROPOSAL_NOT_CREATED" : "CREATION_NOT_PUBLISHED";
    let lifecycle: Record<string, unknown> | undefined;
    let startedAt = 0;
    try {
      try {
        controller.signal.throwIfAborted();
        if (role === "proposal" && "record_id" in row) {
          const record = await this.records.find(row.user_id, row.record_id);
          if (!record || record.version !== row.record_version) { await repo.finish(role, row.run_id, token, "cancelled", "SOURCE_RECORD_CHANGED"); return; }
          if (record.status !== "processed") {
            await this.records.ensurePostprocess(row.user_id, row.record_id, row.record_version);
            await repo.finish(role, row.run_id, token, "queued", "WAITING_FOR_RECORD");
            return;
          }
        }
        const creation = role === "creator" ? await this.service.validateCreation(row.user_id, row.run_id) : undefined;
        const definition = this.agent.registry.get(role === "proposal" ? "proposal-agent" : "creator-agent");
        if (!definition) throw new CreativeError("CREATIVE_AGENT_UNAVAILABLE");
        session = await this.agent.sessions.create(definition, row.user_id, { internal: true });
        reservation = this.agent.sessions.reserve(session);
        if (!await repo.bind(role, row.run_id, token, session.id, creation?.project.version)) throw new CreativeError("CREATIVE_LEASE_LOST");
        lifecycle = { agent: definition.id, runId: row.run_id, userId: row.user_id, sessionId: session.id, attempt: row.attempts, ...(creation ? { proposalId: creation.run.proposal_id, projectId: creation.run.project_id, recordIds: creation.referenceRecordIds } : { recordId: row.record_id, recordVersion: row.record_version }) };
        startedAt = Date.now();
        logAgent("info", "creative-runner", "Agent started", lifecycle);
        const creative: CreativeAuthority = role === "proposal" ? { role, analysisRunId: row.run_id, leaseToken: token } : { role, creationRunId: row.run_id, leaseToken: token };
        heartbeat = setInterval(() => void repo.renew(role, row.run_id, token).then(ok => { if (!ok) controller.abort(); }).catch(() => controller.abort()), 20_000);
        timeout = setTimeout(() => { code = "CREATIVE_TIMEOUT"; controller.abort(); }, role === "proposal" ? this.config.proposalTimeoutMs : this.config.creatorTimeoutMs);
        if (role === "creator") await this.service.recoverImages({ userId: row.user_id, sessionId: session.id, creative, signal: controller.signal });
        const output = role === "proposal"
          ? await this.runSkill(session, "creative", "分析当前触发 Record；有明确创作价值时创建 Proposal，否则返回 no_proposal。全程静默，不向用户提问。", controller.signal, { creative }, async () => {})
          : await this.run(session, "执行用户已经接受的创作提议。读取授权记录和目标项目，根据确认目标选择匹配的创作 Skill，复用已保存图片，完成成果并调用 creation_publish。", controller.signal, { creative }, async () => {});
        if ((await current())?.status === "completed") return;
        if (role === "proposal") {
          const result = assessment.safeParse(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
          if (result.success) { await repo.finish(role, row.run_id, token, "completed", undefined, result.data); return; }
        }
        if (role === "creator") {
          const steps = await repo.steps(row.run_id);
          if (steps.some(s => ["requested", "unknown"].includes(s.status))) code = "IMAGE_RESULT_UNKNOWN";
          else if (steps.some(s => s.status === "failed")) code = steps.find(s => s.status === "failed")!.error_code ?? "IMAGE_GENERATION_FAILED";
        }
      } catch (error) {
        if ((await current())?.status === "completed") return;
        if (error instanceof CreativeError) code = error.code;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
        reservation?.();
        if (session) await this.agent.sessions.release(session.id).catch(() => {});
      }
      const terminal = ["IMAGE_RESULT_UNKNOWN", "IMAGE_GENERATION_FAILED", "IMAGE_GENERATION_REJECTED", "IMAGE_GENERATION_INVALID_RESPONSE", "IMAGE_RECOVERY_UNAVAILABLE", "SOURCE_MEDIA_UNAVAILABLE", "PROJECT_ARCHIVED", "CREATION_NOT_AUTHORIZED", "SOURCE_RECORD_CHANGED"].includes(code);
      await repo.finish(role, row.run_id, token, this.stopped || (!terminal && row.attempts < 3) ? "queued" : "failed", code);
      logError("creative-runner", "Attempt ended without publication", { role, runId: row.run_id, code });
    } finally {
      if (lifecycle) {
        const result = await current();
        logAgent(result?.status === "completed" ? "info" : "warn", "creative-runner", "Agent ended", {
          ...lifecycle, durationMs: Date.now() - startedAt, status: result?.status ?? "missing",
          ...(result && "proposal_id" in result ? { proposalId: result.proposal_id } : {}),
          decision: result && "outcome" in result ? (result.outcome as { decision?: string } | null)?.decision : undefined, errorCode: result?.error_code,
        });
      }
    }
  }
}
