/**
 * Kysely Database 类型定义。
 */

import type { Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── users ──────────────────────────────────────────────────────

export interface UsersTable {
  user_id: string;
  status: "active" | "disabled";
  created_at: Date;
  updated_at: Date;
  disabled_at: Date | null;
}

export interface UserLoginIdentitiesTable {
  identity_id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  display_hint: string | null;
  verified_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface AuthChallengesTable {
  challenge_id: string;
  purpose: "register" | "login" | "bind" | "reauth";
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

export interface UserPreferencesTable {
  id: Generated<number>;
  preference_id: string;
  user_id: string;
  category: string;
  content: string;
  source_session_id: string;
  source_message_id: string;
  source_quote: string;
  version: number;
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
  event_at: string;
  indexed_at: string | null;
  created_at: string;
  embedding: unknown;
}

export interface DB {
  users: UsersTable;
  user_login_identities: UserLoginIdentitiesTable;
  auth_challenges: AuthChallengesTable;
  records: RecordsTable;
  creations: CreationsTable;
  creation_proposals: CreationProposalsTable;
  creation_kinds: CreationKindsTable;
  entity_relations: EntityRelationsTable;
  media_assets: MediaAssetsTable;
  vector_items: VectorItemsTable;
  user_preferences: UserPreferencesTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
