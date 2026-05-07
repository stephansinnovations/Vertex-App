import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

export const THEMES = [
  { key: 'dark',   label: 'Dark' },
  { key: 'light',  label: 'Light' },
  { key: 'custom', label: 'Custom' },
];

export const PERSONALITIES = [
  { key: 'direct',         label: 'Direct',         desc: 'Short, fast, no filler' },
  { key: 'conversational', label: 'Conversational',  desc: 'Friendly and natural' },
  { key: 'professional',   label: 'Professional',    desc: 'Formal and thorough' },
];

const BASE_VARS = {
  dark: {
    '--vx-bg':            '#09090b',
    '--vx-surface':       '#18181b',
    '--vx-surface2':      '#27272a',
    '--vx-border':        '#27272a',
    '--vx-text':          '#ffffff',
    '--vx-text2':         '#a1a1aa',
    '--vx-muted':         '#52525b',
    '--vx-bubble-ai':     '#27272a',
    '--vx-bubble-ai-txt': '#ffffff',
  },
  light: {
    '--vx-bg':            '#f4f4f5',
    '--vx-surface':       '#ffffff',
    '--vx-surface2':      '#e4e4e7',
    '--vx-border':        '#d4d4d8',
    '--vx-text':          '#09090b',
    '--vx-text2':         '#52525b',
    '--vx-muted':         '#a1a1aa',
    '--vx-bubble-ai':     '#e4e4e7',
    '--vx-bubble-ai-txt': '#09090b',
  },
};

function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function applyVars(themeKey, accent) {
  const base = BASE_VARS[themeKey] || BASE_VARS.dark;
  const root = document.documentElement;
  Object.entries(base).forEach(([k, v]) => root.style.setProperty(k, v));
  const a = accent || (themeKey === 'light' ? '#09090b' : '#ffffff');
  root.style.setProperty('--vx-accent', a);
  root.style.setProperty('--vx-accent-fg', luminance(a) > 0.5 ? '#000000' : '#ffffff');
  root.setAttribute('data-vx-theme', themeKey);
}

export function ThemeProvider({ children }) {
  const [themeKey, _setTheme]   = useState(() => localStorage.getItem('vx_theme') || 'dark');
  const [accent,   _setAccent]  = useState(() => localStorage.getItem('vx_accent') || '#ffffff');
  const [personality, _setPersonality] = useState(() => localStorage.getItem('vx_personality') || 'direct');

  const setTheme = (k) => { _setTheme(k); localStorage.setItem('vx_theme', k); };
  const setAccent = (c) => { _setAccent(c); localStorage.setItem('vx_accent', c); };
  const setPersonality = (p) => { _setPersonality(p); localStorage.setItem('vx_personality', p); };

  useEffect(() => {
    applyVars(themeKey, themeKey === 'custom' ? accent : null);
  }, [themeKey, accent]);

  return (
    <ThemeContext.Provider value={{ themeKey, setTheme, accent, setAccent, personality, setPersonality }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
