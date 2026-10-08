import { sql, type Kysely } from "kysely";

/** Move creative work to Project + Pi Session. Keep prior migrations immutable. */
export async function up(db: Kysely<any>) {
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS goal JSONB NOT NULL DEFAULT '{}'::jsonb`.execute(db);
  await sql`
    UPDATE proposals
    SET content = (content - 'creation') || jsonb_build_object('goal', content->'creation')
    WHERE content ? 'creation' AND NOT content ? 'goal'
  `.execute(db);
  await sql`
    UPDATE proposals SET content = content || jsonb_build_object('goal', jsonb_build_object(
      'objective', COALESCE(NULLIF(proposed_summary,''),title)))
    WHERE NOT content ? 'goal'
  `.execute(db);
  await sql`
    UPDATE projects p SET goal = COALESCE((
      SELECT proposal.content->'goal' FROM proposals proposal
      WHERE proposal.user_id=p.user_id AND proposal.result_project_id=p.project_id
        AND proposal.status='accepted'
      ORDER BY proposal.resolved_at DESC,proposal.proposal_id DESC LIMIT 1
    ),jsonb_build_object('objective',COALESCE(NULLIF(p.summary,''),p.title)))
    WHERE p.goal = '{}'::jsonb
  `.execute(db);
  await sql`
    UPDATE projects p SET session_id = (
      SELECT r.agent_session_id FROM creation_runs r
      WHERE r.user_id=p.user_id AND r.project_id=p.project_id AND r.agent_session_id IS NOT NULL
      ORDER BY r.accepted_at DESC LIMIT 1)
    WHERE p.session_id IS NULL
  `.execute(db);
  // Existing processed Records were already eligible for the old discovery system.
  // Avoid re-running analysis for the entire historical backlog on first deploy.
  await sql`
    UPDATE records SET ext_data = jsonb_set(
      COALESCE(NULLIF(ext_data, '')::jsonb, '{}'::jsonb),
      '{proposalAnalyzedVersion}', to_jsonb(version))::text
    WHERE status = 'processed'
  `.execute(db);
  await sql`DROP TABLE IF EXISTS creation_image_steps`.execute(db);
  await sql`DROP TABLE IF EXISTS creation_runs`.execute(db);
  await sql`DROP TABLE IF EXISTS proposal_runs`.execute(db);
}
export async function down(_db: Kysely<any>) {
  throw new Error("Session migration cannot recreate deprecated creative run state");
}
