export async function describeImage(url: string, apiKey: string, baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen3-vl-flash", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }, { type: "text", text: "请只用客观中文描述可见主体、场景、文字和活动；不要推断身份、关系、地点、心理状态或意图。" }] }] }) });
  if (!response.ok) throw new Error(`image model failed: ${response.status}`);
  const body = await response.json() as any;
  const description = body.choices?.[0]?.message?.content;
  if (typeof description !== "string" || !description.trim()) throw new Error("image model returned no description");
  return description.trim();
}

export async function transcribeAudio(url: string, apiKey: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen3-asr-flash", stream: true, messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: url } }] }], asr_options: { enable_itn: false } }) });
  if (!response.ok || !response.body) throw new Error(`audio model failed: ${response.status}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = ""; let done = false; let stopped = false; let language: string | null = null; let emotion: string | null = null; let buffer = "";
  while (!done) { const chunk = await reader.read(); done = chunk.done; buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.startsWith("data: ")) continue; const payload = line.slice(6).trim(); if (payload === "[DONE]") { done = true; break; } const data = JSON.parse(payload); const choice = data.choices?.[0]; if (typeof choice?.delta?.content === "string") text += choice.delta.content; if (choice?.finish_reason === "stop") stopped = true; for (const annotation of choice?.delta?.annotations ?? []) if (annotation.type === "audio_info") { language = annotation.language ?? language; emotion = annotation.emotion ?? emotion; } } }
  if (!stopped || !text.trim()) throw new Error("audio stream was incomplete");
  return { transcript: text.trim(), language, emotion };
}
