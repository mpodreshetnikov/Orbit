"use client";

import { useMutation } from "@tanstack/react-query";
import type { PushSubscriptionInput } from "@/types";

async function pushSubscribe(input: PushSubscriptionInput): Promise<void> {
  const res = await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Push subscribe failed: ${res.status}`);
  }
}

export function usePushSubscribe() {
  return useMutation({
    mutationFn: pushSubscribe,
  });
}
