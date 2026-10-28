export function formatSession(session: Record<string, unknown> | null): string {
  if (!session) return "No active session";
  return JSON.stringify(session, null, 2);
}

export function toIsoFromInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** What the background reports about keeping an unpacked install up to date. */
export interface UpdateStatus {
  phase: string;
  current_version: string;
  latest_version: string | null;
  checked_at: string | null;
  error: string | null;
  /** Firefox: the signed package that installs `latest_version`, asking for any new permission. */
  install_url?: string | null;
}

export interface UpdateStatusView {
  text: string;
  buttonLabel: string;
  updateAvailable: boolean;
  /** An update is already under way or waiting; pressing again would change nothing. */
  busy: boolean;
  /** The button opens this to install the update, instead of asking the background to check. */
  installUrl: string | null;
  /** Offer to copy about:addons: Firefox does not let an extension open it. */
  offerAddonsPage: boolean;
}

/** The page where Firefox checks for and installs add-on updates. */
export const FIREFOX_ADDONS_PAGE = "about:addons";

export function describeUpdateStatus(status: UpdateStatus): UpdateStatusView {
  const current = `Installed: ${status.current_version}`;
  const latest = status.latest_version;
  const check: UpdateStatusView = {
    text: current,
    buttonLabel: "Check for updates",
    updateAvailable: false,
    busy: false,
    installUrl: null,
    offerAddonsPage: false,
  };
  switch (status.phase) {
    case "up_to_date":
      return { ...check, text: `${current}\nUp to date.` };
    case "available":
      return {
        ...check,
        text: `${current}\nAvailable: ${latest}`,
        buttonLabel: `Update to ${latest}`,
        updateAvailable: true,
      };
    case "checking":
    case "staging":
    case "applying":
      return {
        ...check,
        text: `${current}\nUpdating to ${latest ?? "the latest version"}...`,
        busy: true,
      };
    case "waiting_for_import":
    case "reload_pending":
      return {
        ...check,
        text: `${current}\n${latest} is ready and installs as soon as the import in progress ends.`,
        busy: true,
      };
    case "browser_will_install": {
      const addonsSteps =
        `copy ${FIREFOX_ADDONS_PAGE}, paste it into the address bar, then open the gear menu, ` +
        "Check for Updates, and Update next to Orbit.";
      if (status.install_url) {
        return {
          ...check,
          text:
            `${current}\nAvailable: ${latest}. Firefox waits for your consent when an update ` +
            `asks for new permissions. Update opens the signed package and Firefox asks you to ` +
            `confirm it; your settings stay.\nOr ${addonsSteps}`,
          buttonLabel: `Update to ${latest}`,
          updateAvailable: true,
          installUrl: status.install_url,
          offerAddonsPage: true,
        };
      }
      return {
        ...check,
        text:
          `${current}\nAvailable: ${latest}. The browser installs it by itself within a day, ` +
          `unless it asks for new permissions. To get it now, ${addonsSteps}`,
        offerAddonsPage: true,
      };
    }
    case "host_missing":
      return {
        ...check,
        text:
          `${current}\nThe updater is not installed. In the extension folder run ` +
          "updater/install.sh (macOS) or updater/install-windows.cmd (Windows), then try again.",
      };
    case "error":
      return { ...check, text: `${current}\nUpdate failed: ${status.error ?? "unknown error"}` };
    default:
      return check;
  }
}
