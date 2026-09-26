import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { IdentityProvider, ProviderChallenge, StoredAuthChallenge, VerifiedIdentity } from "../../../domain/auth/identity-provider.js";
import { AuthError } from "../../../domain/auth/errors.js";

const proofSchema = z.object({ idToken: z.string().min(1) }).strict();
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

function displayHint(email?: string): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return local.slice(0, 1) + "***@" + domain;
}

export class GoogleIdentityProvider implements IdentityProvider {
  readonly name = "google" as const;
  private readonly jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

  constructor(private readonly allowedClientIds: string[]) {
    if (allowedClientIds.length === 0) throw new Error("GOOGLE_ALLOWED_CLIENT_IDS is required");
  }

  createChallenge(): ProviderChallenge {
    const nonce = randomBytes(32).toString("base64url");
    return {
      public: { nonce },
      stored: { nonceHash: hash(nonce) },
    };
  }

  async verify(proofInput: unknown, challenge: StoredAuthChallenge): Promise<VerifiedIdentity> {
    const parsed = proofSchema.safeParse(proofInput);
    if (!parsed.success) throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Invalid identity provider proof");

    try {
      const { payload } = await jwtVerify(parsed.data.idToken, this.jwks, {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.allowedClientIds,
      });
      if (typeof payload.sub !== "string" || !payload.sub || typeof payload.nonce !== "string" || !payload.nonce) {
        throw new Error("Google token is missing required claims");
      }
      if (!challenge.nonce_hash || hash(payload.nonce) !== challenge.nonce_hash) {
        throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Identity provider nonce does not match authentication challenge");
      }
      return {
        provider: "google",
        subject: payload.sub,
        displayHint: displayHint(typeof payload.email === "string" ? payload.email : undefined),
      };
    } catch (cause) {
      if (cause instanceof AuthError) throw cause;
      throw new AuthError(400, "INVALID_PROVIDER_PROOF", "Invalid identity provider proof");
    }
  }
}
