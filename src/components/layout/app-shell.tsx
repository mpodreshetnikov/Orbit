"use client";

import { TopNav } from "./top-nav";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { LanguageSync } from "./language-sync";
import { ProcessingIndicator } from "./processing-indicator";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen min-w-0 w-full max-w-full overflow-x-hidden bg-background">
      <LanguageSync />
      <TopNav />
      <div className="flex min-w-0 w-full max-w-full">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:pt-16">
          <Sidebar />
        </aside>
        {/* Main content: full width on mobile, safe areas for notched devices */}
        <main className="flex-1 min-w-0 w-full max-w-full md:pl-64 pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)] pt-[calc(4rem+var(--safe-area-inset-top))] pb-[calc(4.5rem+var(--safe-area-inset-bottom))] md:pt-16 md:pb-0">
          <div className="w-full max-w-full container mx-auto p-4 md:p-6 min-w-0">{children}</div>
        </main>
      </div>
      {/* Mobile bottom nav */}
      <MobileNav />
      {/* Processing indicator for background OCR jobs */}
      <ProcessingIndicator />
    </div>
  );
}
