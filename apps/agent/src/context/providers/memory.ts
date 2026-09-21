import type { FantoRecordSearch, FantoServerClient } from "../../clients/fanto-server-client.js";
import type { QueryRewriter } from "../query-rewriter.js";
import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

type MemoryClient = Pick<FantoServerClient, "searchRecords">;
type SearchHit = FantoRecordSearch["data"][number];

export class MemoryProvider implements ContextProvider {
  readonly name = "memory";

  constructor(private readonly client: MemoryClient, private readonly rewriter: QueryRewriter) {}

  async build(input: ContextInput): Promise<ContextFragment> {
    const queries = await this.rewriter.rewrite(input);
    if (queries.length === 0) return { section: "Relevant Memory", content: "" };
    const searches = await Promise.all(queries.map(query => this.client.searchRecords(
      { userId: input.userId, traceId: input.traceId, signal: input.signal },
      { query, limit: 4 },
    )));
    const records = dedupeRecords(searches.flatMap(result => result.data)).slice(0, 2);
    const content = records.map((record, index) => `记录 ${index + 1}：
recordId：${record.recordId}
- 记录：${record.snippet}
- 时间：${record.eventAt}`).join("\n\n");
    return { section: "Relevant Memory", content };
  }
}

export function dedupeRecords(hits: SearchHit[]): SearchHit[] {
  const byRecord = new Map<string, SearchHit>();
  for (const hit of hits) {
    const current = byRecord.get(hit.recordId);
    if (!current || hit.distance < current.distance) byRecord.set(hit.recordId, hit);
  }
  return [...byRecord.values()].sort((a, b) => a.distance - b.distance);
}
