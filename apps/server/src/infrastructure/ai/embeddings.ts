export class EmbeddingsClient {
  constructor(private apiKey: string, private baseUrl: string, private model: string, private dimension: number) {}

  async embed(input: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, input }) });
    if (!response.ok) throw new Error(`embedding model failed: ${response.status}`);
    const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const embedding = body.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== this.dimension || embedding.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("embedding model returned an invalid vector");
    return embedding;
  }
}
