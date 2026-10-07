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
  embedding: unknown | null;
}

export interface ProjectsTable {
  embedding: string | null;
  project_id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  summary: string;
  cover_media_id: string | null;
  content: string;
  status: "active" | "archived";
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProposalsTable {
  proposal_id: string;
  session_id: string | null;
  user_id: string;
  type: "create" | "extend";
  target_project_id: string | null;
  title: string;
  proposed_summary: string | null;
  content: unknown;
  status: "pending" | "accepted" | "rejected";
  result_project_id: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

export interface RecordLinksTable {
  user_id: string;
  outer_id: string;
  type: "project" | "proposal";
  record_id: string;
  record_event_at: Date;
  created_at: Date;
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

export interface MemoriesTable {
  memory_id: string;
  user_id: string;
  kind: "profile" | "goal" | "guidance";
  content: string;
  embedding: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface ProposalRunsTable {
  run_id: string; user_id: string; record_id: string; record_version: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  proposal_id: string | null; outcome: unknown; read_record_ids: unknown;
  agent_session_id: string | null; lease_token: string | null; lease_expires_at: Date | null;
  attempts: number; error_code: string | null; created_at: Date; updated_at: Date;
}
export interface CreationRunsTable {
  execution_plan: unknown;
  run_id: string; user_id: string; proposal_id: string; project_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  base_project_version: number | null; agent_session_id: string | null;
  lease_token: string | null; lease_expires_at: Date | null; progress: unknown;
  published_project_version: number | null; attempts: number; error_code: string | null;
  accepted_at: Date; created_at: Date; updated_at: Date;
}
export interface CreationImageStepsTable {
  run_id: string; image_index: number; fingerprint: string;
  status: "requested" | "response" | "saved" | "failed" | "unknown";
  media_id: string; metadata: unknown; recovery_ciphertext: string | null; recovery_expires_at: Date | null;
  error_code: string | null; created_at: Date; updated_at: Date;
}

export interface DB {
  users: UsersTable;
  user_login_identities: UserLoginIdentitiesTable;
  auth_challenges: AuthChallengesTable;
  records: RecordsTable;
  proposal_runs: ProposalRunsTable;
  creation_runs: CreationRunsTable;
  creation_image_steps: CreationImageStepsTable;
  projects: ProjectsTable;
  proposals: ProposalsTable;
  record_links: RecordLinksTable;
  media_assets: MediaAssetsTable;
  memories: MemoriesTable;
  tasks: TasksTable;
  task_runs: TaskRunsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
