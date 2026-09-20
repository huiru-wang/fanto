import type { ContextFragment } from "./types.js";

const placeholders: Record<string, string> = {
  Character: "{{character}}",
  "User Preferences": "{{user_preferences}}",
  "Relevant Memory": "{{relevant_memory}}",
};

export function composePrompt(template: string, fragments: ContextFragment[]): string {
  return fragments.reduce((prompt, fragment) => {
    const placeholder = placeholders[fragment.section];
    return placeholder ? prompt.replace(placeholder, fragment.content) : prompt;
  }, template);
}
