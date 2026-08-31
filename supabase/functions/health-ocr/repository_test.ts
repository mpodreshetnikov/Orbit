// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseHealthOcrRepository } from "./repository.ts";

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

function createRepositoryWithClients(clients: {
  anonClient?: Record<string, unknown>;
  adminClient?: Record<string, unknown>;
}) {
  return createSupabaseHealthOcrRepository({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    supabaseServiceRoleKey: "service-key",
    createClientFn: ((_url: string, key: string) => {
      if (key === "anon-key") return clients.anonClient;
      return clients.adminClient;
    }) as unknown as typeof createClient,
  });
}

Deno.test("health-ocr repository authenticates user and checks allowlist", async () => {
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
        if (table === "allowed_users") {
          return {
            select: () => ({
              or: () => ({
                single: async () => ({ data: { id: "allowed-1" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: null }),
        }),
      },
    },
  });

  const user = await repository.authenticateUser("token");
  assertEquals(user, { id: "user-1", email: "user@example.com" });
  assertEquals(await repository.isAllowedUser({ id: "user-1", email: "user@example.com" }), true);
});

Deno.test("health-ocr repository handles auth and allowlist failures", async () => {
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
          or: () => ({
            single: async () => ({ data: null, error: { message: "missing" } }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: null }),
        }),
      },
    },
  });

  assertEquals(await repository.authenticateUser("token"), null);
  assertEquals(await repository.isAllowedUser({ id: "user-1", email: "user@example.com" }), false);
});

Deno.test("health-ocr repository loads record and attachments", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "medical_records") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: "record-1", person_id: "person-1", status: "ocr_processing" },
                  error: null,
                }),
              }),
            }),
          };
        }

        if (table === "record_attachments") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "att-1",
                      storage_path: "a.png",
                      mime_type: "image/png",
                      original_filename: "a.png",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: null }),
        }),
      },
    },
  });

  const record = await repository.getRecord("record-1");
  assertEquals(record?.id, "record-1");
  const attachments = await repository.getAttachments("record-1");
  assertEquals(attachments.length, 1);
});

Deno.test("health-ocr repository handles missing record and attachment query errors", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "medical_records") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { message: "not found" } }),
              }),
            }),
          };
        }

        if (table === "record_attachments") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: null, error: { message: "broken" } }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: null }),
        }),
      },
    },
  });

  assertEquals(await repository.getRecord("missing"), null);
  await assertThrowsWithMessage(
    () => repository.getAttachments("record-1"),
    "Failed to fetch attachments: broken",
  );
});

Deno.test("health-ocr repository downloads attachments and updates record states", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      rpc: async () => ({ data: true, error: null }),
      from: (table: string) => {
        if (table === "medical_records") {
          return {
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                // The terminal writes now narrow by claim and read back the rows they matched.
                eq: () => ({
                  select: async () => {
                    updates.push(payload);
                    return { data: [{ id: "record-1" }], error: null };
                  },
                }),
                select: async () => {
                  updates.push(payload);
                  return { data: [{ id: "record-1" }], error: null };
                },
                or: () => ({
                  select: async () => {
                    updates.push(payload);
                    return { data: [{ id: "record-1" }], error: null };
                  },
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          download: async (path: string) => {
            if (path === "missing.png") return { data: null, error: { message: "404" } };
            return { data: new Blob(["ok"]), error: null };
          },
        }),
      },
    },
  });

  const downloaded = await repository.downloadAttachment("ok.png");
  assertEquals(downloaded instanceof Blob, true);
  assertEquals(await repository.downloadAttachment("missing.png"), null);

  // The claim is one database statement now, so the repository only relays its answer.
  assertEquals(typeof (await repository.claimRecord("record-1")), "string");
  await repository.updateRecordSuccess("record-1", { ocrText: "text", title: "Title" });
  await repository.updateRecordFailure("record-1", "broken");
  assertEquals(updates.length, 2);
  assertEquals(updates[0].status, "ocr_review");
  // A finished run releases the record rather than leaving it claimed until the lease expires.
  assertEquals(updates[0].processing_run_id, null);
  assertEquals(updates[1].status, "ocr_failed");
});

Deno.test("health-ocr repository throws when updateRecordSuccess fails", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "medical_records") {
          return {
            update: () => ({
              eq: () => ({
                select: async () => ({ data: null, error: { message: "write failed" } }),
                eq: () => ({
                  select: async () => ({ data: null, error: { message: "write failed" } }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: null }),
        }),
      },
    },
  });

  await assertThrowsWithMessage(
    () => repository.updateRecordSuccess("record-1", { ocrText: "text", title: "Title" }),
    "Failed to update record: write failed",
  );
});

Deno.test(
  "health-ocr repository uses service key fallback for user auth and handles nullable fields",
  async () => {
    const usedKeys: string[] = [];
    let createClientCalls = 0;
    const repository = createSupabaseHealthOcrRepository({
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-key",
      supabaseAnonKey: undefined,
      createClientFn: ((_url: string, key: string) => {
        createClientCalls += 1;
        usedKeys.push(key);
        if (createClientCalls === 1) {
          return {
            from: (table: string) => {
              if (table === "record_attachments") {
                return {
                  select: () => ({
                    eq: () => ({
                      order: async () => ({ data: null, error: null }),
                    }),
                  }),
                };
              }
              throw new Error(`Unexpected table ${table}`);
            },
            storage: {
              from: () => ({
                download: async () => ({ data: null, error: null }),
              }),
            },
          };
        }

        return {
          auth: {
            getUser: async () => ({
              data: { user: { id: "user-1", email: null } },
              error: null,
            }),
          },
        };
      }) as unknown as typeof createClient,
    });

    const user = await repository.authenticateUser("token");
    assertEquals(user, { id: "user-1", email: null });
    // second client creation is user client and must fallback to service role key when anon key is absent.
    assertEquals(usedKeys[1], "service-key");

    const attachments = await repository.getAttachments("record-1");
    assertEquals(attachments, []);
  },
);
