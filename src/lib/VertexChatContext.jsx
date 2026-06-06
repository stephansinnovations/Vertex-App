import React, { createContext, useContext, useState } from 'react';

const Ctx = createContext({
  isOpen: false,
  agentPrompt: null,
  agentName: null,
  agentEmoji: null,
  model: 'claude-haiku-4-5',
  setModel: () => {},
  open: () => {},
  close: () => {},
});

export function VertexChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState(null);
  const [agentName, setAgentName] = useState(null);
  const [agentEmoji, setAgentEmoji] = useState(null);
  const [model, setModel] = useState(() => localStorage.getItem('vx_model') || 'claude-haiku-4-5');

  const handleSetModel = (m) => {
    setModel(m);
    localStorage.setItem('vx_model', m);
  };

  const [entityMode, setEntityMode] = useState(false);

  const open = (prompt = null, name = null, emoji = null, entity = false) => {
    setAgentPrompt(prompt);
    setAgentName(name);
    setAgentEmoji(emoji);
    setEntityMode(entity);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setAgentPrompt(null);
    setAgentName(null);
    setAgentEmoji(null);
  };

  return (
    <Ctx.Provider value={{ isOpen, agentPrompt, agentName, agentEmoji, entityMode, model, setModel: handleSetModel, open, close }}>
      {children}
    </Ctx.Provider>
  );
}

export const useVertexChat = () => useContext(Ctx);
