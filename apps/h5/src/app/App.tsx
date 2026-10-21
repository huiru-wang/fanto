import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { FantoListPage } from "../fanto/FantoListPage";
import { FantoProvider, useFanto } from "../fanto/FantoContext";
import { FantoSettingsPage } from "../fanto/FantoSettingsPage";
import { AppShell } from "../components/AppShell";
import { ChatPage } from "../pages/ChatPage";

export function App() {
  return <FantoProvider><AppContent /></FantoProvider>;
}

function AppContent() {
  const profile = useFanto();
  const location = useLocation();
  const [chatVisited, setChatVisited] = useState(location.pathname === "/chat");
  useEffect(() => { if (location.pathname === "/chat") setChatVisited(true); }, [location.pathname]);
  return (
    <AppShell>
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
