"use client";

import { AppShell } from "@/components/layout";
import { MeasurementCatalogList } from "@/components/catalogs";

export default function MeasurementCatalogPage() {
  return (
    <AppShell>
      <MeasurementCatalogList />
    </AppShell>
  );
}
