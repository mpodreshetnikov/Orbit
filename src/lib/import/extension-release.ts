export interface ExtensionRelease {
  version: string;
  publishedAt: string;
  extensionId: string;
  sha256: string;
  downloadUrl: string;
}

export interface ExtensionReleasePayload {
  version: string;
  published_at: string;
  extension_id: string;
  sha256: string;
  download_url: string;
}

function parseVersionSegment(segment: string): number {
  const parsed = Number.parseInt(segment.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function compareExtensionVersions(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = parseVersionSegment(leftParts[index] ?? "0");
    const rightValue = parseVersionSegment(rightParts[index] ?? "0");
    if (leftValue === rightValue) continue;
    return leftValue - rightValue;
  }

  return 0;
}

export function isExtensionOutdated(
  installedVersion: string | null,
  latestVersion: string | null,
): boolean {
  if (!installedVersion || !latestVersion) return false;
  return compareExtensionVersions(installedVersion, latestVersion) < 0;
}

export function normalizeExtensionRelease(input: unknown): ExtensionRelease | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as Partial<ExtensionReleasePayload>;

  if (
    typeof payload.version !== "string" ||
    typeof payload.published_at !== "string" ||
    typeof payload.extension_id !== "string" ||
    typeof payload.sha256 !== "string" ||
    typeof payload.download_url !== "string"
  ) {
    return null;
  }

  return {
    version: payload.version,
    publishedAt: payload.published_at,
    extensionId: payload.extension_id,
    sha256: payload.sha256,
    downloadUrl: payload.download_url,
  };
}

export function serializeExtensionRelease(release: ExtensionRelease): ExtensionReleasePayload {
  return {
    version: release.version,
    published_at: release.publishedAt,
    extension_id: release.extensionId,
    sha256: release.sha256,
    download_url: release.downloadUrl,
  };
}
