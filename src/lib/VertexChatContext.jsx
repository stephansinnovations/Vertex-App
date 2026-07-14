import React, { createContext, useContext, useState } from 'react';

const Ctx = createContext({
  isOpen: false,
  agentPrompt: null,
  agentName: null,
  agentEmoji: null,
  model: 'claude-haiku-4-5',
  setModel: () => {},
  voiceWanted: false,
  setVoiceWanted: () => {},
  voiceStatus: 'off',
  setVoiceStatus: () => {},
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

  // One Jarvis: the sheet can open "listening" (voiceWanted) — the orb's default.
  // voiceStatus is reported back by the sheet's voice engine so the floating orb
  // can pulse with Jarvis's live state (off|listening|thinking|speaking|building|
  // blocked|unsupported).
  const [voiceWanted, setVoiceWanted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('off');

  const open = (prompt = null, name = null, emoji = null, entity = false, listen = false) => {
    setAgentPrompt(prompt);
    setAgentName(name);
    setAgentEmoji(emoji);
    setEntityMode(entity);
    setVoiceWanted(listen && !entity);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setAgentPrompt(null);
    setAgentName(null);
    setAgentEmoji(null);
    setVoiceWanted(false);
  };

  return (
    <Ctx.Provider value={{
      isOpen, agentPrompt, agentName, agentEmoji, entityMode,
      model, setModel: handleSetModel,
      voiceWanted, setVoiceWanted, voiceStatus, setVoiceStatus,
      open, close,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useVertexChat = () => useContext(Ctx);
