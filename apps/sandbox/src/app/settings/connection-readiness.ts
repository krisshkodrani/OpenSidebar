import type { CloudDeviceV1 } from "@opensidebar/shared-types";

export function browserReadiness(
  device: CloudDeviceV1,
  remoteEnabled: boolean,
) {
  if (device.revokedAt)
    return {
      label: "Access revoked",
      detail: "Link this browser again to use it.",
    };
  if (device.availability !== "online")
    return {
      label: "Browser offline",
      detail: "Open Chrome with OpenSidebar signed in, then refresh status.",
    };
  if (!device.capabilities.includes("remote_browser_tasks_v1"))
    return {
      label: "Remote work unavailable",
      detail:
        "This browser is online, but has not confirmed support for remote tasks. Check the extension version and account connection.",
    };
  if (!remoteEnabled)
    return {
      label: "Remote work disabled",
      detail:
        "Enable remote browser work in Security when you want Codex to send tasks.",
    };
  if (device.capabilities.includes("remote_browser_interactive_v1"))
    return {
      label: "Interactive-capable browser",
      detail: "This browser supports interactive tasks. Your MCP connection also needs interactive consent and access to the rollout.",
    };
  return {
    label: "Ready for remote reading",
    detail:
      "Codex can request read-only work in this browser. Submitting forms, messages, and uploads is not enabled for remote tasks yet.",
  };
}
