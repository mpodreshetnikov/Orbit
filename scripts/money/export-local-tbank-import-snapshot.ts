#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DEFAULT_SOURCE_ID = "tbank_web";
const INSERT_CHUNK_SIZE = 100;

export interface SnapshotColumn {
  name: string;
  dataType: string;
}

export interface DeleteTarget {
  column: string;
  values: Array<string | number>;
}

export interface SnapshotTable {
  name: string;
  mode: "insert" | "upsert";
  columns: SnapshotColumn[];
  rows: Array<Record<string, unknown>>;
  deleteBy?: DeleteTarget;
}

export interface SessionBatchLink {
  sessionId: string;
  batchId: string;
}

export interface ExportSnapshot {
  generatedAt: string;
  sourceId: string;
  batchId: string;
  tables: SnapshotTable[];
  sessionBatchLinks: SessionBatchLink[];
}

interface ParsedArgs {
  batchId?: string;
  dbUrl: string;
  outputPath?: string;
  sourceId: string;
}

interface BatchRecord {
  id: string;
  source: string;
  created_at: string;
}

const TABLE_EXPORTS: Array<{
  name: string;
  mode: SnapshotTable["mode"];
  sql: (batchIdLiteral: string) => string;
}> = [
  {
    name: "money_accounts",
    mode: "upsert",
    sql: (batchIdLiteral) => `
      SELECT DISTINCT account.*
      FROM public.money_accounts AS account
      JOIN public.money_transactions AS tx
        ON tx.account_id = account.id
      JOIN public.money_import_batch_rows AS row
        ON row.transaction_id = tx.id
      WHERE row.batch_id = ${batchIdLiteral}
      ORDER BY account.created_at, account.id
    `,
  },
  {
    name: "money_cards",
    mode: "upsert",
    sql: (batchIdLiteral) => `
      SELECT DISTINCT card.*
      FROM public.money_cards AS card
      JOIN public.money_transactions AS tx
        ON tx.card_id = card.id
      JOIN public.money_import_batch_rows AS row
        ON row.transaction_id = tx.id
      WHERE row.batch_id = ${batchIdLiteral}
      ORDER BY card.created_at, card.id
    `,
  },
  {
    name: "money_transaction_brands",
    mode: "upsert",
    sql: (batchIdLiteral) => `
      SELECT brand.*
      FROM public.money_transaction_brands AS brand
      WHERE brand.id IN (
        SELECT DISTINCT tx.brand_id
        FROM public.money_transactions AS tx
        JOIN public.money_import_batch_rows AS row
          ON row.transaction_id = tx.id
        WHERE row.batch_id = ${batchIdLiteral}
          AND tx.brand_id IS NOT NULL
        UNION
        SELECT DISTINCT resolution.selected_brand_id
        FROM public.money_import_batch_brand_resolutions AS resolution
        WHERE resolution.batch_id = ${batchIdLiteral}
          AND resolution.selected_brand_id IS NOT NULL
        UNION
        SELECT DISTINCT resolution.suggested_brand_id
        FROM public.money_import_batch_brand_resolutions AS resolution
        WHERE resolution.batch_id = ${batchIdLiteral}
          AND resolution.suggested_brand_id IS NOT NULL
      )
      ORDER BY brand.name, brand.id
    `,
  },
  {
    name: "money_import_sessions",
    mode: "insert",
    sql: (batchIdLiteral) => `
      SELECT session.*
      FROM public.money_import_sessions AS session
      WHERE session.id = (
        SELECT batch.session_id
        FROM public.money_import_batches AS batch
        WHERE batch.id = ${batchIdLiteral}
      )
      ORDER BY session.created_at, session.id
    `,
  },
  {
    name: "money_import_batches",
    mode: "insert",
    sql: (batchIdLiteral) => `
      SELECT batch.*
      FROM public.money_import_batches AS batch
      WHERE batch.id = ${batchIdLiteral}
      ORDER BY batch.created_at, batch.id
    `,
  },
  {
    name: "money_transactions",
    mode: "insert",
    sql: (batchIdLiteral) => `
      SELECT tx.*
      FROM public.money_transactions AS tx
      WHERE tx.id IN (
        SELECT DISTINCT row.transaction_id
        FROM public.money_import_batch_rows AS row
        WHERE row.batch_id = ${batchIdLiteral}
          AND row.transaction_id IS NOT NULL
      )
      ORDER BY tx.posted_at, tx.id
    `,
  },
  {
    name: "money_line_items",
    mode: "insert",
    sql: (batchIdLiteral) => `
      SELECT line_item.*
      FROM public.money_line_items AS line_item
      WHERE line_item.transaction_id IN (
        SELECT DISTINCT row.transaction_id
        FROM public.money_import_batch_rows AS row
        WHERE row.batch_id = ${batchIdLiteral}
          AND row.transaction_id IS NOT NULL
      )
      ORDER BY line_item.transaction_id, line_item.created_at, line_item.id
    `,
  },
  {
    name: "money_import_batch_brand_resolutions",
    mode: "insert",
    sql: (batchIdLiteral) => `
      SELECT resolution.*
      FROM public.money_import_batch_brand_resolutions AS resolution
      WHERE resolution.batch_id = ${batchIdLiteral}
      ORDER BY resolution.source_name, resolution.source_key, resolution.id
    `,
  },
  {
    name: "money_import_batch_rows",
    mode: "insert",
    sql: (batchIdLiteral) => `
      SELECT row.*
      FROM public.money_import_batch_rows AS row
      WHERE row.batch_id = ${batchIdLiteral}
      ORDER BY row.source_row_index, row.source_line_index NULLS FIRST, row.created_at, row.id
    `,
  },
];

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dbUrl: process.env.SUPABASE_LOCAL_DB_URL?.trim() || DEFAULT_LOCAL_DB_URL,
    sourceId: DEFAULT_SOURCE_ID,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--batch-id" && argv[index + 1]) {
      parsed.batchId = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current === "--db-url" && argv[index + 1]) {
      parsed.dbUrl = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current === "--output" && argv[index + 1]) {
      parsed.outputPath = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current === "--source" && argv[index + 1]) {
      parsed.sourceId = argv[index + 1].trim() || DEFAULT_SOURCE_ID;
      index += 1;
    }
  }

  return parsed;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function psqlQuery(dbUrl: string, sql: string): string {
  return execFileSync("psql", [dbUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    env: {
      ...process.env,
      PGCLIENTENCODING: "UTF8",
    },
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function psqlJson<T>(dbUrl: string, sql: string): T {
  const result = psqlQuery(
    dbUrl,
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM (${sql}) AS t;`,
  );
  return JSON.parse(result || "[]") as T;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeSessionRowsForInsert(
  rows: Array<Record<string, unknown>>,
  links: SessionBatchLink[],
): Array<Record<string, unknown>> {
  const batchBySessionId = new Map(links.map((link) => [link.sessionId, link.batchId]));
  return rows.map((row) => {
    const rowId = typeof row.id === "string" ? row.id : null;
    if (!rowId || !batchBySessionId.has(rowId)) {
      return row;
    }

    return {
      ...row,
      batch_id: null,
    };
  });
}

function formatSqlValue(value: unknown, column: SnapshotColumn): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (column.dataType === "json" || column.dataType === "jsonb") {
    return `${sqlStringLiteral(JSON.stringify(value))}::jsonb`;
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot serialize non-finite number for ${column.name}`);
    }
    return `${value}`;
  }

  if (typeof value === "string") {
    return sqlStringLiteral(value);
  }

  return sqlStringLiteral(JSON.stringify(value));
}

function buildInsertStatements(table: SnapshotTable): string[] {
  const sourceRows =
    table.name === "money_import_sessions"
      ? normalizeSessionRowsForInsert(table.rows, [])
      : table.rows;

  if (sourceRows.length === 0) {
    return [`-- No rows to insert for public.${table.name}`];
  }

  const columnList = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const updateColumns = table.columns.filter((column) => column.name !== "id");
  const conflictClause =
    table.mode === "upsert"
      ? updateColumns.length > 0
        ? `\nON CONFLICT (${quoteIdentifier("id")}) DO UPDATE SET ${updateColumns
            .map(
              (column) =>
                `${quoteIdentifier(column.name)} = EXCLUDED.${quoteIdentifier(column.name)}`,
            )
            .join(", ")}`
        : `\nON CONFLICT (${quoteIdentifier("id")}) DO NOTHING`
      : "";

  return chunk(sourceRows, INSERT_CHUNK_SIZE).map((rows) => {
    const valuesSql = rows
      .map((row) => {
        const rowSql = table.columns
          .map((column) => formatSqlValue(row[column.name], column))
          .join(", ");
        return `  (${rowSql})`;
      })
      .join(",\n");
    return `INSERT INTO public.${quoteIdentifier(table.name)} (${columnList})\nVALUES\n${valuesSql}${conflictClause};`;
  });
}

function buildInsertStatementsForTable(table: SnapshotTable, links: SessionBatchLink[]): string[] {
  if (table.name !== "money_import_sessions") {
    return buildInsertStatements(table);
  }

  return buildInsertStatements({
    ...table,
    rows: normalizeSessionRowsForInsert(table.rows, links),
  });
}

function buildDeleteStatement(table: SnapshotTable): string | null {
  if (!table.deleteBy || table.deleteBy.values.length === 0) {
    return null;
  }

  const valuesSql = table.deleteBy.values
    .map((value) => (typeof value === "number" ? `${value}` : sqlStringLiteral(`${value}`)))
    .join(", ");
  return `DELETE FROM public.${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(table.deleteBy.column)} IN (${valuesSql});`;
}

function buildSessionBatchLinkStatements(links: SessionBatchLink[]): string[] {
  return links.map(
    (link) =>
      `UPDATE public.${quoteIdentifier("money_import_sessions")} SET ${quoteIdentifier("batch_id")} = ${sqlStringLiteral(link.batchId)} WHERE ${quoteIdentifier("id")} = ${sqlStringLiteral(link.sessionId)};`,
  );
}

export function buildSnapshotSql(snapshot: ExportSnapshot): string {
  const lines: string[] = [
    `-- Generated snapshot for local TBank import batch ${snapshot.batchId}`,
    `-- Source: ${snapshot.sourceId}`,
    `-- Exported at: ${snapshot.generatedAt}`,
    "-- Replays the saved import state locally without fetching TBank again.",
    "",
    "BEGIN;",
    "",
  ];

  for (const table of snapshot.tables) {
    lines.push(`-- public.${table.name}: ${table.rows.length} row(s)`);
    const deleteStatement = buildDeleteStatement(table);
    if (deleteStatement) {
      lines.push(deleteStatement);
    }
    lines.push(...buildInsertStatementsForTable(table, snapshot.sessionBatchLinks));
    lines.push("");
  }

  if (snapshot.sessionBatchLinks.length > 0) {
    lines.push("-- Restore session -> batch links after both rows exist");
    lines.push(...buildSessionBatchLinkStatements(snapshot.sessionBatchLinks));
    lines.push("");
  }

  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

function buildDefaultOutputPath(batch: BatchRecord): string {
  const createdAt = new Date(batch.created_at);
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  const stamp = [
    createdAt.getUTCFullYear(),
    pad(createdAt.getUTCMonth() + 1),
    pad(createdAt.getUTCDate()),
    pad(createdAt.getUTCHours()),
    pad(createdAt.getUTCMinutes()),
    pad(createdAt.getUTCSeconds()),
  ].join("");
  return path.resolve(
    process.cwd(),
    "supabase",
    "snippets",
    `${stamp}_save_local_tbank_import_batch_${batch.id.slice(0, 8)}.sql`,
  );
}

function fetchColumns(dbUrl: string, tableName: string): SnapshotColumn[] {
  return psqlJson<SnapshotColumn[]>(
    dbUrl,
    `
      SELECT
        column_name AS name,
        data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${sqlStringLiteral(tableName)}
      ORDER BY ordinal_position
    `,
  );
}

function fetchLatestBatch(dbUrl: string, sourceId: string): BatchRecord {
  const rows = psqlJson<BatchRecord[]>(
    dbUrl,
    `
      SELECT batch.id, batch.source, batch.created_at
      FROM public.money_import_batches AS batch
      WHERE batch.source = ${sqlStringLiteral(sourceId)}
        AND batch.status = 'completed'
      ORDER BY batch.created_at DESC
      LIMIT 1
    `,
  );
  if (rows.length === 0) {
    throw new Error(`No completed ${sourceId} batch found in the local database.`);
  }
  return rows[0];
}

function fetchBatchById(dbUrl: string, batchId: string): BatchRecord {
  const rows = psqlJson<BatchRecord[]>(
    dbUrl,
    `
      SELECT batch.id, batch.source, batch.created_at
      FROM public.money_import_batches AS batch
      WHERE batch.id = ${sqlStringLiteral(batchId)}
      LIMIT 1
    `,
  );
  if (rows.length === 0) {
    throw new Error(`Batch ${batchId} was not found in the local database.`);
  }
  return rows[0];
}

function deleteValuesForRows(rows: Array<Record<string, unknown>>): Array<string | number> {
  return rows
    .map((row) => row.id)
    .filter(
      (value): value is string | number =>
        typeof value === "string" || (typeof value === "number" && Number.isFinite(value)),
    );
}

function buildSnapshot(dbUrl: string, batch: BatchRecord): ExportSnapshot {
  const batchIdLiteral = sqlStringLiteral(batch.id);
  const tables: SnapshotTable[] = TABLE_EXPORTS.map((tableExport) => {
    const rows = psqlJson<Array<Record<string, unknown>>>(dbUrl, tableExport.sql(batchIdLiteral));
    return {
      name: tableExport.name,
      mode: tableExport.mode,
      columns: fetchColumns(dbUrl, tableExport.name),
      rows,
      deleteBy:
        tableExport.mode === "insert"
          ? { column: "id", values: deleteValuesForRows(rows) }
          : undefined,
    };
  });

  const sessionTable = tables.find((table) => table.name === "money_import_sessions");
  const batchTable = tables.find((table) => table.name === "money_import_batches");
  const sessionBatchLinks =
    sessionTable && batchTable && sessionTable.rows.length > 0 && batchTable.rows.length > 0
      ? [
          {
            sessionId: `${sessionTable.rows[0].id}`,
            batchId: `${batchTable.rows[0].id}`,
          },
        ]
      : [];

  return {
    generatedAt: new Date().toISOString(),
    sourceId: batch.source,
    batchId: batch.id,
    tables,
    sessionBatchLinks,
  };
}

async function writeSnapshotFile(outputPath: string, sql: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, sql, "utf8");
}

async function runCli(): Promise<void> {
  const args = parseArgs(process.argv);
  const batch = args.batchId
    ? fetchBatchById(args.dbUrl, args.batchId)
    : fetchLatestBatch(args.dbUrl, args.sourceId);
  const snapshot = buildSnapshot(args.dbUrl, batch);
  const sql = buildSnapshotSql(snapshot);
  const outputPath = args.outputPath
    ? path.resolve(process.cwd(), args.outputPath)
    : buildDefaultOutputPath(batch);

  await writeSnapshotFile(outputPath, sql);

  process.stdout.write(`[export] batch: ${batch.id}\n`);
  process.stdout.write(`[export] source: ${batch.source}\n`);
  process.stdout.write(`[export] output: ${outputPath}\n`);
  for (const table of snapshot.tables) {
    process.stdout.write(`[export] ${table.name}: ${table.rows.length}\n`);
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedScript) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
