import type { ContextFragment } from "./types.js";

const slots = {
  Character: "{{character}}",
  "Current Time": "{{current_time}}",
  "User Preferences": "{{user_preferences}}",
  "Relevant Memory": "{{relevant_memory}}",
} as const;

export function hasContextSlots(template: string): boolean {
  return Object.values(slots).some(slot => template.includes(slot));
}

export function composePrompt(template: string, fragments: ContextFragment[]): string {
  const values = new Map(fragments.map(fragment => [fragment.section, fragment.content]));
  let prompt = template;
  for (const [section, slot] of Object.entries(slots) as Array<[keyof typeof slots, string]>) {
    prompt = prompt.replaceAll(slot, values.get(section)?.trim() || "（无）");
  }
  return prompt;
}
