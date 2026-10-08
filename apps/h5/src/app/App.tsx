import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ChatPage } from "../pages/ChatPage";
import { RecordsPage } from "../pages/RecordsPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { TasksPage } from "../pages/TasksPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/records" replace />} />
      </Routes>
    </AppShell>
  );
}
