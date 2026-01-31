"use client";

import { useTranslations } from "next-intl";
import { FileText, Library, FlaskConical, Ruler, Stethoscope, HeartPulse, CalendarCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const sidebarLinks = [
  {
    href: "/health",
    icon: FileText,
    labelKey: "health.records",
  },
  {
    href: "/health/measurements",
    icon: Ruler,
    labelKey: "measurements.navTitle",
  },
  {
    href: "/health/observations",
    icon: FlaskConical,
    labelKey: "observationHistory.title",
  },
  {
    href: "/health/findings",
    icon: Stethoscope,
    labelKey: "findings.navTitle",
  },
  {
    href: "/health/conditions",
    icon: HeartPulse,
    labelKey: "conditions.navTitle",
  },
  {
    href: "/health/checkups",
    icon: CalendarCheck,
    labelKey: "checkups.navTitle",
  },
  {
    href: "/health/catalogs",
    icon: Library,
    labelKey: "catalogs.title",
  },
];

export function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1 bg-background border-r px-3 py-4">
      {sidebarLinks.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
            )}
          >
            <link.icon className="h-4 w-4" />
            {t(link.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
