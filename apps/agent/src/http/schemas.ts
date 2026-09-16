import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const userIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const traceIdSchema = z.string().trim().min(1).max(256).optional();

export const createSessionSchema = z.object({
  agentId: id,
}).strict();

export const streamRequestSchema = z.object({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  sessionId: z.string().uuid(),
  message: z.string().trim().min(1).max(16_000),
}).strict();
export const taskRequestSchema = streamRequestSchema;
export const taskParamsSchema = z.object({ taskId: z.string().uuid() });
export const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });
export const cursorSchema = z.coerce.number().int().positive().optional();
export const limitSchema = z.coerce.number().int().min(1).max(100).default(50);
