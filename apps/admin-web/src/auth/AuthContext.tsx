import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const AuthContext = createContext<{ adminKey: string | null; login: (key: string) => void; logout: () => void } | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  // Keep the admin key only in memory; a page reload requires re-entry.
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const value = useMemo(() => ({ adminKey, login: setAdminKey, logout: () => setAdminKey(null) }), [adminKey]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("AuthProvider missing"); return ctx; }
