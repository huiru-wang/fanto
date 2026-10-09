import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAgentRoutes } from "./stream.js";
import { runWithRequestPrincipal } from "../request-user.js";

test("Creator stream requires a user-owned, completed Project bound to the session", async () => {
  const sessionId = randomUUID();
  const seen: string[] = [];
  const registry = { get: (id: string) => ["creator-agent", "proposal-agent"].includes(id) ? { id } : undefined };
  const sessions = { acquire: () => { throw new Error("must not acquire an unbound session"); } };
  const projects = {
    findBySession: async (userId: string, id: string) => {
      seen.push(userId);
      return id === sessionId && userId === "owner"
        ? { projectId: randomUUID(), status: "queued" } : null;
    },
  };
  const app = createAgentRoutes(registry as never, sessions as never, projects as never);
  const request = (userId: string, agentId: string) => runWithRequestPrincipal(
    { userId, source: "user" },
    () => app.request("/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, sessionId, message: "继续" }),
    }),
  );
  assert.equal((await request("intruder", "creator-agent")).status, 409);
  assert.equal((await request("owner", "creator-agent")).status, 409);
  assert.equal((await request("owner", "proposal-agent")).status, 403);
  assert.deepEqual(seen, ["intruder", "owner"]);
});
