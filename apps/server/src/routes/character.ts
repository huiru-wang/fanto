import { Hono } from "hono";
import { z } from "zod";
import { CharacterService } from "../domain/character.js";
import { requireUserId } from "./request-user.js";

const schema = z.object({
  character: z.string().max(16000),
  scenario: z.string().max(16000),
  instructions: z.string().max(16000),
  exampleDialogues: z.string().max(16000),
}).strict();
const ok = (result: unknown) => ({ success: true, result, errorCode: null, errorMsg: null });

export function createCharacterRoutes(service: CharacterService) {
  const app = new Hono();
  app.get("/", async c => c.json(ok(await service.get(requireUserId(c.req.raw)))));
  app.put("/", async c => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: parsed.error.message }, 400);
    return c.json(ok(await service.set(requireUserId(c.req.raw), parsed.data)));
  });
  return app;
}
