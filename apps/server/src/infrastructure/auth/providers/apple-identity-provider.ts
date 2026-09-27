import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { IdentityProvider, ProviderChallenge, StoredAuthChallenge, VerifiedIdentity } from "../../../domain/auth/identity-provider.js";
import { AuthError } from "../../../domain/auth/errors.js";

const proofSchema = z.object({ idToken: z.string().min(1) }).strict();
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

function displayHint(email?: string): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return null;
  return email.slice(0, 1) + "***@" + email.slice(at + 1);
}

export class AppleIdentityProvider implements IdentityProvider {
  readonly name = "apple" as const;

  constructor(
    private readonly allowedClientIds: string[],
    private readonly jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
  ) {
    if (allowedClientIds.length === 0) throw new Error("APPLE_ALLOWED_CLIENT_IDS is required");
  }

  createChallenge(): ProviderChallenge {
    const nonce = randomBytes(32).toString("base64url");
    return { public: { nonce }, stored: { nonceHash: hash(nonce) } };
  }

  async verify(proofInput: unknown, challenge: StoredAuthChallenge): Promise<VerifiedIdentity> {
    const parsed = proofSchema.safeParse(proofInput);
    if (!parsed.success) throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Invalid identity provider proof");

    try {
      const { payload } = await jwtVerify(parsed.data.idToken, this.jwks, {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
        audience: this.allowedClientIds,
      });
      if (typeof payload.sub !== "string" || !payload.sub || typeof payload.nonce !== "string" || !payload.nonce) {
        throw new Error("Apple token is missing required claims");
      }
      if (!challenge.nonce_hash || hash(payload.nonce) !== challenge.nonce_hash) {
        throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Identity provider nonce does not match authentication challenge");
      }
      return {
        provider: "apple",
        subject: payload.sub,
        displayHint: displayHint(typeof payload.email === "string" ? payload.email : undefined),
      };
    } catch (cause) {
      if (cause instanceof AuthError) throw cause;
      throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Invalid identity provider proof");
    }
  }
}
