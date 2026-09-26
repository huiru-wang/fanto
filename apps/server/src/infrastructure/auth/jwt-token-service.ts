import { randomUUID } from "node:crypto";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { AuthError } from "../../domain/auth/errors.js";

export type JwtTokenConfig = {
  privateKeyPem: string;
  publicKeys: Record<string, string>;
  activeKid: string;
  issuer: string;
  accessAudiences: string[];
  refreshAudience: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
};

export type VerifiedAccessToken = { userId: string; tokenId: string };
export type VerifiedRefreshToken = { userId: string; tokenId: string };

type JoseKey = Awaited<ReturnType<typeof importSPKI>>;

export class JwtTokenService {
  private constructor(
    private readonly config: JwtTokenConfig,
    private readonly privateKey: JoseKey,
    private readonly publicKeys: Map<string, JoseKey>,
  ) {}

  static async create(config: JwtTokenConfig): Promise<JwtTokenService> {
    if (!config.publicKeys[config.activeKid]) throw new Error("AUTH_JWT_PUBLIC_KEYS must contain AUTH_JWT_ACTIVE_KID");
    const privateKey = await importPKCS8(config.privateKeyPem, "EdDSA");
    const publicKeys = new Map<string, JoseKey>();
    for (const [kid, pem] of Object.entries(config.publicKeys)) {
      publicKeys.set(kid, await importSPKI(pem, "EdDSA"));
    }
    return new JwtTokenService(config, privateKey, publicKeys);
  }

  async issuePair(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const accessTokenExpiresAt = new Date((now + this.config.accessTtlSeconds) * 1000);
    const refreshTokenExpiresAt = new Date((now + this.config.refreshTtlSeconds) * 1000);
    const accessToken = await new SignJWT({ token_use: "access" })
      .setProtectedHeader({ alg: "EdDSA", kid: this.config.activeKid, typ: "JWT" })
      .setSubject(userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.accessAudiences)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.accessTtlSeconds)
      .setJti(randomUUID())
      .sign(this.privateKey);
    const refreshToken = await new SignJWT({ token_use: "refresh" })
      .setProtectedHeader({ alg: "EdDSA", kid: this.config.activeKid, typ: "JWT" })
      .setSubject(userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.refreshAudience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.refreshTtlSeconds)
      .setJti(randomUUID())
      .sign(this.privateKey);
    return {
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  async verifyAccess(token: string, audience: string): Promise<VerifiedAccessToken> {
    const payload = await this.verify(token, audience, "access");
    return { userId: payload.sub!, tokenId: payload.jti! };
  }

  async verifyRefresh(token: string): Promise<VerifiedRefreshToken> {
    const payload = await this.verify(token, this.config.refreshAudience, "refresh");
    return { userId: payload.sub!, tokenId: payload.jti! };
  }

  private async verify(token: string, audience: string, tokenUse: "access" | "refresh") {
    try {
      const result = await jwtVerify(token, protectedHeader => {
        if (protectedHeader.alg !== "EdDSA" || !protectedHeader.kid) throw new Error("Invalid JWT header");
        const key = this.publicKeys.get(protectedHeader.kid);
        if (!key) throw new Error("Unknown JWT key");
        return key;
      }, {
        issuer: this.config.issuer,
        audience,
        algorithms: ["EdDSA"],
      });
      if (result.payload.token_use !== tokenUse || typeof result.payload.sub !== "string" || typeof result.payload.jti !== "string") {
        throw new Error("Invalid JWT claims");
      }
      return result.payload;
    } catch {
      throw new AuthError(401, tokenUse === "access" ? "UNAUTHENTICATED" : "REFRESH_TOKEN_INVALID", "Invalid or expired token");
    }
  }
}
