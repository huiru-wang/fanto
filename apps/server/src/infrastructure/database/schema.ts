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
  user_id: string;
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
}

export interface ProjectsTable {
  id: Generated<string>;
  project_id: string;
  user_id: string;
  title: string;
  content: string;
  status: "proposed" | "active" | "archived" | "rejected";
  version: number;
  ext_data: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectRecordsTable {
  id: Generated<string>;
  user_id: string;
  project_id: string;
  record_id: string;
  record_event_at: Date;
  created_at: Date;
  updated_at: Date;
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

export interface TasksTable {
  task_id: string;
  user_id: string;
  title: string;
  goal: unknown;
  agent_id: string;
  timeout_seconds: number;
  trigger_type: "immediate" | "scheduled";
  trigger: unknown;
  output: unknown;
  ext_data: unknown;
  status: "active" | "paused" | "completed" | "cancelled";
  next_run_at: Date | null;
  source_session_id: string | null;
  source_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskRunsTable {
  run_id: string;
  task_id: string;
  user_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  scheduled_at: Date;
  worker_session_id: string | null;
  result_media_id: string | null;
  result: unknown | null;
  error: unknown | null;
  ext_data: unknown;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
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
  projects: ProjectsTable;
  project_records: ProjectRecordsTable;
  media_assets: MediaAssetsTable;
  vector_items: VectorItemsTable;
  user_preferences: UserPreferencesTable;
  tasks: TasksTable;
  task_runs: TaskRunsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
