// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseHealthStructureRepository } from "./repository.ts";

async function assertThrowsWithMessage(
  run: () => Promise<unknown> | unknown,
  expectedMessage: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof Error)) throw new Error("Expected Error");
  assertEquals(caught.message, expectedMessage);
}

function createRepositoryWithClients(clients: {
  anonClient?: Record<string, unknown>;
  adminClient?: Record<string, unknown>;
}) {
  return createSupabaseHealthStructureRepository({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    supabaseServiceRoleKey: "service-key",
    createClientFn: ((_url: string, key: string) => {
      if (key === "anon-key") return clients.anonClient;
      return clients.adminClient;
    }) as unknown as typeof createClient,
  });
}

Deno.test("health-structure repository requires Supabase environment", async () => {
  await assertThrowsWithMessage(
    () =>
      createSupabaseHealthStructureRepository({
        supabaseUrl: undefined,
        supabaseServiceRoleKey: undefined,
      }),
    "Supabase environment not configured",
  );
});

Deno.test("health-structure repository authenticates and allowlists users", async () => {
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
    },
  });

  const user = await repository.authenticateAllowedUser("token");
  assertEquals(user, { id: "user-1", email: "user@example.com" });
});

Deno.test("health-structure repository handles auth failures and record lookup", async () => {
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

        if (table === "allowed_users") {
          return {
            select: () => ({
              or: () => ({
                single: async () => ({ data: null, error: { message: "missing" } }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  assertEquals(await repository.authenticateAllowedUser("token"), null);
  assertEquals(await repository.getRecord("record-1"), null);
});

Deno.test("health-structure repository loads catalogs and person context", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "observation_catalog") {
          return {
            select: () => ({
              order: async () => ({
                data: [
                  {
                    id: "obs-1",
                    obs_code: "GLU",
                    name_ru: "Глюкоза",
                    name_en: "Glucose",
                    canonical_unit: "mmol/L",
                    synonyms_ru: [],
                    synonyms_en: [],
                    accepted_units: {},
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "finding_type_catalog") {
          return {
            select: () => ({
              order: async () => ({
                data: [
                  {
                    id: "ft-1",
                    finding_code: "F1",
                    name_ru: "Узел",
                    name_en: "Nodule",
                    synonyms_ru: [],
                    synonyms_en: [],
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "body_site_catalog") {
          return {
            select: () => ({
              order: async () => ({
                data: [
                  {
                    id: "bs-1",
                    site_code: "LUNG",
                    name_ru: "Легкое",
                    name_en: "Lung",
                    parent_site_code: null,
                    synonyms_ru: [],
                    synonyms_en: [],
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "conditions") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  order: async () => ({
                    data: [
                      {
                        id: "cond-1",
                        name: "Condition",
                        code: null,
                        current_status: "active",
                        onset_date: null,
                        resolved_date: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "record_findings") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({
                    data: [
                      {
                        finding_code: "F1",
                        finding_type_text: "Nodule",
                        site_code: "LUNG",
                        body_site_text: "Lung",
                        finding_type_id: "ft-1",
                        body_site_id: "bs-1",
                        resolution_status: "observed",
                      },
                      {
                        finding_code: "F1",
                        finding_type_text: "Nodule",
                        site_code: "LUNG",
                        body_site_text: "Lung",
                        finding_type_id: "ft-1",
                        body_site_id: "bs-1",
                        resolution_status: "observed",
                      },
                      {
                        finding_code: "F2",
                        finding_type_text: "Resolved",
                        site_code: "LIVER",
                        body_site_text: "Liver",
                        finding_type_id: "ft-2",
                        body_site_id: "bs-2",
                        resolution_status: "resolved",
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "checkup_items") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => ({
                    order: async () => ({
                      data: [
                        {
                          id: "check-1",
                          title: "Blood panel",
                          category: "lab",
                          next_due_at: "2026-01-01",
                        },
                      ],
                      error: null,
                    }),
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

  assertEquals((await repository.fetchObservationCatalog()).length, 1);
  assertEquals((await repository.fetchFindingTypeCatalog()).length, 1);
  assertEquals((await repository.fetchBodySiteCatalog()).length, 1);
  assertEquals((await repository.fetchPersonConditions("person-1")).length, 1);
  assertEquals((await repository.fetchPersonActiveFindings("person-1")).length, 1);
  assertEquals((await repository.fetchUpcomingOverdueCheckupItems("person-1")).length, 1);
});

Deno.test(
  "health-structure repository handles catalog/query errors with empty arrays",
  async () => {
    const repository = createRepositoryWithClients({
      anonClient: {
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      },
      adminClient: {
        from: () => ({
          select: () => ({
            order: async () => ({ data: null, error: { message: "broken" } }),
            eq: () => ({
              is: () => ({
                order: async () => ({ data: null, error: { message: "broken" } }),
              }),
              eq: () => ({
                order: async () => ({ data: null, error: { message: "broken" } }),
                not: () => ({
                  order: async () => ({ data: null, error: { message: "broken" } }),
                }),
              }),
            }),
          }),
        }),
      },
    });

    assertEquals(await repository.fetchObservationCatalog(), []);
    assertEquals(await repository.fetchFindingTypeCatalog(), []);
    assertEquals(await repository.fetchBodySiteCatalog(), []);
    assertEquals(await repository.fetchPersonConditions("person-1"), []);
    assertEquals(await repository.fetchPersonActiveFindings("person-1"), []);
    assertEquals(await repository.fetchUpcomingOverdueCheckupItems("person-1"), []);
  },
);

Deno.test("health-structure repository updates and replaces record rows", async () => {
  const inserted: Record<string, unknown>[][] = [];
  let deletedCount = 0;
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      rpc: async () => ({ data: true, error: null }),
      from: (table: string) => {
        if (table === "medical_records") {
          const matched = { data: [{ id: "record-1" }], error: null };
          return {
            update: () => ({
              eq: () => ({
                select: async () => matched,
                eq: () => ({ select: async () => matched }),
                or: () => ({ select: async () => matched }),
              }),
            }),
          };
        }
        if (table === "record_observations" || table === "record_findings") {
          return {
            delete: () => ({
              eq: async () => {
                deletedCount += 1;
                return { error: null };
              },
            }),
            insert: (rows: Record<string, unknown>[]) => {
              inserted.push(rows);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "condition_records") {
          return {
            delete: () => ({
              eq: async () => {
                deletedCount += 1;
                return { error: null };
              },
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  await repository.updateMedicalRecord("record-1", { title: "Doc" });
  await repository.replaceRecordObservations("record-1", [{ a: 1 }]);
  await repository.replaceRecordFindings("record-1", []);
  await repository.clearConditionRecords("record-1");

  assertEquals(inserted.length, 1);
  assertEquals(deletedCount, 3);
});

Deno.test("health-structure repository throws on write failures", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "medical_records") {
          const failed = { data: null, error: { message: "write failed" } };
          return {
            update: () => ({
              eq: () => ({
                select: async () => failed,
                eq: () => ({ select: async () => failed }),
                or: () => ({ select: async () => failed }),
              }),
            }),
          };
        }
        if (table === "record_observations") {
          return {
            delete: () => ({
              eq: async () => ({ error: null }),
            }),
            insert: async () => ({ error: { message: "obs failed" } }),
          };
        }
        if (table === "record_findings") {
          return {
            delete: () => ({
              eq: async () => ({ error: null }),
            }),
            insert: async () => ({ error: { message: "findings failed" } }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  await assertThrowsWithMessage(
    () => repository.updateMedicalRecord("record-1", { title: "x" }),
    "Failed to update record: write failed",
  );
  await assertThrowsWithMessage(
    () => repository.replaceRecordObservations("record-1", [{ a: 1 }]),
    "Failed to insert observations: obs failed",
  );
  await assertThrowsWithMessage(
    () => repository.replaceRecordFindings("record-1", [{ a: 1 }]),
    "Failed to insert findings: findings failed",
  );
});

Deno.test("health-structure repository condition/finding helpers work", async () => {
  const updates: Record<string, unknown>[] = [];
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "conditions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: async () => ({ data: { id: "cond-by-code" }, error: null }),
                  }),
                }),
                ilike: () => ({
                  is: () => ({
                    maybeSingle: async () => ({ data: { id: "cond-by-name" }, error: null }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: "cond-created" }, error: null }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async () => {
                updates.push(patch);
                return { error: null };
              },
            }),
          };
        }
        if (table === "condition_records") {
          return {
            insert: async () => ({ error: null }),
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { status_in_record: "resolved" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "record_findings") {
          return {
            insert: async () => ({ error: null }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  await repository.insertConditionRecord({ condition_id: "cond-1" });
  await repository.recomputeConditionCurrentStatus("cond-1");
  await repository.insertFinding({ record_id: "record-1" });

  // Only the status recompute writes to conditions now; creating and renaming them left the
  // edge function with the proposal path.
  assertEquals(updates.length, 1);
  assertEquals(updates[updates.length - 1].current_status, "resolved");
});

Deno.test("health-structure repository condition helpers handle null paths", async () => {
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "conditions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
                ilike: () => ({
                  is: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: { message: "create failed" } }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === "condition_records") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { status_in_record: null }, error: null }),
                  }),
                }),
              }),
            }),
            insert: async () => ({ error: null }),
          };
        }
        if (table === "record_findings") {
          return {
            insert: async () => ({ error: null }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  await repository.recomputeConditionCurrentStatus("cond-1");
});

Deno.test(
  "health-structure repository handles missing anon key and nullable catalog/query data",
  async () => {
    const repositoryMissingAnon = createSupabaseHealthStructureRepository({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: undefined,
      supabaseServiceRoleKey: "service-key",
      createClientFn: ((_url: string, _key: string) => {
        return {
          from: () => ({
            select: () => ({
              order: async () => ({ data: null, error: null }),
              eq: () => ({
                is: () => ({
                  order: async () => ({ data: null, error: null }),
                }),
                eq: () => ({
                  order: async () => ({ data: null, error: null }),
                  not: () => ({
                    order: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }) as unknown as typeof createClient,
    });

    assertEquals(await repositoryMissingAnon.authenticateAllowedUser("token"), null);
    assertEquals(await repositoryMissingAnon.fetchObservationCatalog(), []);
    assertEquals(await repositoryMissingAnon.fetchFindingTypeCatalog(), []);
    assertEquals(await repositoryMissingAnon.fetchBodySiteCatalog(), []);
    assertEquals(await repositoryMissingAnon.fetchPersonConditions("person-1"), []);
    assertEquals(await repositoryMissingAnon.fetchPersonActiveFindings("person-1"), []);
    assertEquals(await repositoryMissingAnon.fetchUpcomingOverdueCheckupItems("person-1"), []);
  },
);

Deno.test(
  "health-structure repository active findings normalization covers fallback branches",
  async () => {
    const repository = createRepositoryWithClients({
      anonClient: {
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      },
      adminClient: {
        from: (table: string) => {
          if (table === "record_findings") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: async () => ({
                      data: [
                        {
                          finding_code: null,
                          finding_type_text: "   ",
                          site_code: null,
                          body_site_text: null,
                          finding_type_id: null,
                          body_site_id: null,
                          resolution_status: "observed",
                        },
                      ],
                      error: null,
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

    const findings = await repository.fetchPersonActiveFindings("person-1");
    assertEquals(findings.length, 1);
    assertEquals(findings[0].finding_type_text, "Unknown finding");
    assertEquals(findings[0].finding_code, null);
    assertEquals(findings[0].site_code, null);
  },
);

Deno.test("health-structure repository replaceRecordObservations handles empty rows", async () => {
  let insertCalled = false;
  const repository = createRepositoryWithClients({
    anonClient: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    adminClient: {
      from: (table: string) => {
        if (table === "record_observations") {
          return {
            delete: () => ({
              eq: async () => ({ error: null }),
            }),
            insert: async () => {
              insertCalled = true;
              return { error: null };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  });

  await repository.replaceRecordObservations("record-1", []);
  assertEquals(insertCalled, false);
});

// A delete that failed turns "replace" into "append" for a run with corrections, and into "keep
// the old warnings" for a clean one -- and the clean case would report a problem that is gone.
Deno.test("replaceRecordExtractionIssues refuses to proceed when the clear failed", async () => {
  const repository = createSupabaseHealthStructureRepository({
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    createClientFn: (() => ({
      from: () => ({
        delete: () => ({
          eq: async () => ({ error: { message: "permission denied" } }),
        }),
        insert: async () => {
          throw new Error("must not insert after a failed clear");
        },
      }),
    })) as unknown as typeof createClient,
  });

  let caught: unknown = null;
  try {
    await repository.replaceRecordExtractionIssues("record-1", []);
  } catch (error) {
    caught = error;
  }
  assertEquals((caught as Error)?.message, "Failed to clear extraction issues: permission denied");
});
