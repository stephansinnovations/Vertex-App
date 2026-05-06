import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, X, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

function NoteItem({ note, onDelete, onUpdate }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || '');

  const handleBlur = (field, value) => {
    if (field === 'title' && value.trim() === note.title) return;
    if (field === 'content' && value === (note.content || '')) return;
    onUpdate(note.id, { title, content });
  };

  return (
    <div className="px-6 py-5 group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => handleBlur('title', title)}
            className="w-full bg-transparent text-white font-medium text-base focus:outline-none border-b border-transparent focus:border-zinc-600 transition-colors cursor-text"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={() => handleBlur('content', content)}
            placeholder="Add notes..."
            rows={Math.max(2, content.split('\n').length)}
            className="w-full bg-transparent text-gray-400 text-sm mt-1 focus:outline-none resize-none cursor-text placeholder:text-gray-700 border-b border-transparent focus:border-zinc-600 transition-colors"
          />
          <p className="text-gray-600 text-xs mt-2">
            {new Date(note.created_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={() => onDelete(note.id)}
          className="text-gray-700 hover:text-red-500 transition-colors flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function MeetingNotes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const buildId = urlParams.get('id');
  const buildName = urlParams.get('name') || 'Build';

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['meetingNotes', buildId],
    queryFn: () => base44.entities.MeetingNote.filter({ build_id: buildId }, '-created_date'),
    enabled: !!buildId,
  });

  const createMutation = useMutation({
    mutationFn: () => base44.entities.MeetingNote.create({ build_id: buildId, title: title.trim(), content: content.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetingNotes', buildId] });
      setTitle('');
      setContent('');
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MeetingNote.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meetingNotes', buildId] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MeetingNote.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meetingNotes', buildId] }),
  });

  const handleSubmit = () => {
    if (!title.trim()) return;
    createMutation.mutate();
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/BuildDetail?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <p className="text-gray-500 text-sm">{buildName}</p>
              <h1 className="text-3xl font-bold text-white tracking-tight">Meeting Notes</h1>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-white text-black font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            New Note
          </button>
        </div>

        {/* New Note Form */}
        {showForm && (
          <div className="mb-6 rounded-2xl bg-zinc-900 border border-zinc-800 p-5" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title..."
              className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500 mb-3"
              autoFocus
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your notes here..."
              rows={5}
              className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500 resize-none mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowForm(false); setTitle(''); setContent(''); }}
                className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!title.trim() || createMutation.isPending}
                className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold bg-white text-black hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
        )}

        {/* Notes List */}
        <div className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {isLoading && <div className="px-6 py-5 text-gray-500 text-sm">Loading...</div>}

          {!isLoading && notes.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 text-lg mb-2">No meeting notes yet</p>
              <p className="text-gray-600 text-sm mb-6">Add your first note to get started</p>
              <button
                onClick={() => setShowForm(true)}
                className="bg-white text-black font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                New Note
              </button>
            </div>
          )}

          {notes.map((note, index) => (
            <div key={note.id} className={index !== notes.length - 1 ? 'border-b border-zinc-800' : ''}>
              <NoteItem
                note={note}
                onDelete={(id) => deleteMutation.mutate(id)}
                onUpdate={(id, data) => updateMutation.mutate({ id, data })}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}