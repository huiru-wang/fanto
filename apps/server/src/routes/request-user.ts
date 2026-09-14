const userIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function validUserId(value: string | undefined): value is string { return !!value && userIdPattern.test(value); }

export function requireUserId(request: Request) {
  const userId = request.headers.get("x-user-id")?.trim();
  if (!validUserId(userId)) throw new Error("Missing or invalid x-user-id");
  return userId;
}
