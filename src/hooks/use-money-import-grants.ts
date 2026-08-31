"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";

export interface MoneyImportGrant {
  id: string;
  person_id: string;
  label: string;
  allowed_sources: string[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface CreateMoneyImportGrantInput {
  personId: string;
  label: string;
  allowedSources: string[];
  expiresAt?: string | null;
}

const GRANTS_QUERY_KEY = ["money-import-grants"];

/** 32 bytes of randomness, hex-encoded. Shown once, then only its SHA-256 is kept. */
export function generateGrantToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashGrantToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchGrants(): Promise<MoneyImportGrant[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_import_grants")
    .select(
      "id, person_id, label, allowed_sources, expires_at, revoked_at, last_used_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as MoneyImportGrant[];
}

export function useMoneyImportGrants() {
  return useQuery({
    queryKey: GRANTS_QUERY_KEY,
    queryFn: fetchGrants,
  });
}

export function useCreateMoneyImportGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateMoneyImportGrantInput,
    ): Promise<{ grant: MoneyImportGrant; token: string }> => {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw new Error(userError.message);
      if (!user) throw new Error("Not signed in");

      // The token exists in this function and in the reply to the caller, nowhere else:
      // only its hash is stored, so a lost token is reissued rather than recovered.
      const token = generateGrantToken();
      const { data, error } = await supabase
        .from("money_import_grants")
        .insert({
          person_id: input.personId,
          created_by_auth_user_id: user.id,
          label: input.label.trim(),
          token_hash: await hashGrantToken(token),
          allowed_sources: input.allowedSources,
          expires_at: input.expiresAt ?? null,
        })
        .select(
          "id, person_id, label, allowed_sources, expires_at, revoked_at, last_used_at, created_at",
        )
        .single();

      if (error) throw new Error(error.message);
      return { grant: data as MoneyImportGrant, token };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GRANTS_QUERY_KEY });
    },
  });
}

export function useRevokeMoneyImportGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string): Promise<void> => {
      const supabase = createClient();
      const { error } = await supabase
        .from("money_import_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", grantId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GRANTS_QUERY_KEY });
    },
  });
}
