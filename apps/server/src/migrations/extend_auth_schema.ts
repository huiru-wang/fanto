import { sql, type Kysely } from "kysely";

/** Adds authentication tables for databases created before auth was introduced. */
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'wx_openid'
      ) THEN
        ALTER TABLE users ALTER COLUMN wx_openid DROP NOT NULL;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS user_login_identities (
      identity_id UUID PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      display_hint TEXT,
      verified_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT user_login_identities_provider_subject UNIQUE(provider, provider_subject)
    );

    CREATE INDEX IF NOT EXISTS idx_user_login_identities_active_user
      ON user_login_identities(user_id)
      WHERE revoked_at IS NULL;

    CREATE TABLE IF NOT EXISTS auth_challenges (
      challenge_id UUID PRIMARY KEY,
      purpose TEXT NOT NULL CHECK (purpose IN ('register','login','bind','reauth')),
      provider TEXT NOT NULL,
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      target_hash TEXT,
      nonce_hash TEXT,
      state_hash TEXT,
      verification_hash TEXT,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires
      ON auth_challenges(expires_at)
      WHERE consumed_at IS NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP TABLE IF EXISTS auth_challenges;
    DROP TABLE IF EXISTS user_login_identities;
  `.execute(db);
}
