import { AuthError } from "./errors.js";

export type ChallengePurpose = "authenticate" | "register" | "login" | "bind" | "reauth";
export type IdentityProviderName = "google" | "apple" | "phone";

export type ProviderChallenge = {
  public: Record<string, unknown>;
  stored?: {
    nonceHash?: string | null;
    stateHash?: string | null;
    verificationHash?: string | null;
    targetHash?: string | null;
    context?: unknown;
  };
};

export type StoredAuthChallenge = {
  challenge_id: string;
  purpose: ChallengePurpose;
  provider: string;
  user_id: string | null;
  target_hash: string | null;
  nonce_hash: string | null;
  state_hash: string | null;
  verification_hash: string | null;
  context: unknown;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

export type VerifiedIdentity = {
  provider: IdentityProviderName;
  subject: string;
  displayHint?: string | null;
};

export interface IdentityProvider {
  readonly name: IdentityProviderName;
  createChallenge(): Promise<ProviderChallenge> | ProviderChallenge;
  verify(proof: unknown, challenge: StoredAuthChallenge): Promise<VerifiedIdentity>;
}

export class IdentityProviderRegistry {
  private readonly providers = new Map<IdentityProviderName, IdentityProvider>();

  constructor(providers: IdentityProvider[]) {
    for (const provider of providers) this.providers.set(provider.name, provider);
  }

  get(name: string): IdentityProvider {
    const provider = this.providers.get(name as IdentityProviderName);
    if (!provider) throw new AuthError(400, "PROVIDER_NOT_SUPPORTED", "Identity provider is not supported");
    return provider;
  }
}
