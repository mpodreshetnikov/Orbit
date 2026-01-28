"use client";

import { AppShell } from "@/components/layout";

export default function HealthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
