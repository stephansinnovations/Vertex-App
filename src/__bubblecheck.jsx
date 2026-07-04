import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/lib/ThemeContext';
import { VertexChatProvider } from '@/lib/VertexChatContext';
import VertexChat from '@/components/VertexChat';
import '@/index.css';

localStorage.setItem('jarvis_agent_url', 'https://agent.test');
localStorage.setItem('jarvis_agent_secret', 's');
// Seed a finished-build deploy card into the chat history.
localStorage.setItem('vxd_home', JSON.stringify([
  { id: '1', type: 'deploy', branch: 'jarvis/2026-06-24-07-01', changed: true, text: 'Added the interrupt feature.' },
]));
localStorage.setItem('vxa_home', '[]');

window.__deployCalls = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (u, opts) => {
  const url = String(u);
  if (url.endsWith('/deploy')) {
    window.__deployCalls.push(JSON.parse(opts.body));
    return new Response('{"ok":true,"merged":"jarvis/2026-06-24-07-01"}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/rest/v1/') || url.includes('/auth/v1/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  return realFetch(u, opts);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    <ThemeProvider>
      <VertexChatProvider>
        <VertexChat isOpen={true} onClose={() => {}} />
      </VertexChatProvider>
    </ThemeProvider>
  </MemoryRouter>
);
