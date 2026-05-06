import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { localClient } from '@/api/localDb';

// ── Tools the AI can call ──────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_sops',
    description: 'List all SOPs, optionally filtered by department or group.',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Filter by group/department name (optional)' },
      },
    },
  },
  {
    name: 'create_sop',
    description: 'Create a new SOP.',
    input_schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        department: { type: 'string' },
        group: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step_number: { type: 'number' },
              title: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'list_builds',
    description: 'List all van builds.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_build',
    description: 'Create a new van build.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
  {
    name: 'list_departments',
    description: 'List all SOP departments/folders.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_stock',
    description: 'Get current stock levels from localStorage.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_sops',
    description: 'Search SOPs by keyword in title or description.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
      },
    },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case 'list_sops': {
      const all = await localClient.entities.SOP.filter(input.group ? { group: input.group } : {});
      return all.map(s => ({ id: s.id, title: s.title, group: s.group, department: s.department, description: s.description }));
    }
    case 'create_sop': {
      const user = await localClient.auth.me();
      const sop = await localClient.entities.SOP.create({
        ...input,
        company_id: user.company_id,
        steps: input.steps || [],
        materials: [],
      });
      return { success: true, id: sop.id, title: sop.title };
    }
    case 'list_builds': {
      const builds = await localClient.entities.Build.filter();
      return builds.map(b => ({ id: b.id, name: b.name, description: b.description }));
    }
    case 'create_build': {
      const user = await localClient.auth.me();
      const build = await localClient.entities.Build.create({ ...input, company_id: user.company_id, parts: [] });
      return { success: true, id: build.id, name: build.name };
    }
    case 'list_departments': {
      const orders = await localClient.entities.WorkOrder.filter();
      return orders.map(o => ({ id: o.id, name: o.name }));
    }
    case 'get_stock': {
      try {
        const stock = JSON.parse(localStorage.getItem('partsLibraryStock') || '{}');
        return stock;
      } catch { return {}; }
    }
    case 'search_sops': {
      const all = await localClient.entities.SOP.filter();
      const q = input.query.toLowerCase();
      return all
        .filter(s => s.title?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
        .map(s => ({ id: s.id, title: s.title, group: s.group, description: s.description }));
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── API call ───────────────────────────────────────────────────────────────

async function callClaude(messages) {
  const res = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are Vertex AI, the intelligent assistant built into the Vertex Vans app. You help the team manage SOPs, builds, inventory, and parts. You can create and search SOPs, manage builds, and check stock levels. Be concise and action-oriented. When you create something, confirm what you made. When listing items, format them clearly.`,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Vertex() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);

    const userMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);

    try {
      let apiMessages = history.map(m => ({ role: m.role, content: m.content }));

      // Agentic loop — keep going until no more tool calls
      while (true) {
        const response = await callClaude(apiMessages);

        if (response.stop_reason === 'tool_use') {
          // Show tool calls as a pending assistant message
          const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
          const textBlocks = response.content.filter(b => b.type === 'text');

          const assistantMsg = {
            role: 'assistant',
            content: response.content,
            display: textBlocks.map(b => b.text).join('') || null,
            toolCalls: toolUseBlocks.map(t => ({ name: t.name, id: t.id })),
          };
          setMessages(prev => [...prev, assistantMsg]);

          // Execute all tools
          const toolResults = await Promise.all(
            toolUseBlocks.map(async (tool) => {
              const result = await executeTool(tool.name, tool.input);
              return {
                type: 'tool_result',
                tool_use_id: tool.id,
                content: JSON.stringify(result),
              };
            })
          );

          apiMessages = [
            ...apiMessages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: toolResults },
          ];
        } else {
          // Final text response
          const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
          setMessages(prev => [...prev, { role: 'assistant', content: text, display: text }]);
          break;
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, display: `Error: ${err.message}`, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <img src="/src/assets/vertex-logo.png" alt="Vertex" className="w-6 h-6 object-contain invert" />
          <h1 className="text-xl font-bold text-white">Vertex AI</h1>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center mt-20">
            <img src="/src/assets/vertex-logo.png" alt="Vertex" className="w-16 h-16 object-contain invert mx-auto mb-4 opacity-30" />
            <p className="text-gray-500 text-lg font-medium">Vertex AI</p>
            <p className="text-gray-600 text-sm mt-1">Ask me to build SOPs, check inventory, manage builds, and more.</p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {[
                'List all SOPs',
                'Create a new build',
                'What departments do we have?',
                'Check stock levels',
              ].map(s => (
                <button key={s} onClick={() => setInput(s)}
                  className="text-xs bg-zinc-900 border border-zinc-700 text-gray-300 px-3 py-1.5 rounded-full hover:bg-zinc-800 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'user' ? (
              <div className="max-w-[80%] bg-white text-black px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[85%] space-y-1.5">
                {msg.toolCalls?.map((t, j) => (
                  <div key={j} className="text-xs text-zinc-500 italic px-1">
                    ⚙ Running: {t.name.replace(/_/g, ' ')}…
                  </div>
                ))}
                {msg.display && (
                  <div className={`px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm whitespace-pre-wrap ${msg.isError ? 'bg-red-900/40 text-red-300' : 'bg-zinc-900 text-gray-100'}`}>
                    {msg.display}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-900 px-4 py-3 rounded-2xl rounded-tl-sm">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-6 pt-2 border-t border-zinc-800 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask Vertex AI anything…"
            rows={1}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-zinc-500 resize-none"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-white text-black p-3 rounded-2xl hover:bg-gray-200 transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
