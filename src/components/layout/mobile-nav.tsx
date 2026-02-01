"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { FileText, Library, FlaskConical, Ruler, Stethoscope, HeartPulse, CalendarCheck, Sparkles, Pill } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddMeasurementDialog } from "@/components/measurements/add-measurement-dialog";
import { useUIStore } from "@/stores/ui-store";

const navLinks = [
  {
    href: "/health",
    icon: FileText,
    labelKey: "health.records",
  },
  {
    href: "/health/medications",
    icon: Pill,
    labelKey: "medications.navTitle",
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

export function MobileNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const [measurementDialogOpen, setMeasurementDialogOpen] = useState(false);
  const [medicationTypeDialogOpen, setMedicationTypeDialogOpen] = useState(false);
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightShadow, setShowRightShadow] = useState(false);

  const updateScrollShadow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const hasOverflow = scrollWidth > clientWidth;
    const notAtEnd = scrollLeft < scrollWidth - clientWidth - 1;
    setShowRightShadow(hasOverflow && notAtEnd);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollShadow();
    const ro = new ResizeObserver(updateScrollShadow);
    ro.observe(el);
    el.addEventListener("scroll", updateScrollShadow);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateScrollShadow);
    };
  }, []);

  const openNewMedication = (kind: "regular" | "one_time") => {
    setMedicationTypeDialogOpen(false);
    router.push(`/health/medications/new?kind=${kind}`);
  };

  return (
    <>
      {/* Bottom Navigation: safe area for home indicator / notches */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] border-t bg-background md:hidden pb-[max(0.5rem,var(--safe-area-inset-bottom))] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]">
        <div className="flex h-14 items-stretch">
          {/* Scrollable nav items - takes remaining space, shows max ~5 items */}
          <div className="flex-1 relative min-w-0">
            <div
              ref={scrollRef}
              className="flex h-full items-center overflow-x-auto scrollbar-hide"
            >
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
            {/* Right-edge shadow when scrollable and not at end */}
            {showRightShadow && (
              <div
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-r from-transparent to-background shadow-[inset_-6px_0_10px_-4px_rgba(0,0,0,0.08)] dark:shadow-[inset_-6px_0_10px_-4px_rgba(0,0,0,0.25)]"
                aria-hidden
              />
            )}
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
                  <span className="sr-only">{t("nav.quickCreate")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="mb-2 min-w-[200px]">
                <DropdownMenuItem asChild>
                  <Link href="/health/records/new" className="flex items-center gap-3 py-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                      <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <span className="font-medium">{t("nav.medicalRecord")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setMeasurementDialogOpen(true)}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                    <Ruler className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="font-medium">{t("nav.measurement")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setMedicationTypeDialogOpen(true)}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                    <Pill className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="font-medium">{t("nav.medication")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      {/* Measurement dialog */}
      <AddMeasurementDialog
        open={measurementDialogOpen}
        onOpenChange={setMeasurementDialogOpen}
        personId={selectedPersonId}
      />

      {/* Medication type choice (mobile: popup instead of submenu) */}
      <Dialog open={medicationTypeDialogOpen} onOpenChange={setMedicationTypeDialogOpen}>
        <DialogContent className="max-w-[min(320px,calc(100vw-32px))] gap-0">
          <DialogHeader>
            <DialogTitle>{t("nav.medication")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-4">
            <Button
              variant="outline"
              className="justify-start h-12 text-base"
              onClick={() => openNewMedication("regular")}
            >
              <Pill className="h-4 w-4 mr-3 text-violet-600 dark:text-violet-400" />
              {t("nav.regularMedication")}
            </Button>
            <Button
              variant="outline"
              className="justify-start h-12 text-base"
              onClick={() => openNewMedication("one_time")}
            >
              <Pill className="h-4 w-4 mr-3 text-violet-600 dark:text-violet-400" />
              {t("nav.oneTimeMedication")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
