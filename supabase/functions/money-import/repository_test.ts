// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseMoneyImportRepository, type MoneyImportRepository } from "./repository.ts";
import type { CanonicalTransactionRowInput } from "./types.ts";

interface TransactionsTableStubOptions {
  /** Row returned by the identity lookup (by external id or dedupe hash). */
  existingRow?: Record<string, unknown> | null;
  /** Rows the adoption sweep sees: same payer, same account, no external id yet. */
  statementRows?: Array<Record<string, unknown>>;
  insertResult?: () => { data: Record<string, unknown> | null; error: unknown };
  onUpdate?: (id: string, payload: Record<string, unknown>) => void;
  onDedupeLookup?: () => void;
}

/**
 * Chainable stand-in for the money_transactions table, covering the four shapes the
 * repository builds against it: identity lookup, adoption sweep, insert and update.
 */
function createTransactionsTableStub(options: TransactionsTableStubOptions) {
  const identityLookup = {
    maybeSingle: async () => ({
      data: options.existingRow ?? null,
      error: options.existingRow ? null : { message: "not found" },
    }),
  };

  return {
    insert: () => ({
      select: () => ({
        single: async () =>
          options.insertResult?.() ?? { data: { id: "tx-inserted" }, error: null },
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: (column: string, value: string) => {
        assertEquals(column, "id");
        options.onUpdate?.(value, payload);
        return Promise.resolve({ error: null });
      },
    }),
    select: () => ({
      eq: (column: string) => {
        if (column === "payer_person_id") {
          return {
            // Identity lookup continues with limit(1) then the key predicates.
            limit: () => ({
              eq: (keyColumn: string) => {
                if (keyColumn === "dedupe_hash") {
                  options.onDedupeLookup?.();
                  return { ...identityLookup, eq: () => identityLookup };
                }
                return { ...identityLookup, eq: () => identityLookup };
              },
              ...identityLookup,
            }),
            // Adoption sweep continues with the account and the posted_at window.
            eq: () => ({
              is: () => ({
                gte: () => ({
                  lte: async () => ({ data: options.statementRows ?? [], error: null }),
                }),
              }),
            }),
            is: () => ({
              gte: () => ({
                lte: async () => ({ data: options.statementRows ?? [], error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected first filter column ${column}`);
      },
    }),
  };
}

function createRepositoryWithClients(clients: {
  anonClient?: Record<string, unknown>;
  adminClient?: Record<string, unknown>;
  createClientFn?: typeof createClient;
  moneyCategorizeRunner?: (input: {
    lineItemIds: string[];
    personId: string;
    triggerSource: string;
    forceOverwriteLocked?: boolean;
  }) => Promise<Record<string, unknown>>;
}): MoneyImportRepository {
  const createClientFn =
    clients.createClientFn ??
    (((_url: string, key: string) => {
      if (key === "anon-key") return clients.anonClient;
      return clients.adminClient;
    }) as unknown as typeof createClient);

  return createSupabaseMoneyImportRepository({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    supabaseServiceRoleKey: "service-key",
    createClientFn,
    moneyCategorizeRunner: clients.moneyCategorizeRunner,
  });
}

async function assertThrowsWithMessage(
  run: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof Error)) {
    throw new Error("Expected an Error to be thrown");
  }
  assertEquals(caught.message, expectedMessage);
}

Deno.test("repository authenticateAllowedUser returns user context", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
      },
    },
    adminClient: {
      from: (table: string) => {
        assertEquals(table, "allowed_users");
        return {
          select: () => ({
            or: () => ({
              single: async () => ({ data: { id: "allowed-1" }, error: null }),
            }),
          }),
        };
      },
    },
  });

  const result = await repository.authenticateAllowedUser("token");
  assertEquals(result?.mode, "user");
  assertEquals(result?.userId, "user-1");
});

Deno.test("repository authenticateAllowedUser returns null on auth error", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "bad token" },
        }),
      },
    },
    adminClient: {
      from: () => ({
        select: () => ({
          or: async () => ({ data: null, error: null }),
        }),
      }),
    },
  });

  const result = await repository.authenticateAllowedUser("token");
  assertEquals(result, null);
});

Deno.test("repository getSessionByToken hashes token and loads session", async () => {
  let eqValue = "";
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        assertEquals(table, "money_import_sessions");
        return {
          select: () => ({
            eq: (_column: string, value: string) => {
              eqValue = value;
              return {
                single: async () => ({
                  data: { id: "session-1", status: "running" },
                  error: null,
                }),
              };
            },
          }),
        };
      },
    },
  });

  const session = await repository.getSessionByToken("plain-token");
  assertEquals(session?.id, "session-1");
  assertEquals(eqValue.length, 64);
});

Deno.test("repository createImportSession throws on insert error", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: "insert failed" } }),
          }),
        }),
      }),
    },
  });

  await assertThrowsWithMessage(
    () => repository.createImportSession({ source: "x" }),
    "insert failed",
  );
});

Deno.test(
  "repository applyCategoryRulePipeline uses money-categorize runner when enabled LLM rules exist",
  async () => {
    const runnerCalls: Array<{
      lineItemIds: string[];
      personId: string;
      triggerSource: string;
      forceOverwriteLocked?: boolean;
    }> = [];
    let rpcCalls = 0;

    const repository = createRepositoryWithClients({
      moneyCategorizeRunner: async (input) => {
        runnerCalls.push(input);
        return { runs: [], count: 0 };
      },
      adminClient: {
        from: (table: string) => {
          if (table === "money_category_rules") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: async () => ({
                      data: [{ id: "rule-llm" }],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
        rpc: async () => {
          rpcCalls += 1;
          return { data: { runs: [], count: 0 }, error: null };
        },
      },
    });

    await repository.applyCategoryRulePipeline?.(
      ["line-1", "line-2"],
      "person-1",
      "import_auto",
      true,
    );

    assertEquals(runnerCalls, [
      {
        lineItemIds: ["line-1", "line-2"],
        personId: "person-1",
        triggerSource: "import_auto",
        forceOverwriteLocked: true,
      },
    ]);
    assertEquals(rpcCalls, 0);
  },
);

Deno.test(
  "repository getExistingTransactionStates distinguishes fulfilled and synthetic-only matches",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transactions") {
            // The states lookup runs three queries: by external_id, by dedupe_hash, and a
            // statement sweep for candidates neither key matched. All of them are scoped to
            // the payer, so every chain starts with the same eq().
            const statementSweep = {
              is: () => ({
                gte: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
            return {
              select: () => ({
                eq: () => ({
                  ...statementSweep,
                  eq: () => ({
                    in: (column: string, _values: string[]) => {
                      if (column === "external_id") {
                        return Promise.resolve({
                          data: [
                            {
                              id: "tx-real",
                              source: "tbank",
                              external_id: "ext-real",
                              dedupe_hash: "hash-real",
                              receipt_enrichment_status: "ok",
                            },
                            {
                              id: "tx-synth",
                              source: "tbank",
                              external_id: "ext-synth",
                              dedupe_hash: "hash-synth",
                              receipt_enrichment_status: "ok",
                            },
                          ],
                          error: null,
                        });
                      }
                      throw new Error(`Unexpected external-id column ${column}`);
                    },
                  }),
                  in: (column: string, _values: string[]) => {
                    if (column === "dedupe_hash") {
                      return Promise.resolve({ data: [], error: null });
                    }
                    throw new Error(`Unexpected column ${column}`);
                  },
                }),
              }),
            };
          }

          if (table === "money_line_items") {
            return {
              select: () => ({
                in: (_column: string, values: string[]) =>
                  Promise.resolve({
                    data: values.flatMap((transactionId) =>
                      transactionId === "tx-real"
                        ? [{ transaction_id: "tx-real", raw_payload: { source: "receipt" } }]
                        : transactionId === "tx-synth"
                          ? [{ transaction_id: "tx-synth", raw_payload: { source: "fallback" } }]
                          : [],
                    ),
                    error: null,
                  }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const states = await repository.getExistingTransactionStates("tbank_web", "person-1", [
      {
        external_id: "ext-real",
        dedupe_hash: "hash-real",
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
      },
      {
        external_id: "ext-synth",
        dedupe_hash: "hash-synth",
        posted_at: "2026-01-02T00:00:00.000Z",
        amount: 20,
      },
      {
        external_id: "ext-missing",
        dedupe_hash: "hash-missing",
        posted_at: "2026-01-03T00:00:00.000Z",
        amount: 30,
      },
    ]);

    assertEquals(states[0], {
      transaction_id: "tx-real",
      exists: true,
      fulfilled: true,
      has_only_synthetic_line_items: false,
      has_real_line_items: true,
      receipt_enrichment_status: "ok",
    });
    assertEquals(states[1], {
      transaction_id: "tx-synth",
      exists: true,
      fulfilled: false,
      has_only_synthetic_line_items: true,
      has_real_line_items: false,
      receipt_enrichment_status: "ok",
    });
    assertEquals(states[2], {
      transaction_id: null,
      exists: false,
      fulfilled: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
      receipt_enrichment_status: null,
    });
  },
);

Deno.test("repository resolveAccountIdForRow uses card hint when multiple accounts", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table === "money_accounts") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ id: "acc-1" }, { id: "acc-2" }],
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === "money_cards") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ account_id: "acc-2" }],
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  const resolved = await repository.resolveAccountIdForRow(
    "person-1",
    {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      raw_payload: { account_hint: "**** 4444" },
    },
    "tbank_web",
    "acc-1",
  );

  assertEquals(resolved, "acc-2");
});

Deno.test("repository resolveAccountIdForRow throws when no accounts found", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        assertEquals(table, "money_accounts");
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        };
      },
    },
  });

  await assertThrowsWithMessage(
    () =>
      repository.resolveAccountIdForRow(
        "person-1",
        {
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          transaction_type: "expense",
        },
        "tbank",
      ),
    "No money account found for source tbank",
  );
});

Deno.test(
  "repository resolveAccountIdForRow uses default account fallback when card hint is unresolved",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [{ id: "acc-1" }, { id: "acc-2" }],
                    error: null,
                  }),
                }),
              }),
            };
          }

          if (table === "money_cards") {
            return {
              select: () => ({
                eq: () => ({
                  in: async () => ({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const resolved = await repository.resolveAccountIdForRow(
      "person-1",
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        raw_payload: { account_hint: "**** 9999" },
      },
      "tbank_web",
      "acc-2",
    );

    assertEquals(resolved, "acc-2");
  },
);

Deno.test(
  "repository resolveAccountIdForRow ignores invalid default and still uses single account fallback",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [{ id: "acc-only" }],
                    error: null,
                  }),
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const resolved = await repository.resolveAccountIdForRow(
      "person-1",
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
      },
      "manual",
      "acc-invalid",
    );

    assertEquals(resolved, "acc-only");
  },
);

Deno.test(
  "repository insertOrResolveTransaction inserts a new operation and updates a known one",
  async () => {
    const updatedTransactions: Array<{ id: string; payload: Record<string, unknown> }> = [];

    const row: CanonicalTransactionRowInput = {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      source: "tbank",
      external_id: "ext-1",
      account_id: "acc-1",
    };

    const freshRepository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
          return createTransactionsTableStub({
            existingRow: null,
            statementRows: [],
            insertResult: () => ({ data: { id: "tx-1" }, error: null }),
            onUpdate: (id, payload) => updatedTransactions.push({ id, payload }),
          });
        },
      },
    });

    assertEquals(await freshRepository.insertOrResolveTransaction(row, "person-1"), {
      transactionId: "tx-1",
      inserted: true,
    });
    assertEquals(updatedTransactions.length, 0);

    const knownRepository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
          return createTransactionsTableStub({
            existingRow: { id: "tx-existing" },
            onUpdate: (id, payload) => updatedTransactions.push({ id, payload }),
          });
        },
      },
    });

    assertEquals(await knownRepository.insertOrResolveTransaction(row, "person-1"), {
      transactionId: "tx-existing",
      inserted: false,
    });
    assertEquals(updatedTransactions.length, 1);
    assertEquals(updatedTransactions[0]?.id, "tx-existing");
    assertEquals(updatedTransactions[0]?.payload.external_id, "ext-1");
  },
);

Deno.test("repository adopts the statement transaction behind an operation", async () => {
  const updatedTransactions: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
        return createTransactionsTableStub({
          existingRow: null,
          statementRows: [{ id: "tx-statement", amount: -1000 }],
          insertResult: () => {
            throw new Error("must not insert when a statement row can be adopted");
          },
          onUpdate: (id, payload) => updatedTransactions.push({ id, payload }),
        });
      },
    },
  });

  const result = await repository.insertOrResolveTransaction(
    {
      posted_at: "2026-01-05T10:00:00.000Z",
      amount: -1000,
      transaction_type: "expense",
      source: "tbank",
      external_id: "op-1",
      dedupe_hash: "hash-op-1",
      account_id: "acc-1",
    },
    "person-1",
  );

  assertEquals(result, { transactionId: "tx-statement", inserted: false, adopted: true });
  assertEquals(updatedTransactions[0]?.id, "tx-statement");
  // Taking on the identity keys is what stops the next run from adopting the row again.
  assertEquals(updatedTransactions[0]?.payload.external_id, "op-1");
  assertEquals(updatedTransactions[0]?.payload.dedupe_hash, "hash-op-1");
});

Deno.test("repository refuses to adopt when two statement rows match", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
        return createTransactionsTableStub({
          existingRow: null,
          statementRows: [
            { id: "tx-statement-a", amount: -1000 },
            { id: "tx-statement-b", amount: -1000 },
          ],
          insertResult: () => {
            throw new Error("must not insert while the match is ambiguous");
          },
          onUpdate: () => {
            throw new Error("must not update while the match is ambiguous");
          },
        });
      },
    },
  });

  await assertThrowsWithMessage(
    () =>
      repository.insertOrResolveTransaction(
        {
          posted_at: "2026-01-05T10:00:00.000Z",
          amount: -1000,
          transaction_type: "expense",
          source: "tbank",
          external_id: "op-1",
          account_id: "acc-1",
        },
        "person-1",
      ),
    "Multiple statement transactions match this operation",
  );
});

Deno.test("repository adopts only within the window and only for API rows", async () => {
  function repositoryWithStatementRows(statementRows: Array<Record<string, unknown>>) {
    return createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
          return createTransactionsTableStub({
            existingRow: null,
            statementRows,
            insertResult: () => ({ data: { id: "tx-new" }, error: null }),
          });
        },
      },
    });
  }

  // A statement row on a different amount is not this operation.
  assertEquals(
    await repositoryWithStatementRows([
      { id: "tx-statement", amount: -999 },
    ]).insertOrResolveTransaction(
      {
        posted_at: "2026-01-05T10:00:00.000Z",
        amount: -1000,
        transaction_type: "expense",
        source: "tbank",
        external_id: "op-1",
        account_id: "acc-1",
      },
      "person-1",
    ),
    { transactionId: "tx-new", inserted: true },
  );

  // A statement row without an external id of our own to offer is not adoptable: a CSV
  // import must never absorb another statement row.
  assertEquals(
    await repositoryWithStatementRows([
      { id: "tx-statement", amount: -1000 },
    ]).insertOrResolveTransaction(
      {
        posted_at: "2026-01-05T10:00:00.000Z",
        amount: -1000,
        transaction_type: "expense",
        source: "tbank",
        external_id: null,
        dedupe_hash: "hash-csv",
        account_id: "acc-1",
      },
      "person-1",
    ),
    { transactionId: "tx-new", inserted: true },
  );
});

Deno.test(
  "repository insertLineItemIfNew handles duplicate fallback and update errors",
  async () => {
    let insertCalls = 0;
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_line_items") {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => {
                    insertCalls += 1;
                    if (insertCalls === 1) {
                      return { data: { id: "line-1" }, error: null };
                    }
                    if (insertCalls === 2) {
                      return { data: null, error: { code: "23505", message: "duplicate" } };
                    }
                    return { data: null, error: { code: "500", message: "boom" } };
                  },
                }),
              }),
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: "line-existing" }, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const first = await repository.insertLineItemIfNew(
      "tx-1",
      { title: "Coffee", amount: 10 },
      "hash-1",
      10,
    );
    assertEquals(first, { lineItemId: "line-1", inserted: true });

    const duplicate = await repository.insertLineItemIfNew(
      "tx-1",
      { title: "Coffee", amount: 10 },
      "hash-1",
      10,
    );
    assertEquals(duplicate, { lineItemId: "line-existing", inserted: false });

    await assertThrowsWithMessage(
      () => repository.insertLineItemIfNew("tx-1", { title: "Coffee", amount: 10 }, "hash-2", 10),
      "boom",
    );
  },
);

Deno.test("repository insertReportRow and updateImportBatch throw on DB error", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table === "money_import_batch_rows") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: { message: "report failed" } }),
              }),
            }),
          };
        }

        if (table === "money_import_batches") {
          return {
            update: () => ({
              eq: async () => ({ error: { message: "batch failed" } }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  await assertThrowsWithMessage(
    () => repository.insertReportRow({ batch_id: "b1" }),
    "report failed",
  );
  await assertThrowsWithMessage(
    () => repository.updateImportBatch("b1", { status: "running" }),
    "batch failed",
  );
});

Deno.test("repository manages sessions, batches and last imported lookup", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table === "money_transactions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { posted_at: "2026-01-03T00:00:00.000Z" },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === "money_import_sessions") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: "session-1" }, error: null }),
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({ data: { id: "session-1" }, error: null }),
                }),
                single: async () => ({ data: { id: "session-1" }, error: null }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        if (table === "money_import_batches") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: "batch-1" }, error: null }),
              }),
            }),
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: "batch-1" }, error: null }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  assertEquals(
    await repository.findLastImportedAt("tbank", "person-1"),
    "2026-01-03T00:00:00.000Z",
  );
  assertEquals((await repository.createImportSession({ source: "x" })).id, "session-1");
  assertEquals(await repository.createImportBatch({ source: "x" }), "batch-1");
  assertEquals((await repository.getImportSessionForUser("session-1", "user-1"))?.id, "session-1");
  assertEquals((await repository.getImportSessionById("session-1"))?.id, "session-1");
  assertEquals((await repository.getImportBatch("batch-1"))?.id, "batch-1");
  await repository.updateImportSession("session-1", { status: "running" });
  await repository.updateImportBatch("batch-1", { status: "running" });
});

Deno.test(
  "repository resolveAccountIdForRow handles explicit/single/ambiguous and card errors",
  async () => {
    const explicitRepository = createRepositoryWithClients({
      adminClient: {
        from: () => {
          throw new Error("no db call expected");
        },
      },
    });
    assertEquals(
      await explicitRepository.resolveAccountIdForRow(
        "person-1",
        {
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          transaction_type: "expense",
          account_id: "acc-explicit",
        },
        "manual",
      ),
      "acc-explicit",
    );

    const singleRepository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({ data: [{ id: "acc-1" }], error: null }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      },
    });
    assertEquals(
      await singleRepository.resolveAccountIdForRow(
        "person-1",
        {
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          transaction_type: "expense",
        },
        "manual",
      ),
      "acc-1",
    );

    const ambiguousRepository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_accounts") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({ data: [{ id: "acc-1" }, { id: "acc-2" }], error: null }),
                }),
              }),
            };
          }
          if (table === "money_cards") {
            return {
              select: () => ({
                eq: () => ({
                  in: async () => ({ data: [], error: { message: "cards failed" } }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    await assertThrowsWithMessage(
      () =>
        ambiguousRepository.resolveAccountIdForRow(
          "person-1",
          {
            posted_at: "2026-01-01T00:00:00.000Z",
            amount: 10,
            transaction_type: "expense",
            raw_payload: { account_hint: "**** 9999" },
          },
          "manual",
        ),
      "cards failed",
    );
  },
);

Deno.test(
  "repository transaction and line-item helpers expose additional failure branches",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transactions") {
            return createTransactionsTableStub({
              existingRow: null,
              statementRows: [],
              insertResult: () => ({
                data: null,
                error: { code: "500", message: "tx failed" },
              }),
            });
          }
          if (table === "money_line_items") {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { code: "23505", message: "duplicate" },
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    await assertThrowsWithMessage(
      () =>
        repository.insertOrResolveTransaction(
          {
            posted_at: "2026-01-01T00:00:00.000Z",
            amount: 10,
            transaction_type: "expense",
            account_id: "acc-1",
          },
          "person-1",
        ),
      "tx failed",
    );

    const duplicateWithoutExisting = await repository.insertLineItemIfNew(
      "tx-1",
      { title: "Coffee", amount: 10 },
      "hash-1",
      10,
    );
    assertEquals(duplicateWithoutExisting, { lineItemId: null, inserted: false });
  },
);

Deno.test("repository handles missing env and anon configuration branches", async () => {
  const repositoryMissingEnv = createSupabaseMoneyImportRepository({
    supabaseUrl: undefined,
    supabaseServiceRoleKey: undefined,
    supabaseAnonKey: "anon-key",
  });

  await assertThrowsWithMessage(
    () => repositoryMissingEnv.getSessionByToken("token"),
    "Supabase environment not configured",
  );

  const repositoryMissingAnon = createSupabaseMoneyImportRepository({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: undefined,
    supabaseServiceRoleKey: "service-key",
    createClientFn: ((_url: string, key: string) => {
      if (key === "service-key") {
        return {
          from: () => ({
            select: () => ({
              or: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        auth: {
          getUser: async () => ({ data: { user: null }, error: null }),
        },
      };
    }) as unknown as typeof createClient,
  });

  assertEquals(await repositoryMissingAnon.authenticateAllowedUser("token"), null);
});

Deno.test("repository returns null for lookup errors and uses default error messages", async () => {
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table === "money_transactions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: { message: "no tx" } }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "money_import_sessions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({ data: null, error: { message: "missing" } }),
                }),
                single: async () => ({ data: null, error: { message: "missing" } }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: { message: "session update failed" } }),
            }),
          };
        }
        if (table === "money_import_batches") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: {} }),
              }),
            }),
            select: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { message: "missing batch" } }),
              }),
            }),
          };
        }
        if (table === "money_import_batch_rows") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: {} }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  assertEquals(await repository.findLastImportedAt("tbank", "person-1"), null);
  assertEquals(await repository.getImportSessionForUser("session-1", "user-1"), null);
  assertEquals(await repository.getImportSessionById("session-1"), null);
  assertEquals(await repository.getImportBatch("batch-1"), null);

  await assertThrowsWithMessage(
    () => repository.updateImportSession("session-1", { status: "running" }),
    "session update failed",
  );
  await assertThrowsWithMessage(
    () => repository.createImportBatch({ source: "x" }),
    "Failed to create import batch",
  );
  await assertThrowsWithMessage(
    () => repository.insertReportRow({ batch_id: "b-1" }),
    "Failed to insert report row",
  );
});

Deno.test("repository resolves a duplicate through the dedupe hash", async () => {
  let dedupeQueryUsed = false;
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
        return createTransactionsTableStub({
          existingRow: { id: "tx-dedupe" },
          onDedupeLookup: () => {
            dedupeQueryUsed = true;
          },
          insertResult: () => {
            throw new Error("must not insert a row the dedupe hash already resolved");
          },
        });
      },
    },
  });

  assertEquals(
    await repository.insertOrResolveTransaction(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 20,
        transaction_type: "expense",
        account_id: "acc-1",
        dedupe_hash: "hash-1",
      },
      "person-1",
    ),
    { transactionId: "tx-dedupe", inserted: false },
  );
  assertEquals(dedupeQueryUsed, true);
});

Deno.test("repository reports a duplicate it cannot resolve", async () => {
  // A concurrent run inserted the same operation between the lookup and the insert, and by
  // the time the conflict is re-resolved the row is gone again. Reporting that is better
  // than silently returning an id that does not exist.
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
        return createTransactionsTableStub({
          existingRow: null,
          statementRows: [],
          insertResult: () => ({ data: null, error: { code: "23505", message: "dup" } }),
        });
      },
    },
  });

  await assertThrowsWithMessage(
    () =>
      repository.insertOrResolveTransaction(
        {
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 20,
          transaction_type: "expense",
          account_id: "acc-1",
        },
        "person-1",
      ),
    "Duplicate transaction but existing row could not be resolved",
  );
});

Deno.test("repository line-item payload uses defaults and fallback errors", async () => {
  const insertedPayloads: Record<string, unknown>[] = [];
  let insertCall = 0;
  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table !== "money_line_items") throw new Error(`Unexpected table ${table}`);
        return {
          insert: (payload: Record<string, unknown>) => {
            insertedPayloads.push(payload);
            return {
              select: () => ({
                single: async () => {
                  insertCall += 1;
                  if (insertCall === 1) return { data: { id: "line-1" }, error: null };
                  return { data: null, error: { code: "500" } };
                },
              }),
            };
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      },
    },
  });

  const inserted = await repository.insertLineItemIfNew(
    "tx-1",
    {
      title: null,
      amount: null,
      raw_payload: { source: "raw" },
    },
    "hash-1",
    42,
  );
  assertEquals(inserted, { lineItemId: "line-1", inserted: true });
  assertEquals(insertedPayloads[0].title, "Imported");
  assertEquals(insertedPayloads[0].amount, 42);
  assertEquals(insertedPayloads[0].raw_payload, { source: "raw" });

  await assertThrowsWithMessage(
    () =>
      repository.insertLineItemIfNew(
        "tx-1",
        { title: "x", amount: 1, raw_payload: null },
        "hash-2",
        1,
      ),
    "Failed to insert line item",
  );
});

Deno.test(
  "repository resolveCardIdForRow supports explicit, existing and no-hint branches",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table !== "money_cards") throw new Error(`Unexpected table ${table}`);
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: "card-existing" }, error: null }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: "card-new" }, error: null }),
              }),
            }),
          };
        },
      },
    });

    assertEquals(
      await repository.resolveCardIdForRow("acc-1", {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        card_id: "card-explicit",
        raw_payload: { account_hint: "**** 9999" },
      }),
      "card-explicit",
    );

    assertEquals(
      await repository.resolveCardIdForRow("acc-1", {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        raw_payload: { account_hint: "**** 4444" },
      }),
      "card-existing",
    );

    assertEquals(
      await repository.resolveCardIdForRow("acc-1", {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        raw_payload: { account_hint: "no digits" },
      }),
      null,
    );
  },
);

Deno.test(
  "repository resolveCardIdForRow creates card and handles unique-conflict fallback",
  async () => {
    let insertCalls = 0;
    const insertedPayloads: Record<string, unknown>[] = [];
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table !== "money_cards") throw new Error(`Unexpected table ${table}`);
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      if (insertCalls === 0) return { data: null, error: null };
                      return { data: { id: "card-after-conflict" }, error: null };
                    },
                  }),
                }),
              }),
            }),
            insert: (payload: Record<string, unknown>) => {
              insertedPayloads.push(payload);
              return {
                select: () => ({
                  single: async () => {
                    insertCalls += 1;
                    if (insertCalls === 1) return { data: { id: "card-created" }, error: null };
                    return { data: null, error: { code: "23505", message: "duplicate card" } };
                  },
                }),
              };
            },
          };
        },
      },
    });

    const created = await repository.resolveCardIdForRow("acc-2", {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      raw_payload: { account_hint: "card **** 1234" },
    });
    assertEquals(created, "card-created");
    assertEquals(insertedPayloads[0].account_id, "acc-2");
    assertEquals(insertedPayloads[0].last4, "1234");

    const conflictResolved = await repository.resolveCardIdForRow("acc-2", {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      raw_payload: { account_hint: "****1234" },
    });
    assertEquals(conflictResolved, "card-after-conflict");
  },
);

Deno.test("repository resolveBrandIdForRow creates canonical brand and alias", async () => {
  const brandInserts: Record<string, unknown>[] = [];
  const aliasInserts: Record<string, unknown>[] = [];

  const repository = createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table === "money_transaction_brand_aliases") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
              order: async () => ({
                data: [],
                error: null,
              }),
            }),
            insert: (payload: Record<string, unknown>) => {
              aliasInserts.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }

        if (table === "money_transaction_brands") {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              order: async () => ({
                data: [],
                error: null,
              }),
            }),
            insert: (payload: Record<string, unknown>) => {
              brandInserts.push(payload);
              return {
                select: () => ({
                  single: async () => ({ data: { id: "brand-1" }, error: null }),
                }),
              };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  const brandId = await repository.resolveBrandIdForRow!(
    {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      source: "tbank_web",
      source_brand: {
        source_key: "17879",
        name: "Transport",
        website_url: "https://mu-kgt.ru",
        logo_url: "https://cdn.example.com/logo.png",
        base_color: "C21722",
        base_text_color: "FFFFFF",
      },
    },
    "tbank_web",
    true,
  );

  assertEquals(brandId, "brand-1");
  assertEquals(brandInserts[0], {
    slug: "transport",
    name: "Transport",
    website_url: "https://mu-kgt.ru",
    logo_url: "https://cdn.example.com/logo.png",
    base_color: "C21722",
    base_text_color: "FFFFFF",
  });
  assertEquals(aliasInserts[0], {
    brand_id: "brand-1",
    source: "tbank",
    source_key: "17879",
    source_name: "Transport",
    website_url: "https://mu-kgt.ru",
    logo_url: "https://cdn.example.com/logo.png",
    base_color: "C21722",
    base_text_color: "FFFFFF",
  });
});

Deno.test(
  "repository resolveBrandIdForRow reuses existing alias and can skip creation",
  async () => {
    let aliasLookupCount = 0;
    let brandLookupCount = 0;

    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transaction_brand_aliases") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => {
                        aliasLookupCount += 1;
                        if (aliasLookupCount === 1) {
                          return { data: { brand_id: "brand-existing" }, error: null };
                        }
                        return { data: null, error: null };
                      },
                    }),
                  }),
                }),
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
              insert: () => Promise.resolve({ error: { code: "should-not-insert" } }),
            };
          }

          if (table === "money_transaction_brands") {
            return {
              select: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      brandLookupCount += 1;
                      return {
                        data: {
                          id: "brand-existing",
                          name: "Known Brand",
                          website_url: null,
                          logo_url: null,
                          base_color: null,
                          base_text_color: null,
                        },
                        error: null,
                      };
                    },
                  }),
                }),
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
              update: () => ({
                eq: async () => ({ error: null }),
              }),
              insert: () => ({
                select: () => ({
                  single: async () => ({ data: null, error: { code: "should-not-insert" } }),
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const reusedBrandId = await repository.resolveBrandIdForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "17879",
          name: "Known Brand",
          website_url: "https://known.example",
        },
      },
      "tbank_web",
      true,
    );
    assertEquals(reusedBrandId, "brand-existing");
    assertEquals(brandLookupCount, 1);

    const skippedBrandId = await repository.resolveBrandIdForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "new-brand",
          name: "New Brand",
        },
      },
      "tbank_web",
      false,
    );
    assertEquals(skippedBrandId, null);
  },
);

Deno.test(
  "repository previewBrandResolutionForRow auto-selects website + name match at 100",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transaction_brand_aliases") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            };
          }

          if (table === "money_transaction_brands") {
            return {
              select: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "brand-known",
                      slug: "known-brand",
                      name: "Known Brand",
                      website_url: "https://known.example/store",
                      logo_url: "https://cdn.example.com/known-brand.png",
                      base_color: null,
                      base_text_color: null,
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const resolution = await repository.previewBrandResolutionForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "known-brand",
          name: "Known Brand",
          website_url: "https://known.example/merchant/42",
        },
      },
      "tbank_web",
    );

    assertEquals(resolution?.suggested_brand_id, "brand-known");
    assertEquals(resolution?.suggested_confidence, 100);
    assertEquals(resolution?.selected_action, "match_existing");
    assertEquals(resolution?.selected_brand_id, "brand-known");
  },
);

Deno.test(
  "repository previewBrandResolutionForRow auto-selects exact name-only match at 90",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transaction_brand_aliases") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            };
          }

          if (table === "money_transaction_brands") {
            return {
              select: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "brand-name-only",
                      slug: "known-brand",
                      name: "Known Brand",
                      website_url: null,
                      logo_url: null,
                      base_color: "111111",
                      base_text_color: "ffffff",
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const resolution = await repository.previewBrandResolutionForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "known-brand",
          name: "Known Brand",
          base_color: "ff0000",
          base_text_color: "000000",
        },
      },
      "tbank_web",
    );

    assertEquals(resolution?.suggested_brand_id, "brand-name-only");
    assertEquals(resolution?.suggested_confidence, 90);
    assertEquals(resolution?.selected_action, "match_existing");
    assertEquals(resolution?.selected_brand_id, "brand-name-only");
  },
);

Deno.test(
  "repository previewBrandResolutionForRow reuses the indexed brand catalog across calls",
  async () => {
    let brandCatalogLoads = 0;
    let aliasCatalogLoads = 0;

    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transaction_brand_aliases") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
                order: async () => {
                  aliasCatalogLoads += 1;
                  return {
                    data: [
                      {
                        brand_id: "brand-known",
                        source_name: "Known Brand",
                        website_url: null,
                        logo_url: null,
                      },
                    ],
                    error: null,
                  };
                },
              }),
            };
          }

          if (table === "money_transaction_brands") {
            return {
              select: () => ({
                order: async () => {
                  brandCatalogLoads += 1;
                  return {
                    data: [
                      {
                        id: "brand-known",
                        slug: "known-brand",
                        name: "Known Brand",
                        website_url: null,
                        logo_url: null,
                        base_color: null,
                        base_text_color: null,
                      },
                    ],
                    error: null,
                  };
                },
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const firstResolution = await repository.previewBrandResolutionForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "known-brand-1",
          name: "Known Brand",
        },
      },
      "tbank_web",
    );
    const secondResolution = await repository.previewBrandResolutionForRow!(
      {
        posted_at: "2026-01-02T00:00:00.000Z",
        amount: 20,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "known-brand-2",
          name: "Known Brand",
        },
      },
      "tbank_web",
    );

    assertEquals(firstResolution?.suggested_brand_id, "brand-known");
    assertEquals(secondResolution?.suggested_brand_id, "brand-known");
    assertEquals(brandCatalogLoads, 1);
    assertEquals(aliasCatalogLoads, 1);
  },
);

Deno.test(
  "repository previewBrandResolutionForRow defaults tied top matches to create_new",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transaction_brand_aliases") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            };
          }

          if (table === "money_transaction_brands") {
            return {
              select: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "brand-a",
                      slug: "known-brand-a",
                      name: "Known Brand",
                      website_url: null,
                      logo_url: null,
                      base_color: null,
                      base_text_color: null,
                    },
                    {
                      id: "brand-b",
                      slug: "known-brand-b",
                      name: "Known Brand",
                      website_url: null,
                      logo_url: null,
                      base_color: null,
                      base_text_color: null,
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const resolution = await repository.previewBrandResolutionForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "known-brand",
          name: "Known Brand",
        },
      },
      "tbank_web",
    );

    assertEquals(resolution?.suggested_brand_id, null);
    assertEquals(resolution?.suggested_confidence, 90);
    assertEquals(resolution?.selected_action, "create_new");
    assertEquals(resolution?.selected_brand_id ?? null, null);
  },
);

Deno.test(
  "repository previewBrandResolutionForRow ignores bank-native labels even when an alias exists",
  async () => {
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transaction_brand_aliases") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: {
                          brand_id: "brand-bad",
                          source_name: "Внутрибанковский перевод",
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            };
          }

          if (table === "money_transaction_brands") {
            return {
              select: () => ({
                order: async () => ({
                  data: [],
                  error: null,
                }),
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      },
    });

    const resolution = await repository.previewBrandResolutionForRow!(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 10,
        transaction_type: "expense",
        source: "tbank_web",
        source_brand: {
          source_key: "native-transfer",
          name: "Внутрибанковский перевод 3-м лицам",
        },
      },
      "tbank_web",
    );

    assertEquals(resolution, null);
  },
);

function createBatchOwnershipRepository(batch: Record<string, unknown> | null) {
  return createRepositoryWithClients({
    adminClient: {
      from: (table: string) => {
        if (table === "money_import_batches") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: batch,
                  error: batch ? null : { message: "not found" },
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    },
  });
}

Deno.test("repository getImportBatchForUser hides a batch created by someone else", async () => {
  const ownRepository = createBatchOwnershipRepository({
    id: "batch-1",
    created_by_auth_user_id: "user-1",
  });
  assertEquals((await ownRepository.getImportBatchForUser("batch-1", "user-1"))?.id, "batch-1");

  const otherRepository = createBatchOwnershipRepository({
    id: "batch-1",
    created_by_auth_user_id: "user-2",
  });
  assertEquals(await otherRepository.getImportBatchForUser("batch-1", "user-1"), null);

  // Batches created before the column existed carry NULL and keep their previous reach.
  const legacyRepository = createBatchOwnershipRepository({
    id: "batch-1",
    created_by_auth_user_id: null,
  });
  assertEquals((await legacyRepository.getImportBatchForUser("batch-1", "user-1"))?.id, "batch-1");

  const missingRepository = createBatchOwnershipRepository(null);
  assertEquals(await missingRepository.getImportBatchForUser("batch-1", "user-1"), null);
});
