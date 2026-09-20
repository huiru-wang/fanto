import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { Models } from "@earendil-works/pi-ai";

const tool = z.enum(["read", "write", "edit", "bash", "record_get", "record_list", "record_search", "present_media"]);
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
  systemPromptFile: z.string().min(1).optional(),
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

function assertPromptSource(
  value: { systemPrompt?: string; systemPromptFile?: string },
  label: string,
): void {
  if (value.systemPrompt && value.systemPromptFile) {
    throw new Error(`Invalid agents.yaml ${label}: systemPrompt and systemPromptFile are mutually exclusive`);
  }
}

function readPromptFile(configPath: string, promptFile: string, agentId: string): string {
  if (isAbsolute(promptFile)) {
    throw new Error(`Invalid agents.yaml agent "${agentId}": systemPromptFile must be relative to agents.yaml`);
  }
  const root = dirname(resolve(configPath));
  const promptPath = resolve(root, promptFile);
  const pathFromRoot = relative(root, promptPath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Invalid agents.yaml agent "${agentId}": systemPromptFile must stay inside the config directory`);
  }
  let prompt: string;
  try {
    prompt = readFileSync(promptPath, "utf8").trim();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid agents.yaml agent "${agentId}": cannot read systemPromptFile "${promptFile}": ${message}`);
  }
  if (!prompt) throw new Error(`Invalid agents.yaml agent "${agentId}": systemPromptFile must not be empty`);
  return prompt;
}

export function readAgentDefinitions(
  path: string,
  models: Models,
  knownSkills: ReadonlySet<string>,
  modelDefaults: { provider?: string; model?: string } = {},
): AgentDefinition[] {
  const parsed = parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (parsed.errors.length > 0) throw new Error(`Invalid agents.yaml: ${parsed.errors.map(error => error.message).join("; ")}`);
  const document = documentSchema.safeParse(parsed.toJS());
  if (!document.success) throw new Error(`Invalid agents.yaml: ${document.error.message}`);
  assertPromptSource(document.data.defaults, "defaults");

  const ids = new Set<string>();
  for (const agent of document.data.agents) {
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id "${agent.id}"`);
    ids.add(agent.id);
    assertPromptSource(agent, `agent "${agent.id}"`);
  }

  return document.data.agents.map(configured => {
    const { id, systemPrompt, systemPromptFile, ...overrides } = configured;
    const defaultPrompt = document.data.defaults.systemPrompt;
    const defaultPromptFile = document.data.defaults.systemPromptFile;
    const resolvedPrompt = systemPrompt
      ?? (systemPromptFile ? readPromptFile(path, systemPromptFile, id) : undefined)
      ?? defaultPrompt
      ?? (defaultPromptFile ? readPromptFile(path, defaultPromptFile, id) : undefined);
    const { systemPrompt: _defaultPrompt, systemPromptFile: _defaultPromptFile, ...yamlDefaults } = document.data.defaults;
    const defaults = { ...yamlDefaults, ...modelDefaults };
    const merged = {
      ...defaults,
      ...overrides,
      id,
      description: overrides.description ?? document.data.defaults.description ?? "",
      systemPrompt: resolvedPrompt,
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
