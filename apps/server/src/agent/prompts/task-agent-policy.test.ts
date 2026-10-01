import assert from "node:assert/strict";
import test from "node:test";
import { mainPrompt } from "./main.js";
import { taskWorkerPrompt } from "./task-worker.js";

test("Main task delegation policy keeps implementation questions away from the user", () => {
  assert.match(mainPrompt, /照片如何嵌入/);
  assert.match(mainPrompt, /永远不要询问用户/);
  assert.match(mainPrompt, /output\.format 必须显式填写/);
  assert.match(mainPrompt, /不要传 mediaId/);
  assert.match(mainPrompt, /不用“默认策略”替用户做重要决定/);
});

test("Task Worker policy treats artifacts as final products rather than developer handoffs", () => {
  assert.match(taskWorkerPrompt, /最终产物会直接在 Fanto 产品中呈现给普通用户/);
  assert.match(taskWorkerPrompt, /必须调用 task_plan_manage/);
  assert.match(taskWorkerPrompt, /不要通过 bash\/curl 自行抓取网页/);
  assert.match(taskWorkerPrompt, /不要在卡片底部附加如何使用 result\.html 或如何替换照片的说明/);
  assert.match(taskWorkerPrompt, /summary 不得包含文件路径/);
});
