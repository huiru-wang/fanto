import { sql, type Kysely } from "kysely";

/** Enables the unified authenticate challenge for databases created before it existed. */
export async function up(db: Kysely<any>) {
  await sql`
    DO $$
    DECLARE
      purpose_constraint TEXT;
    BEGIN
      SELECT conname INTO purpose_constraint
      FROM pg_constraint
      WHERE conrelid = 'auth_challenges'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%purpose%';

      IF purpose_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE auth_challenges DROP CONSTRAINT %I', purpose_constraint);
      END IF;

      ALTER TABLE auth_challenges
        ADD CONSTRAINT auth_challenges_purpose_check
        CHECK (purpose IN ('authenticate', 'register', 'login', 'bind', 'reauth'));
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    ALTER TABLE auth_challenges DROP CONSTRAINT IF EXISTS auth_challenges_purpose_check;
    ALTER TABLE auth_challenges
      ADD CONSTRAINT auth_challenges_purpose_check
      CHECK (purpose IN ('register', 'login', 'bind', 'reauth'));
  `.execute(db);
}
