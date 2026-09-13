import { Hono } from "hono";
import { z } from "zod";
import { logProactiveCreation } from "../infrastructure/logger.js";
import type { RecordRepository } from "../modules/record/record.repository.js";
import { SqliteCreationRepository, type CreationProposal } from "../modules/creation/creation.repository.js";
import type { ProactiveCreationWorkflow } from "../agent/workflows/proactive-creation/workflow.js";
import { requireUserId } from "../interfaces/request-user.js";

const id = z.string().uuid();
const proposalListItem = (item: CreationProposal) => ({ proposalId: item.id, operation: item.operation, creationId: item.creationId, title: item.title, type: item.type, summary: item.summary, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt });

export function createCreationRoutes(creations: SqliteCreationRepository, records: RecordRepository, workflow: ProactiveCreationWorkflow) {
  const app = new Hono();
  app.post("/run", async c => {
    const userId = requireUserId(c.req.raw);
    try {
      const result = await workflow.startManual(userId);
      return c.json({ success: true, result, errorCode: null, errorMsg: null });
    } catch (cause) {
      return c.json({ success: false, result: null, errorCode: "WORKFLOW_FAILED", errorMsg: cause instanceof Error ? cause.message : "Workflow failed" }, 500);
    }
  });
  app.get("/creation-proposals", async c => {
    const status = c.req.query("status");
    if (status && status !== "pending_confirmation") return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Only pending_confirmation is supported" }, 400);
    const items = await creations.listProposals(requireUserId(c.req.raw), status as "pending_confirmation" | undefined);
    return c.json({ success: true, result: { data: items.map(proposalListItem) }, errorCode: null, errorMsg: null });
  });
  app.get("/creation-proposals/:proposalId", async c => {
    if (!id.safeParse(c.req.param("proposalId")).success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid proposal id" }, 400);
    const userId = requireUserId(c.req.raw); const item = await creations.findProposal(userId, c.req.param("proposalId"));
    if (!item) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Proposal not found" }, 404);
    const sourceIds = Array.isArray((item.source as any)?.records) ? (item.source as any).records : [];
    const sourceRecords = await Promise.all(sourceIds.map(async (recordId: string) => { const record = await records.findById(recordId); return record?.userId === userId ? { id: record.id, text: record.content.text, createdAt: record.createdAt } : null; }));
    const target = item.creationId ? await creations.findCreation(userId, item.creationId) : null;
    return c.json({ success: true, result: { ...proposalListItem(item), content: item.content, sources: sourceRecords.filter(Boolean), targetCreation: target ? { id: target.id, title: target.title, summary: target.summary, version: target.version } : null }, errorCode: null, errorMsg: null });
  });
  app.post("/creation-proposals/:proposalId/confirm", async c => {
    if (!id.safeParse(c.req.param("proposalId")).success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid proposal id" }, 400);
    const userId = requireUserId(c.req.raw); const result = await creations.confirm(userId, c.req.param("proposalId"));
    if (result.kind === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Proposal not found" }, 404);
    if (result.kind === "invalid_state") return c.json({ success: false, errorCode: "INVALID_STATE", errorMsg: "Proposal cannot be confirmed" }, 409);
    if (result.kind === "conflict") return c.json({ success: false, result: { proposalId: c.req.param("proposalId"), creationId: result.creationId, expectedVersion: result.expectedVersion, actualVersion: result.actualVersion }, errorCode: "VERSION_CONFLICT", errorMsg: "Creation has changed; proposal was superseded" }, 409);
    if (result.kind !== "confirmed") return c.json({ success: false, errorCode: "INTERNAL_ERROR", errorMsg: "Unexpected confirmation result" }, 500);
    logProactiveCreation("info", "proposal confirmed", { proposalId: result.proposal.id, userId, creationId: result.creation.id, operation: result.proposal.operation });
    return c.json({ success: true, result: { proposalId: result.proposal.id, proposalStatus: "confirmed", creation: { id: result.creation.id, title: result.creation.title, type: result.creation.type, version: result.creation.version, status: result.creation.status } }, errorCode: null, errorMsg: null });
  });
  app.post("/creation-proposals/:proposalId/reject", async c => {
    if (!id.safeParse(c.req.param("proposalId")).success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid proposal id" }, 400);
    const userId = requireUserId(c.req.raw); const accepted = await creations.reject(userId, c.req.param("proposalId"));
    if (!accepted) return c.json({ success: false, errorCode: "INVALID_STATE", errorMsg: "Proposal cannot be rejected" }, 409);
    logProactiveCreation("info", "proposal rejected", { proposalId: c.req.param("proposalId"), userId });
    return c.json({ success: true, result: { proposalId: c.req.param("proposalId"), proposalStatus: "rejected" }, errorCode: null, errorMsg: null });
  });
  app.get("/creations", async c => {
    const data = await creations.activeByUser(requireUserId(c.req.raw));
    return c.json({ success: true, result: { data: data.map(item => ({ id: item.id, title: item.title, type: item.type, summary: item.summary, status: item.status, version: item.version, createdAt: item.createdAt, updatedAt: item.updatedAt })) }, errorCode: null, errorMsg: null });
  });
  app.get("/creations/:creationId", async c => {
    if (!id.safeParse(c.req.param("creationId")).success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid creation id" }, 400);
    const item = await creations.findCreation(requireUserId(c.req.raw), c.req.param("creationId"));
    if (!item) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Creation not found" }, 404);
    return c.json({ success: true, result: item, errorCode: null, errorMsg: null });
  });
  return app;
}
