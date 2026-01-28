"use client";

import { useParams } from "next/navigation";
import { RecordDetail } from "@/components/records";

export default function RecordDetailPage() {
  const params = useParams();
  const recordId = params.id as string;

  return <RecordDetail recordId={recordId} />;
}
