import { requestJson } from "./http";

export type CharacterPrompt = {
  character: string;
  scenario: string;
  instructions: string;
  exampleDialogues: string;
};

export function getCharacter(signal?: AbortSignal): Promise<CharacterPrompt> {
  return requestJson("/api/character", { signal });
}

export function saveCharacter(config: CharacterPrompt): Promise<CharacterPrompt> {
  return requestJson("/api/character", { method: "PUT", body: JSON.stringify(config) });
}
