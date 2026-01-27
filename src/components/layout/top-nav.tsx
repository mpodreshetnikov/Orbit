"use client";

import { useTranslations } from "next-intl";
import { Heart, ChevronDown, Settings, Plus } from "lucide-react";
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

export function TopNav() {
  const t = useTranslations();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-full items-center justify-between px-4">
        {/* Left: App name + Mini-app switcher */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Heart className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">{t("app.name")}</span>
          </Link>

          {/* Mini-app switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <Heart className="h-4 w-4" />
                <span>{t("nav.health")}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
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
        <div className="flex items-center gap-2">
          {/* Quick add button */}
          <Button variant="ghost" size="icon" asChild>
            <Link href="/health/records/new">
              <Plus className="h-5 w-5" />
              <span className="sr-only">{t("nav.quickAdd")}</span>
            </Link>
          </Button>

          {/* Person selector */}
          <PersonSelector />

          {/* Settings dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
                <span className="sr-only">{t("nav.settings")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
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
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Profile */}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
