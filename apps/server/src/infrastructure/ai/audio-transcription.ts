export type AudioTranscription = { transcript: string };

export async function transcribeAudio(input: { audioUrl: string; apiKey: string; baseUrl: string; signal?: AbortSignal; onDelta: (text: string) => Promise<void> }) {
  const response = await fetch(`${input.baseUrl}/chat/completions`, { method: "POST", signal: input.signal, headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen3-asr-flash", stream: true, messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: input.audioUrl } }] }], asr_options: { enable_itn: false } }) });
  if (!response.ok || !response.body) throw new Error(`audio model failed: ${response.status}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let transcript = ""; let buffer = ""; let stopped = false; let done = false;
  while (!done) { const chunk = await reader.read(); done = chunk.done; buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.startsWith("data: ")) continue; const payload = line.slice(6).trim(); if (payload === "[DONE]") { done = true; break; } const data = JSON.parse(payload); const choice = data.choices?.[0]; if (typeof choice?.delta?.content === "string") { transcript += choice.delta.content; await input.onDelta(choice.delta.content); } if (choice?.finish_reason === "stop") stopped = true; } }
  if (!stopped) throw new Error("audio stream was incomplete");
  return { transcript: transcript.trim() } satisfies AudioTranscription;
}
