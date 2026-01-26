"use client";

import { useTranslations } from "next-intl";
import { FileText, MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navLinks = [
  {
    href: "/health",
    icon: FileText,
    labelKey: "health.records",
  },
  {
    href: "/health/chat",
    icon: MessageSquare,
    labelKey: "health.chat",
  },
];

export function MobileNav() {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-background md:hidden">
      {navLinks.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 text-xs font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-primary"
            )}
          >
            <link.icon className="h-5 w-5" />
            <span>{t(link.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
