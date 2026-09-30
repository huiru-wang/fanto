import assert from "node:assert/strict";
import test from "node:test";
import { installHarnessHooks } from "./hooks.js";

test("successful task delivery terminates the Worker turn", async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const harness = {
    hooks: {
      on(name: string, handler: (...args: any[]) => unknown) {
        handlers.set(name, handler);
      },
    },
  } as any;

  installHarnessHooks(harness, {
    workspace: "/workspace",
    systemPrompt: { release: () => {} } as any,
    transformContext: async () => undefined,
  });

  const afterTool = handlers.get("after_tool")!;
  assert.deepEqual(await afterTool({ toolName: "deliver_task_result", isError: false }), { terminate: true });
  assert.equal(await afterTool({ toolName: "deliver_task_result", isError: true }), undefined);
  assert.equal(await afterTool({ toolName: "write", isError: false }), undefined);
});
