import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listFantos, type FantoSettings } from "../api/fanto";
import { getDefaultMainSession } from "../api/agent";
import { requestJson } from "../api/http";
import { mergeFanto, usableSelection } from "./settings-state";

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
  select: (id: string | null) => void;
};
const Context = createContext<FantoState | null>(null);
export function FantoProvider({ children }: { children: ReactNode }) {
  const [{ roles, selectedId }, setCollection] = useState<{ roles: FantoSettings[]; selectedId: string | null }>({ roles: [], selectedId: null });
  const [mainSession, setMainSession] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refreshId = useRef(0);
  const user = useRef<string | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletion[]>([]);
  const updatePending = useCallback((pending: PendingDeletion, done = false) => {
    setPendingDeletions(old => {
      const next = [...old.filter(item => item.fantoId !== pending.fantoId), ...(done ? [] : [pending])];
      return next;
    });
  }, []);
  useEffect(() => {
    try { if (user.current) sessionStorage.setItem(`fanto.pending.${user.current}`, JSON.stringify(pendingDeletions)); } catch { /* Keep retry targets in memory. */ }
  }, [pendingDeletions]);
  const removed = useRef(new Set<string>());
  const accept = useCallback((role: FantoSettings) => {
    generation.current++;
    if (removed.current.has(role.fantoId)) return;
    setCollection(old => {
      const next = mergeFanto(old.roles, role);
      return { roles: next, selectedId: usableSelection(old.selectedId, next) };
    });
  }, []);
  const forget = useCallback((id: string) => {
    generation.current++;
    removed.current.add(id);
    setCollection(old => {
      const next = old.roles.filter(role => role.fantoId !== id);
      return { roles: next, selectedId: usableSelection(old.selectedId, next) };
    });
  }, []);
  const refresh = useCallback(async () => {
    const id = ++generation.current, requestId = ++refreshId.current;
    setLoading(true); setError("");
    try {
      const [rows, main, me] = await Promise.all([listFantos(), getDefaultMainSession(), requestJson<{ userId: string }>("/api/users/me")]);
      if (id !== generation.current) return;
      let savedSelection: string | null | undefined;
      if (user.current !== me.userId) {
        user.current = me.userId;
        try {
          const stored: unknown = JSON.parse(sessionStorage.getItem(`fanto.pending.${me.userId}`) ?? "[]");
          setPendingDeletions(Array.isArray(stored) ? stored.filter((item): item is PendingDeletion =>
            !!item && typeof item.fantoId === "string" && Number.isInteger(item.version) && item.version > 0 && typeof item.nickname === "string") : []);
          savedSelection = sessionStorage.getItem(`fanto.selected.${me.userId}`);
        } catch { setPendingDeletions([]); }
      }
      const visible = rows.filter(role => !removed.current.has(role.fantoId));
      setCollection(old => {
        const next = visible.map(role => {
          const cached = old.roles.find(item => item.fantoId === role.fantoId);
          return cached && cached.version > role.version ? cached : role;
        });
        return { roles: next, selectedId: usableSelection(savedSelection === undefined ? old.selectedId : savedSelection, next) };
      });
      setMainSession(main);
    } catch (cause) {
      if (id === generation.current) setError(cause instanceof Error ? cause.message : "读取角色失败");
    } finally { if (requestId === refreshId.current) setLoading(false); }
  }, []);
  const select = useCallback((id: string | null) => setCollection(old => ({ ...old, selectedId: usableSelection(id, old.roles) })), []);
  useEffect(() => {
    try { if (user.current && mainSession) sessionStorage.setItem(`fanto.selected.${user.current}`, selectedId ?? "default"); } catch { /* Keep in memory. */ }
  }, [selectedId, mainSession]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const settings = roles.find(role => role.fantoId === selectedId && role.status === "active") ?? null;
  return <Context.Provider value={{ pendingDeletions, updatePending, roles, selectedId, settings, sessionId: settings?.sessionId ?? mainSession,
    error, loading, refresh, accept, forget, select }}>{children}</Context.Provider>;
}
export function useFanto() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing FantoProvider");
  return value;
}
