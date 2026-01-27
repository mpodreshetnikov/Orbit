"use client";

import { AppShell } from "@/components/layout";
import { FindingTypeCatalogList } from "@/components/catalogs";

export default function FindingTypeCatalogPage() {
  return (
    <AppShell>
      <FindingTypeCatalogList />
    </AppShell>
  );
}
