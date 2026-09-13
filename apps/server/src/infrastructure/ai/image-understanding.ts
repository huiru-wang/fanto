export interface ImageUnderstanding { describe(input: { imageUrl: string; signal?: AbortSignal }): Promise<{ description: string }>; }

const prompt = `你正在为个人记录中的一张图片生成简洁、客观的中文描述，供用户稍后回顾。

请用 1 到 3 句完整中文描述可见的主体、环境、动作或事件，以及清晰可读的文字（若有）。
只陈述画面直接可见的事实；不要猜测人物身份、姓名、关系、职业、地点、时间、动机、情绪或故事背景。不要评价美丑、质量、构图或摄影风格。不要使用标题、列表、Markdown、免责声明或“这张图片展示了”等套话。`;

export class QwenImageUnderstanding implements ImageUnderstanding {
  constructor(private apiKey: string, private baseUrl: string) {}
  async describe(input: { imageUrl: string; signal?: AbortSignal }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", signal: input.signal, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen3-vl-flash", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: input.imageUrl } }, { type: "text", text: prompt }] }] }) });
    if (!response.ok) throw new Error(`image model failed: ${response.status}`);
    const body = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
    const choice = body.choices?.[0]; const description = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (choice?.finish_reason !== "stop" || !description) throw new Error("image model returned no complete description");
    return { description: description.slice(0, 1_000) };
  }
}
