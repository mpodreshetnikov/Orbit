"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Heart,
  ChevronDown,
  Settings,
  Plus,
  FileText,
  Ruler,
  Pill,
  Smartphone,
  Wallet,
  CreditCard,
  Tags,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import { PersonSelector } from "./person-selector";
import { UserMenu } from "@/components/auth/user-menu";
import { AddMeasurementDialog } from "@/components/measurements/add-measurement-dialog";
import { useUIStore } from "@/stores/ui-store";
import { getAppSection } from "@/lib/app-section";

export function TopNav() {
  const t = useTranslations();
  const [measurementDialogOpen, setMeasurementDialogOpen] = useState(false);
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const pathname = usePathname();
  const section = getAppSection(pathname);
  const isMoney = section === "money";

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-[60] h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-[var(--safe-area-inset-top)] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]">
        <div className="w-full max-w-full md:container md:mx-auto flex h-full min-h-[4rem] items-center justify-between px-4">
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
                  <span className="text-sm">{isMoney ? t("nav.money") : t("nav.health")}</span>
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
                <DropdownMenuItem asChild>
                  <Link href="/money" className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    {t("nav.money")}
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
                    <span className="sr-only">{t("nav.quickCreate")}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8}>
                  {isMoney ? (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/money/transactions/new" className="flex items-center gap-2">
                          <Wallet className="h-4 w-4" />
                          {t("money.addTransaction")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/money/accounts?new=1" className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          {t("money.addAccount")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/money/categories?new=1" className="flex items-center gap-2">
                          <Tags className="h-4 w-4" />
                          {t("money.addCategory")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/money/rules" className="flex items-center gap-2">
                          <Workflow className="h-4 w-4" />
                          {t("money.rules")}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/health/records/new" className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          {t("nav.medicalRecord")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setMeasurementDialogOpen(true)}
                        className="flex items-center gap-2"
                      >
                        <Ruler className="h-4 w-4" />
                        {t("nav.measurement")}
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2">
                          <Pill className="h-4 w-4" />
                          {t("nav.medication")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem asChild>
                            <Link
                              href="/health/medications/new?kind=regular"
                              className="flex items-center gap-2"
                            >
                              {t("nav.regularMedication")}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href="/health/medications/new?kind=one_time"
                              className="flex items-center gap-2"
                            >
                              {t("nav.oneTimeMedication")}
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </>
                  )}
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
                <div className="px-2 py-1.5 text-sm font-semibold">{t("settings.title")}</div>
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

      {/* Measurement dialog */}
      <AddMeasurementDialog
        open={measurementDialogOpen}
        onOpenChange={setMeasurementDialogOpen}
        personId={selectedPersonId}
      />
    </>
  );
}
