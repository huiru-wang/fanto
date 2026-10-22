import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { FantoListPage } from "../fanto/FantoListPage";
import { FantoProvider, useFanto } from "../fanto/FantoContext";
import { FantoSettingsPage } from "../fanto/FantoSettingsPage";
import { useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { StartupExperience } from "../auth/StartupExperience";
import { AppShell } from "../components/AppShell";
import { ChatPage } from "../pages/ChatPage";

export function App() {
  const auth = useAuth();
  if (auth.status === "signedOut") return <LoginPage />;
  if (auth.status === "restoring" || auth.status === "loggingOut" || auth.status === "error" || auth.status === "logoutError") {
    return <StartupExperience state={auth.status === "error" || auth.status === "logoutError" ? "error" : auth.status} message={auth.error}
      onRetry={() => void (auth.status === "logoutError" ? auth.logout() : auth.retry())} />;
  }
  return <FantoProvider key={auth.user?.userId}><FantoBootstrap /></FantoProvider>;
}

function FantoBootstrap() {
  const profile = useFanto();
  const [ready, setReady] = useState(false);
  useEffect(() => { if (!profile.loading && !profile.error && profile.sessionId) setReady(true); }, [profile.loading, profile.error, profile.sessionId]);
  if (!ready && (profile.loading || profile.error || !profile.sessionId)) {
    return <StartupExperience state={profile.error ? "error" : "preparing"} message={profile.error || "正在准备你的 Fanto…"}
      onRetry={() => void profile.refresh()} />;
  }
  return <AppContent />;
}

function AppContent() {
  const profile = useFanto();
  const auth = useAuth();
  const location = useLocation();
  const [chatVisited, setChatVisited] = useState(location.pathname === "/chat");
  useEffect(() => { if (location.pathname === "/chat") setChatVisited(true); }, [location.pathname]);
  return (
    <AppShell>
      <button className="auth-logout" type="button" onClick={() => void auth.logout()} aria-label="退出登录">退出登录</button>
      <div hidden={location.pathname !== "/chat"}>{(chatVisited || location.pathname === "/chat") && <ChatPage key={profile.sessionId ?? "loading"} active={location.pathname === "/chat"} />}</div>
      <Routes>
        <Route path="/chat" element={null} />
        <Route path="/fanto/settings" element={<Navigate to={profile.selectedId ? `/fantos/${profile.selectedId}` : "/fantos"} replace />} />
        <Route path="/fantos" element={<FantoListPage />} />
        <Route path="/fantos/new" element={<FantoSettingsPage creating />} />
        <Route path="/fantos/:fantoId" element={<FantoSettingsPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </AppShell>
  );
}
