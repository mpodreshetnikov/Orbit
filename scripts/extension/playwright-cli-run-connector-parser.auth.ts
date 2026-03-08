export interface ManualAuthAssessment {
  requiresManualAuth: boolean;
  reason: string;
  pageUrl: string;
}

export interface ManualAuthSignals {
  hasOperationsFeed: boolean;
  hasPasswordInput: boolean;
  looksLikeAuthGate: boolean;
}

export function resolveManualAuthAssessment(
  pageUrl: string,
  targetUrl: string,
  tabUrlContains: string,
  signals: ManualAuthSignals,
): ManualAuthAssessment {
  const normalizedPageUrl = pageUrl.trim().toLowerCase();
  const normalizedTargetUrl = targetUrl.trim().toLowerCase();
  const targetContains = tabUrlContains.trim().toLowerCase();
  const isTargetPageByUrl = targetContains
    ? normalizedPageUrl.includes(targetContains)
    : normalizedPageUrl === normalizedTargetUrl;
  const looksLikeLoginUrl =
    normalizedPageUrl.includes("/auth/login") ||
    /\/login(?:[/?#]|$)/.test(normalizedPageUrl) ||
    normalizedPageUrl.includes("redirectto=");

  if (signals.hasOperationsFeed || (isTargetPageByUrl && !signals.looksLikeAuthGate)) {
    return {
      requiresManualAuth: false,
      reason: "Session appears authenticated and operations page is available.",
      pageUrl,
    };
  }

  if (
    signals.hasPasswordInput ||
    signals.looksLikeAuthGate ||
    looksLikeLoginUrl ||
    !isTargetPageByUrl
  ) {
    return {
      requiresManualAuth: true,
      reason: looksLikeLoginUrl
        ? "Detected login redirect instead of the source page."
        : "Detected login/challenge state on source page.",
      pageUrl,
    };
  }

  return {
    requiresManualAuth: false,
    reason: `No explicit auth gate detected for ${targetUrl}.`,
    pageUrl,
  };
}
