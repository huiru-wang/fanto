import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentHarness, createReadTool, createWriteTool, type HarnessTool, uuidv7 } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Model, Models } from "@earendil-works/pi-ai";
import type { SqliteSessionRepository } from "@earendil-works/pi-session-backend-sqlite-node";
import { Type } from "typebox";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { specialistResultSchema, type Record, type SpecialistResult } from "./schemas.js";

type Kind = "research" | "code" | "image";
type Request = { kind: Kind; brief: string; sourceRecordIds: string[] };
type Context = { env: NodeExecutionEnv; records: Record[] };

const recordsTool = (): AgentHarnessTool<Context, ReturnType<typeof Type.Object>> => ({
  name: "get_records", label: "get_records", description: "Read only the supplied source records.",
  parameters: Type.Object({ recordIds: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) }),
  execute: async (_id, args, _signal, _update, context) => ({ content: [{ type: "text", text: JSON.stringify(context.records.filter(record => (args as { recordIds: string[] }).recordIds.includes(record.id))) }], details: undefined }),
}) as AgentHarnessTool<Context, ReturnType<typeof Type.Object>>;

const unavailableImageTool = (): AgentHarnessTool<Context, ReturnType<typeof Type.Object>> => ({
  name: "generate_image", label: "generate_image", description: "Image generation is not configured for this experiment.",
  parameters: Type.Object({ prompt: Type.String({ minLength: 1 }) }),
  execute: async () => ({ content: [{ type: "text", text: JSON.stringify({ status: "capability_unavailable" }) }], details: undefined }),
}) as AgentHarnessTool<Context, ReturnType<typeof Type.Object>>;

const text = (message: { content: Array<{ type: string; text?: string }> }) => message.content.filter(item => item.type === "text").map(item => item.text ?? "").join("");
const parse = (raw: string): SpecialistResult => specialistResultSchema.parse(JSON.parse(raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "")));

export class SpecialistRunner {
  constructor(private repository: SqliteSessionRepository, private models: Models, private model: Model<any>, private runDir: string) {}

  async run(request: Request, records: Record[]): Promise<{ id: string; result: SpecialistResult }> {
    const id = uuidv7(); const root = resolve(this.runDir, "delegations", id); const workspace = resolve(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const session = await this.repository.create({ id, cwd: workspace, metadata: { role: request.kind } });
    const env = new NodeExecutionEnv({ cwd: workspace, shellEnv: {} });
    const tools = request.kind === "research" ? [recordsTool()] : request.kind === "code" ? [createReadTool<Context>(), createWriteTool<Context>()] : [unavailableImageTool()];
    const systemPrompt = request.kind === "research"
      ? "You are a research specialist. Inspect only supplied records. Return JSON: status, summary, sourceRecordIds, artifactPaths, limitations."
      : request.kind === "code"
        ? `You are a coding specialist. Create one static HTML artifact only inside ${workspace}. Return JSON: status, summary, sourceRecordIds, artifactPaths, limitations.`
        : "You are an image specialist. Call generate_image once if useful. Return JSON: status, summary, sourceRecordIds, artifactPaths, limitations.";
    const { harness } = await AgentHarness.create({ session, models: this.models, model: this.model, systemPrompt, tools: tools as unknown as HarnessTool[], activeToolNames: tools.map(tool => tool.name), toolContext: { env, records }, toolExecution: "sequential" });
    let result: SpecialistResult;
    try {
      const outcome = await harness.prompt(`Brief: ${request.brief}\nSource record ids: ${JSON.stringify(request.sourceRecordIds)}\nReturn JSON only.`);
      if (!outcome.ok) throw new Error(outcome.error.message);
      if (outcome.value.kind !== "completed") throw new Error(outcome.value.kind === "failed" ? outcome.value.error.message : "child did not complete");
      result = parse(text(outcome.value.finalMessage));
      if (request.kind === "image" && !result.artifactPaths.length) result = { ...result, status: "unavailable", limitations: [...result.limitations, "No image provider is configured"] };
    } catch (cause) {
      result = { status: request.kind === "image" ? "unavailable" : "failed", summary: cause instanceof Error ? cause.message : "specialist failed", sourceRecordIds: request.sourceRecordIds, artifactPaths: [], limitations: ["No valid specialist result"] };
    }
    const entries = await harness.session.findEntries({ order: "oldestFirst", limit: 500 });
    await writeFile(resolve(root, "request.json"), JSON.stringify(request, null, 2));
    await writeFile(resolve(root, "child-entries.json"), JSON.stringify(entries, null, 2));
    await writeFile(resolve(root, "result.json"), JSON.stringify(result, null, 2));
    await harness.close();
    return { id, result };
  }
}
