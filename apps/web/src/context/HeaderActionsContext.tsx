'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface HeaderActionsContextValue {
  actions: ReactNode | null;
  setActions: (node: ReactNode | null) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  actions: null,
  setActions: () => {},
});

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  return (
    <HeaderActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}
