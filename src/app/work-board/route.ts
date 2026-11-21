import { NextResponse } from "next/server";
import { WORK_BOARD_ALLOWED_EMAIL, resolveWorkBoardAccess } from "@/lib/work-board/access";
import { clearWorkBoardCache, loadWorkBoardCards } from "@/lib/work-board/fetch-registry";
import { renderBoardHtml } from "@/lib/work-board/render";
import { getRequestOrigin } from "@/lib/request-origin";
import { getCurrentUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Maxim-only live orbit-tasks board (T-261121-q3r).
 * Gated by ORBIT_WORK_BOARD_ENABLED (default off) and a strict email ACL.
 * Never enable on kakos/cacos.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const access = resolveWorkBoardAccess({ email: user?.email ?? null });
  const origin = getRequestOrigin(request);

  if (access === "not-found") {
    return new NextResponse("Not Found", { status: 404 });
  }
  if (access === "unauthenticated") {
    const login = new URL("/login", origin);
    login.searchParams.set("redirect", "/work-board");
    return NextResponse.redirect(login);
  }
  if (access === "forbidden") {
    return NextResponse.redirect(new URL("/access-denied", origin));
  }

  const url = new URL(request.url);
  if (url.searchParams.get("refresh") === "1") {
    clearWorkBoardCache();
  }

  try {
    const { cards, generatedAt, source, cacheHit } = await loadWorkBoardCards();
    const html = renderBoardHtml(cards, {
      generatedAt: `${generatedAt} (${source}${cacheHit ? ", cache" : ", fresh"})`,
      reviewers: [WORK_BOARD_ALLOWED_EMAIL],
      lang: "ru",
    });
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load work board";
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Work board unavailable</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem"><h1>Work board unavailable</h1><p>The board is enabled, but the private registry could not be loaded. If <code>ORBIT_TASKS_GITHUB_TOKEN</code> is missing, that is a Lead blocker — do not bypass.</p><pre style="white-space:pre-wrap;background:#f4f4f5;padding:1rem">${escapeHtml(message)}</pre></body></html>`;
    return new NextResponse(html, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
