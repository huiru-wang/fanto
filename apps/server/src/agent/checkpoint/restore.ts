import { TODO_CONTEXT, insertEntry, insertUsage, type Session, type Entry } from "@earendil-works/pi-agent-core";
import type { CheckpointRepository } from "./postgres-repository.js";

/** Restore complete durable transcript through the public Pi Session API. Pi owns compaction. */
export async function restoreCheckpoint(session: Session, id: string, repository: CheckpointRepository): Promise<void> {
  const metadata = await repository.getSession(id);
  if (!metadata) throw new Error("Checkpoint session does not exist");
  const entries = sanitizeInterruptedToolCalls(await repository.loadEntries(id));
  const usage = await repository.loadUsage(id);
  // The underlying MemorySessionRepo assigns its own seq; stable Entry/Usage IDs remain unchanged.
  if (entries.length || usage.length) {
    await session.mutate(async writer => {
      await writer.commit([
        ...entries.map(entry => insertEntry(entry)),
        ...usage.map(row => insertUsage(row)),
      ], TODO_CONTEXT);
    }, TODO_CONTEXT);
  }
  const tip = metadata.tipId;
  if (tip !== null && !entries.some(entry => entry.id === tip)) throw new Error("Session checkpoint tip is missing");
  await session.createBranch("main", tip, TODO_CONTEXT);
}

/** Preserve the previous crash-recovery safeguard without altering any persisted parent links. */
function sanitizeInterruptedToolCalls(source: Entry[]): Entry[] {
  const completed = new Set(source.flatMap(entry =>
    entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : []));
  const calls = new Set(source.flatMap(entry => entry.type === "message" && entry.message.role === "assistant"
    ? entry.message.content.flatMap(block => block.type === "toolCall" ? [block.id] : []) : []));
  return source.map(entry => {
    if (entry.type !== "message") return entry;
    if (entry.message.role === "toolResult" && !calls.has(entry.message.toolCallId)) {
      return { type: "custom", id: entry.id, parentId: entry.parentId, seq: entry.seq, timestamp: entry.timestamp,
        customType: "fanto.ignored_tool_result", data: {} };
    }
    if (entry.message.role !== "assistant") return entry;
    const content = entry.message.content.filter(block => block.type !== "toolCall" || completed.has(block.id));
    return content.length === entry.message.content.length ? entry : { ...entry, message: {
      ...entry.message, content, stopReason: "aborted" as const,
    } };
  });
}
