export interface ProjectEmbeddingProvider { embed(input: string): Promise<number[]> }

export async function embedProjectText(provider: ProjectEmbeddingProvider, text: string): Promise<string> {
  const values = await provider.embed(text);
  if (values.length !== 768 || values.some(v => !Number.isFinite(v)) || !values.some(v => v !== 0)) throw new Error("Invalid Project embedding");
  return `[${values.join(",")}]`;
}
