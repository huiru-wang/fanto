import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { AgentHarnessTool, ExecutionToolContext } from "@earendil-works/pi-agent-core";

const optionSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 100 }),
  label: Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false });

const singleSelectQuestion = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 60, pattern: "^[a-zA-Z0-9_-]+$" }),
  type: Type.Literal("single_select"),
  label: Type.String({ minLength: 1, maxLength: 300 }),
  options: Type.Array(optionSchema, { minItems: 2, maxItems: 8 }),
  allowOther: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const multiSelectQuestion = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 60, pattern: "^[a-zA-Z0-9_-]+$" }),
  type: Type.Literal("multi_select"),
  label: Type.String({ minLength: 1, maxLength: 300 }),
  options: Type.Array(optionSchema, { minItems: 2, maxItems: 8 }),
  allowOther: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const textQuestion = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 60, pattern: "^[a-zA-Z0-9_-]+$" }),
  type: Type.Literal("text"),
  label: Type.String({ minLength: 1, maxLength: 300 }),
  placeholder: Type.Optional(Type.String({ maxLength: 200 })),
  multiline: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const schema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  questions: Type.Array(Type.Union([singleSelectQuestion, multiSelectQuestion, textQuestion]), { minItems: 1, maxItems: 4 }),
}, { additionalProperties: false });

export type UserInputOption = { value: string; label: string };
export type UserInputQuestion =
  | { id: string; type: "single_select"; label: string; options: UserInputOption[]; allowOther?: boolean }
  | { id: string; type: "multi_select"; label: string; options: UserInputOption[]; allowOther?: boolean }
  | { id: string; type: "text"; label: string; placeholder?: string; multiline?: boolean };

export type UserInputRequestDetails = {
  kind: "user_input_requested";
  interactionId: string;
  title: string;
  description?: string;
  questions: UserInputQuestion[];
};

export function sanitizeUserInputRequestDetails(value: unknown): UserInputRequestDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  if (root.kind !== "user_input_requested" || typeof root.interactionId !== "string" || typeof root.title !== "string" || !Array.isArray(root.questions)) return undefined;
  const questions: UserInputQuestion[] = [];
  for (const raw of root.questions) {
    if (!raw || typeof raw !== "object") return undefined;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.label !== "string") return undefined;
    if (item.type === "text") {
      questions.push({
        id: item.id,
        type: "text",
        label: item.label,
        ...(typeof item.placeholder === "string" ? { placeholder: item.placeholder } : {}),
        ...(typeof item.multiline === "boolean" ? { multiline: item.multiline } : {}),
      });
      continue;
    }
    if ((item.type !== "single_select" && item.type !== "multi_select") || !Array.isArray(item.options)) return undefined;
    const options = item.options.flatMap(rawOption => {
      if (!rawOption || typeof rawOption !== "object") return [];
      const option = rawOption as Record<string, unknown>;
      return typeof option.value === "string" && typeof option.label === "string"
        ? [{ value: option.value, label: option.label }]
        : [];
    });
    if (options.length !== item.options.length) return undefined;
    questions.push({
      id: item.id,
      type: item.type,
      label: item.label,
      options,
      ...(typeof item.allowOther === "boolean" ? { allowOther: item.allowOther } : {}),
    });
  }
  return {
    kind: "user_input_requested",
    interactionId: root.interactionId,
    title: root.title,
    ...(typeof root.description === "string" ? { description: root.description } : {}),
    questions,
  };
}

export function createCollectUserInputTool(): AgentHarnessTool<ExecutionToolContext, typeof schema, UserInputRequestDetails> {
  return {
    name: "collect_user_input",
    label: "向用户确认",
    description: [
      "只有缺失的是用户必须做出的选择，而且不同答案会明显改变最终结果时才使用。",
      "技术实现、文件路径、媒体放置、输出如何预览等问题不能询问用户；能从用户记录或已有上下文获得的信息应先自行获取。",
      "一次只收集真正必要的信息，最多 4 个问题。",
    ].join("\n"),
    parameters: schema,
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, params) {
      const details: UserInputRequestDetails = {
        kind: "user_input_requested",
        interactionId: randomUUID(),
        title: params.title.trim(),
        ...(params.description?.trim() ? { description: params.description.trim() } : {}),
        questions: params.questions as UserInputQuestion[],
      };
      return {
        content: [{ type: "text" as const, text: "已向用户请求必要信息，等待用户回答。" }],
        details,
      };
    },
  };
}
