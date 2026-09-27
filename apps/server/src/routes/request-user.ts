import { AsyncLocalStorage } from "node:async_hooks";

export type AuthenticatedPrincipal = {
  userId: string;
  source: "user" | "agent";
};

const principalStorage = new AsyncLocalStorage<AuthenticatedPrincipal>();

export function runWithRequestPrincipal<T>(principal: AuthenticatedPrincipal, callback: () => T): T {
  return principalStorage.run(principal, callback);
}

export function requirePrincipal(_request?: Request): AuthenticatedPrincipal {
  const principal = principalStorage.getStore();
  if (!principal) throw new Error("Missing authenticated principal");
  return principal;
}

export function requireUserId(request?: Request): string {
  return requirePrincipal(request).userId;
}

export function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization")?.trim();
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || undefined;
}
