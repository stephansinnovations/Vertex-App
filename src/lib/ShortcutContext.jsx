import React, { createContext, useContext, useState } from 'react';

const ShortcutContext = createContext(null);

export function ShortcutProvider({ children }) {
  const [pending, setPending] = useState(null);
  // pending = { label, icon, path } | null

  return (
    <ShortcutContext.Provider value={{ pending, setPending }}>
      {children}
    </ShortcutContext.Provider>
  );
}

export function useShortcut() {
  return useContext(ShortcutContext);
}