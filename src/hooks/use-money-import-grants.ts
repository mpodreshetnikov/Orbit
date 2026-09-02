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

const GRANT_COLUMNS =
  "id, person_id, label, allowed_sources, expires_at, revoked_at, last_used_at, created_at";

/**
 * `money_import_grants` is in the generated `Database` types now, so the typed client can name it
 * directly. It was not when this hook was written -- the artifact check passed while the table was
 * missing from them entirely, which #61 has since fixed -- and a hand-written interface plus an
 * `as unknown as` cast stood in for it. Both go with the reason for them.
 */
function grantsTable(supabase: ReturnType<typeof createClient>) {
  return supabase.from("money_import_grants");
}

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
  const { data, error } = await grantsTable(supabase)
    .select(GRANT_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
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

      // The issuer is not sent. `created_by_auth_user_id` defaults to `auth.uid()`, and the insert
      // policy has always required it to equal `auth.uid()` -- so asking `supabase.auth.getUser()`
      // first was a network round trip to learn the only value the database would have accepted.
      // It was also in front of the one call on this screen that must not fail to settle: the key
      // below lives in this closure and nowhere else until the row lands, so a request that never
      // returns loses a credential that is already real.

      // The token exists in this function and in the reply to the caller, nowhere else:
      // only its hash is stored, so a lost token is reissued rather than recovered.
      const token = generateGrantToken();
      // The id is chosen here rather than by the database, so that a lost response can be told
      // apart from a failed insert. Without it, a disconnect after the row commits leaves an
      // active grant whose only plaintext key was shown zero times and cannot be recovered --
      // the one failure this screen must not have, since the key exists nowhere else.
      const id = crypto.randomUUID();
      const { data, error } = await grantsTable(supabase)
        .insert({
          id,
          person_id: input.personId,
          label: input.label.trim(),
          token_hash: await hashGrantToken(token),
          allowed_sources: input.allowedSources,
          expires_at: input.expiresAt ?? null,
        })
        .select(GRANT_COLUMNS)
        .single();

      if (data) return { grant: data, token };

      // Ask whether it landed anyway. The token is still in hand, so if the row is there this
      // is a delivery failure rather than an issuance failure, and the caller can be given both.
      const { data: reconciled } = await grantsTable(supabase)
        .select(GRANT_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (reconciled) return { grant: reconciled, token };

      throw new Error(error?.message ?? "The grant was created but not returned");
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
      const { error } = await grantsTable(supabase)
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", grantId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GRANTS_QUERY_KEY });
    },
  });
}
