"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateMoneyTransferSelfAlias,
  useDeleteMoneyTransferSelfAlias,
  useMoneyTransferSelfAliases,
} from "@/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * "Псевдонимы для переводов себе": how the bank spells the owner's own name, so a transfer to
 * oneself drops out of every money total. It lived on the report page until T-261028-yhm moved it
 * here, beside the accounts the transfers move between.
 */
export function SelfTransferAliases({ personId }: { personId: string }) {
  const t = useTranslations();
  const [draft, setDraft] = useState("");
  const aliases = useMoneyTransferSelfAliases(personId);
  const createAlias = useCreateMoneyTransferSelfAlias();
  const deleteAlias = useDeleteMoneyTransferSelfAlias();

  async function addAlias() {
    const value = draft.trim();
    if (!value) {
      toast.error(t("money.reportAliasValidation"));
      return;
    }
    try {
      await createAlias.mutateAsync({ personId, alias: value });
      setDraft("");
      toast.success(t("money.reportAliasSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.reportAliasSaveFailed"));
    }
  }

  async function removeAlias(id: string) {
    try {
      await deleteAlias.mutateAsync(id);
      toast.success(t("money.reportAliasDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("money.reportAliasDeleteFailed"));
    }
  }

  return (
    <Card data-testid="self-transfer-aliases">
      <CardHeader>
        <CardTitle className="text-base">{t("money.reportSelfAliases")}</CardTitle>
        <CardDescription>{t("money.reportSelfAliasesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addAlias();
          }}
        >
          <Input
            aria-label={t("money.reportSelfAliases")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("money.reportAliasPlaceholder")}
          />
          <Button type="submit" disabled={createAlias.isPending}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("common.add")}
          </Button>
        </form>
        {(aliases.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("money.reportAliasesEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {(aliases.data ?? []).map((alias) => (
              <li
                key={alias.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div>
                  <p className="font-medium">{alias.alias}</p>
                  <p className="text-xs text-muted-foreground">{alias.normalized_alias}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("common.delete")} ${alias.alias}`}
                  onClick={() => removeAlias(alias.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
