import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import { createDatabase, runMigrations } from "./database.js";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("Project Session migration creates Goal and removes creative Run tables", async () => {
  const admin = createDatabase(process.env.TEST_DATABASE_URL!);
  const name = "project_session_" + randomUUID().replaceAll("-", "");
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = "/" + name;
  const db = createDatabase(url.href);
  try {
    await runMigrations(db);
    await runMigrations(db);
    const columns = await sql<{column_name:string}>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='projects' AND column_name IN ('goal','session_id','content')
    `.execute(db);
    assert.deepEqual(columns.rows.map(x=>x.column_name).sort(), ["content","goal","session_id"]);
    const gone = await sql<{table_name:string}>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('proposal_runs','creation_runs','creation_image_steps')
    `.execute(db);
    assert.equal(gone.rows.length,0);
  } finally {
    await db.destroy();
    await sql.raw(`DROP DATABASE "${name}" WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});
