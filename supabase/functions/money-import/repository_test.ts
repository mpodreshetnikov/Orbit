// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseMoneyImportRepository, type MoneyImportRepository } from "./repository.ts";
import type { CanonicalTransactionRowInput } from "./types.ts";

function createRepositoryWithClients(clients: {
  anonClient?: Record<string, unknown>;
  adminClient?: Record<string, unknown>;
  createClientFn?: typeof createClient;
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
  "repository insertOrResolveTransaction handles inserted and duplicate paths",
  async () => {
    let insertCalls = 0;
    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table === "money_transactions") {
            return {
              insert: () => ({
                select: () => ({
                  single: async () => {
                    insertCalls += 1;
                    if (insertCalls === 1) {
                      return { data: { id: "tx-1" }, error: null };
                    }
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  },
                }),
              }),
              select: () => ({
                limit: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: { id: "tx-existing" }, error: null }),
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

    const row: CanonicalTransactionRowInput = {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      source: "tbank",
      external_id: "ext-1",
      account_id: "acc-1",
    };

    const inserted = await repository.insertOrResolveTransaction(row, "person-1");
    assertEquals(inserted, { transactionId: "tx-1", inserted: true });

    const duplicate = await repository.insertOrResolveTransaction(row, "person-1");
    assertEquals(duplicate, { transactionId: "tx-existing", inserted: false });
  },
);

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
            return {
              insert: () => ({
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { code: "500", message: "tx failed" },
                  }),
                }),
              }),
            };
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

Deno.test(
  "repository duplicate transaction handling covers dedupe and unresolved duplicate branches",
  async () => {
    let insertCall = 0;
    let dedupeQueryUsed = false;

    const repository = createRepositoryWithClients({
      adminClient: {
        from: (table: string) => {
          if (table !== "money_transactions") throw new Error(`Unexpected table ${table}`);
          return {
            insert: () => ({
              select: () => ({
                single: async () => {
                  insertCall += 1;
                  if (insertCall === 1)
                    return { data: null, error: { code: "23505", message: "dup" } };
                  return { data: null, error: { code: "23505", message: "dup" } };
                },
              }),
            }),
            select: () => ({
              limit: () => ({
                eq: (column: string) => {
                  if (column === "dedupe_hash") dedupeQueryUsed = true;
                  return {
                    eq: () => ({
                      maybeSingle: async () => ({ data: { id: "tx-dedupe" }, error: null }),
                    }),
                    maybeSingle: async () => ({ data: { id: "tx-dedupe" }, error: null }),
                  };
                },
              }),
            }),
          };
        },
      },
    });

    const dedupeResolved = await repository.insertOrResolveTransaction(
      {
        posted_at: "2026-01-01T00:00:00.000Z",
        amount: 20,
        transaction_type: "expense",
        account_id: "acc-1",
        dedupe_hash: "hash-1",
      },
      "person-1",
    );
    assertEquals(dedupeResolved, { transactionId: "tx-dedupe", inserted: false });
    assertEquals(dedupeQueryUsed, true);

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
  },
);

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
