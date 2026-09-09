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
  created_at: string;
  updated_at: string;
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

export interface MessagesTable {
  id: Generated<number>;
  user_id: string;
  session_id: string;
  role: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

export interface DB {
  users: UsersTable;
  records: RecordsTable;
  media_assets: MediaAssetsTable;
  messages: MessagesTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;
