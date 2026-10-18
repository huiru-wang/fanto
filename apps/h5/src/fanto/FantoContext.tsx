import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getFantoSettings, type FantoSettings } from "../api/fanto";
const Context = createContext<{
    settings: FantoSettings | null;
    error: string;
    loading: boolean;
    refresh: () => Promise<void>;
    accept: (s: FantoSettings) => void;
} | null>(null);
export function FantoProvider({ children }: {
    children: ReactNode;
}) {
    const [settings, setSettings] = useState<FantoSettings | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
    const generation = useRef(0);
    const accept = useCallback((s: FantoSettings) => setSettings(old => !old || s.version >= old.version ? s : old), []);
    const refresh = useCallback(async () => { const id = ++generation.current; setLoading(true); setError(""); try {
        const s = await getFantoSettings();
        if (id === generation.current)
            accept(s);
    }
    catch (e) {
        if (id === generation.current)
            setError(e instanceof Error ? e.message : "读取失败");
    }
    finally {
        if (id === generation.current)
            setLoading(false);
    } }, [accept]);
    useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
    return <Context.Provider value={{ settings, error, loading, refresh, accept }}>{children}</Context.Provider>;
}
export function useFanto() { const value = useContext(Context); if (!value)
    throw new Error("Missing FantoProvider"); return value; }
