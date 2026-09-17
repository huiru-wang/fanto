/**
 * Kysely Database 类型定义。
 */

import type { Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── users ──────────────────────────────────────────────────────

export interface UsersTable {
  id: Generated<number>;
  user_id: string;
  wx_openid: string;
  created_at: string;
}

// ─── records ────────────────────────────────────────────────────

export interface RecordsTable {
  ext_data: Generated<string | null>;
  id: Generated<number>;
  record_id: string;
  user_id: string;
  source: string;
  content: string;
  version: number;
  status: string;
  task_id: string | null;
  event_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreationsTable {
  id: Generated<number>;
  creation_id: string;
  user_id: string;
  title: string;
  kind_id: string;
  session_id: string;
  summary: string;
  content: string;
  status: "active" | "resting" | "archived";
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreationProposalsTable {
  id: Generated<number>;
  proposal_id: string;
  user_id: string;
  creation_id: string | null;
  base_creation_version: number | null;
  operation: string;
  session_id: string;
  title: string | null;
  kind_id: string | null;
  summary: string | null;
  content: string | null;
  ext_data: string | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreationKindsTable { kind_id: string; owner_user_id: string | null; name: string; title: string; created_at: string; updated_at: string; }
export interface EntityRelationsTable { relation_id: string; user_id: string; source_entity_id: string; source_entity_type: string; target_entity_id: string; target_entity_type: string; relation_type: string; source_created_at: string; created_at: string; }

export interface MediaAssetsTable {
  id: Generated<number>;
  media_id: string;
  user_id: string;
  object_key: string;
  media_type: string;
  mime_type: string;
  bytes: number;
  status: string;
  ext_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface VectorItemsTable {
  id: Generated<number>;
  user_id: string;
  type: string;
  outer_id: string;
  content: string;
  content_hash: string;
  status: string;
  error_code: string | null;
  indexed_at: string | null;
  created_at: string;
}

export interface DB {
  users: UsersTable;
  records: RecordsTable;
  creations: CreationsTable;
  creation_proposals: CreationProposalsTable;
  creation_kinds: CreationKindsTable;
  entity_relations: EntityRelationsTable;
  media_assets: MediaAssetsTable;
  vector_items: VectorItemsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
