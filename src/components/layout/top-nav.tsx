"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Heart, ChevronDown, Settings, Plus, FileText, Ruler, Smartphone } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import { PersonSelector } from "./person-selector";
import { UserMenu } from "@/components/auth/user-menu";
import { AddMeasurementDialog } from "@/components/measurements/add-measurement-dialog";
import { useUIStore } from "@/stores/ui-store";

export function TopNav() {
  const t = useTranslations();
  const [measurementDialogOpen, setMeasurementDialogOpen] = useState(false);
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-[60] h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-full items-center justify-between px-4">
          {/* Left: App name + Mini-app switcher */}
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <Link href="/" className="flex items-center gap-2 font-semibold shrink-0">
              <Heart className="h-5 w-5 text-primary" />
              <span className="hidden sm:inline">{t("app.name")}</span>
            </Link>

            {/* Mini-app switcher - always visible */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2 sm:px-3">
                  <span className="text-sm">{t("nav.health")}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8}>
                <DropdownMenuItem asChild>
                  <Link href="/health" className="flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    {t("nav.health")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right: Quick add, Person selector, Settings, Profile */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Quick add dropdown - desktop only */}
            <div className="hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Plus className="h-5 w-5" />
                    <span className="sr-only">{t("nav.quickAdd")}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8}>
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

            {/* Person selector - shows name on all screen sizes */}
            <PersonSelector />

          {/* Settings dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
                <span className="sr-only">{t("nav.settings")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-48">
              <div className="px-2 py-1.5 text-sm font-semibold">
                {t("settings.title")}
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t("settings.theme")}</span>
                  <ThemeToggle />
                </div>
              </div>
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t("settings.language")}</span>
                  <LanguageToggle />
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings" className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  {t("settings.appSettings")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Profile */}
          <UserMenu />
        </div>
      </div>
    </header>

    {/* Add Measurement Dialog */}
    <AddMeasurementDialog
      open={measurementDialogOpen}
      onOpenChange={setMeasurementDialogOpen}
      personId={selectedPersonId}
    />
  </>
  );
}
