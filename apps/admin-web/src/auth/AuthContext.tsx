import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const AuthContext = createContext<{ token: string | null; login: (token: string) => void; logout: () => void } | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  // Deliberately memory-only: no admin access token persists in local/session storage.
  const [token, setToken] = useState<string | null>(null);
  const value = useMemo(() => ({ token, login: setToken, logout: () => setToken(null) }), [token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("AuthProvider missing"); return ctx; }
