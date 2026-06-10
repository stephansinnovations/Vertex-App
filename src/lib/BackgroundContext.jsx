import React, { createContext, useContext, useState, useEffect } from 'react';

const BackgroundContext = createContext(null);
const LS_LIST = 'vx_backgrounds';
const LS_ACTIVE = 'vx_active_bg';

// The original app background (a base44-hosted image) is preserved so it can be restored.
const ORIGINAL = {
  id: 'original',
  name: 'Original',
  type: 'image',
  value: 'https://media.base44.com/images/public/6993c32ea9b395384e8b7f61/fab379186_generated_image.png',
};

// Rich, warm, masterful — gold light over deep forged-bronze fading to black.
// Evokes craftsmanship, endurance, success, and things built right.
const MASTER_CRAFTER = {
  id: 'master-crafter',
  name: 'Master Crafter',
  type: 'css',
  value:
    'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(201,162,77,0.22), transparent 60%), '
    + 'radial-gradient(ellipse 120% 80% at 50% 115%, rgba(120,72,30,0.20), transparent 60%), '
    + 'linear-gradient(180deg, #1c1610 0%, #0e0b08 45%, #050403 100%)',
};

const SEED = [MASTER_CRAFTER, ORIGINAL];

// Inline style for a swatch/preview of a background.
export function backgroundStyle(bg) {
  if (!bg) return {};
  if (bg.type === 'image') {
    return { backgroundColor: '#0a0a0a', backgroundImage: `url("${bg.value}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: bg.value, backgroundSize: 'cover' };
}

function applyToBody(bg) {
  if (!bg) return;
  const b = document.body;
  b.style.backgroundImage = '';
  if (bg.type === 'image') {
    b.style.background = '#0a0a0a';
    b.style.backgroundImage = `url("${bg.value}")`;
    b.style.backgroundSize = 'cover';
    b.style.backgroundPosition = 'center';
    b.style.backgroundAttachment = 'fixed';
  } else {
    b.style.background = bg.value;
    b.style.backgroundSize = 'cover';
    b.style.backgroundAttachment = 'fixed';
  }
}

export function BackgroundProvider({ children }) {
  const [backgrounds, setBackgrounds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_LIST));
      if (Array.isArray(saved) && saved.length) {
        // Make sure the built-in seeds are always present.
        const ids = new Set(saved.map(b => b.id));
        return [...SEED.filter(s => !ids.has(s.id)), ...saved];
      }
    } catch { /* ignore */ }
    return SEED;
  });
  const [activeId, setActiveId] = useState(() => localStorage.getItem(LS_ACTIVE) || MASTER_CRAFTER.id);

  useEffect(() => { localStorage.setItem(LS_LIST, JSON.stringify(backgrounds)); }, [backgrounds]);
  useEffect(() => {
    localStorage.setItem(LS_ACTIVE, activeId);
    applyToBody(backgrounds.find(b => b.id === activeId) || backgrounds[0]);
  }, [activeId, backgrounds]);

  const setActive = (id) => setActiveId(id);

  // Saving a new background (by the user or generated) auto-adds it and makes it active.
  const addBackground = ({ name, type, value }) => {
    const id = 'bg-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
    const entry = { id, name: name || 'Custom', type: type || 'css', value };
    setBackgrounds(prev => [...prev, entry]);
    setActiveId(id);
    return entry;
  };

  const removeBackground = (id) => {
    if (id === MASTER_CRAFTER.id || id === ORIGINAL.id) return; // keep the built-ins
    setBackgrounds(prev => prev.filter(b => b.id !== id));
    if (activeId === id) setActiveId(MASTER_CRAFTER.id);
  };

  const active = backgrounds.find(b => b.id === activeId) || backgrounds[0];

  return (
    <BackgroundContext.Provider value={{ backgrounds, activeId, active, setActive, addBackground, removeBackground }}>
      {children}
    </BackgroundContext.Provider>
  );
}

export const useBackground = () => useContext(BackgroundContext);
