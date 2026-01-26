"use client";

import { TopNav } from "./top-nav";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { LanguageSync } from "./language-sync";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <LanguageSync />
      <TopNav />
      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:pt-16">
          <Sidebar />
        </aside>
        {/* Main content */}
        <main className="flex-1 md:pl-64 pt-16 pb-16 md:pb-0">
          <div className="container mx-auto p-4 md:p-6">{children}</div>
        </main>
      </div>
      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
