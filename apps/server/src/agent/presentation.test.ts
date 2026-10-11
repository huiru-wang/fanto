import assert from "node:assert/strict";
import test from "node:test";
import { projectHistory, resolveToolPresentation } from "./presentation.js";
import { createPresentMediaTool } from "./tools/media.js";
import { createRecordReadTool } from "./tools/records.js";

test("tool declarations own their presentation configuration", () => {
  const recordRead = createRecordReadTool({} as any);
  const presentMedia = createPresentMediaTool({} as any);

  assert.deepEqual(resolveToolPresentation(recordRead.presentation, "start"), {
    visible: true,
    displayContent: "🤔 正在回忆...",
    animation: "thinking",
  });
  assert.deepEqual(resolveToolPresentation(recordRead.presentation, "end", "succeeded"), {
    visible: true,
    displayContent: "💡 想起来了",
  });
  assert.deepEqual(resolveToolPresentation(presentMedia.presentation, "start"), {
    visible: false,
    displayContent: "",
  });
});

test("history preserves assistant text-tool-text boundaries using tool declarations", () => {
  const entries = [
    {
      id: "assistant-2",
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "找到了，是去年八月份那次。" }] },
    },
    {
      id: "tool-1",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "record_read",
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    },
    {
      id: "assistant-1",
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "我记得你之前提到过这个。" }] },
    },
    {
      id: "user-1",
      type: "message",
      message: { role: "user", content: "上次是什么时候？" },
    },
  ] as any;
  const tools = [createRecordReadTool({} as any)];

  assert.deepEqual(projectHistory(entries, tools), [
    {
      id: "user-1",
      role: "user",
      blocks: [{ type: "text", content: "上次是什么时候？" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      blocks: [
        { type: "text", content: "我记得你之前提到过这个。" },
        {
          type: "activity",
          toolCallId: "call-1",
          status: "succeeded",
          presentation: { visible: true, displayContent: "💡 想起来了" },
        },
        { type: "text", content: "找到了，是去年八月份那次。" },
      ],
    },
  ]);
});

test("history exposes a submitted clarification as a distinct user block", () => {
  const entries = [{
    id: "user-clarification",
    type: "message",
    message: {
      role: "user",
      content: "[[fanto-user-input:interaction-1]]\n卡片想给老婆看：温柔一点",
    },
  }] as any;

  assert.deepEqual(projectHistory(entries, []), [{
    id: "user-clarification",
    role: "user",
    blocks: [{
      type: "user_input_response",
      interactionId: "interaction-1",
      content: "卡片想给老婆看：温柔一点",
    }],
  }]);
});

test("history keeps an empty stopped turn and isolates its state from the next turn", () => {
  const entries = [
    {id:"a2",type:"message",message:{role:"assistant",content:[{type:"text",text:"next answer"}]}},
    {id:"u2",type:"message",message:{role:"user",content:"next"}},
    {id:"stop",type:"custom",customType:"fanto.run_stopped",data:{sourceMessageId:"u1"}},
    {id:"u1",type:"message",message:{role:"user",content:"first"}},
  ] as any;
  assert.deepEqual(projectHistory(entries,[]),[
    {id:"u1",role:"user",blocks:[{type:"text",content:"first"}]},
    {id:"stop",role:"assistant",blocks:[],state:"stopped"},
    {id:"u2",role:"user",blocks:[{type:"text",content:"next"}]},
    {id:"a2",role:"assistant",blocks:[{type:"text",content:"next answer"}]},
  ]);
});
