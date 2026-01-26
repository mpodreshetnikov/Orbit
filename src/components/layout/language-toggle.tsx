"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore, type Language } from "@/stores/ui-store";

export function LanguageToggle() {
  const t = useTranslations();
  const { language, setLanguage } = useUIStore();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    // Set cookie for server-side rendering
    document.cookie = `app.lang=${lang};path=/;max-age=31536000`;
    // Reload to apply the new locale
    window.location.reload();
  };

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8">
        <Globe className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
          <Globe className="h-4 w-4" />
          <span className="text-xs uppercase">{language}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleLanguageChange("en")}>
          {t("languages.en")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleLanguageChange("ru")}>
          {t("languages.ru")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
