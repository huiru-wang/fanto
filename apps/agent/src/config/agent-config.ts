import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { Models } from "@earendil-works/pi-ai";

const tool = z.enum(["read", "write", "edit", "bash"]);
const compaction = z.object({
  enabled: z.boolean(),
  reserveTokens: z.number().int().nonnegative(),
  keepRecentTokens: z.number().int().nonnegative(),
}).strict();
const partialDefinition = z.object({
  description: z.string().max(500).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  tools: z.array(tool).optional(),
  skills: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).optional(),
  compaction: compaction.partial().optional(),
}).strict();
const configuredAgent = partialDefinition.extend({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
}).strict();
const documentSchema = z.object({
  version: z.literal(1),
  defaults: partialDefinition.default({}),
  agents: z.array(configuredAgent).min(1, "agents must not be empty"),
}).strict();
const definitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  description: z.string().max(500),
  provider: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  tools: z.array(tool),
  skills: z.array(z.string()),
  compaction,
}).strict();

export type AgentDefinition = z.infer<typeof definitionSchema> & { revision: string };

export function readAgentDefinitions(path: string, models: Models, knownSkills: ReadonlySet<string>): AgentDefinition[] {
  const parsed = parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (parsed.errors.length > 0) throw new Error(`Invalid agents.yaml: ${parsed.errors.map(error => error.message).join("; ")}`);
  const document = documentSchema.safeParse(parsed.toJS());
  if (!document.success) throw new Error(`Invalid agents.yaml: ${document.error.message}`);

  const ids = new Set<string>();
  for (const agent of document.data.agents) {
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id "${agent.id}"`);
    ids.add(agent.id);
  }

  return document.data.agents.map(configured => {
    const { id, ...overrides } = configured;
    const merged = {
      ...document.data.defaults,
      ...overrides,
      id,
      description: overrides.description ?? document.data.defaults.description ?? "",
      tools: overrides.tools ?? document.data.defaults.tools ?? [],
      skills: overrides.skills ?? document.data.defaults.skills ?? [],
      compaction: { ...document.data.defaults.compaction, ...overrides.compaction },
    };
    const definition = definitionSchema.safeParse(merged);
    if (!definition.success) throw new Error(`Invalid agents.yaml agent "${id}": ${definition.error.message}`);
    if (new Set(definition.data.tools).size !== definition.data.tools.length) throw new Error(`Agent "${id}" has duplicate tools`);
    if (new Set(definition.data.skills).size !== definition.data.skills.length) throw new Error(`Agent "${id}" has duplicate skills`);
    for (const skill of definition.data.skills) {
      if (!knownSkills.has(skill)) throw new Error(`Agent "${id}" references unknown skill "${skill}"`);
    }
    const model = models.getModel(definition.data.provider, definition.data.model);
    if (!model) throw new Error(`Agent "${id}" uses unknown model "${definition.data.provider}/${definition.data.model}"`);
    if (model.contextWindow > 0 && definition.data.compaction.reserveTokens + definition.data.compaction.keepRecentTokens >= model.contextWindow) {
      throw new Error(`Agent "${id}" compaction token budget exceeds its model context window`);
    }
    return { ...definition.data, revision: createHash("sha256").update(JSON.stringify(definition.data)).digest("hex") };
  });
}
