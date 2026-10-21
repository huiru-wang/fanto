import type { ReactNode } from "react";

// §2.1: conversation is primary; identity and role navigation are secondary.
// §3.2, §6.1: use the existing neutral palette, 8/16/24 spacing and glass tokens.
export function AppShell({ children }: { children: ReactNode }) {
  return <main className="conversation-shell">{children}</main>;
}
