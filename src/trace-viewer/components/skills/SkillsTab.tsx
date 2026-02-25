import React, { useEffect } from "react";
import { useStore } from "../../store";
import * as api from "../../api";
import PanelLayout from "../PanelLayout";
import SkillFilterPanel from "./SkillFilterPanel";
import SkillList from "./SkillList";
import SkillDetail from "./SkillDetail";

export default function SkillsTab() {
  const setSkills = useStore((s) => s.setSkills);
  const setSkillsLoading = useStore((s) => s.setSkillsLoading);

  useEffect(() => {
    setSkillsLoading(true);
    api
      .fetchSkills()
      .then((skills) => setSkills(skills || []))
      .catch(() => setSkills([]))
      .finally(() => setSkillsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PanelLayout
      left={
        <>
          <SkillFilterPanel />
          <SkillList />
        </>
      }
      right={<SkillDetail />}
    />
  );
}
