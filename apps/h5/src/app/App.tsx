import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ChatPage } from "../pages/ChatPage";
import { RecordsPage } from "../pages/RecordsPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { SettingsPage } from "../pages/SettingsPage";

export function App() {
  const location = useLocation();
  const [chatVisited, setChatVisited] = useState(location.pathname === "/chat");
  useEffect(() => { if (location.pathname === "/chat") setChatVisited(true); }, [location.pathname]);
  return (
    <AppShell>
      <div hidden={location.pathname !== "/chat"}>{(chatVisited || location.pathname === "/chat") && <ChatPage active={location.pathname === "/chat"} />}</div>
      <Routes>
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/chat" element={null} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/records" replace />} />
      </Routes>
    </AppShell>
  );
}
