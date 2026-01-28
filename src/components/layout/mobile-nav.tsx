"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Library, FlaskConical, Ruler, Stethoscope, HeartPulse, Plus } from "lucide-react";
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
      {/* Floating Action Button */}
      <div className="fixed bottom-20 right-4 z-[60] md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="lg"
              className="h-14 w-14 rounded-full shadow-lg"
            >
              <Plus className="h-6 w-6" />
              <span className="sr-only">{t("nav.quickAdd")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-2">
            <DropdownMenuItem asChild>
              <Link href="/health/records/new" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t("nav.addMedicalRecord")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => setMeasurementDialogOpen(true)}
              className="flex items-center gap-2"
            >
              <Ruler className="h-4 w-4" />
              {t("nav.addMeasurement")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] h-16 border-t bg-background md:hidden">
        <div className="flex h-full items-center overflow-x-auto scrollbar-hide px-2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors min-w-[64px]",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-primary"
                )}
              >
                <link.icon className="h-5 w-5" />
                <span className="whitespace-nowrap text-center">{t(link.labelKey)}</span>
              </Link>
            );
          })}
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
