#!/usr/bin/env node
/**
 * Runs the money migrations that rewrite already-stored rows against rows in the shape they
 * were written to repair — the check T-0013 named as mandatory before merge and could not
 * perform.
 *
 * CI applies every migration to empty tables, because CI holds none of the data these three
 * repair. That makes their most dangerous statements the least exercised ones in the
 * repository: one shifts every statement row's timestamp by three hours, one recomputes the
 * identity hash those rows are found by, and the third then builds a unique index over the
 * result — which fails outright, mid-deploy, if the recompute produced a single collision.
 *
 * A copy of production would answer this once. A fixture answers it on every run and keeps
 * answering it, so this seeds the shapes instead: the corrupted composition the missing repair
 * call left behind, a human-edited row that must survive, a genuine receipt that must not be
 * touched, an operation late enough in the Moscow evening that a three-hour error moves it into
 * the previous day, and two purchases identical in every hashed field.
 *
 * Both phases then run twice. A data migration that is not idempotent is a migration that
 * cannot be re-run after a partial deploy, and the second run is the only thing that proves it.
 *
 *   npx tsx scripts/just/db-data-migration-check.ts
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { buildMoneyDedupeHash } from "../../shared/lib/money/dedupe";
// The CSV importer's own normalisation, not a copy of it. These rows carry `Номер карты`, so
// this is the function that produced their hashes, and the SQL under test claims to mirror it.
import { extractAccountHint } from "../../src/lib/import/connectors/tbank-csv";

// Overridable, because they were not and two concurrent runs destroyed each other: the second
// invocation's `startDatabase` force-removes the containers by name and then competes for the
// same host port, so one check tears down the other and reports a migration failure that never
// happened. Two checkouts, or an agent and a person, is not an exotic situation.
const CONTAINER = process.env.ORBIT_DB_CONTAINER ?? "orbit_db_migration_check";
const NETWORK = process.env.ORBIT_DB_NETWORK ?? "orbit_db_check_net";
const PORT = process.env.ORBIT_DB_PORT ?? "54329";
const USING_DEFAULT_INSTANCE = !process.env.ORBIT_DB_CONTAINER && !process.env.ORBIT_DB_PORT;
/** The first T-0013 migration; everything before it is the "already accumulated" world. */
const FIRST_REPAIR_MIGRATION = "20260814090000";
const LAST_MIGRATION_BEFORE_REPAIR = "20260814089999";
/**
 * The upper bound matters as much as the lower one. Without it, `--from` sweeps in every
 * migration added after these, and the second pass re-executes them — ordinary migrations use
 * bare `CREATE TABLE` and `CREATE INDEX`, so the next one written would fail this check and
 * take every database CI job with it, for a reason having nothing to do with the repairs.
 */
const LAST_REPAIR_MIGRATION = "20260814094000";

const repoRoot = path.resolve(__dirname, "..", "..");
const childEnv = {
  ...process.env,
  PGPASSWORD: "postgres",
  ORBIT_DB_CONTAINER: CONTAINER,
  ORBIT_DB_NETWORK: NETWORK,
  ORBIT_DB_PORT: PORT,
  // The developer database already owns 5432 on this host, and only the pgTAP runner needs it.
  ORBIT_DB_PUBLISH_DEFAULT_PORT: "0",
};

const PERSON = "d0000000-0000-0000-0000-000000000001";
const OTHER_PERSON = "d0000000-0000-0000-0000-000000000002";
const ACCOUNT = "d0000000-0000-0000-0000-00000000ac01";

/** Fixture ids are spelled out so a failing check names the case it came from. */
const TX = {
  loneStatementRow: "d1000000-0000-0000-0000-0000000000a1",
  corrupted: "d1000000-0000-0000-0000-0000000000b1",
  extensionPlaceholder: "d1000000-0000-0000-0000-0000000000c1",
  humanEdited: "d1000000-0000-0000-0000-0000000000d1",
  genuineReceipt: "d1000000-0000-0000-0000-0000000000e1",
  lateEvening: "d1000000-0000-0000-0000-0000000000f1",
  twinFirst: "d1000000-0000-0000-0000-000000000101",
  twinSecond: "d1000000-0000-0000-0000-000000000102",
  otherPayerTwin: "d1000000-0000-0000-0000-000000000103",
  fromExtension: "d1000000-0000-0000-0000-000000000104",
  longMaskedCard: "d1000000-0000-0000-0000-000000000105",
  shortMaskedCard: "d1000000-0000-0000-0000-000000000106",
};

const LI = {
  lone: "d2000000-0000-0000-0000-0000000000a1",
  corruptedPlaceholder: "d2000000-0000-0000-0000-0000000000b1",
  corruptedRealFirst: "d2000000-0000-0000-0000-0000000000b2",
  corruptedRealSecond: "d2000000-0000-0000-0000-0000000000b3",
  extensionPlaceholder: "d2000000-0000-0000-0000-0000000000c1",
  humanEdited: "d2000000-0000-0000-0000-0000000000d1",
  genuineFirst: "d2000000-0000-0000-0000-0000000000e1",
  genuineSecond: "d2000000-0000-0000-0000-0000000000e2",
};

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${same ? "  ok" : "NOT OK"} - ${label}`);
  if (!same) {
    failures.push(
      `${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function sql(query: string): string {
  return execFileSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      PORT,
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      query,
    ],
    { env: childEnv, encoding: "utf8" },
  ).trim();
}

function exec(query: string): void {
  execFileSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      PORT,
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      query,
    ],
    { env: childEnv, encoding: "utf8", stdio: ["ignore", "ignore", "inherit"] },
  );
}

function dbLocalDocker(args: string[]): void {
  execFileSync("node", [path.join("scripts", "just", "db-local-docker.cjs"), ...args], {
    cwd: repoRoot,
    env: childEnv,
    stdio: "inherit",
  });
}

/**
 * A statement transaction as the CSV importer wrote it before the fix: Moscow wall clock
 * stored as UTC, and the statement's own column names left in `raw_payload`, which is what
 * both migrations use to recognise a statement row.
 */
/** The card every seeded row carries unless it is testing another shape. */
const DEFAULT_STATEMENT_CARD = "*1234";

function statementTransaction(input: {
  id: string;
  person?: string;
  postedAt: string;
  amount: string;
  merchant: string;
  card?: string;
  dedupeHash?: string;
}): string {
  const raw = JSON.stringify({
    "Дата операции": input.postedAt,
    "Номер карты": input.card ?? DEFAULT_STATEMENT_CARD,
    Описание: input.merchant,
  });
  return `insert into public.money_transactions
      (id, payer_person_id, account_id, source, external_id, posted_at, amount, currency,
       transaction_type, status, merchant_name, raw_payload, dedupe_hash)
    values ('${input.id}', '${input.person ?? PERSON}', '${ACCOUNT}', 'tbank', null,
      '${input.postedAt}+00'::timestamptz, ${input.amount}, 'RUB', 'expense', 'posted',
      '${input.merchant}', '${raw}'::jsonb,
      ${input.dedupeHash ? `'${input.dedupeHash}'` : "null"});`;
}

function lineItem(input: {
  id: string;
  transaction: string;
  title: string;
  amount: string;
  method?: string;
  importHash?: string | null;
  locked?: boolean;
  rawSource?: string;
}): string {
  const raw = input.rawSource ? `'${JSON.stringify({ source: input.rawSource })}'::jsonb` : "null";
  return `insert into public.money_line_items
      (id, transaction_id, title, amount, line_status, assignment_method, import_hash,
       category_locked_by_user, raw_payload)
    values ('${input.id}', '${input.transaction}', '${input.title}', ${input.amount}, 'final',
      '${input.method ?? "import"}',
      ${input.importHash === null ? "null" : `'${input.importHash ?? `hash-${input.id}`}'`},
      ${input.locked ? "true" : "false"}, ${raw});`;
}

function seedAccumulatedRows(): void {
  exec(`
    insert into public.persons (id, name, kind) values
      ('${PERSON}', 'Payer', 'human'), ('${OTHER_PERSON}', 'Other payer', 'human');
    insert into public.money_accounts
      (id, owner_person_id, source, account_kind, account_label, currency)
    values ('${ACCOUNT}', '${PERSON}', 'tbank', 'card', 'Everyday', 'RUB');
  `);

  // A: an ordinary statement row nothing has enriched — one line item for the whole amount.
  exec(
    statementTransaction({
      id: TX.loneStatementRow,
      postedAt: "2026-03-05T10:00:00",
      amount: "-2400.00",
      merchant: "Пятёрочка",
    }),
  );
  exec(
    lineItem({
      id: LI.lone,
      transaction: TX.loneStatementRow,
      title: "Покупка",
      amount: "-2400.00",
    }),
  );

  // B: the corrupted shape. A real receipt landed beside the placeholder instead of replacing
  // it, so the transaction's spending counts twice and cannot heal on its own.
  exec(
    statementTransaction({
      id: TX.corrupted,
      postedAt: "2026-03-06T11:00:00",
      amount: "-1000.00",
      merchant: "Лента",
    }),
  );
  exec(
    lineItem({
      id: LI.corruptedPlaceholder,
      transaction: TX.corrupted,
      title: "Покупка",
      amount: "-1000.00",
    }),
  );
  exec(
    lineItem({
      id: LI.corruptedRealFirst,
      transaction: TX.corrupted,
      title: "Молоко",
      amount: "-400.00",
    }),
  );
  exec(
    lineItem({
      id: LI.corruptedRealSecond,
      transaction: TX.corrupted,
      title: "Корм",
      amount: "-600.00",
    }),
  );

  // C: the extension's own placeholder, marked in raw_payload rather than by shape.
  exec(
    statementTransaction({
      id: TX.extensionPlaceholder,
      postedAt: "2026-03-07T12:00:00",
      amount: "-500.00",
      merchant: "Аптека",
    }),
  );
  exec(
    lineItem({
      id: LI.extensionPlaceholder,
      transaction: TX.extensionPlaceholder,
      title: "Покупка",
      amount: "-500.00",
      rawSource: "fallback",
    }),
  );

  // D: a placeholder-shaped row a human edited. Removing a manual edit automatically is worse
  // than leaving a visible discrepancy, so this one must come through untouched.
  exec(
    statementTransaction({
      id: TX.humanEdited,
      postedAt: "2026-03-08T13:00:00",
      amount: "-700.00",
      merchant: "Кафе",
    }),
  );
  exec(
    lineItem({
      id: LI.humanEdited,
      transaction: TX.humanEdited,
      title: "Обед",
      amount: "-700.00",
      locked: true,
    }),
  );

  // E: a genuine two-item receipt. Neither line covers the whole amount, so nothing here is a
  // placeholder and nothing may be deleted.
  exec(
    statementTransaction({
      id: TX.genuineReceipt,
      postedAt: "2026-03-09T14:00:00",
      amount: "-900.00",
      merchant: "Магнит",
    }),
  );
  exec(
    lineItem({
      id: LI.genuineFirst,
      transaction: TX.genuineReceipt,
      title: "Хлеб",
      amount: "-400.00",
    }),
  );
  exec(
    lineItem({
      id: LI.genuineSecond,
      transaction: TX.genuineReceipt,
      title: "Сыр",
      amount: "-500.00",
    }),
  );

  // F: 23:30 Moscow, stored as 23:30 UTC. Three hours out is enough to report the purchase on
  // the previous day, which is the user-visible symptom the fix exists for.
  exec(
    statementTransaction({
      id: TX.lateEvening,
      postedAt: "2026-03-10T23:30:00",
      amount: "-150.00",
      merchant: "Кофейня",
    }),
  );

  // G: two purchases identical in every hashed field. If the recompute gave them one hash, the
  // unique index built by the next migration would fail and take the deploy with it.
  exec(
    statementTransaction({
      id: TX.twinFirst,
      postedAt: "2026-03-11T09:00:00",
      amount: "-320.00",
      merchant: "Кофейня",
    }),
  );
  exec(
    statementTransaction({
      id: TX.twinSecond,
      postedAt: "2026-03-11T09:00:00",
      amount: "-320.00",
      merchant: "Кофейня",
    }),
  );

  // H: the same operation for a different payer. Identity is scoped per payer, so this must not
  // collide with G even though every hashed field matches.
  exec(
    statementTransaction({
      id: TX.otherPayerTwin,
      person: OTHER_PERSON,
      postedAt: "2026-03-11T09:00:00",
      amount: "-320.00",
      merchant: "Кофейня",
    }),
  );

  // J: a card number in the longer masked form the statements also carry. The parser keeps the
  // last four characters after removing the mask; the migration used to keep every digit that
  // was left, so it wrote `2200700368` where a re-import computes `0368` — a hash the importer
  // cannot reproduce, and therefore a second copy of a row this migration had just repaired,
  // slipping past a unique index that never sees a collision because the two hashes differ.
  exec(
    statementTransaction({
      id: TX.longMaskedCard,
      postedAt: "2026-03-13T08:00:00",
      amount: "-777.00",
      merchant: "Аптека",
      card: "220070******0368",
    }),
  );

  // K: the short masked form. `extractAccountHint("  ** 12 ")` is tested to return "12", so the
  // hint is two characters and not four — the shape that told me I had mirrored the wrong
  // function. Counting digits and demanding four of them turns this into an empty hint, which is
  // a different hash from the one a re-import computes, which is a duplicate the payer-scoped
  // index cannot catch.
  exec(
    statementTransaction({
      id: TX.shortMaskedCard,
      postedAt: "2026-03-14T08:00:00",
      amount: "-55.00",
      merchant: "Киоск",
      card: "** 12",
    }),
  );

  // I: an extension row — no statement column in raw_payload. Neither its timestamp nor its
  // hash may move.
  exec(`insert into public.money_transactions
      (id, payer_person_id, account_id, source, external_id, posted_at, amount, currency,
       transaction_type, status, merchant_name, raw_payload, dedupe_hash)
    values ('${TX.fromExtension}', '${PERSON}', '${ACCOUNT}', 'tbank', 'ext-1',
      '2026-03-12T23:30:00+00'::timestamptz, -250.00, 'RUB', 'expense', 'posted',
      'Кофейня', '{"operationId": "ext-1"}'::jsonb, 'extension-hash-untouched');`);
}

async function expectedHashFor(input: {
  postedAtIso: string;
  amount: number;
  merchant: string;
  occurrence: number;
  /** The raw statement cell, exactly as seeded — not the hint derived from it. */
  card?: string;
}): Promise<string> {
  // Derived, never written down. Hard-coding "0368" and "12" here made the parity gate assert
  // that the SQL agrees with *this file's idea* of the parser: change `extractAccountHint` and
  // the SQL would drift away from the importer with every check still green. Running the seeded
  // card through the real function is what makes this a gate rather than a restatement.
  return buildMoneyDedupeHash({
    source: "tbank",
    postedAtIso: input.postedAtIso,
    amount: input.amount,
    currency: "RUB",
    merchantName: input.merchant,
    accountHint: extractAccountHint(input.card ?? DEFAULT_STATEMENT_CARD) || null,
    occurrence: input.occurrence,
  });
}

async function assertRepaired(): Promise<void> {
  console.log("\n# placeholders");
  check(
    "A: a lone statement line item is flagged as a placeholder",
    sql(`select is_placeholder from public.money_line_items where id = '${LI.lone}'`),
    "t",
  );
  check(
    "A: it is not deleted — nothing real stands beside it",
    sql(
      `select count(*) from public.money_line_items where transaction_id = '${TX.loneStatementRow}'`,
    ),
    "1",
  );

  check(
    "B: the corrupted placeholder is gone",
    sql(`select count(*) from public.money_line_items where id = '${LI.corruptedPlaceholder}'`),
    "0",
  );
  check(
    "B: the real receipt survives and adds up to the transaction",
    sql(
      `select round(sum(amount), 2) from public.money_line_items where transaction_id = '${TX.corrupted}'`,
    ),
    "-1000.00",
  );

  check(
    "C: the extension's marked placeholder is flagged",
    sql(
      `select is_placeholder from public.money_line_items where id = '${LI.extensionPlaceholder}'`,
    ),
    "t",
  );
  check(
    "D: a human-edited row is neither flagged nor deleted",
    sql(`select is_placeholder from public.money_line_items where id = '${LI.humanEdited}'`),
    "f",
  );
  check(
    "E: a genuine two-item receipt is left alone",
    sql(
      `select count(*) filter (where is_placeholder) from public.money_line_items where transaction_id = '${TX.genuineReceipt}'`,
    ),
    "0",
  );

  console.log("\n# statement timestamps");
  check(
    "F: 23:30 Moscow read as UTC is moved back three hours",
    sql(
      `select to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.money_transactions where id = '${TX.lateEvening}'`,
    ),
    "2026-03-10 20:30",
  );
  check(
    "F: the row is marked so a re-run cannot shift it again",
    sql(
      `select raw_payload->>'posted_at_offset_fixed' from public.money_transactions where id = '${TX.lateEvening}'`,
    ),
    "true",
  );
  check(
    "I: an extension row keeps its timestamp",
    sql(
      `select to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.money_transactions where id = '${TX.fromExtension}'`,
    ),
    "2026-03-12 23:30",
  );
  check(
    "I: an extension row keeps its hash",
    sql(`select dedupe_hash from public.money_transactions where id = '${TX.fromExtension}'`),
    "extension-hash-untouched",
  );

  console.log("\n# identity");
  check(
    "G: two identical purchases keep distinct identities",
    sql(
      `select count(distinct dedupe_hash) from public.money_transactions where id in ('${TX.twinFirst}', '${TX.twinSecond}')`,
    ),
    "2",
  );
  // Two payers with an otherwise identical statement row must get the *same* hash, and the
  // unique index — scoped by `payer_person_id` — is what keeps their rows apart.
  //
  // This assertion originally required two distinct hashes, and passed, because the migration
  // numbered occurrences globally. That is the bug it should have caught: the importer's
  // `assignMoneyDedupeOccurrences` groups the rows of one batch, and a batch belongs to one
  // person, so the second payer's next import computes occurrence 0 against a stored
  // occurrence-1 hash, matches nothing, and inserts a second copy of a row this very migration
  // had just repaired. A check that blesses the behaviour it exists to police is worse than no
  // check: it reports the defect as verified.
  check(
    "H: the same operation for another payer hashes the same, and the index keeps them apart",
    sql(
      `select count(distinct dedupe_hash) from public.money_transactions where id in ('${TX.twinFirst}', '${TX.otherPayerTwin}')`,
    ),
    "1",
  );
  check(
    "H2: both payers' rows survive, kept apart by the payer-scoped index",
    sql(
      `select count(*) from public.money_transactions where id in ('${TX.twinFirst}', '${TX.otherPayerTwin}')`,
    ),
    "2",
  );
  check(
    "the unique identity index over the recomputed hashes exists",
    sql(
      `select count(*) from pg_indexes where indexname = 'idx_money_transactions_person_dedupe_hash'`,
    ),
    "1",
  );

  // The recompute is written in SQL and the importers in TypeScript. If they disagree by one
  // character, re-importing the same statement creates a second copy of every row it repaired —
  // which is the failure this whole migration exists to prevent.
  const expected = await expectedHashFor({
    postedAtIso: "2026-03-05T07:00:00.000Z",
    amount: -2400,
    merchant: "Пятёрочка",
    occurrence: 0,
  });
  check(
    "the SQL recompute agrees with shared/lib/money/dedupe.ts",
    sql(`select dedupe_hash from public.money_transactions where id = '${TX.loneStatementRow}'`),
    expected,
  );

  // The same agreement for the longer masked card, which is where the two normalisations used to
  // part company: `*1234` reduces to `1234` however you do it, so the seeded rows above agreed
  // whether or not the SQL matched the parser.
  const expectedLongMask = await expectedHashFor({
    postedAtIso: "2026-03-13T05:00:00.000Z",
    amount: -777,
    merchant: "Аптека",
    occurrence: 0,
    card: "220070******0368",
  });
  check(
    "J: a 220070******0368 card hashes to the parser's last four, not to every digit left",
    sql(`select dedupe_hash from public.money_transactions where id = '${TX.longMaskedCard}'`),
    expectedLongMask,
  );

  const expectedShortMask = await expectedHashFor({
    postedAtIso: "2026-03-14T05:00:00.000Z",
    amount: -55,
    merchant: "Киоск",
    occurrence: 0,
    card: "** 12",
  });
  check(
    "K: a short '** 12' card keeps its two characters rather than becoming an empty hint",
    sql(`select dedupe_hash from public.money_transactions where id = '${TX.shortMaskedCard}'`),
    expectedShortMask,
  );
}

function snapshot(): string {
  return sql(`select md5(string_agg(row_data, '|' order by row_data)) from (
      select concat_ws(':', id::text, posted_at::text, dedupe_hash, raw_payload::text) as row_data
      from public.money_transactions
      union all
      select concat_ws(':', id::text, amount::text, is_placeholder::text)
      from public.money_line_items
    ) as rows;`);
}

/** True when a container of that name exists in any state. */
function containerExists(name: string): boolean {
  try {
    execFileSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const LOCK_PATH = path.join(os.tmpdir(), `orbit-data-migration-check-${CONTAINER}.lock`);

/**
 * Reserves the shared instance, atomically.
 *
 * Asking whether the container exists and then creating it are two operations, and two checks
 * starting together both get "no" before either has built anything — which is the race the check
 * was supposed to remove, arriving a few milliseconds earlier. `mkdir` is atomic and fails when
 * the directory is there, so exactly one of them wins.
 */
function acquireLock(): boolean {
  try {
    fs.mkdirSync(LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.rmdirSync(LOCK_PATH);
  } catch {
    // Releasing is best effort; a lock left behind is reported by the next run, with the path.
  }
}

async function main(): Promise<number> {
  // Overridable names were not enough. Whoever runs the documented command gets the defaults, so
  // two of them — two checkouts, or an agent beside a person — still pick the same container and
  // the same port: the second run's fresh `up` force-removes the first one's database, and either
  // run's closing `down` can remove the other's replacement. The first run then reports a
  // migration failure that never happened.
  //
  // Refusing is the honest move rather than allocating a port. Destroying someone else's run to
  // start your own is the behaviour being fixed, and picking a free port silently would leave two
  // checks interleaving against one daemon with nothing saying so.
  if (USING_DEFAULT_INSTANCE && !acquireLock()) {
    console.error(
      `Another data migration check holds ${CONTAINER}, or one crashed and left the lock. This ` +
        `run stops rather than removing a database it does not own.\n` +
        `  If a run is in progress, wait for it.\n` +
        `  If it is a leftover: rm -r ${LOCK_PATH} && docker rm -f ${CONTAINER}\n` +
        `  To run two at once, give this one its own: ORBIT_DB_CONTAINER=… ORBIT_DB_PORT=… ` +
        `ORBIT_DB_NETWORK=…`,
    );
    return 1;
  }
  if (USING_DEFAULT_INSTANCE && containerExists(CONTAINER)) {
    // The lock is free but the container is not: a previous run was killed between the two.
    releaseLock();
    console.error(
      `${CONTAINER} exists while no check holds the lock, so a previous run was interrupted. ` +
        `Remove it and try again: docker rm -f ${CONTAINER}`,
    );
    return 1;
  }

  console.log(`# building a database at migration ${LAST_MIGRATION_BEFORE_REPAIR}`);
  dbLocalDocker(["up", "--until", LAST_MIGRATION_BEFORE_REPAIR, "--no-deploy", "--no-tls"]);

  console.log("# seeding rows in their pre-repair shape");
  seedAccumulatedRows();

  console.log(
    `# applying the repair migrations (${FIRST_REPAIR_MIGRATION}..${LAST_REPAIR_MIGRATION})`,
  );
  dbLocalDocker(["migrate", "--from", FIRST_REPAIR_MIGRATION, "--until", LAST_REPAIR_MIGRATION]);
  await assertRepaired();

  const afterFirstRun = snapshot();

  console.log("\n# applying them a second time");
  dbLocalDocker(["migrate", "--from", FIRST_REPAIR_MIGRATION, "--until", LAST_REPAIR_MIGRATION]);
  await assertRepaired();
  check("a second run changes nothing", snapshot(), afterFirstRun);

  dbLocalDocker(["down"]);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("\nAll data migration checks passed.");
  return 0;
}

main()
  .then((code) => {
    if (USING_DEFAULT_INSTANCE) releaseLock();
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    try {
      dbLocalDocker(["down"]);
    } catch {
      // The teardown is best effort; the original failure is what matters.
    }
    if (USING_DEFAULT_INSTANCE) releaseLock();
    process.exit(1);
  });
