"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout";
import { RecordDetail } from "@/components/records";

export default function RecordDetailPage() {
  const params = useParams();
  const recordId = params.id as string;

  return (
    <AppShell>
      <RecordDetail recordId={recordId} />
    </AppShell>
  );
}
