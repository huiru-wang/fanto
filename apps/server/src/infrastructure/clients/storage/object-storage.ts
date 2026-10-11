export type SignedUrl = { url: string; expiresAt: string };
export type ObjectMetadata = { bytes: number; contentType: string; etag: string; metadata: Record<string, string> };

export interface ObjectStorage {
  signUpload(key: string, contentType: string, expiresSeconds: number): Promise<SignedUrl>;
  signRead(key: string, expiresSeconds: number): Promise<SignedUrl>;
  head(key: string): Promise<ObjectMetadata | null>;
  getObject(key: string, options?: { maxBytes?: number }): Promise<Buffer>;
  putObject(key: string, data: Buffer, contentType: string, options?: { metadata?: Record<string, string> }): Promise<void>;
  remove(key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); this.name = "StorageError"; }
}
