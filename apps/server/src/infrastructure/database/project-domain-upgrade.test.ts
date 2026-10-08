import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";
import { up as legacyUp } from "../../migrations/zz_project_domain_refactor.js";
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("migrations support fresh databases and preserve legacy Project data", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = `migration_${randomUUID().replaceAll("-", "")}`;
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const db = createDatabase(url.href);
  try {
    await runMigrations(db);
    await runMigrations(db);
    const columns = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name = 'proposals'`.execute(db);
    assert.ok(columns.rows.some(r => r.column_name === "session_id"));
    assert.equal((await sql`SELECT 1 FROM information_schema.tables WHERE table_name = 'legacy_projects'`.execute(db)).rows.length, 0);
    // Reproduce the deployed migration history and old Project schema.
    await sql`DROP TABLE record_links; DROP TABLE proposals; DROP TABLE projects;
      DROP TABLE IF EXISTS creation_image_steps; DROP TABLE IF EXISTS creation_runs; DROP TABLE IF EXISTS proposal_runs;
      DROP TABLE memories; DROP TABLE media_object_deletions; ALTER TABLE records DROP COLUMN embedding;
      DELETE FROM kysely_migration WHERE name IN ('zzzzz_memory_schema', 'zzzzzz_creative_runtime', 'zzzzzzz_project_domain_upgrade', 'zzzzzzzz_project_summary_embedding', 'zzzzzzzzz_proposal_creation_goal', 'zzzzzzzzzz_media_object_deletions', 'zzzzzzzzzzz_project_session_goal');`.execute(db);
    await legacyUp(db);
    const userId = randomUUID(), otherId = randomUUID(), recordId = randomUUID(), mediaId = randomUUID();
    const now = new Date();
    await db.insertInto("users").values([userId, otherId].map(id => ({ user_id: id, status: "active" as const, created_at: now, updated_at: now, disabled_at: null }))).execute();
    await sql`INSERT INTO records (record_id,user_id,source,content,version,status,event_at,created_at,updated_at)
      VALUES (${recordId},${userId},'user','preserved record',1,'processed',${now.toISOString()},${now.toISOString()},${now.toISOString()})`.execute(db);
    await sql`INSERT INTO media_assets (media_id,user_id,object_key,media_type,mime_type,bytes,status,created_at,updated_at)
      VALUES (${mediaId},${userId},${mediaId},'image','image/png',10,'ready',${now.toISOString()},${now.toISOString()});`.execute(db);
    const ids = Array.from({ length: 4 }, randomUUID);
    for (const [i, status] of ["active", "archived", "proposed", "rejected"].entries()) {
      await sql`INSERT INTO projects (project_id,user_id,title,content,status,version,created_at,updated_at)
        VALUES (${ids[i]},${userId},'历史标题','preserved markdown',${status},2,${now},${now})`.execute(db);
      await sql`INSERT INTO project_records (user_id,project_id,record_id,record_event_at,created_at,updated_at)
        VALUES (${userId},${ids[i]},${recordId},${now},${now},${now});`.execute(db);
    }
    // An invalid legacy cross-user link must never become an authorized reference.
    await sql`INSERT INTO project_records (user_id,project_id,record_id,record_event_at,created_at,updated_at)
      VALUES (${otherId},${ids[0]},${recordId},${now},${now},${now});`.execute(db);
    await runMigrations(db);
    await runMigrations(db);
    const projects = await db.selectFrom("projects").selectAll().execute();
    assert.equal(projects.length, 2); assert.ok(projects.every(p => p.content === "preserved markdown" && p.version === 2 && p.summary === "历史标题"));
    const proposals = await db.selectFrom("proposals").selectAll().execute();
    assert.deepEqual(proposals.map(p => p.status).sort(), ["pending", "rejected"]);
    assert.ok(proposals.every(p => p.session_id === null));
    const links = await db.selectFrom("record_links").selectAll().execute();
    assert.equal(links.length, 4); assert.ok(links.every(l => l.user_id === userId));
    assert.equal((await sql`SELECT * FROM legacy_projects`.execute(db)).rows.length, 4);
    assert.equal((await sql`SELECT * FROM legacy_project_records`.execute(db)).rows.length, 5);
    assert.equal((await db.selectFrom("records").select("content").executeTakeFirstOrThrow()).content, "preserved record");
    assert.equal((await db.selectFrom("media_assets").select("media_id").executeTakeFirstOrThrow()).media_id, mediaId);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
