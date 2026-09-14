import { z } from "zod";

export const agentRequestSchema = z.object({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(16_000),
}).strict();
export const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });
export const cursorSchema = z.coerce.number().int().nonnegative().default(0);
export const limitSchema = z.coerce.number().int().min(1).max(100).default(50);
