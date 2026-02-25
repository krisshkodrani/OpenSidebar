import React, { useEffect } from "react";
import { useStore } from "../../store";
import * as api from "../../api";
import PanelLayout from "../PanelLayout";
import MemoryFilterPanel from "./MemoryFilterPanel";
import MemoryList from "./MemoryList";
import MemoryDetail from "./MemoryDetail";

export default function MemoryTab() {
  const setMemoryEntries = useStore((s) => s.setMemoryEntries);
  const setMemoryCategories = useStore((s) => s.setMemoryCategories);
  const setMemoryLoading = useStore((s) => s.setMemoryLoading);

  useEffect(() => {
    setMemoryLoading(true);
    Promise.all([api.fetchMemory(), api.fetchMemoryCategories()])
      .then(([entries, categories]) => {
        setMemoryEntries(entries || []);
        setMemoryCategories(categories || []);
      })
      .catch(() => {
        setMemoryEntries([]);
        setMemoryCategories([]);
      })
      .finally(() => setMemoryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PanelLayout
      left={
        <>
          <MemoryFilterPanel />
          <MemoryList />
        </>
      }
      right={<MemoryDetail />}
    />
  );
}
