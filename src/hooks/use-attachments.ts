"use client";

import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { RecordAttachment } from "@/types";

const BUCKET_NAME = "medical-attachments";

// ============================================================================
// UPLOAD ATTACHMENT
// ============================================================================
interface UploadAttachmentInput {
  recordId: string;
  personId: string;
  file: File;
  sortOrder?: number;
}

async function uploadAttachment({
  recordId,
  personId,
  file,
  sortOrder = 0,
}: UploadAttachmentInput): Promise<RecordAttachment> {
  const supabase = createClient();

  // Generate unique filename to avoid collisions
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const storagePath = `${personId}/${recordId}/${timestamp}_${sanitizedName}`;

  // Upload file to storage
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // Create attachment record in database
  const { data, error } = await supabase
    .from("record_attachments")
    .insert({
      record_id: recordId,
      storage_path: storagePath,
      mime_type: file.type,
      original_filename: file.name,
      file_size: file.size,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error) {
    // Cleanup: delete the uploaded file if DB insert fails
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    throw new Error(error.message);
  }

  return data as RecordAttachment;
}

export function useUploadAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadAttachment,
    onSuccess: (data) => {
      // Invalidate the record to refresh attachments
      queryClient.invalidateQueries({
        queryKey: ["medical-record", data.record_id],
      });
    },
  });
}

// ============================================================================
// UPLOAD MULTIPLE ATTACHMENTS
// ============================================================================
interface UploadMultipleInput {
  recordId: string;
  personId: string;
  files: File[];
}

async function uploadMultipleAttachments({
  recordId,
  personId,
  files,
}: UploadMultipleInput): Promise<RecordAttachment[]> {
  const results: RecordAttachment[] = [];

  for (let i = 0; i < files.length; i++) {
    const attachment = await uploadAttachment({
      recordId,
      personId,
      file: files[i],
      sortOrder: i,
    });
    results.push(attachment);
  }

  return results;
}

export function useUploadMultipleAttachments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadMultipleAttachments,
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({
          queryKey: ["medical-record", data[0].record_id],
        });
      }
    },
  });
}

// ============================================================================
// DELETE ATTACHMENT
// ============================================================================
async function deleteAttachment(attachment: RecordAttachment): Promise<void> {
  const supabase = createClient();

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([attachment.storage_path]);

  if (storageError) {
    throw new Error(`Storage delete failed: ${storageError.message}`);
  }

  // Delete from database
  const { error } = await supabase
    .from("record_attachments")
    .delete()
    .eq("id", attachment.id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAttachment,
    onSuccess: (_, attachment) => {
      queryClient.invalidateQueries({
        queryKey: ["medical-record", attachment.record_id],
      });
    },
  });
}

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
async function getAttachmentUrls(
  attachments: RecordAttachment[]
): Promise<Record<string, string>> {
  const supabase = createClient();
  const urls: Record<string, string> = {};

  // Batch request for all URLs
  for (const attachment of attachments) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(attachment.storage_path, 3600);

    if (!error && data) {
      urls[attachment.id] = data.signedUrl;
    }
  }

  return urls;
}

export function useAttachmentUrls(attachments: RecordAttachment[]) {
  return useQuery({
    queryKey: [
      "attachment-urls",
      attachments.map((a) => a.id).sort(),
    ],
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

async function updateAttachmentOrder({
  attachmentId,
  newOrder,
}: UpdateOrderInput): Promise<void> {
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
