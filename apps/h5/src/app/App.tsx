import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ChatPage } from "../pages/ChatPage";
import { RecordsPage } from "../pages/RecordsPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/records" replace />} />
      </Routes>
    </AppShell>
  );
}
