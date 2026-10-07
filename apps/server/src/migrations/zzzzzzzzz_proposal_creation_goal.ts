import { sql, type Kysely } from "kysely";
/** Move execution details out of Proposal while retaining active runs' paid image budgets. */
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE creation_runs ADD COLUMN IF NOT EXISTS execution_plan JSONB;
    UPDATE creation_runs r SET execution_plan = jsonb_build_object(
      'sourceMediaIds', p.content->'creation'->'sourceMediaIds',
      'subject', p.content->'creation'->'subject',
      'imageCount', p.content->'creation'->'imageCount',
      'composition', CASE WHEN p.type = 'create' THEN 'create' ELSE 'append' END)
    FROM proposals p WHERE r.proposal_id = p.proposal_id AND r.user_id = p.user_id
      AND r.execution_plan IS NULL AND p.content->'creation'->>'intent' = 'roleplay_article';
    UPDATE proposals SET content = jsonb_set(content, '{creation}', jsonb_strip_nulls(jsonb_build_object(
      'objective', content->'creation'->>'objective',
      'context', concat_ws(E'\n', content->'creation'->>'theme', content->'creation'->'subject'->>'description'),
      'constraints', COALESCE((SELECT jsonb_agg('保留：' || x) FROM jsonb_array_elements_text(content->'creation'->'preserve') x), '[]'::jsonb)
        || COALESCE((SELECT jsonb_agg('允许变化：' || x) FROM jsonb_array_elements_text(content->'creation'->'changes') x), '[]'::jsonb),
      'successCriteria', jsonb_build_array('交付 ' || (content->'creation'->>'imageCount') || ' 张主题创作图片与配文'))))
    WHERE content->'creation'->>'intent' = 'roleplay_article';
  `.execute(db);
}
export async function down(_db: Kysely<any>) {
  throw new Error("Proposal goal migration cannot reconstruct removed execution details");
}
