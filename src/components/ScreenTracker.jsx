import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useVertexChat } from '@/lib/VertexChatContext';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

// A small fixed breadcrumb that always shows which screen the user is on:
// the current page, the room name when inside an AI Room, and the agent name
// when a chat/voice session is open. Top-left so it clears the floating
// Settings gear (top-right) and the Vertex orb (bottom-center).

// Friendly labels for known routes. Anything missing falls back to a
// camelCase→spaced version of the path segment.
const PAGE_LABELS = {
  Home: 'Home',
  PartsLibrary: 'Parts',
  MasterSheet: 'Master Sheet',
  Builds: 'Builds',
  BuildDetail: 'Build',
  BuildParts: 'Build Parts',
  BuildPartsLibrary: 'Build Parts Library',
  BuildPhases: 'Build Phases',
  PhaseDetail: 'Phase',
  BuildSheet: 'Build Sheet',
  BuildWorkOrder: 'Work Order',
  WorkOrderPage: 'Work Order',
  MeetingNotes: 'Meeting Notes',
  Inventory: 'Inventory',
  InventoryIdeas: 'Inventory Ideas',
  Stock: 'Stock',
  StockLocation: 'Stock Location',
  GeminiScanner: 'Scanner',
  Contacts: 'Contacts',
  Profile: 'Profile',
  MyProfile: 'My Profile',
  TeamProfiles: 'Team',
  Vertex: 'Vertex',
  AIRoom: 'AI Room',
  Rooms: 'Rooms',
  MusicApp: 'Music',
  Modulation: 'Modulation',
  Settings: 'Settings',
  Bugs: 'Bugs',
  SOPList: 'SOPs',
  SOPView: 'SOP',
  SOPEditor: 'SOP Editor',
  SOPPerform: 'Perform SOP',
};

function labelForSegment(segment) {
  if (!segment) return 'Home';
  if (PAGE_LABELS[segment]) return PAGE_LABELS[segment];
  // Fallback: split camelCase / PascalCase into words.
  return segment.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
}

export default function ScreenTracker() {
  const { pathname, search } = useLocation();
  const { isAuthenticated } = useAuth();
  const { isOpen, agentName, agentEmoji } = useVertexChat();
  const [roomName, setRoomName] = useState(null);

  const segment = pathname === '/' || pathname === ''
    ? 'Home'
    : pathname.replace(/^\//, '').split('/')[0];

  const roomId = new URLSearchParams(search).get('room');

  // Look up the room name when we're inside an AI Room (?room=<id>).
  useEffect(() => {
    let cancelled = false;
    if (segment === 'AIRoom' && roomId) {
      (async () => {
        try {
          const { data } = await supabase
            .from('ai_rooms')
            .select('name')
            .eq('id', roomId)
            .maybeSingle();
          if (!cancelled) setRoomName(data?.name || null);
        } catch {
          if (!cancelled) setRoomName(null);
        }
      })();
    } else {
      setRoomName(null);
    }
    return () => { cancelled = true; };
  }, [segment, roomId]);

  // Hidden on Login / when signed out (nothing to track yet).
  if (!isAuthenticated || pathname === '/Login') return null;

  // Build the breadcrumb trail: Page › Room › Agent.
  const crumbs = [labelForSegment(segment)];
  if (roomName) crumbs.push(roomName);
  const showAgent = isOpen && agentName;

  return (
    <div
      className="fixed z-40 left-3 top-3 max-w-[60vw] select-none pointer-events-none"
      aria-label="Current screen"
    >
      <div
        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-white text-xs font-medium"
        style={{
          background: 'rgba(24,24,27,0.82)',
          border: '1px solid rgba(255,255,255,0.16)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(6px)',
        }}
      >
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="w-3 h-3 opacity-50 shrink-0" />}
            <span className={i === 0 && !showAgent ? 'opacity-100' : 'opacity-80'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c}
            </span>
          </React.Fragment>
        ))}
        {showAgent && (
          <>
            <ChevronRight className="w-3 h-3 opacity-50 shrink-0" />
            <span className="flex items-center gap-1 text-emerald-300" style={{ whiteSpace: 'nowrap' }}>
              {agentEmoji && <span aria-hidden>{agentEmoji}</span>}
              {agentName}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
