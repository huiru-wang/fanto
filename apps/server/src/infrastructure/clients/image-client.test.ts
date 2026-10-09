import assert from "node:assert/strict";
import test from "node:test";
import { QwenImageUnderstanding } from "./image-client.js";

test("image client uses its configured vision model", async () => {
  const originalFetch = globalThis.fetch; let body = "";
  globalThis.fetch = async (_input, init) => { body = String(init?.body); return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "一张风景照片。" } }] }), { headers: { "Content-Type": "application/json" } }); };
  try {
    const result = await new QwenImageUnderstanding("token", "https://model.example/v1", "qwen3-vl-plus").describe({ imageUrl: "https://oss.example/image.jpg" });
    assert.deepEqual(result, { description: "一张风景照片。" });
    assert.equal(JSON.parse(body).model, "qwen3-vl-plus");
  } finally { globalThis.fetch = originalFetch; }
});

test("visual review actually sends the generated image and distinct reference images", async () => {
  const originalFetch = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async (_input,init) => {
    sent=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"眼部细节需要核实；光影正常。"}}]}));
  };
  try {
    const result=await new QwenImageUnderstanding("token","https://model.example/v1").review({
      imageUrl:"https://example.com/generated.png",referenceUrls:["https://example.com/original.jpg"],brief:"写真：保留人物身份",
    });
    assert.match(result.review,/眼部/);
    const content=sent.messages[0].content;
    assert.equal(content.filter((p:any)=>p.type==="image_url").length,2);
    assert.equal(content[0].image_url.url,"https://example.com/generated.png");
    assert.equal(content[1].image_url.url,"https://example.com/original.jpg");
    assert.match(content[2].text,/不可声称对比过原图/);
  } finally { globalThis.fetch=originalFetch; }
});
