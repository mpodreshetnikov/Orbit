import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A proposed checkup is scheduled only from the card: `propose_checkup` must write nothing and
 * return what the card shows, and only the card-only tool adds it.
 */
const checkups = vi.hoisted(() => ({
  reviewCheckupProposals: vi.fn(),
  addProposedCheckups: vi.fn(),
}));

vi.mock("../health/checkups", () => checkups);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));
vi.mock("../resolve-person", () => ({
  resolvePerson: vi.fn(async () => ({
    status: "ok",
    person: { id: "p-1", name: "Максим", kind: "human" },
  })),
}));

import { RECORD_DRAFT_HTML } from "./record-draft-page";
import { registerCheckupProposalApp, scheduleLabel } from "./checkup-proposal";
import { RECORD_DRAFT_RESOURCE_URI } from "./record-draft";

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const ctx = {
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

const ULTRASOUND = {
  title: "УЗИ щитовидной железы",
  category: "imaging",
  schedule: { type: "interval", every: 1, unit: "year" },
  first_due_at: "2027-03-06",
  why: "Узел 4 мм, контроль через год",
  condition_id: null,
};

function register() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerCheckupProposalApp({
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
      return {} as never;
    }),
  } as never);
  return tools;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkups.reviewCheckupProposals.mockResolvedValue({
    accepted: [{ input: ULTRASOUND, first_due_at: "2027-03-06", condition_name: null }],
    refused: [{ title: "ОАК", reason: 'already scheduled as "ОАК" (active)' }],
    evidence: { record_id: "rec-1", title: "УЗИ", record_date: "2026-03-06" },
  });
});

describe("scheduleLabel", () => {
  it("says the interval in Russian", () => {
    expect(scheduleLabel({ type: "interval", every: 1, unit: "year" })).toBe("раз в год");
    expect(scheduleLabel({ type: "interval", every: 3, unit: "month" })).toBe("раз в 3 месяца");
    expect(scheduleLabel({ type: "interval", every: 21, unit: "week" })).toBe("раз в 21 неделю");
    expect(scheduleLabel({ type: "one_off", due_at: "2026-12-01" })).toBe("однократно");
  });
});

describe("registerCheckupProposalApp", () => {
  it("shows propose_checkup on the card and keeps adding to the card", () => {
    const tools = register();
    expect(tools.get("propose_checkup")!.config._meta).toEqual({
      ui: { resourceUri: RECORD_DRAFT_RESOURCE_URI },
      "ui/resourceUri": RECORD_DRAFT_RESOURCE_URI,
    });
    expect(tools.get("propose_checkup")!.config.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.get("add_proposed_checkups")!.config._meta).toEqual({
      ui: { visibility: ["app"] },
    });
  });

  it("returns the card's view, names what it refused, and writes nothing", async () => {
    const result = await register()
      .get("propose_checkup")!
      .handler({ checkups: [ULTRASOUND], evidence_record_id: "rec-1" }, ctx);

    expect(result.content[0].text).toContain(
      'Showing 1 proposed checkup(s) for Максим on a card: "УЗИ щитовидной железы" first due 2027-03-06',
    );
    expect(result.content[0].text).toContain('- "ОАК": already scheduled');
    expect(result.structuredContent?.checkup_proposal).toEqual({
      person_id: "p-1",
      person_name: "Максим",
      evidence_record_id: "rec-1",
      evidence_label: "УЗИ, 6 марта 2026 г.",
      items: [
        {
          title: "УЗИ щитовидной железы",
          category_label: "Диагностика",
          schedule_label: "раз в год",
          first_due_at: "2027-03-06",
          why: "Узел 4 мм, контроль через год",
          condition_name: null,
          input: ULTRASOUND,
        },
      ],
    });
    expect(checkups.addProposedCheckups).not.toHaveBeenCalled();
  });

  it("fails when nothing is left to show", async () => {
    checkups.reviewCheckupProposals.mockResolvedValue({
      accepted: [],
      refused: [{ title: "ОАК", reason: "already scheduled" }],
      evidence: null,
    });
    const result = await register()
      .get("propose_checkup")!
      .handler({ checkups: [ULTRASOUND] }, ctx);
    expect(result.isError).toBe(true);
  });

  it("adds from the card after checking again, and needs write access", async () => {
    checkups.addProposedCheckups.mockResolvedValue([
      { id: "k-1", title: "УЗИ щитовидной железы", next_due_at: "2027-03-06" },
    ]);
    const add = register().get("add_proposed_checkups")!.handler;
    const result = await add({ person_id: "p-1", checkups: [ULTRASOUND] }, ctx);
    expect(checkups.reviewCheckupProposals).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain(
      'Scheduled for Максим: "УЗИ щитовидной железы" (due 2027-03-06)',
    );

    const readOnly = { http: { authInfo: { ...ctx.http.authInfo, scopes: ["health:read"] } } };
    const refused = await add({ person_id: "p-1", checkups: [ULTRASOUND] }, readOnly);
    expect(refused.isError).toBe(true);
    expect(checkups.addProposedCheckups).toHaveBeenCalledTimes(1);
  });
});

describe("the card's checkup mode", () => {
  it("adds through the card-only tool with the items it was given", () => {
    expect(RECORD_DRAFT_HTML).toContain('name: "add_proposed_checkups"');
    expect(RECORD_DRAFT_HTML).toContain("return c.input;");
  });
});
