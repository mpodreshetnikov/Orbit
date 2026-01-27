"use client";

import { AppShell } from "@/components/layout";
import { ObservationCatalogList } from "@/components/catalogs";

export default function ObservationCatalogPage() {
  return (
    <AppShell>
      <ObservationCatalogList />
    </AppShell>
  );
}
