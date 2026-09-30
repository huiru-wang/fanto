import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduledTaskTrigger } from "./model.js";
import { nextRecurringOccurrence, TaskService } from "./service.js";

test("recurring schedule is evaluated in its IANA wall-clock timezone", () => {
  const trigger: ScheduledTaskTrigger = {
    type: "scheduled",
    schedule: {
      type: "recurring",
      rrule: "FREQ=WEEKLY;BYDAY=WE;BYHOUR=19;BYMINUTE=0;BYSECOND=0",
      timezone: "Asia/Shanghai",
      startAt: "2026-09-29T19:00:00+08:00",
    },
  };

  const next = nextRecurringOccurrence(trigger, new Date("2026-09-29T00:00:00.000Z"), false);
  assert.equal(next?.toISOString(), "2026-09-30T11:00:00.000Z");
});

test("recurring schedule keeps local wall time across DST changes", () => {
  const trigger: ScheduledTaskTrigger = {
    type: "scheduled",
    schedule: {
      type: "recurring",
      rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0",
      timezone: "America/New_York",
      startAt: "2026-03-02T09:00:00-05:00",
    },
  };

  const next = nextRecurringOccurrence(trigger, new Date("2026-03-03T00:00:00.000Z"), false);
  assert.equal(next?.toISOString(), "2026-03-09T13:00:00.000Z");
});

test("delegate rejects recurring schedules with no future occurrence before writing", async () => {
  const service = new TaskService({} as never, { minSeconds: 30, maxSeconds: 3600 });

  await assert.rejects(
    service.delegate(
      { userId: "u1", timeZone: "Asia/Shanghai" },
      {
        title: "expired",
        agentId: "task-worker",
        goal: { objective: "do something" },
        trigger: {
          type: "scheduled",
          schedule: {
            type: "recurring",
            rrule: "FREQ=DAILY;COUNT=1",
            timezone: "Asia/Shanghai",
            startAt: "2020-01-01T09:00:00+08:00",
          },
        },
        output: { format: "markdown" },
      },
      { defaultTimeoutSeconds: 900, maxTimeoutSeconds: 3600 },
    ),
    /no future occurrence/,
  );
});

test("immediate task persists its creation time as nextRunAt without creating a run", async () => {
  const service = new TaskService({} as never, { minSeconds: 30, maxSeconds: 3600 });
  let created: Record<string, unknown> | undefined;
  (service as any).repository = {
    createTask: async (row: Record<string, unknown>) => {
      created = row;
    },
  };

  const result = await service.delegate(
    { userId: "u1", timeZone: "Asia/Shanghai" },
    {
      title: "Generate a card",
      agentId: "task-worker",
      goal: { objective: "Create one result file" },
      trigger: { type: "immediate" },
      output: { format: "html" },
      references: { recordIds: ["record-1"] },
    },
    { defaultTimeoutSeconds: 900, maxTimeoutSeconds: 3600 },
  );

  assert.equal(result.status, "active");
  assert.ok(result.nextRunAt);
  assert.equal(created?.trigger_type, "immediate");
  assert.equal((created?.next_run_at as Date).toISOString(), result.nextRunAt);
  assert.deepEqual((created?.ext_data as any).references, { recordIds: ["record-1"] });
  assert.deepEqual(created?.output, { format: "html" });
  assert.equal("run_id" in (created ?? {}), false);
});
