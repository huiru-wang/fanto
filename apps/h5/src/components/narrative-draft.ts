export type DraftPart = { id: string; kind: "speech" | "narration"; text: string };
let nextId = 0;
export const draftPart = (kind: DraftPart["kind"] = "speech", text = ""): DraftPart => ({ id: `part-${nextId++}`, kind, text });

export function serializeDraft(parts: DraftPart[]): string {
  return parts.filter(part => part.text.trim()).map(part => part.kind === "narration"
    ? part.text.trim().split(/\r?\n/).map(line => `> ${line}`).join("\n")
    : part.text.trim()).join("\n\n");
}

export function parseDraft(text: string): DraftPart[] {
  const parts: DraftPart[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const narration = /^> ?/.test(line);
    const kind = narration ? "narration" : "speech";
    const value = narration ? line.replace(/^> ?/, "") : line;
    const last = parts.at(-1);
    if (!value && !narration) { if (last && last.text) parts.push(draftPart()); continue; }
    if (last?.kind === kind) last.text += (last.text ? "\n" : "") + value;
    else parts.push(draftPart(kind, value));
  }
  return parts.filter(part => part.text.trim()).length ? parts.filter(part => part.text.trim()) : [draftPart()];
}

export function restoreDraft(raw: string): DraftPart[] {
  try {
    const saved = JSON.parse(raw);
    if (saved?.version === 1 && Array.isArray(saved.parts) && saved.parts.length && saved.parts.every((part: DraftPart) =>
      part && (part.kind === "speech" || part.kind === "narration") && typeof part.text === "string")) {
      return saved.parts.map((part: DraftPart) => draftPart(part.kind, part.text));
    }
  } catch { /* Existing plain Markdown drafts remain compatible. */ }
  return parseDraft(raw);
}

// Preserve the text on either side of the selection when adding a description.
export function insertNarration(parts: DraftPart[], id: string, start: number, end: number): { parts: DraftPart[]; focusId: string } {
  const index = parts.findIndex(part => part.id === id);
  const part = parts[index];
  if (!part) return { parts, focusId: parts.at(-1)!.id };
  const action = draftPart("narration", part.text.slice(start, end));
  const suffix = draftPart(part.kind, part.text.slice(end));
  const prefix = { ...part, text: part.text.slice(0, start) };
  return { parts: [...parts.slice(0, index), ...(prefix.text ? [prefix] : []), action, ...(suffix.text ? [suffix] : []), ...parts.slice(index + 1)], focusId: action.id };
}

export function finishNarration(parts: DraftPart[], id: string, start: number, end: number): { parts: DraftPart[]; focusId: string } {
  const index = parts.findIndex(part => part.id === id), part = parts[index];
  if (!part) return { parts, focusId: parts.at(-1)!.id };
  const speech = draftPart("speech", part.text.slice(end));
  const following = parts[index + 1];
  // Reuse an existing empty language field rather than accumulating blank fields.
  const reuse = following?.kind === "speech" && !following.text && !speech.text;
  return { parts: [...parts.slice(0, index), { ...part, text: part.text.slice(0, start) }, ...(reuse ? [] : [speech]), ...parts.slice(index + 1)], focusId: reuse ? following.id : speech.id };
}
