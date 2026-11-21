import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { PROTECTED_RESOURCE_METADATA_PATH, isMcpServerEnabled } from "@/lib/mcp/config";
import { registerCheckupDraftApp } from "@/lib/mcp/apps/checkup-draft";
import { registerCheckupProposalApp } from "@/lib/mcp/apps/checkup-proposal";
import { registerAppProbe } from "@/lib/mcp/apps/probe";
import { registerRecordDraftApp } from "@/lib/mcp/apps/record-draft";
import { registerCategoryDraftApp } from "@/lib/mcp/apps/category-draft";
import { registerSpendDraftApp } from "@/lib/mcp/apps/spend-draft";
import { withServerTimingHeader } from "@/lib/mcp/server-timing";
import { registerHealthTools } from "@/lib/mcp/tools";
import { verifyMcpBearerToken } from "@/lib/mcp/verify-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The MCP endpoint. Add this URL as a custom connector in an MCP client
 * (Claude on web, desktop, mobile, or Claude Code) and it will discover the
 * OAuth server, register itself, walk the user through the app's normal Google
 * login, and then call these tools on their behalf.
 *
 * Auth is bearer-token only. An unauthenticated call must answer 401 with a
 * `WWW-Authenticate` header naming the protected-resource document -- that
 * header is how a client discovers where to authenticate. The app's session
 * middleware skips this path precisely so it cannot turn that 401 into a
 * redirect to /login (see BEARER_AUTH_ROUTE_PREFIXES in supabase-middleware.ts).
 */
// Stryker disable next-line ArrayDeclaration: connector prose only — tool registration is the gate
const MCP_INSTRUCTIONS = [
  "Health data for a personal/family health app.",
  "Most tools are scoped to a person (family members and pets are tracked separately).",
  "Call list_persons first when you do not know which person a request refers to, and ask the user rather than guessing.",
  "Two different things are called measurements here: `measurements` are manually recorded body metrics (weight, height, circumferences), while observations are lab values extracted from uploaded medical documents. Pick the right one for the question.",
  "To bring in a medical document you have read yourself: create_medical_record, upload its pages (get_upload_links for fresh links when an upload fails; never a second record for the same document), get_ingest_candidates, ingest_medical_document with its reconciliation decided in the same call, then show_record_draft so the user approves or declines the draft on its card (activate_medical_record only when they agree in words instead). When an approved record turns out to close a condition or complete a checkup, propose_reconciliation, then show_record_draft so the user confirms it on the card. To schedule a follow-up a document asks for, propose_checkup; the user adds it from its card. To create or edit a checkup (title, category, schedule, status, reminders, planned_on, why, notes) use propose_checkup_create / propose_checkup_edit then confirm_checkup_draft after the owner confirms on the card (or clearly in chat). To mark an existing checkup done, mark_checkup_done (backdates need a preview call then confirm=true). To change only recurrence quickly, update_checkup_schedule (preview then confirm=true).",
  "Money reads: for month/period totals or spend-by-category call get_money_spending_report (one call). list_money_transactions is a wide compact ledger (no receipt lines, no raw bank JSON; default limit 100, has_more) — one page covers a typical month (~40–80 rows); do not page a whole month for aggregates. Prefer search_money_line_items for product/line text (e.g. milk). Call get_money_transaction_details only for ids whose receipt composition you need. list_money_categories and list_money_accounts name what the filters accept.",
  "Money writes: propose_spend or propose_spend_edit and propose_category_create / rename / delete / propose_line_recategorize show a draft card; the owner confirms on the card (confirm_spend_draft or confirm_category_draft). There is no direct create/update money tool — never invent one.",
].join(" ");

const handler = createMcpHandler(
  (server) => {
    registerHealthTools(server);
    registerAppProbe(server);
    registerRecordDraftApp(server);
    registerCheckupProposalApp(server);
    registerCheckupDraftApp(server);
    registerSpendDraftApp(server);
    registerCategoryDraftApp(server);
  },
  {
    serverInfo: { name: "orbit-health", version: "1.0.0" },
    instructions: MCP_INSTRUCTIONS,
  },
);

/**
 * Time bearer verify separately from the MCP handler so prod latency can be
 * split via Server-Timing (auth vs mcp vs total) without reading response bodies.
 */
async function route(request: Request): Promise<Response> {
  if (!isMcpServerEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  const totalStart = performance.now();
  let authMs = 0;

  const timedVerify: typeof verifyMcpBearerToken = async (req, bearerToken) => {
    const authStart = performance.now();
    let authResult: Awaited<ReturnType<typeof verifyMcpBearerToken>>;
    try {
      authResult = await verifyMcpBearerToken(req, bearerToken);
    } catch (error) {
      authMs = performance.now() - authStart;
      throw error;
    }
    authMs = performance.now() - authStart;
    return authResult;
  };

  const timedHandler = withMcpAuth(handler, timedVerify, {
    required: true,
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
  });

  const response = await timedHandler(request);
  const totalMs = performance.now() - totalStart;
  return withServerTimingHeader(response, {
    authMs,
    // Stryker disable next-line MethodExpression: Math.min would collapse the mcp bucket to 0
    mcpMs: Math.max(0, totalMs - authMs),
    totalMs,
  });
}

export { route as GET, route as POST, route as DELETE };
