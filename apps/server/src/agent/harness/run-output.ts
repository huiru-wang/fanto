/** Bound transport backpressure without making durable cancellation depend on it. */
export async function waitForOutput(write: () => Promise<void>, signal: AbortSignal, timeoutMs = 5000): Promise<"written" | "cancelled" | "timeout"> {
  if (signal.aborted) return "cancelled";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const interrupted = new Promise<"cancelled" | "timeout">(resolve => {
    cancel = () => resolve("cancelled");
    signal.addEventListener("abort", cancel, {once: true});
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(write).then(() => "written" as const), interrupted]); }
  finally {clearTimeout(timer);signal.removeEventListener("abort",cancel);}
}
