import type { MoneyImportBatchStatus } from "@orbit-types/import";
import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A batch's status as the web's history and report badge it. */
export function BatchStatus({ status }: { status: MoneyImportBatchStatus }) {
  return <Badge label={t(`money.importBatchStatus${capitalized(status)}`)} />;
}

/** "22.10.2026 14:05", or a dash for none. */
export function importDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
