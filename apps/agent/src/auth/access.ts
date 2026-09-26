import { AsyncLocalStorage } from "node:async_hooks";
import { importSPKI, jwtVerify } from "jose";

type JoseKey = Awaited<ReturnType<typeof importSPKI>>;

export type AgentPrincipal = {
  userId: string;
  token: string;
};

export interface AccessTokenVerifier {
  verify(token: string): Promise<{ userId: string }>;
}

export class JwtAccessTokenVerifier implements AccessTokenVerifier {
  private constructor(
    private readonly issuer: string,
    private readonly publicKeys: Map<string, JoseKey>,
  ) {}

  static async fromEnvironment(): Promise<JwtAccessTokenVerifier> {
    const raw = process.env.AUTH_JWT_PUBLIC_KEYS?.trim();
    if (!raw) throw new Error("AUTH_JWT_PUBLIC_KEYS is required");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AUTH_JWT_PUBLIC_KEYS must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AUTH_JWT_PUBLIC_KEYS must be a JSON object");
    const keys = new Map<string, JoseKey>();
    for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!kid || typeof value !== "string" || !value.trim()) throw new Error("AUTH_JWT_PUBLIC_KEYS contains invalid key material");
      keys.set(kid, await importSPKI(value.replace(/\\n/g, "\n"), "EdDSA"));
    }
    if (keys.size === 0) throw new Error("AUTH_JWT_PUBLIC_KEYS is required");
    return new JwtAccessTokenVerifier(process.env.AUTH_JWT_ISSUER?.trim() || "fanto", keys);
  }

  async verify(token: string): Promise<{ userId: string }> {
    const result = await jwtVerify(token, header => {
      if (header.alg !== "EdDSA" || !header.kid) throw new Error("Invalid JWT header");
      const key = this.publicKeys.get(header.kid);
      if (!key) throw new Error("Unknown JWT key");
      return key;
    }, {
      algorithms: ["EdDSA"],
      issuer: this.issuer,
      audience: "fanto-agent",
    });
    if (result.payload.token_use !== "access" || typeof result.payload.sub !== "string" || !result.payload.sub) {
      throw new Error("Invalid access token");
    }
    return { userId: result.payload.sub };
  }
}

const principalStorage = new AsyncLocalStorage<AgentPrincipal>();

export function runWithAgentPrincipal<T>(principal: AgentPrincipal, callback: () => T): T {
  return principalStorage.run(principal, callback);
}

export function requireAgentPrincipal(_request?: Request): AgentPrincipal {
  const principal = principalStorage.getStore();
  if (!principal) throw new Error("Missing authenticated principal");
  return principal;
}

export function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization")?.trim();
  const match = value ? /^Bearer\s+(.+)$/i.exec(value) : null;
  return match?.[1]?.trim() || undefined;
}
