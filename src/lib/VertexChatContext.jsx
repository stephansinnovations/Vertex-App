import React, { createContext, useContext, useState } from 'react';

const Ctx = createContext({ isOpen: false, open: () => {}, close: () => {} });

export function VertexChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Ctx.Provider value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useVertexChat = () => useContext(Ctx);
