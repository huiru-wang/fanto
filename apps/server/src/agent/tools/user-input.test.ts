import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeUserInputRequestDetails } from "./user-input.js";

test("collect_user_input sanitizer exposes only renderable form data", () => {
  assert.deepEqual(sanitizeUserInputRequestDetails({
    kind: "user_input_requested",
    interactionId: "interaction-1",
    title: "确认一下",
    description: "只差一个选择",
    questions: [{
      id: "tone",
      type: "single_select",
      label: "更喜欢哪种感觉？",
      options: [{ value: "quiet", label: "安静克制" }, { value: "warm", label: "温暖一点" }],
      allowOther: true,
      secret: "hidden",
    }],
    internal: "hidden",
  }), {
    kind: "user_input_requested",
    interactionId: "interaction-1",
    title: "确认一下",
    description: "只差一个选择",
    questions: [{
      id: "tone",
      type: "single_select",
      label: "更喜欢哪种感觉？",
      options: [{ value: "quiet", label: "安静克制" }, { value: "warm", label: "温暖一点" }],
      allowOther: true,
    }],
  });
});
