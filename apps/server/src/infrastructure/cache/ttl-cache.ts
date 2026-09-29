export class TtlCache<K, V> {
  private readonly values = new Map<K, { value: V; expiresAt: number }>();
  private readonly pending = new Map<K, Promise<V>>();

  constructor(
    private readonly options: {
      ttlMs: number;
      maxEntries: number;
      now?: () => number;
    },
  ) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) throw new Error("ttlMs must be positive");
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) throw new Error("maxEntries must be a positive integer");
  }

  get(key: K): V | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (!this.values.has(key) && this.values.size >= this.options.maxEntries) {
      const oldestKey = this.values.keys().next().value as K | undefined;
      if (oldestKey !== undefined) this.values.delete(oldestKey);
    }
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
  }

  delete(key: K): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
    this.pending.clear();
  }

  async getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = loader()
      .then(value => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
