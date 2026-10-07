import { useEffect, useRef } from "react";
const dirtyForms = new Set<symbol>();
let confirmedNavigation = false;
export function useDraftWarning(dirty: boolean) {
  const owner = useRef(Symbol("workspace-draft"));
  useEffect(() => {
    const id = owner.current;
    if (dirty) dirtyForms.add(id);
    else dirtyForms.delete(id);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyForms.size && !confirmedNavigation) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      dirtyForms.delete(id);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);
}
export function confirmSignOut() {
  if (
    dirtyForms.size &&
    !window.confirm("You have unsaved changes. Discard them and sign out?")
  )
    return false;
  confirmedNavigation = true;
  return true;
}
export function retainDraftProtection() {
  confirmedNavigation = false;
}
