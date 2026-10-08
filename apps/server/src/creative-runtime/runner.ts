import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import { runAgent, runAgentSkill } from "../agent/harness/run.js";
import type { AgentStreamEvent } from "../agent/harness/events.js";
import { CreativeService } from "./service.js";
import { logError } from "../infrastructure/logging/logger.js";

export type CreativeRunnerConfig = { workers: number; proposalTimeoutMs: number; creatorTimeoutMs: number };
type Listener = (event: AgentStreamEvent | { type: "done" } | { type: "error" }) => void;
type Job = { key: string; projectId?: string; execute: () => Promise<void> };

/** Process-local FIFO submissions. No background scanner or restart recovery. */
export class CreativeRunner {
  private readonly active = new Set<string>();
  private readonly queued = new Map<string, Job>();
  private readonly activeProjects = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private stopping = false;
  private readonly executions = new Set<Promise<void>>();
  constructor(readonly service: CreativeService, private readonly agent: AgentRuntime, private readonly config: CreativeRunnerConfig) {}

  async stop() {
    this.stopping = true;
    this.queued.clear();
    await Promise.allSettled([...this.executions]);
  }
  subscribe(projectId: string, listener: Listener) {
    let set = this.listeners.get(projectId);
    if (!set) { set = new Set(); this.listeners.set(projectId, set); }
    set.add(listener);
    return () => { set!.delete(listener); if (!set!.size) this.listeners.delete(projectId); };
  }
  private publish(id: string, event: Parameters<Listener>[0]) {
    for (const listener of this.listeners.get(id) ?? []) listener(event);
  }
  private enqueue(job: Job) {
    if (this.stopping) throw Error("CREATIVE_RUNNER_STOPPED");
    if (this.queued.has(job.key) || this.active.has(job.key)) return;
    this.queued.set(job.key, job);
    this.drain();
  }
  private drain() {
    while (!this.stopping && this.active.size < this.config.workers && this.queued.size) {
      const next = [...this.queued].find(([, item]) => !item.projectId || !this.activeProjects.has(item.projectId));
      if (!next) break;
      const [key, job] = next;
      this.queued.delete(key);
      this.active.add(key);
      if (job.projectId) this.activeProjects.add(job.projectId);
      const promise = Promise.resolve().then(job.execute)
        .catch(error => logError("creative-runner", "Agent execution failed", {key, error: error instanceof Error ? error.message : String(error)}))
        .finally(() => {
          this.active.delete(key);
          if (job.projectId) this.activeProjects.delete(job.projectId);
          this.executions.delete(promise);
          this.drain();
        });
      this.executions.add(promise);
    }
  }
  submitProposal(userId: string, recordId: string, version: number) {
    this.enqueue({ key: `record:${userId}:${recordId}:${version}`, execute: () => this.analyzeRecord(userId, recordId, version) });
  }
  private async analyzeRecord(userId: string, recordId: string, version: number) {
    const definition = this.agent.registry.get("proposal-agent");
    if (!definition) throw Error("PROPOSAL_AGENT_UNAVAILABLE");
    const session = await this.agent.sessions.create(definition, userId, {internal:true});
    const release = this.agent.sessions.reserve(session);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), this.config.proposalTimeoutMs);
    try {
      await runAgentSkill(session, "creative", "完整理解当前 Record；仅在确有创意价值时保存一份包含 1–2 个候选的 Proposal，否则回复 no_proposal。不要询问用户。", controller.signal,
        {creative: {role:"proposal", recordId, recordVersion:version}}, async () => {});
    } finally { clearTimeout(timeout); release(); await this.agent.sessions.release(session.id); }
  }
  async ensureSession(userId: string, projectId: string) {
    const project = await this.service.projects.find(userId, projectId);
    if (!project) throw Error("PROJECT_NOT_FOUND");
    if (project.sessionId) return project.sessionId;
    const definition = this.agent.registry.get("creator-agent");
    if (!definition) throw Error("CREATOR_AGENT_UNAVAILABLE");
    const session = await this.agent.sessions.create(definition, userId, {internal:true});
    try {
      const bound = await this.service.projects.bindSession(userId, projectId, session.id);
      if (!bound) throw Error("PROJECT_SESSION_UNAVAILABLE");
      return bound;
    } finally {
      // Release only if another concurrent accept already bound a different session.
      const current = await this.service.projects.find(userId, projectId);
      if (current?.sessionId !== session.id) await this.agent.sessions.release(session.id);
    }
  }
  async onAccepted(userId: string, projectId: string, proposalId: string) {
    const sessionId = await this.ensureSession(userId, projectId);
    this.enqueue({ key: `creation:${proposalId}`, projectId, execute: () => this.dispatch(userId, projectId, proposalId) });
    return sessionId;
  }
  /** Explicit user retry when acceptance committed but Session creation failed. */
  async startAcceptedProject(userId: string, projectId: string) {
    const project = await this.service.projects.find(userId, projectId);
    if (!project || project.status !== "active") throw Error("PROJECT_NOT_FOUND");
    if (project.sessionId) return project.sessionId;
    const proposal = await this.service.db.selectFrom("proposals")
      .select(["proposal_id", "content"]).where("user_id", "=", userId)
      .where("result_project_id", "=", projectId).where("status", "=", "accepted")
      .orderBy("resolved_at", "desc").orderBy("proposal_id", "desc").executeTakeFirst();
    const content = proposal?.content as { selectedIdeaId?: string } | undefined;
    if (!proposal || !content?.selectedIdeaId) throw Error("ACCEPTED_PROPOSAL_NOT_FOUND");
    return this.onAccepted(userId, projectId, proposal.proposal_id);
  }
  private async dispatch(userId: string, projectId: string, proposalId: string) {
    const project = await this.service.projects.find(userId, projectId);
    if (!project?.sessionId) throw Error("PROJECT_SESSION_UNAVAILABLE");
    const definition = this.agent.registry.get("creator-agent");
    if (!definition) throw Error("CREATOR_AGENT_UNAVAILABLE");
    const session = await this.agent.sessions.acquire(definition, project.sessionId, userId, {internal:true});
    const release = this.agent.sessions.reserve(session);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), this.config.creatorTimeoutMs);
    try {
      const previous = await session.session.findEntries({order:"desc",limit:2000},TODO_CONTEXT);
      if (previous.some(entry => entry.type === "custom" && entry.customType === "fanto.proposal_dispatched" &&
          (entry.data as {proposalId?:string})?.proposalId === proposalId)) return;
      // The accepted decision starts once; failures remain recoverable through this Project Session.
      await session.runtime.appendCustomEntry("fanto.proposal_dispatched", {proposalId});
      await runAgent(session, "请按当前已确认的方向继续完成作品。", controller.signal, {projectId},
        async event => this.publish(projectId, event));
      this.publish(projectId, {type:"done"});
    } catch (error) { this.publish(projectId, {type:"error"}); throw error; }
    finally {clearTimeout(timeout); release(); await this.agent.sessions.release(session.id);}
  }
  async send(userId: string, projectId: string, message: string, signal: AbortSignal, emit: (event:AgentStreamEvent)=>Promise<void>) {
    const project = await this.service.projects.find(userId, projectId);
    if (!project?.sessionId || project.status !== "active") throw Error("PROJECT_NOT_AUTHORIZED");
    const definition = this.agent.registry.get("creator-agent");
    if (!definition) throw Error("CREATOR_AGENT_UNAVAILABLE");
    const session = await this.agent.sessions.acquire(definition, project.sessionId, userId, {internal:true});
    const release = this.agent.sessions.reserve(session);
    try {
      await runAgent(session, message, signal, {projectId}, async event => {this.publish(projectId,event); await emit(event);});
      this.publish(projectId, {type:"done"});
    } catch (error) {this.publish(projectId, {type:"error"}); throw error;}
    finally {release(); await this.agent.sessions.release(session.id);}
  }
}
