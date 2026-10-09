import assert from "node:assert/strict";
import test from "node:test";
import { fantoCore } from "./fanto-core.js";
import { mainPrompt } from "./main.js";
import { proposalAgentPrompt } from "./proposal-agent.js";
import { creatorAgentPrompt } from "./creator-agent.js";

test("proposal and creator inherit exactly the same Fanto Core and Character slot", () => {
  for (const prompt of [mainPrompt, proposalAgentPrompt, creatorAgentPrompt]) {
    assert.ok(prompt.startsWith(fantoCore));
    assert.ok(prompt.includes("{{character}}"));
  }
  assert.ok(proposalAgentPrompt.includes("opening"));
  assert.ok(proposalAgentPrompt.includes("增量价值"));
  assert.ok(creatorAgentPrompt.includes("用户如果已经有这些 Record"));
  assert.ok(creatorAgentPrompt.includes("原图"));
  assert.ok(!proposalAgentPrompt.includes("# Operational Policy"));
});
