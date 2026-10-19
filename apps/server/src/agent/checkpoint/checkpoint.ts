import type { AgentHarness, Entry, UsageRow } from "@earendil-works/pi-agent-core";
import type { CheckpointItem, CheckpointRepository } from "./postgres-repository.js";

/** Collects only committed Pi Session events; never changes the Pi Agent loop. */
export class SessionCheckpoint {
  private pending: CheckpointItem[] = [];
  private activeRunId: string | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private readonly unsubscribe: Array<() => void>;

  constructor(
    private readonly sessionId: string,
    private readonly repository: CheckpointRepository,
    harness: AgentHarness<any>,
  ) {
    this.unsubscribe = [
      harness.events.on("entry_added", ({ entry }) => this.collect({ kind: "entry", entry, runId: this.activeRunId })),
      harness.events.on("usage", ({ row }) => this.collect({ kind: "usage", row, runId: this.activeRunId })),
      harness.events.on("turn_end", async () => { await this.checkpoint(); }),
      harness.events.on("run_end", async () => { await this.checkpoint(); }),
    ];
  }

  beginRun(runId: string): void {
    if (this.activeRunId) throw new Error("Session checkpoint already has an active Run");
    this.activeRunId = runId;
  }

  endRun(): void { this.activeRunId = null; }

  private collect(item: CheckpointItem): void {
    this.pending.push(item);
  }

  /** Listener failures are isolated by Pi EventBus; capture them for the outer caller. */
  private async checkpoint(): Promise<void> {
    try { await this.flush(); }
    catch (error) { this.failure = error; }
  }

  async flush(): Promise<void> {
    const write = this.writeTail.then(async () => {
      if (!this.pending.length) { if (this.failure) throw this.failure; return; }
      const items = this.pending.slice();
      await this.repository.persist(this.sessionId, items);
      this.pending.splice(0, items.length);
      this.failure = undefined;
    });
    this.writeTail = write.catch(() => {});
    return write;
  }

  async close(): Promise<void> {
    await this.flush();
    for (const stop of this.unsubscribe) stop();
  }

  /** Live history may include already committed Pi Entries awaiting a PG checkpoint. */
  unpersistedEntries(): Entry[] {
    return this.pending.flatMap(item => item.kind === "entry" ? [item.entry] : []);
  }

  get hasPending(): boolean { return this.pending.length > 0 || !!this.failure; }
}
