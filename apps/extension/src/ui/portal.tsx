import * as React from "react";

type UiPortalContextValue = {
    container: HTMLElement | null;
};

const UiPortalContext = React.createContext<UiPortalContextValue>({
    container: null,
});

export type UiPortalProviderProps = {
    children: React.ReactNode;
    container?: HTMLElement | null;
};

export function UiPortalProvider({ children, container = null }: UiPortalProviderProps) {
    const value = React.useMemo<UiPortalContextValue>(() => ({ container }), [container]);

    return <UiPortalContext.Provider value={value}>{children}</UiPortalContext.Provider>;
}

export function useUiPortalContainer() {
    return React.useContext(UiPortalContext).container;
}
