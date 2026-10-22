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
  contact_value: Generated<string | null>;
  display_hint: string | null;
  verified_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface AuthChallengesTable {
  challenge_id: string;
  purpose: "authenticate" | "register" | "login" | "bind" | "reauth";
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
  owner_type: "user" | "fanto";
  owner_id: string;
  source: string;
  content: string;
  version: number;
  status: string;
  task_id: string | null;
  location_latitude: number | null;
  location_longitude: number | null;
  event_at: string;
  created_at: string;
  updated_at: string;
  embedding: unknown | null;
}

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

export interface MemoriesTable {
  memory_id: string;
  fanto_id: string;
  content: string;
  embedding: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface UserFantosTable {
  fanto_id: string;
  user_id: string;
  nickname: string;
  description: string;
  avatar_media_id: string | null;
  role_config: import("kysely").JSONColumnType<{[key: string]: unknown}>;
  agent_config: import("kysely").JSONColumnType<{[key: string]: unknown}>;
  status: "active" | "archived";
  archived_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfilesTable {
  user_id: string; nickname: string; signature: string; avatar_media_id: string | null; cover_media_id: string | null; version: number; updated_at: Date;
}

export interface AuthSessionsTable {
  session_id: string;
  token_hash: string;
  user_id: string;
  client_type: "web" | "native";
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

export interface DB {
  auth_sessions: AuthSessionsTable;
  user_profiles: UserProfilesTable;
  users: UsersTable;
  user_login_identities: UserLoginIdentitiesTable;
  auth_challenges: AuthChallengesTable;
  records: RecordsTable;
  media_assets: MediaAssetsTable;
  memories: MemoriesTable;
  user_fantos: UserFantosTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
