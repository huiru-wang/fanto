import { Hono } from "hono";
import { statsTimeZone, profilePatch, UserProfileError, type UserProfileService } from "../domain/users/profile-service.js";
import { requireUserId } from "./request-user.js";
const ok = (result: unknown) => ({success: true, result, errorCode: null, errorMsg: null});
export function createUserProfileRoutes(service: UserProfileService) {
  const app = new Hono();
  app.get("/", async c => c.json(ok(await service.get(requireUserId(c.req.raw)))));
  app.patch("/", async c => {
    const parsed = profilePatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({success: false, result: null, errorCode: "INVALID_INPUT", errorMsg: "昵称需为1–30字，签名最多40字，且均为单行。"}, 400);
    try { return c.json(ok(await service.update(requireUserId(c.req.raw), parsed.data))); }
    catch (error) { if (error instanceof UserProfileError) return c.json({success: false, result: null, errorCode: error.code, errorMsg: error.message}, error.status); throw error; }
  });
  return app;
}

export function createUserStatisticsRoutes(service: UserProfileService) {
  const app = new Hono();
  app.get("/", async c => {
    const timeZone = statsTimeZone.safeParse(c.req.query("timeZone"));
    if (!timeZone.success) return c.json({success: false, result: null, errorCode: "INVALID_INPUT", errorMsg: "时区无效。"}, 400);
    return c.json(ok(await service.getStatistics(requireUserId(c.req.raw), timeZone.data)));
  });
  return app;
}
