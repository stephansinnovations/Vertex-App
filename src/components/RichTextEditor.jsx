import React, { useRef, useState, useEffect } from 'react';

export default function RichTextEditor({ value, onChange, placeholder }) {
  const editorRef = useRef(null);
  const isInternalChange = useRef(false);

  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML && value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value || '';
      }
    }
    isInternalChange.current = false;
  }, [value]);

  const handleInput = () => {
    isInternalChange.current = true;
    onChange(editorRef.current.innerHTML);
  };

  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    handleInput();
  };

  const [fontSize, setFontSize] = useState(11);
  const [color, setColor] = useState('#ffffff');
  const [alignOpen, setAlignOpen] = useState(false);
  const [spacingOpen, setSpacingOpen] = useState(false);

  const decreaseFontSize = () => {
    setFontSize(prev => {
      const next = Math.max(6, prev - 1);
      exec('fontSize', next <= 8 ? 1 : next <= 10 ? 2 : next <= 13 ? 3 : next <= 16 ? 4 : next <= 18 ? 5 : next <= 24 ? 6 : 7);
      return next;
    });
  };

  const increaseFontSize = () => {
    setFontSize(prev => {
      const next = Math.min(72, prev + 1);
      exec('fontSize', next <= 8 ? 1 : next <= 10 ? 2 : next <= 13 ? 3 : next <= 16 ? 4 : next <= 18 ? 5 : next <= 24 ? 6 : 7);
      return next;
    });
  };

  const applyLineHeight = (lh) => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const block = range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    const el = block.closest('p, div, li') || block;
    if (el) el.style.lineHeight = lh;
    handleInput();
    setSpacingOpen(false);
  };

  const ToolBtn = ({ onClick, children, title }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="px-1 py-0.5 rounded hover:bg-zinc-600 text-gray-200 transition-colors leading-none flex items-center justify-center min-w-[22px]"
    >
      {children}
    </button>
  );

  const Divider = () => <div className="w-px h-4 bg-zinc-600 mx-0.5" />;

  const DropChevron = () => (
    <svg viewBox="0 0 8 5" width="7" height="5" fill="currentColor" className="text-gray-400 ml-px">
      <path d="M0 0l4 5 4-5z"/>
    </svg>
  );

  return (
    <div className="mt-1 rounded-md border border-zinc-700 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-zinc-800 border-b border-zinc-700 flex-wrap">

        {/* Font size controls */}
        <ToolBtn onClick={decreaseFontSize} title="Decrease font size">
          <span className="text-xs font-bold">−</span>
        </ToolBtn>
        <span className="text-xs text-gray-300 w-6 text-center tabular-nums">{fontSize}</span>
        <ToolBtn onClick={increaseFontSize} title="Increase font size">
          <span className="text-xs font-bold">+</span>
        </ToolBtn>

        <Divider />

        {/* Bold */}
        <ToolBtn onClick={() => exec('bold')} title="Bold">
          <span className="font-bold text-sm">B</span>
        </ToolBtn>
        {/* Italic */}
        <ToolBtn onClick={() => exec('italic')} title="Italic">
          <span className="italic text-sm">I</span>
        </ToolBtn>
        {/* Underline */}
        <ToolBtn onClick={() => exec('underline')} title="Underline">
          <span className="underline text-sm">U</span>
        </ToolBtn>

        {/* Font color */}
        <ToolBtn onClick={() => document.getElementById('rte-color').click()} title="Font color">
          <span className="relative text-sm font-bold" style={{ color }}>
            A
            <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded" style={{ background: color }} />
          </span>
          <input
            id="rte-color"
            type="color"
            value={color}
            onChange={(e) => { setColor(e.target.value); exec('foreColor', e.target.value); }}
            className="sr-only"
          />
        </ToolBtn>

        {/* Clear formatting */}
        <ToolBtn onClick={() => exec('removeFormat')} title="Clear formatting">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M3.5 13.5l2-4L13 3 14 4l-7.5 7.5-1 2H3.5zm0 0H2v-1.5l1.5 1.5z"/>
          </svg>
        </ToolBtn>

        <Divider />

        {/* ── Align + Indent (with dropdown) ── */}
        <div className="relative flex items-center">
          <ToolBtn onClick={() => exec('justifyLeft')} title="Align left">
            <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor">
              <rect x="0" y="1" width="14" height="1.8" rx="0.5"/>
              <rect x="0" y="4.6" width="9" height="1.8" rx="0.5"/>
              <rect x="0" y="8.2" width="14" height="1.8" rx="0.5"/>
              <rect x="0" y="11.8" width="9" height="1.8" rx="0.5"/>
            </svg>
          </ToolBtn>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setAlignOpen(v => !v); setSpacingOpen(false); }}
            className="px-0.5 py-0.5 rounded hover:bg-zinc-600 text-gray-400 flex items-center"
          >
            <DropChevron />
          </button>
          {alignOpen && (
            <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 p-1 flex flex-col gap-0.5 min-w-[110px]">
              {[
                { cmd: 'justifyLeft', label: 'Align Left' },
                { cmd: 'justifyCenter', label: 'Align Center' },
                { cmd: 'justifyRight', label: 'Align Right' },
                { cmd: 'justifyFull', label: 'Justify' },
              ].map(({ cmd, label }) => (
                <button key={cmd} type="button"
                  onMouseDown={(e) => { e.preventDefault(); exec(cmd); setAlignOpen(false); }}
                  className="text-left text-xs text-gray-200 px-2 py-1 rounded hover:bg-zinc-600"
                >{label}</button>
              ))}
              <div className="border-t border-zinc-600 my-0.5"/>
              <button type="button"
                onMouseDown={(e) => { e.preventDefault(); exec('indent'); setAlignOpen(false); }}
                className="text-left text-xs text-gray-200 px-2 py-1 rounded hover:bg-zinc-600">Increase Indent</button>
              <button type="button"
                onMouseDown={(e) => { e.preventDefault(); exec('outdent'); setAlignOpen(false); }}
                className="text-left text-xs text-gray-200 px-2 py-1 rounded hover:bg-zinc-600">Decrease Indent</button>
            </div>
          )}
        </div>

        {/* ── Line & Paragraph Spacing (with dropdown) ── */}
        <div className="relative flex items-center">
          <ToolBtn onClick={() => setSpacingOpen(v => !v)} title="Line & paragraph spacing">
            <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor">
              <rect x="4" y="1.5" width="10" height="1.5" rx="0.5"/>
              <rect x="4" y="6.25" width="10" height="1.5" rx="0.5"/>
              <rect x="4" y="11" width="10" height="1.5" rx="0.5"/>
              <path d="M1 2.5L2.5 1 4 2.5M1 11.5L2.5 13 4 11.5M2.5 1v12" stroke="currentColor" strokeWidth="1" fill="none"/>
            </svg>
          </ToolBtn>
          {spacingOpen && (
            <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 p-1 flex flex-col gap-0.5 min-w-[120px]">
              <p className="text-xs text-gray-400 px-2 py-0.5">Line spacing</p>
              {[['Single (1.0)', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['Double (2.0)', '2']].map(([label, val]) => (
                <button key={val} type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyLineHeight(val); }}
                  className="text-left text-xs text-gray-200 px-2 py-1 rounded hover:bg-zinc-600"
                >{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Checklist ── */}
        <ToolBtn onClick={() => exec('insertHTML',
          '<ul style="list-style:none;padding-left:0"><li><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" /> <span>Item</span></label></li></ul>'
        )} title="Checklist">
          <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor">
            <rect x="0.5" y="1.5" width="3.5" height="3.5" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M1.2 3.4l.9.9 1.6-1.6" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <rect x="5.5" y="2.5" width="8" height="1.5" rx="0.5"/>
            <rect x="0.5" y="7" width="3.5" height="3.5" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
            <rect x="5.5" y="8" width="8" height="1.5" rx="0.5"/>
            <rect x="0.5" y="12" width="3.5" height="1.5" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
            <rect x="5.5" y="12" width="8" height="1.5" rx="0.5"/>
          </svg>
        </ToolBtn>

        {/* ── Bulleted list ── */}
        <ToolBtn onClick={() => exec('insertHTML', '<ul style="list-style:disc;padding-left:1.5em;margin:4px 0"><li>Item</li></ul>')} title="Bulleted list">
          <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor">
            <circle cx="1.5" cy="3" r="1.3"/>
            <rect x="4.5" y="2.25" width="9" height="1.5" rx="0.5"/>
            <circle cx="1.5" cy="7" r="1.3"/>
            <rect x="4.5" y="6.25" width="9" height="1.5" rx="0.5"/>
            <circle cx="1.5" cy="11" r="1.3"/>
            <rect x="4.5" y="10.25" width="9" height="1.5" rx="0.5"/>
          </svg>
        </ToolBtn>

        {/* ── Numbered list ── */}
        <ToolBtn onClick={() => exec('insertHTML', '<ol style="list-style:decimal;padding-left:1.5em;margin:4px 0"><li>Item</li></ol>')} title="Numbered list">
          <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor">
            <text x="0" y="4.5" fontSize="4" fontFamily="sans-serif" fill="currentColor">1.</text>
            <rect x="4.5" y="2.25" width="9" height="1.5" rx="0.5"/>
            <text x="0" y="9" fontSize="4" fontFamily="sans-serif" fill="currentColor">2.</text>
            <rect x="4.5" y="6.75" width="9" height="1.5" rx="0.5"/>
            <text x="0" y="13.5" fontSize="4" fontFamily="sans-serif" fill="currentColor">3.</text>
            <rect x="4.5" y="11.25" width="9" height="1.5" rx="0.5"/>
          </svg>
        </ToolBtn>

      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="min-h-[80px] px-3 py-2 bg-black text-white text-sm outline-none focus:outline-none"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      />

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #52525b;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}