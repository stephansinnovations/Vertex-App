import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { isDeviceAuthorized } from '@/api/overrideAuth';
import OverrideGateModal from '@/components/OverrideGateModal';

// Provides `ensureAuthorized(reason)` to the whole app. Call it before any
// sensitive action/build: it resolves true once this device is authorized (within
// its 24h window), or pops the gate modal and resolves true/false on the user's
// choice. Wrap the app in <OverrideAuthProvider>; read via useOverrideAuth().

const OverrideAuthContext = createContext(null);

export const useOverrideAuth = () => useContext(OverrideAuthContext);

export function OverrideAuthProvider({ children }) {
  const [gate, setGate] = useState(null); // { reason } while the modal is open
  const resolverRef = useRef(null);

  const ensureAuthorized = useCallback((reason) => {
    if (isDeviceAuthorized()) return Promise.resolve(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setGate({ reason });
    });
  }, []);

  const finish = useCallback((ok) => {
    setGate(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(ok);
  }, []);

  return (
    <OverrideAuthContext.Provider value={{ ensureAuthorized }}>
      {children}
      {gate && <OverrideGateModal reason={gate.reason} onResolved={finish} />}
    </OverrideAuthContext.Provider>
  );
}
