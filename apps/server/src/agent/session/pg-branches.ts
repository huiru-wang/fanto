import { sql } from "kysely";
import type { Entry, EntryStructure, StorageBranchScan } from "@earendil-works/pi-agent-core";
import type { SessionDb } from "./pg-queries.js";
import { decodeEntry, entryStructure, safeNumber, type PgEntryRow } from "./pg-codec.js";

type BranchMember = { branch_id: string; entry_seq: number | string };

/**
 * Branch cache follows the same logical ancestry as SQLite's branch index.
 * On divergence we materialize the full prefix rather than SQLite's compaction
 * segment optimization. No extra schema or database-specific SQL is required.
 */
export async function indexEntry(db: SessionDb, sessionId: string, entry: Entry): Promise<void> {
  if (entry.parentId === null) {
    await sql`INSERT INTO agent_session.branch_meta
      (session_id, branch_id, tip_entry_id, tip_seq, base_branch_id, base_seq)
      VALUES (${sessionId}, ${entry.id}, ${entry.id}, ${entry.seq}, NULL, NULL)`.execute(db);
    await insertMember(db, sessionId, entry.id, entry);
    return;
  }

  const found = await sql<{ branch_id: string }>`
    SELECT branch_id FROM agent_session.branch_meta
    WHERE session_id = ${sessionId} AND tip_entry_id = ${entry.parentId}
  `.execute(db);
  const branch = found.rows[0];
  if (branch) {
    await insertMember(db, sessionId, branch.branch_id, entry);
    await sql`UPDATE agent_session.branch_meta SET tip_entry_id = ${entry.id},
      tip_seq = ${entry.seq} WHERE session_id = ${sessionId} AND branch_id = ${branch.branch_id}`.execute(db);
    return;
  }

  // Parent is not a branch tip: create a divergent branch carrying the exact
  // parent chain, including the new child. Index is a projection, not authority.
  await sql`INSERT INTO agent_session.branch_meta
    (session_id, branch_id, tip_entry_id, tip_seq, base_branch_id, base_seq)
    VALUES (${sessionId}, ${entry.id}, ${entry.id}, ${entry.seq}, NULL, NULL)`.execute(db);
  await sql`
    WITH RECURSIVE lineage AS (
      SELECT id, parent_id, seq, type FROM agent_session.entries
        WHERE session_id = ${sessionId} AND id = ${entry.id}
      UNION ALL
      SELECT p.id, p.parent_id, p.seq, p.type FROM agent_session.entries p
        JOIN lineage l ON p.id = l.parent_id
        WHERE p.session_id = ${sessionId}
    )
    INSERT INTO agent_session.branch_entries
      (session_id, branch_id, entry_id, entry_seq, entry_type)
    SELECT ${sessionId}, ${entry.id}, id, seq, type FROM lineage
  `.execute(db);
}

async function insertMember(db: SessionDb, sessionId: string, branchId: string, entry: Entry): Promise<void> {
  await sql`INSERT INTO agent_session.branch_entries
    (session_id, branch_id, entry_id, entry_seq, entry_type)
    VALUES (${sessionId}, ${branchId}, ${entry.id}, ${entry.seq}, ${entry.type})`.execute(db);
}

export async function scanBranch(
  db: SessionDb, sessionId: string, query: StorageBranchScan, structure: true,
): Promise<EntryStructure[]>;
export async function scanBranch(
  db: SessionDb, sessionId: string, query: StorageBranchScan, structure?: false,
): Promise<Entry[]>;
export async function scanBranch(
  db: SessionDb, sessionId: string, query: StorageBranchScan, structure = false,
): Promise<Entry[] | EntryStructure[]> {
  const membership = await sql<BranchMember>`
    SELECT b.branch_id, b.entry_seq
    FROM agent_session.branch_entries b
    JOIN agent_session.branch_meta m
      ON m.session_id = b.session_id AND m.branch_id = b.branch_id
    WHERE b.session_id = ${sessionId} AND b.entry_id = ${query.start}
      AND b.entry_seq <= m.tip_seq
    ORDER BY m.tip_seq DESC, b.branch_id LIMIT 1
  `.execute(db);
  const branch = membership.rows[0];
  if (!branch) throw new Error(`Branch cache missing entry ${query.start}`);

  const upperSeq = safeNumber(branch.entry_seq, "branch.entry_seq");
  const oldest = query.order === "oldestFirst";
  const predicates = [
    sql`b.session_id = ${sessionId}`,
    sql`b.branch_id = ${branch.branch_id}`,
    sql`b.entry_seq <= ${upperSeq}`,
  ];

  if (query.stopAtId !== undefined || query.stopAtType !== undefined) {
    const stops = [];
    if (query.stopAtId !== undefined) stops.push(sql`entry_id = ${query.stopAtId}`);
    if (query.stopAtType !== undefined) stops.push(sql`entry_type = ${query.stopAtType}`);
    const result = await sql<{ stop_seq: number | string | null }>`
      SELECT ${oldest ? sql.raw("MIN(entry_seq)") : sql.raw("MAX(entry_seq)")} AS stop_seq
      FROM agent_session.branch_entries
      WHERE session_id = ${sessionId} AND branch_id = ${branch.branch_id}
        AND entry_seq <= ${upperSeq}
        AND (${sql.join(stops, sql` OR `)})
    `.execute(db);
    const stop = result.rows[0]?.stop_seq;
    if (stop !== null && stop !== undefined) {
      predicates.push(oldest
        ? sql`b.entry_seq <= ${safeNumber(stop, "branch.stop_seq")}`
        : sql`b.entry_seq >= ${safeNumber(stop, "branch.stop_seq")}`);
    }
  }
  if (query.type !== undefined) predicates.push(sql`b.entry_type = ${query.type}`);
  if (query.customType !== undefined) predicates.push(sql`e.custom_type = ${query.customType}`);
  if (query.cursor !== undefined) {
    predicates.push(oldest ? sql`b.entry_seq > ${query.cursor.seq}` : sql`b.entry_seq < ${query.cursor.seq}`);
  }
  const direction = oldest ? sql.raw("ASC") : sql.raw("DESC");
  const limit = query.limit === undefined ? sql`` : sql`LIMIT ${Math.max(0, query.limit)}`;
  const rows = await sql<PgEntryRow>`
    SELECT e.id, e.parent_id, e.seq, e.type, e.custom_type, e.timestamp, e.payload
    FROM agent_session.branch_entries b
    JOIN agent_session.entries e ON e.session_id = b.session_id AND e.id = b.entry_id
    WHERE ${sql.join(predicates, sql` AND `)}
    ORDER BY b.entry_seq ${direction} ${limit}
  `.execute(db);
  return structure ? rows.rows.map(entryStructure) : rows.rows.map(decodeEntry);
}
