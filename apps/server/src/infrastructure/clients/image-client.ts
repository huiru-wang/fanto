export interface ImageUnderstanding {
  describe(input: { imageUrl: string; signal?: AbortSignal }): Promise<{ description: string }>;
  review?(input: { imageUrl: string; referenceUrls?: string[]; brief: string; signal?: AbortSignal }): Promise<{ review: string }>;
}

const prompt = `你正在为个人记录中的一张图片生成简洁、客观的中文描述，供用户稍后回顾。

请用 1 到 3 句完整中文描述可见的主体、环境、动作或事件，以及清晰可读的文字（若有）。
只陈述画面直接可见的事实；不要猜测人物身份、姓名、关系、职业、地点、时间、动机、情绪或故事背景。不要评价美丑、质量、构图或摄影风格。不要使用标题、列表、Markdown、免责声明或“这张图片展示了”等套话。`;

export class QwenImageUnderstanding implements ImageUnderstanding {
  constructor(private apiKey: string, private baseUrl: string, private model = "qwen3-vl-flash") {}
  async review(input: { imageUrl: string; referenceUrls?: string[]; brief: string; signal?: AbortSignal }) {
    const instruction = `请以专业视觉编辑身份检查实际生成图片（第一张），若有后续图片则是用户提供的真实参考图，需要对比主体身份、人物数量和细节的一致性；无参考图时不可声称对比过原图。检查当前图片是否满足以下创作命题：${input.brief.slice(0, 2000)}。只根据这张图片能直接观察到的内容判断：主体、构图、光影、文字、身体结构是否有明显问题，以及不能仅凭此图核实的身份或历史事实。请用简洁中文给出：可见内容、明显缺陷、需要复核的部分、针对缺陷的修改建议。不预设图像优秀，不虚构参考图比较结果。`;
    const review = await this.analyze([input.imageUrl, ...(input.referenceUrls ?? [])], instruction, input.signal);
    return { review: review.slice(0, 2400) };
  }
  async describe(input: { imageUrl: string; signal?: AbortSignal }) {
    const description = await this.analyze([input.imageUrl], prompt, input.signal);
    return { description: description.slice(0, 1_000) };
  }
  private async analyze(imageUrls: string[], instruction: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", signal, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: [...imageUrls.map(url => ({ type: "image_url", image_url: { url } })), { type: "text", text: instruction }] }] }) });
    if (!response.ok) throw new Error(`image model failed: ${response.status}`);
    const body = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
    const choice = body.choices?.[0]; const description = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (choice?.finish_reason !== "stop" || !description) throw new Error("image model returned no complete description");
    return description;
  }
}
