import test from "node:test";
import assert from "node:assert/strict";
import { inspectProjectContent } from "./content.js";
const id = "e04414ee-f038-4196-869a-149a28badb2b";
test("Markdown references use syntax trees, including image definitions and HTML/CSS", () => {
  assert.deepEqual(inspectProjectContent(`![a][photo]\n\n[photo]: fanto-media://${id}\n\n\`\`\`html-preview\n<div style="background:url('fanto-media://${id}')"><img src='fanto-media://${id}'></div>\n\`\`\``), { kind: "ok", data: [id] });
  assert.deepEqual(inspectProjectContent(`\`\`\`html\n<img src='https://example.com'>\n\`\`\`\n\n\`![a](fanto-media://${id})\`\n\n<img src='https://example.com'>`), { kind: "ok", data: [] });
});
test("external resources, executable HTML and CSS are rejected", () => {
  for (const html of ['<script>alert(1)</script>', '<img src="https://x.test/a">', '<img src="data:image/png;base64,AA">', '<div onclick="x()">X</div>', '<iframe src="x"></iframe>', '<style>@import "https://x.test";</style>', '<style>div { background: url(https://x.test) }</style>', '<style>div { background: image-set("https://x.test/a" 1x) }</style>', '<style>div { background: u\\72l(https://x.test) }</style>', '<form></form>', '<meta http-equiv="refresh" content="0;url=https://x.test">', '<svg><image href="https://x.test"></image></svg>', '<img srcset="https://x.test/a 2x">']) assert.equal(inspectProjectContent(`\`\`\`html-preview\n${html}\n\`\`\``).kind, "error", html);
  for (const url of ['https://x.test/a', '/tmp/a.png', 'data:image/png;base64,AA']) assert.equal(inspectProjectContent(`![a](${url})`).kind, "error");
  assert.deepEqual(inspectProjectContent('[x](javascript:alert)'), { kind: "error", code: "INVALID_INPUT" });
});
test("UTF-8 content limits count bytes rather than characters", () => {
  assert.equal(inspectProjectContent("a".repeat(2 * 1024 * 1024)).kind, "ok");
  assert.deepEqual(inspectProjectContent("中".repeat(700000)), { kind: "error", code: "CONTENT_TOO_LARGE" });
});
