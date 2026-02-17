"use client";

import { use } from "react";
import { RecordDetail } from "@/components/records";

export default function RecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: recordId } = use(params);
  return <RecordDetail recordId={recordId} />;
}
