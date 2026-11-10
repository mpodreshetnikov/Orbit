import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Checkup create/edit only via draft→confirm: propose writes nothing, confirm needs health:write.
 */
const draftApi = vi.hoisted(() => ({
  buildCreateCheckupDraft: vi.fn(),
  buildEditCheckupDraft: vi.fn(),
  applyCheckupDraft: vi.fn(),
  checkupDraftSummaryText: vi.fn(
    (draft: { title: string }) =>
      `Showing a create checkup draft for Максим on a card: "${draft.title}"`,
  ),
}));

vi.mock("../health/checkup-draft", async () => {
  const actual =
    await vi.importActual<typeof import("../health/checkup-draft")>("../health/checkup-draft");
  return {
    ...actual,
    buildCreateCheckupDraft: (...args: unknown[]) => draftApi.buildCreateCheckupDraft(...args),
    buildEditCheckupDraft: (...args: unknown[]) => draftApi.buildEditCheckupDraft(...args),
    applyCheckupDraft: (...args: unknown[]) => draftApi.applyCheckupDraft(...args),
  };
});
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));
vi.mock("../resolve-person", () => ({
  resolvePerson: vi.fn(async () => ({
    status: "ok",
    person: { id: "p-1", name: "Максим", kind: "human" },
  })),
}));

import { CHECKUP_DRAFT_HTML } from "./checkup-draft-page";
import {
  confirmCheckupDraftInputSchema,
  registerCheckupDraftApp,
  CHECKUP_DRAFT_RESOURCE_URI,
} from "./checkup-draft";

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const healthCtx = {
  http: {
    authInfo: {
      scopes: ["health:read", "health:write"],
      extra: {
        grantId: "g-1",
        authUserId: "11111111-1111-1111-1111-111111111111",
        userEmail: "u@example.com",
      },
    },
  },
};

const CREATE = {
  title: "УЗИ щитовидной железы",
  category: "imaging" as const,
  schedule: { type: "interval" as const, every: 6, unit: "month" as const },
  first_due_at: "2026-12-01",
  why: "контроль по документу",
};

function register() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  const resources = new Map<string, unknown>();
  registerCheckupDraftApp({
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
      return {} as never;
    }),
    registerResource: vi.fn((name: string, uri: string, config: unknown, reader: unknown) => {
      resources.set(name, { uri, config, reader });
      return {} as never;
    }),
  } as never);
  return { tools, resources };
}

beforeEach(() => {
  vi.clearAllMocks();
  draftApi.buildCreateCheckupDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "create",
      person_id: "p-1",
      person_name: "Максим",
      checkup_id: null,
      title: CREATE.title,
      category_label: "Диагностика",
      schedule_label: "раз в 6 мес.",
      first_due_label: "1 декабря 2026 г.",
      status_label: "активен",
      planned_on_label: null,
      reminders_label: null,
      why: CREATE.why,
      notes: null,
      condition_name: null,
      input: CREATE,
    },
  });
  draftApi.applyCheckupDraft.mockResolvedValue({
    ok: true,
    checkup_id: "c-1",
    title: CREATE.title,
  });
});

describe("registerCheckupDraftApp", () => {
  it("links propose tools to the checkup card and keeps confirm on model+app", () => {
    const { tools, resources } = register();
    expect(resources.get("orbit-checkup-draft")).toMatchObject({
      uri: CHECKUP_DRAFT_RESOURCE_URI,
    });
    expect(tools.get("propose_checkup_create")!.config._meta).toEqual({
      ui: { resourceUri: CHECKUP_DRAFT_RESOURCE_URI },
      "ui/resourceUri": CHECKUP_DRAFT_RESOURCE_URI,
    });
    expect(tools.get("propose_checkup_create")!.config.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(tools.get("propose_checkup_edit")!.config.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(tools.get("confirm_checkup_draft")!.config.annotations).toMatchObject({
      readOnlyHint: false,
    });
    expect(tools.get("confirm_checkup_draft")!.config._meta).toEqual({
      ui: { visibility: ["model", "app"] },
    });
  });

  it("returns the card view, Markdown fallback, and writes nothing on propose", async () => {
    const result = await register().tools.get("propose_checkup_create")!.handler(CREATE, healthCtx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("УЗИ");
    expect(result.content[0].text).toMatch(/cannot show the MCP App/i);
    expect(result.content[0].text).toContain("# УЗИ");
    expect(result.content[0].text).toContain("## Метаданные");
    expect(result.content[0].text).toContain("confirm_checkup_draft");
    expect(result.content[0].text).toMatch(/explicit Confirm/i);
    expect(result.structuredContent?.checkup_draft).toMatchObject({ mode: "create" });
    expect(draftApi.applyCheckupDraft).not.toHaveBeenCalled();
  });

  it("keeps confirm listed to the model (not app-only) for hosts without MCP Apps", () => {
    const meta = register().tools.get("confirm_checkup_draft")!.config._meta as {
      ui: { visibility: string[] };
    };
    expect(meta.ui.visibility).toEqual(["model", "app"]);
    expect(register().tools.get("confirm_checkup_draft")!.config.description).toMatch(
      /explicitly confirmed/i,
    );
  });

  it("needs health:read to propose", async () => {
    const moneyOnly = {
      http: { authInfo: { ...healthCtx.http.authInfo, scopes: ["money:read", "money:write"] } },
    };
    const result = await register().tools.get("propose_checkup_create")!.handler(CREATE, moneyOnly);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"health:read"');
    expect(draftApi.buildCreateCheckupDraft).not.toHaveBeenCalled();
  });

  it("confirms with health:write and denies without it", async () => {
    const confirm = register().tools.get("confirm_checkup_draft")!.handler;
    const saved = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, healthCtx);
    expect(saved.isError).toBeFalsy();
    expect(saved.content[0].text).toContain("checkup_id c-1");
    expect(draftApi.applyCheckupDraft).toHaveBeenCalledTimes(1);

    const readOnly = {
      http: { authInfo: { ...healthCtx.http.authInfo, scopes: ["health:read"] } },
    };
    const refused = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, readOnly);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('"health:write"');
    expect(draftApi.applyCheckupDraft).toHaveBeenCalledTimes(1);
  });
});

describe("confirmCheckupDraftInputSchema", () => {
  it("keeps checkup_id on edit drafts", () => {
    const parsed = confirmCheckupDraftInputSchema.parse({
      person_id: "11111111-1111-4111-8111-111111111111",
      mode: "edit",
      draft: {
        checkup_id: "22222222-2222-4222-8222-222222222222",
        title: "Новое имя",
        status: "paused",
      },
    });
    expect(parsed.mode).toBe("edit");
    expect(parsed.draft).toMatchObject({
      checkup_id: "22222222-2222-4222-8222-222222222222",
      title: "Новое имя",
      status: "paused",
    });
  });
});

describe("the checkup card", () => {
  it("confirms through confirm_checkup_draft with the draft it was given", () => {
    expect(CHECKUP_DRAFT_HTML).toContain('name: "confirm_checkup_draft"');
    expect(CHECKUP_DRAFT_HTML).toContain("draft.input");
    expect(CHECKUP_DRAFT_HTML).toContain("Подтвердить");
    expect(CHECKUP_DRAFT_HTML).toContain('protocolVersion: "2026-01-26"');
    expect(CHECKUP_DRAFT_HTML).toContain("ui/notifications/initialized");
    expect(CHECKUP_DRAFT_HTML).toContain("checkup_draft");
  });

  it("keeps confirm in-flight after a timeout but surfaces definitive RPC rejects", () => {
    expect(CHECKUP_DRAFT_HTML).toContain("timedOut.timedOut = true");
    expect(CHECKUP_DRAFT_HTML).toContain("if (err && err.timedOut)");
    expect(CHECKUP_DRAFT_HTML).toContain('kind: "waiting"');
    expect(CHECKUP_DRAFT_HTML).toContain("late.error");
  });
});
