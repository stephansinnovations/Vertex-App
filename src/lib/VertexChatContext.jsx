import React, { createContext, useContext, useState } from 'react';

const Ctx = createContext({
  isOpen: false,
  agentPrompt: null,
  agentName: null,
  agentEmoji: null,
  open: () => {},
  close: () => {},
});

export function VertexChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState(null);
  const [agentName, setAgentName] = useState(null);
  const [agentEmoji, setAgentEmoji] = useState(null);

  const open = (prompt = null, name = null, emoji = null) => {
    setAgentPrompt(prompt);
    setAgentName(name);
    setAgentEmoji(emoji);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setAgentPrompt(null);
    setAgentName(null);
    setAgentEmoji(null);
  };

  return (
    <Ctx.Provider value={{ isOpen, agentPrompt, agentName, agentEmoji, open, close }}>
      {children}
    </Ctx.Provider>
  );
}

export const useVertexChat = () => useContext(Ctx);
