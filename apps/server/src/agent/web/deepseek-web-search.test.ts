import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekWebSearchClient } from "./deepseek-web-search.js";

test("DeepSeekWebSearchClient returns synthesized text and deduplicated sources", async () => {
  const requests: any[] = [];
  const client = new DeepSeekWebSearchClient("key", (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [
        { type: "web_search_tool_result", content: [
          { type: "web_search_result", title: "A", url: "https://example.com/a", page_age: "2026-09-30" },
          { type: "web_search_result", title: "A duplicate", url: "https://example.com/a" },
        ] },
        { type: "text", text: "当前资料显示……" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch);

  const result = await client.search("奉化旅行资料");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }]);
  assert.equal(result.summary, "当前资料显示……");
  assert.deepEqual(result.sources, [{ title: "A", url: "https://example.com/a", pageAge: "2026-09-30" }]);
});

test("DeepSeekWebSearchClient continues pause_turn with the opaque server tool blocks", async () => {
  let call = 0;
  const firstContent = [{ type: "server_tool_use", id: "srv-1", name: "web_search", input: { query: "x" } }];
  const client = new DeepSeekWebSearchClient("key", (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({ stop_reason: "pause_turn", content: firstContent }), { status: 200 });
    }
    assert.deepEqual(body.messages[1], { role: "assistant", content: firstContent });
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "Source", url: "https://example.com/source" }] },
      { type: "text", text: "done" },
    ] }), { status: 200 });
  }) as typeof fetch);

  assert.equal((await client.search("latest")).summary, "done");
  assert.equal(call, 2);
});
