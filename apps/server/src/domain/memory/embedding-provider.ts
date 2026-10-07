export interface EmbeddingProvider {
  embed(input: string): Promise<number[]>;
}
