"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Library, FlaskConical, Ruler, Stethoscope, HeartPulse, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddMeasurementDialog } from "@/components/measurements/add-measurement-dialog";
import { useUIStore } from "@/stores/ui-store";

const navLinks = [
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
    labelKey: "observationHistory.navTitle",
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
    href: "/health/catalogs",
    icon: Library,
    labelKey: "catalogs.title",
  },
];

export function MobileNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const [measurementDialogOpen, setMeasurementDialogOpen] = useState(false);
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);

  return (
    <>
      {/* Bottom Navigation: safe area for home indicator / notches */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] border-t bg-background md:hidden pb-[max(0.5rem,var(--safe-area-inset-bottom))] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]">
        <div className="flex h-14 items-stretch">
          {/* Scrollable nav items - takes remaining space, shows max ~5 items */}
          <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide min-w-0">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors shrink-0",
                    "w-[calc((100vw-4rem-var(--safe-area-inset-left)-var(--safe-area-inset-right))/5)]",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  <link.icon className="h-5 w-5" />
                  <span className="whitespace-nowrap text-center truncate max-w-full px-1">{t(link.labelKey)}</span>
                </Link>
              );
            })}
          </div>

          {/* Superbutton - fixed on right side */}
          <div className="flex items-center justify-center px-2 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-11 w-11 rounded-xl shadow-lg bg-gradient-to-br from-violet-400 via-purple-500 to-violet-600 hover:from-violet-500 hover:via-purple-600 hover:to-violet-700 text-white border-0 transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  <Sparkles className="h-5 w-5" />
                  <span className="sr-only">{t("nav.quickAdd")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="mb-2 min-w-[200px]">
                <DropdownMenuItem asChild>
                  <Link href="/health/records/new" className="flex items-center gap-3 py-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                      <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <span className="font-medium">{t("nav.addMedicalRecord")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setMeasurementDialogOpen(true)}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                    <Ruler className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="font-medium">{t("nav.addMeasurement")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      {/* Add Measurement Dialog */}
      <AddMeasurementDialog
        open={measurementDialogOpen}
        onOpenChange={setMeasurementDialogOpen}
        personId={selectedPersonId}
      />
    </>
  );
}
