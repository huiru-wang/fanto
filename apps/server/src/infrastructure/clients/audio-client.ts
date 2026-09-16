export type AudioTranscription = { transcript: string; model: string; emotion?: string; language?: string };
export interface AudioTranscriptionClient { transcribe(input: { audioUrl: string; signal?: AbortSignal }): Promise<AudioTranscription>; }

export class QwenAudioTranscription implements AudioTranscriptionClient {
  constructor(private apiKey: string, private baseUrl: string, private model = "qwen3-asr-flash") {}
  async transcribe(input: { audioUrl: string; signal?: AbortSignal }) {
    const endpoint = `${this.baseUrl.replace(/\/compatible-mode\/v1\/?$/, "").replace(/\/$/, "")}/api/v1/services/aigc/multimodal-generation/generation`;
    const response = await fetch(endpoint, { method: "POST", signal: input.signal, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, input: { messages: [{ role: "user", content: [{ audio: input.audioUrl }] }] }, parameters: { asr_options: { enable_itn: false } } }) });
    if (!response.ok) {
      const details = (await response.text()).replace(/https?:\/\/[^"\s]+/g, "<redacted-url>").slice(0, 1_000);
      throw new Error(`audio model failed: ${response.status}${details ? `: ${details}` : ""}`);
    }
    const body = await response.json() as { output?: { choices?: Array<{ finish_reason?: string; message?: { content?: Array<{ text?: unknown }>; annotations?: Array<{ type?: unknown; emotion?: unknown; language?: unknown }> } }> } };
    const choice = body.output?.choices?.[0]; const transcript = choice?.message?.content?.flatMap(item => typeof item.text === "string" ? [item.text] : []).join("\n").trim() ?? "";
    if (choice?.finish_reason !== "stop" || !transcript) throw new Error("audio model returned no complete transcription");
    const info = choice.message?.annotations?.find(annotation => annotation.type === "audio_info");
    return { transcript: transcript.slice(0, 20_000), model: this.model, emotion: typeof info?.emotion === "string" ? info.emotion : undefined, language: typeof info?.language === "string" ? info.language : undefined } satisfies AudioTranscription;
  }
}
