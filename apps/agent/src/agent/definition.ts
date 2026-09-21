import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { Models } from "@earendil-works/pi-ai";

const tool = z.enum(["read", "write", "edit", "bash", "record_get", "record_list", "record_search", "present_media", "preference_manage"]);
const compaction = z.object({
  enabled: z.boolean(),
  reserveTokens: z.number().int().nonnegative(),
  keepRecentTokens: z.number().int().nonnegative(),
}).strict();
const partialDefinition = z.object({
  description: z.string().max(500).optional(),
  model_id: z.string().min(3).optional(),
  systemPrompt: z.string().min(1).optional(),
  systemPromptFile: z.string().min(1).optional(),
  corePromptFile: z.string().min(1).optional(),
  tools: z.array(tool).optional(),
  skills: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).optional(),
  compaction: compaction.partial().optional(),
}).strict();
const configuredAgent = partialDefinition.extend({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
}).strict();
const configuredModel = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
}).strict();
const documentSchema = z.object({
  version: z.literal(1),
  models: z.array(configuredModel).min(1, "models must not be empty"),
  agents: z.array(configuredAgent).min(1, "agents must not be empty"),
}).strict();
const definitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  description: z.string().max(500),
  modelId: z.string().min(3),
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
    throw new Error(`Invalid agents.yaml agent "${agentId}": prompt file must be relative to agents.yaml`);
  }
  const root = dirname(resolve(configPath));
  const promptPath = resolve(root, promptFile);
  const pathFromRoot = relative(root, promptPath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Invalid agents.yaml agent "${agentId}": prompt file must stay inside the config directory`);
  }
  let prompt: string;
  try {
    prompt = readFileSync(promptPath, "utf8").trim();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid agents.yaml agent "${agentId}": cannot read prompt file "${promptFile}": ${message}`);
  }
  if (!prompt) throw new Error(`Invalid agents.yaml agent "${agentId}": prompt file must not be empty`);
  return prompt;
}

export function readAgentDefinitions(
  path: string,
  models: Models,
  knownSkills: ReadonlySet<string>,
): AgentDefinition[] {
  const parsed = parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (parsed.errors.length > 0) throw new Error(`Invalid agents.yaml: ${parsed.errors.map(error => error.message).join("; ")}`);
  const document = documentSchema.safeParse(parsed.toJS());
  if (!document.success) throw new Error(`Invalid agents.yaml: ${document.error.message}`);
  const ids = new Set<string>();
  for (const agent of document.data.agents) {
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id "${agent.id}"`);
    ids.add(agent.id);
    assertPromptSource(agent, `agent "${agent.id}"`);
  }
  const configuredModels = new Map<string, { provider: string; model: string }>();
  for (const configured of document.data.models) {
    const modelId = `${configured.provider}/${configured.model}`;
    if (configuredModels.has(modelId)) throw new Error(`Duplicate model id "${modelId}"`);
    if (!models.getModel(configured.provider, configured.model)) {
      throw new Error(`Model "${modelId}" is not in the Pi model catalog`);
    }
    configuredModels.set(modelId, configured);
  }

  return document.data.agents.map(configured => {
    const { id, model_id, systemPrompt, systemPromptFile, corePromptFile, ...overrides } = configured;
    if (!model_id) throw new Error(`Invalid agents.yaml agent "${id}": model_id is required`);
    const configuredModel = configuredModels.get(model_id);
    if (!configuredModel) throw new Error(`Agent "${id}" references unknown model_id "${model_id}"`);
    const resolvedPrompt = systemPrompt ?? (systemPromptFile ? readPromptFile(path, systemPromptFile, id) : undefined);
    const corePrompt = corePromptFile
      ? readPromptFile(path, corePromptFile, id)
      : undefined;
    const merged = {
      ...overrides,
      id,
      modelId: model_id,
      provider: configuredModel.provider,
      model: configuredModel.model,
      description: overrides.description ?? "",
      systemPrompt: [corePrompt, resolvedPrompt].filter((prompt): prompt is string => Boolean(prompt)).join("\n\n"),
      tools: overrides.tools ?? [],
      skills: overrides.skills ?? [],
      compaction: overrides.compaction,
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
