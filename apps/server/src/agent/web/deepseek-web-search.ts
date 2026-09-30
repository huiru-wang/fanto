export type WebSearchSource = {
  title: string;
  url: string;
  pageAge?: string;
};

export type WebSearchResult = {
  query: string;
  summary: string;
  sources: WebSearchSource[];
};

type AnthropicContent = Record<string, unknown>;
type AnthropicResponse = {
  content?: AnthropicContent[];
  stop_reason?: string;
  error?: { message?: string };
};

export class DeepSeekWebSearchClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://api.deepseek.com/anthropic/v1/messages",
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
    const normalized = query.trim();
    if (!normalized) throw new Error("web_search query must not be empty");
    const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
    const messages: Array<Record<string, unknown>> = [{
      role: "user",
      content: `Use web search to investigate this request. Return a concise factual synthesis grounded in the search results.\n\n${normalized}`,
    }];
    const sources = new Map<string, WebSearchSource>();
    let summary = "";

    for (let continuation = 0; continuation < 3; continuation += 1) {
      const response = await this.fetcher(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          max_tokens: 1800,
          system: "You are a research helper inside Fanto. Search the web when asked, prefer reliable sources, and never invent sources or URLs.",
          messages,
          tools,
        }),
        signal,
      });
      const payload = await response.json().catch(() => null) as AnthropicResponse | null;
      if (!response.ok || !payload) {
        throw new Error(`DeepSeek web search failed (${response.status})`);
      }
      if (payload.error?.message) throw new Error(`DeepSeek web search failed: ${payload.error.message}`);
      const content = Array.isArray(payload.content) ? payload.content : [];
      collectContent(content, sources, text => { summary += text; });
      if (payload.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content });
    }

    const normalizedSummary = summary.trim();
    if (sources.size === 0) throw new Error("DeepSeek web search returned no source results");
    return {
      query: normalized,
      summary: normalizedSummary || "搜索已完成，请结合下列来源继续分析。",
      sources: [...sources.values()],
    };
  }
}

function collectContent(
  content: AnthropicContent[],
  sources: Map<string, WebSearchSource>,
  appendText: (text: string) => void,
): void {
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      appendText(block.text);
      continue;
    }
    if (block.type !== "web_search_tool_result") continue;
    const resultContent = block.content;
    if (!Array.isArray(resultContent)) continue;
    for (const raw of resultContent) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (item.type !== "web_search_result" || typeof item.url !== "string" || typeof item.title !== "string") continue;
      if (!sources.has(item.url)) {
        sources.set(item.url, {
          title: item.title,
          url: item.url,
          ...(typeof item.page_age === "string" ? { pageAge: item.page_age } : {}),
        });
      }
    }
  }
}
