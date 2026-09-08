/**
 * Kysely Database 类型定义。
 */

import type { Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── users ──────────────────────────────────────────────────────

export interface UsersTable {
  id: string;
  wx_openid: string;
  created_at: string;
}

// ─── records ────────────────────────────────────────────────────

export interface RecordsTable {
  ext_data: Generated<string | null>;
  id: string;
  user_id: string;
  source: string;
  content: string;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UploadIntentsTable {
  id: string;
  user_id: string;
  object_key: string;
  mime_type: string;
  bytes: number;
  status: string;
  media_type: string;
  media_id: string | null;
  ext_data: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface MediaAssetsTable {
  id: string;
  user_id: string;
  object_key: string;
  media_type: string;
  mime_type: string;
  bytes: number;
  ext_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface DB {
  users: UsersTable;
  records: RecordsTable;
  upload_intents: UploadIntentsTable;
  media_assets: MediaAssetsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
