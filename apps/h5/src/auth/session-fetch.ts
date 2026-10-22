export async function authorizedFetch(path: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-Fanto-Web", "1");
    if (!headers.has("Content-Type") && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (response.status === 401 && !String(path).startsWith("/api/auth/")) {
    window.dispatchEvent(new Event("fanto:auth-invalidated"));
  }
  return response;
}
