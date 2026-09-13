import { useEffect, useState } from "react";
import type { LocalPersonalDataSyncPreferencesV1, PersonalDataCategory, PersonalDataStatusV1 } from "../../types";
import { MessageSource } from "../../types";
import { cloudSession } from "../cloud-client";
import { uiRuntime } from "../runtime";

export function PersonalDataSyncBadge({ category }: { category: PersonalDataCategory }) {
  const [label, setLabel] = useState("Local only");
  useEffect(() => {
    let active = true;
    void cloudSession().then(async (session) => {
      if (!session) return;
      const result = await uiRuntime.sendMessage<{
        ok: boolean;
        status?: PersonalDataStatusV1;
        preferences?: LocalPersonalDataSyncPreferencesV1;
      }>({ type: "PERSONAL_DATA_SYNC_STATUS", requestId: crypto.randomUUID(), source: MessageSource.SIDEPANEL });
      if (!active) return;
      if (category === "profile" && result.status?.capabilities.profile !== true)
        setLabel("Sync coming soon");
      else if (result.preferences?.categories[category])
        setLabel(result.status?.documents[category] ? "Encrypted sync on" : "Sync enabled");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [category]);
  return <span title="Manage in Settings → Sync" className="rounded bg-warm-100 px-1.5 py-0.5 text-[9px] font-medium text-warm-500 dark:bg-warm-800 dark:text-warm-400">{label}</span>;
}
