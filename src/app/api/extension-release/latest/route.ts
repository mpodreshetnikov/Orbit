import { NextResponse } from "next/server";
import { readLatestExtensionReleasePayload } from "./release-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await readLatestExtensionReleasePayload();
    if (!payload) {
      return NextResponse.json(
        { error: "Extension release metadata is not published yet." },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load extension release metadata.";
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
