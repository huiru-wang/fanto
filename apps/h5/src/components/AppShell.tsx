import { MessageCircle, NotebookPen, Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const navigation = [
  { to: "/records", label: "记录", icon: NotebookPen },
  { to: "/chat", label: "Fanto", icon: MessageCircle },
  { to: "/settings", label: "设置", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18} strokeWidth={1.8} /></span>
          <span className="brand-name">Fanto</span>
        </div>

        <nav className="side-nav" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="status-dot" />
          <span>测试环境</span>
        </div>
      </aside>

      <main className="main-shell">{children}</main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `mobile-nav-item ${isActive ? "active" : ""}`}>
            <Icon size={21} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
