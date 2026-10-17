export type UploadTicket = { mediaId: string; uploadUrl: string; expiresAt: string };
export type UploadProgress = { ticket: UploadTicket; stage: "ticket" | "uploading" | "uploaded" | "ready" };

/** Upload at most two complete media pipelines concurrently, in selection order.
 * Wait for the entire pair on failure so a new manual attempt cannot race it. */
export async function uploadInPairs<T>(
  items: readonly T[],
  upload: (item: T) => Promise<string>,
  onPair?: (first: number, last: number, total: number) => void,
): Promise<string[]> {
  const ids: string[] = [];
  for (let start = 0; start < items.length; start += 2) {
    onPair?.(start + 1, Math.min(start + 2, items.length), items.length);
    const results = await Promise.allSettled(items.slice(start, start + 2).map(upload));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    ids.push(...results.map(result => (result as PromiseFulfilledResult<string>).value));
  }
  return ids;
}
export async function uploadDraft(media: { upload?: UploadProgress }, driver: {
 create(): Promise<UploadTicket>; put(ticket: UploadTicket): Promise<{ok:boolean;status:number}>;
 complete(id: string): Promise<unknown>; isMissing(error: unknown): boolean;
}): Promise<string> {
  const complete = (id: string) => driver.complete(id);
  if (media.upload?.stage === "ready") return media.upload.ticket.mediaId;
  if (media.upload?.stage === "uploading") {
    try { await complete(media.upload.ticket.mediaId); media.upload.stage = "ready"; return media.upload.ticket.mediaId; }
    catch (error) { if (!driver.isMissing(error)) throw error; media.upload.stage = "ticket"; }
  }
  if (!media.upload || media.upload.stage === "ticket" && Date.parse(media.upload.ticket.expiresAt) <= Date.now()) {
    const ticket = await driver.create();
    media.upload = { ticket, stage: "ticket" };
  }
  const { ticket } = media.upload;
  if (media.upload.stage === "ticket") {
    media.upload.stage = "uploading";
    const upload = await driver.put(ticket);
    if (!upload.ok) throw new Error(`附件上传失败（${upload.status}）`);
    media.upload.stage = "uploaded";
  }
  await complete(ticket.mediaId);
  media.upload.stage = "ready";
  return ticket.mediaId;
}
