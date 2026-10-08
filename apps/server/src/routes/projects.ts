import { Hono, type Context } from "hono";
import { z } from "zod";
import type { DomainResult, ProjectService, ProposalService, ProjectStatus, ProposalStatus, ProposalType } from "../domain/projects/index.js";
import { requireUserId } from "./request-user.js";
import type { CreativeRunner } from "../creative-runtime/runner.js";
const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });
const errors = { EMBEDDING_UNAVAILABLE: 503, INVALID_INPUT: 400, INVALID_CURSOR: 400, NOT_FOUND: 404, INVALID_STATE: 409, VERSION_CONFLICT: 409, REFERENCE_RECORDS_UNAVAILABLE: 409, MEDIA_NOT_READY: 409, CONTENT_TOO_LARGE: 413 } as const;
function respond<T>(c: Context, result: DomainResult<T>) {
  return result.kind === "ok" ? c.json(ok(result.data)) : c.json({ success: false, result: null, errorCode: result.code, errorMsg: result.code }, errors[result.code]);
}
const pagination = (c: Context, fallback: number) => ({ limit: c.req.query("limit") === undefined ? fallback : Number(c.req.query("limit")), cursor: c.req.query("cursor") });
const expectedVersion = z.number().int().positive();
const acceptProposal = z.object({ selectedIdeaId: z.string().uuid().optional() }).strict();
const patch = z.object({ expectedVersion, title: z.string().optional(), summary: z.string().optional(), coverMediaId: z.string().nullable().optional(), content: z.string().optional(), goal: z.object({ objective: z.string().min(1), context: z.string().optional(), constraints: z.array(z.string()).optional(), successCriteria: z.array(z.string()).optional() }).strict().optional() }).strict();
export function createProjectRoutes(service: ProjectService) {
  const app = new Hono();
  app.get("/projects", async c => respond(c, await service.list(requireUserId(c.req.raw), { ...pagination(c, 20), status: c.req.query("status") as ProjectStatus | undefined })));
  app.get("/projects/:id", async c => respond(c, await service.detail(requireUserId(c.req.raw), c.req.param("id"))));
  app.patch("/projects/:id", async c => {
    const parsed = patch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return respond(c, { kind: "error", code: "INVALID_INPUT" });
    const { expectedVersion, ...values } = parsed.data;
    return respond(c, await service.update(requireUserId(c.req.raw), c.req.param("id"), expectedVersion, values));
  });
  app.post("/projects/:id/archive", async c => {
    const parsed = z.object({ expectedVersion }).strict().safeParse(await c.req.json().catch(() => null));
    return parsed.success ? respond(c, await service.archive(requireUserId(c.req.raw), c.req.param("id"), parsed.data.expectedVersion)) : respond(c, { kind: "error", code: "INVALID_INPUT" });
  });
  return app;
}
export function createProposalRoutes(service: ProposalService, runner?: CreativeRunner) {
  const app = new Hono();
  app.get("/proposals", async c => respond(c, await service.list(requireUserId(c.req.raw), { ...pagination(c, 20), type: c.req.query("type") as ProposalType | undefined, status: c.req.query("status") as ProposalStatus | undefined, targetProjectId: c.req.query("targetProjectId") })));
  app.get("/proposals/:id", async c => respond(c, await service.detail(requireUserId(c.req.raw), c.req.param("id"))));
  app.get("/proposals/:id/records", async c => respond(c, await service.recordsPage(requireUserId(c.req.raw), c.req.param("id"), pagination(c, 5))));
  app.post("/proposals/:id/accept", async c => {
    const parsed = acceptProposal.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return respond(c, {kind:"error",code:"INVALID_INPUT"});
    const userId = requireUserId(c.req.raw);
    const accepted = await service.accept(userId,c.req.param("id"),parsed.data);
    if (accepted.kind === "error") return respond(c,accepted);
    if (!runner) return respond(c,accepted);
    try {
      const sessionId = await runner.onAccepted(userId,accepted.data.resultProjectId,c.req.param("id"));
      return c.json(ok({...accepted.data, sessionId}));
    } catch { return c.json({success:false,result:null,errorCode:"PROJECT_SESSION_UNAVAILABLE",errorMsg:"Session binding pending; retry accept"},503); }
  });
  app.post("/proposals/:id/reject", async c => respond(c, await service.reject(requireUserId(c.req.raw), c.req.param("id"))));
  return app;
}
