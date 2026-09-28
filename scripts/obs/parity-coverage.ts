export function summarizeParityCoverage(
  storeIds: Iterable<string>,
  spineIds: Iterable<string>,
): { storeOnly: string[]; spineOnly: string[] } {
  const store = new Set(storeIds);
  const spine = new Set(spineIds);
  return {
    storeOnly: [...store].filter((id) => !spine.has(id)),
    spineOnly: [...spine].filter((id) => !store.has(id)),
  };
}
