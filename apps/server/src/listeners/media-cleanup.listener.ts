import type { MediaService } from "../domain/media/index.js";
import { logError } from "../infrastructure/logging/logger.js";

export function startMediaCleanup(media: MediaService) {
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = media.cleanupDeletedObjects().catch(() => {
      logError("media-cleanup", "Cleanup scan failed; will retry");
    }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => { clearInterval(timer); await running; };
}
