import assert from "node:assert/strict";
import test from "node:test";
import { installHarnessHooks } from "./hooks.js";

function harnessWithHandlers() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const harness = {
    hooks: {
      on(name: string, handler: (...args: any[]) => unknown) { handlers.set(name, handler); },
    },
  } as any;
  installHarnessHooks(harness, {
    workspace: process.cwd(),
    systemPrompt: { release: () => {} } as any,
    transformContext: async () => undefined,
  });
  return handlers;
}

test("user input collection terminates the current turn", async () => {
  const handlers = harnessWithHandlers();
  const afterTool = handlers.get("after_tool")!;
  assert.deepEqual(await afterTool({ toolName: "collect_user_input", isError: false }), { terminate: true });
  assert.equal(await afterTool({ toolName: "write", isError: false }), undefined);
  assert.equal(await afterTool({ toolName: "collect_user_input", isError: true }), undefined);
});
