"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/layout";
import { FlaskConical, Ruler, ChevronRight, Stethoscope, MapPin } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const catalogLinks = [
  {
    href: "/health/catalogs/observations",
    icon: FlaskConical,
    titleKey: "catalogs.observations",
    descriptionKey: "catalogs.observationsDescription",
  },
  {
    href: "/health/catalogs/measurements",
    icon: Ruler,
    titleKey: "catalogs.measurements",
    descriptionKey: "catalogs.measurementsDescription",
  },
  {
    href: "/health/catalogs/finding-types",
    icon: Stethoscope,
    titleKey: "catalogs.findingTypes",
    descriptionKey: "catalogs.findingTypesDescription",
  },
  {
    href: "/health/catalogs/body-sites",
    icon: MapPin,
    titleKey: "catalogs.bodySites",
    descriptionKey: "catalogs.bodySitesDescription",
  },
];

export default function CatalogsPage() {
  const t = useTranslations();

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("catalogs.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("catalogs.description")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalogLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <link.icon className="h-8 w-8 text-primary" />
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <CardTitle className="mt-4">{t(link.titleKey)}</CardTitle>
                  <CardDescription>{t(link.descriptionKey)}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
