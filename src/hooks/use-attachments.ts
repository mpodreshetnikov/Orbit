"use client";

import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { RecordAttachment } from "@/types";

const BUCKET_NAME = "medical-attachments";

// ============================================================================
// GET SIGNED URL FOR ATTACHMENT
// ============================================================================
async function getAttachmentUrl(storagePath: string): Promise<string> {
  const supabase = createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 3600); // 1 hour expiry

  if (error) {
    throw new Error(error.message);
  }

  return data.signedUrl;
}

export function useAttachmentUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ["attachment-url", storagePath],
    queryFn: () => getAttachmentUrl(storagePath!),
    enabled: !!storagePath,
    staleTime: 1000 * 60 * 50, // Cache for 50 minutes (URL valid for 1 hour)
  });
}

// ============================================================================
// GET MULTIPLE SIGNED URLS
// ============================================================================
async function getAttachmentUrls(attachments: RecordAttachment[]): Promise<Record<string, string>> {
  const supabase = createClient();
  const urls: Record<string, string> = {};

  // Batch request for all URLs
  for (const attachment of attachments) {
    const { data } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(attachment.storage_path, 3600);

    if (data) {
      urls[attachment.id] = data.signedUrl;
    }
  }

  return urls;
}

export function useAttachmentUrls(attachments: RecordAttachment[]) {
  return useQuery({
    queryKey: ["attachment-urls", attachments.map((a) => a.id).sort()],
    queryFn: () => getAttachmentUrls(attachments),
    enabled: attachments.length > 0,
    staleTime: 1000 * 60 * 50,
  });
}

// ============================================================================
// UPDATE ATTACHMENT ORDER
// ============================================================================
interface UpdateOrderInput {
  attachmentId: string;
  recordId: string;
  newOrder: number;
}

async function updateAttachmentOrder({ attachmentId, newOrder }: UpdateOrderInput): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("record_attachments")
    .update({ sort_order: newOrder })
    .eq("id", attachmentId);

  if (error) {
    throw new Error(error.message);
  }
}

export function useUpdateAttachmentOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateAttachmentOrder,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["medical-record", variables.recordId],
      });
    },
  });
}
