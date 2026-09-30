import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function createWorkspace(root: string, userId: string, sessionId: string): string {
  assertWorkspaceSegment(userId, "userId");
  assertWorkspaceSegment(sessionId, "sessionId");
  const workspace = resolve(root, userId, sessionId);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

export function assertWorkspacePath(workspace: string, path: string): void {
  if (isAbsolute(path)) throw new Error("File paths must be relative to the session workspace");
  const root = realpathSync(workspace);
  const target = resolve(root, path);
  if (!isWithin(root, target)) throw new Error("File paths must stay inside the session workspace");
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const resolvedExisting = realpathSync(existing);
  if (!isWithin(root, resolvedExisting)) throw new Error("File paths must not traverse workspace symlinks");
  if (existsSync(target) && lstatSync(target).isSymbolicLink() && !isWithin(root, realpathSync(target))) {
    throw new Error("File paths must not resolve outside the session workspace");
  }
}

function assertWorkspaceSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid workspace ${label}`);
  }
}

function isWithin(root: string, target: string): boolean {
  const difference = relative(root, target);
  return difference === "" || (!difference.startsWith("..") && !difference.includes("../"));
}
