import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listFantos, type FantoSettings } from "../api/fanto";
import { getDefaultMainSession } from "../api/agent";
import { requestJson } from "../api/http";
import { matchingDefaultFanto, mergeFanto, usableSelection } from "./settings-state";

export type PendingDeletion = { fantoId: string; version: number; nickname: string };
type FantoState = {
  pendingDeletions: PendingDeletion[];
  updatePending: (pending: PendingDeletion, done?: boolean) => void;
  roles: FantoSettings[];
  selectedId: string | null;
  settings: FantoSettings | null;
  sessionId: string | null;
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
  accept: (role: FantoSettings) => void;
  forget: (id: string) => void;
  select: (id: string) => void;
};
const Context = createContext<FantoState | null>(null);
type Collection = { roles: FantoSettings[]; selectedId: string | null; defaultId: string | null };
const emptyCollection = (): Collection => ({ roles: [], selectedId: null, defaultId: null });

export function FantoProvider({ children }: { children: ReactNode }) {
  const [{ roles, selectedId, defaultId }, setCollection] = useState<Collection>(emptyCollection);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refreshId = useRef(0);
  const user = useRef<string | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletion[]>([]);
  const removed = useRef(new Set<string>());
  const updatePending = useCallback((pending: PendingDeletion, done = false) => {
    setPendingDeletions(old => [...old.filter(item => item.fantoId !== pending.fantoId), ...(done ? [] : [pending])]);
  }, []);
  useEffect(() => {
    try { if (user.current) sessionStorage.setItem(`fanto.pending.${user.current}`, JSON.stringify(pendingDeletions)); }
    catch { /* Keep retry targets in memory. */ }
  }, [pendingDeletions]);
  const accept = useCallback((role: FantoSettings) => {
    generation.current++;
    if (removed.current.has(role.fantoId)) return;
    setCollection(old => {
      const next = mergeFanto(old.roles, role);
      return { ...old, roles: next, selectedId: usableSelection(old.selectedId, next, old.defaultId) };
    });
  }, []);
  const forget = useCallback((id: string) => {
    generation.current++;
    removed.current.add(id);
    setCollection(old => {
      const next = old.roles.filter(role => role.fantoId !== id);
      return { ...old, roles: next, selectedId: usableSelection(old.selectedId, next, old.defaultId) };
    });
  }, []);
  const refresh = useCallback(async () => {
    const id = ++generation.current, requestId = ++refreshId.current;
    setLoading(true); setError("");
    try {
      const [main, rows, me] = await Promise.all([
        getDefaultMainSession(), listFantos(), requestJson<{ userId: string }>("/api/users/me"),
      ]);
      if (id !== generation.current) return;
      // A Session cannot silently fall back to a different role's history.
      const base = matchingDefaultFanto(rows, main, me.userId);
      if (!base) throw new Error("默认 Fanto 与会话不一致，请刷新后重试。");
      let savedSelection: string | null | undefined;
      const switchedUser = user.current !== me.userId;
      if (switchedUser) {
        user.current = me.userId;
        removed.current.clear();
        try {
          const stored: unknown = JSON.parse(sessionStorage.getItem(`fanto.pending.${me.userId}`) ?? "[]");
          setPendingDeletions(Array.isArray(stored) ? stored.filter((item): item is PendingDeletion =>
            !!item && typeof item.fantoId === "string" && item.fantoId !== base.fantoId
            && Number.isInteger(item.version) && item.version > 0 && typeof item.nickname === "string") : []);
          savedSelection = sessionStorage.getItem(`fanto.selected.${me.userId}`);
        } catch { setPendingDeletions([]); }
      }
      const visible = rows.filter(role => !removed.current.has(role.fantoId));
      setCollection(old => {
        const sameUser = !switchedUser;
        const next = visible.map(role => {
          const cached = sameUser ? old.roles.find(item => item.fantoId === role.fantoId) : undefined;
          return cached && cached.version > role.version ? cached : role;
        });
        return { roles: next, defaultId: base.fantoId,
          selectedId: usableSelection(savedSelection === undefined ? old.selectedId : savedSelection, next, base.fantoId) };
      });
    } catch (cause) {
      if (id === generation.current) setError(cause instanceof Error ? cause.message : "读取角色失败");
    } finally { if (requestId === refreshId.current) setLoading(false); }
  }, []);
  const select = useCallback((id: string) => setCollection(old => ({ ...old,
    selectedId: usableSelection(id, old.roles, old.defaultId),
  })), []);
  useEffect(() => {
    try { if (user.current && selectedId) sessionStorage.setItem(`fanto.selected.${user.current}`, selectedId); }
    catch { /* Keep in memory. */ }
  }, [selectedId]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const settings = roles.find(role => role.fantoId === selectedId && role.status === "active") ?? null;
  return <Context.Provider value={{ pendingDeletions, updatePending, roles, selectedId, settings,
    sessionId: settings?.sessionId ?? null, error, loading, refresh, accept, forget, select }}>{children}</Context.Provider>;
}
export function useFanto() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing FantoProvider");
  return value;
}
