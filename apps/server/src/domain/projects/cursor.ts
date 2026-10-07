export type Cursor = { time: string; id: string };
export function encodeCursor(scope: unknown, value: Cursor): string {
  return Buffer.from(JSON.stringify({ scope, ...value })).toString("base64url");
}
export function decodeCursor(raw: string | undefined, scope: unknown): Cursor | undefined | null {
  if (raw === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (JSON.stringify(v.scope) !== JSON.stringify(scope) || typeof v.time !== "string" || !Number.isFinite(Date.parse(v.time)) || typeof v.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.id)) return null;
    return { time: v.time, id: v.id };
  } catch { return null; }
}
export function page<T>(rows: T[], limit: number, scope: unknown, cursor: (row: T) => Cursor) {
  const data = rows.slice(0, limit), hasMore = rows.length > limit;
  return { data, hasMore, nextCursor: hasMore ? encodeCursor(scope, cursor(data.at(-1)!)) : null, pageSize: limit };
}
