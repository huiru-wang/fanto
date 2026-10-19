import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LogOut, Users, PanelLeft } from "lucide-react";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { UsersPage } from "../pages/UsersPage";
import { UserDetailPage } from "../pages/UserDetailPage";
function Shell() {
  const { token, logout } = useAuth();
  const location = useLocation();
  if (!token) return <LoginPage/>;
  return <div className="app-layout"><aside className="sidebar">
    <div className="brand"><span className="brand-icon">f</span><span><strong>Fanto</strong><small>ADMIN CONSOLE</small></span></div>
    <span className="sidebar-label">WORKSPACE</span>
    <Link className={`nav-item ${location.pathname.startsWith("/users") ? "active" : ""}`} to="/users"><Users size={18}/> 用户管理</Link>
    <div className="sidebar-bottom"><span className="local-label"><span className="local-dot"/> LOCAL ONLY</span><button className="text-button" onClick={logout}><LogOut size={16}/> 退出</button></div>
  </aside><main className="main"><header className="topbar"><span><PanelLeft size={16}/> Fanto 管理后台</span><span className="topbar-right">READ ONLY <span className="avatar">A</span></span></header>
    <div className="page-container"><Routes><Route path="/users" element={<UsersPage/>}/><Route path="/users/:userId" element={<UserDetailPage/>}/><Route path="*" element={<Navigate to="/users" replace/>}/></Routes></div>
  </main></div>;
}
export function App() { return <AuthProvider><BrowserRouter><Shell/></BrowserRouter></AuthProvider>; }
