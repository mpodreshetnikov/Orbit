import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as dbLocalDocker from "./db-local-docker.cjs";

const { findTransactionControl, maskSqlNoise } = dbLocalDocker as {
  findTransactionControl: (sql: string) => Array<{ line: number; statement: string }>;
  maskSqlNoise: (sql: string) => string;
};

const migrationsDir = path.resolve(__dirname, "..", "..", "supabase", "migrations");

describe("migration transaction control", () => {
  it("masks comments, literals and function bodies without moving anything", () => {
    // The mask has to leave every offset where it was, or the line numbers it reports point at
    // the wrong statement — which is worse than not reporting one, because it sends whoever
    // reads the failure to a line that is fine.
    const sql = [
      "-- BEGIN; in a comment",
      "/* COMMIT; in a block /* nested */ still a comment */",
      "SELECT 'BEGIN;' AS literal;",
      "CREATE FUNCTION f() RETURNS void AS $$",
      "BEGIN",
      "  RAISE NOTICE 'COMMIT;';",
      "END;",
      "$$ LANGUAGE plpgsql;",
    ].join("\n");

    const masked = maskSqlNoise(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked.split("\n").length).toBe(sql.split("\n").length);
    expect(findTransactionControl(sql)).toEqual([]);
  });

  it("finds transaction control that is real, with the line it is on", () => {
    const sql = ["-- a migration", "BEGIN;", "ALTER TABLE t ADD COLUMN c int;", "COMMIT;"].join(
      "\n",
    );

    expect(findTransactionControl(sql)).toEqual([
      { line: 2, statement: "BEGIN" },
      { line: 4, statement: "COMMIT" },
    ]);
  });

  it("treats every synonym as transaction control", () => {
    // `END` and `ABORT` are documented synonyms for `COMMIT` and `ROLLBACK`, and a savepoint is
    // transaction control too: it is only legal inside one, so a migration that takes one is
    // making the same assumption about who owns the transaction.
    for (const statement of [
      "START TRANSACTION;",
      "END;",
      "END TRANSACTION;",
      "ABORT;",
      "ROLLBACK;",
      "SAVEPOINT s;",
      "RELEASE SAVEPOINT s;",
      "begin isolation level serializable;",
    ]) {
      expect(findTransactionControl(statement), statement).toHaveLength(1);
    }
  });

  it("leaves ordinary SQL alone", () => {
    for (const statement of [
      "SELECT CASE WHEN a THEN 1 ELSE 2 END;",
      "CREATE INDEX ON t (c);",
      "COMMENT ON TABLE t IS 'begin';",
      "SELECT 1 WHERE name = 'commit';",
    ]) {
      expect(findTransactionControl(statement), statement).toEqual([]);
    }
  });

  it("no migration manages its own transaction", () => {
    // The runner applies each migration and the `schema_migrations` row that records it in one
    // `psql --single-transaction`, so the two commit together or not at all. PostgreSQL
    // documents what a `COMMIT` inside such a script does: it commits the wrapper there and
    // then, and everything after runs in autocommit. For a migration whose last statement is
    // `COMMIT;` — three of this repository's were written that way — the schema change commits
    // and the version insert becomes a separate transaction, which is exactly the split the
    // wrapper exists to close. This is a whole-directory check rather than three fixes, because
    // the next migration written by hand is the one that reintroduces it.
    const offenders = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => ({
        name,
        statements: findTransactionControl(readFileSync(path.join(migrationsDir, name), "utf8")),
      }))
      .filter(({ statements }) => statements.length > 0)
      .map(
        ({ name, statements }) =>
          `${name}: ${statements.map((entry) => `line ${entry.line} ${entry.statement}`).join(", ")}`,
      );

    expect(offenders, "migrations that open or close their own transaction").toEqual([]);
  });
});
