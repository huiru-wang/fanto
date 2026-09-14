import { Hono } from "hono";
import { requireUserId } from "./request-user.js";
import { CreationProposalRepository } from "../domain/creations/proposal-repository.js";

const proposalIdIsValid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

export function createCreationProposalRoutes(repo: CreationProposalRepository) {
  const app = new Hono();
  const present = async (userId: string, row: Awaited<ReturnType<typeof repo.find>>) => {
    if (!row) return null;
    return {
      proposalId: row.proposal_id,
      operation: row.operation,
      creationId: row.creation_id,
      title: row.title,
      kind: row.kind_id ? { kindId: row.kind_id, name: row.kind_name ?? "unknown", title: row.kind_title ?? "未分类" } : null,
      summary: row.summary,
      content: row.content,
      status: row.status,
      sourceCount: await repo.sourceCount(userId, row.proposal_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  app.get("/creation-proposals", async c => {
    const status = c.req.query("status");
    if (status && status !== "pending_confirmation") return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Only pending_confirmation is supported" }, 400);
    const userId = requireUserId(c.req.raw);
    const rows = await repo.listPending(userId);
    const data = await Promise.all(rows.map(row => present(userId, row)));
    return c.json({ success: true, result: { data }, errorCode: null, errorMsg: null });
  });
  app.get("/creation-proposals/:proposalId", async c => {
    const proposalId = c.req.param("proposalId");
    if (!proposalIdIsValid(proposalId)) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid proposal id" }, 400);
    const userId = requireUserId(c.req.raw);
    const item = await present(userId, await repo.find(userId, proposalId));
    if (!item) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Proposal not found" }, 404);
    return c.json({ success: true, result: { ...item, sources: await repo.sourceRecords(userId, proposalId) }, errorCode: null, errorMsg: null });
  });
  app.post("/creation-proposals/:proposalId/confirm", async c => {
    const proposalId = c.req.param("proposalId");
    if (!proposalIdIsValid(proposalId)) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid proposal id" }, 400);
    const result = await repo.confirm(requireUserId(c.req.raw), proposalId);
    if (result.kind === "confirmed") return c.json({ success: true, result: { proposalId, proposalStatus: "confirmed", creationId: result.creationId }, errorCode: null, errorMsg: null });
    if (result.kind === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Proposal not found" }, 404);
    if (result.kind === "invalid_state") return c.json({ success: false, errorCode: "INVALID_STATE", errorMsg: "Proposal cannot be confirmed" }, 409);
    return c.json({ success: false, errorCode: "VERSION_CONFLICT", errorMsg: "Creation has changed; proposal was superseded", result }, 409);
  });
  app.post("/creation-proposals/:proposalId/reject", async c => {
    const proposalId = c.req.param("proposalId");
    if (!proposalIdIsValid(proposalId)) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid proposal id" }, 400);
    const accepted = await repo.reject(requireUserId(c.req.raw), proposalId);
    return accepted
      ? c.json({ success: true, result: { proposalId, proposalStatus: "rejected" }, errorCode: null, errorMsg: null })
      : c.json({ success: false, errorCode: "INVALID_STATE", errorMsg: "Proposal cannot be rejected" }, 409);
  });
  return app;
}
