const D_PREFIX = 'vxd_';
const A_PREFIX = 'vxa_';
const MAX = 80;

export function loadDisplay(ctx) {
  try { return JSON.parse(localStorage.getItem(D_PREFIX + ctx) || '[]'); } catch { return []; }
}
export function loadApi(ctx) {
  try { return JSON.parse(localStorage.getItem(A_PREFIX + ctx) || '[]'); } catch { return []; }
}
export function saveDisplay(ctx, msgs) {
  localStorage.setItem(D_PREFIX + ctx, JSON.stringify(msgs.slice(-MAX)));
}
export function saveApi(ctx, msgs) {
  localStorage.setItem(A_PREFIX + ctx, JSON.stringify(msgs.slice(-MAX)));
}
export function clearHistory(ctx) {
  localStorage.removeItem(D_PREFIX + ctx);
  localStorage.removeItem(A_PREFIX + ctx);
}

export function getCurrentPageName() {
  const path = window.location.pathname;
  const p = new URLSearchParams(window.location.search);
  if (path.includes('BuildDetail'))        return `BuildDetail (id=${p.get('id') || '?'})`;
  if (path.includes('BuildPhases'))        return `BuildPhases (id=${p.get('id') || '?'})`;
  if (path.includes('BuildWorkOrder'))     return `BuildWorkOrder (id=${p.get('id') || '?'})`;
  if (path.includes('BuildPartsLibrary'))  return `BuildPartsLibrary (id=${p.get('id') || '?'})`;
  if (path.includes('PhaseDetail'))        return `PhaseDetail (buildId=${p.get('buildId') || '?'}, phaseId=${p.get('phaseId') || '?'})`;
  if (path.includes('SOPEditor'))          return `SOPEditor (id=${p.get('id') || '?'})`;
  if (path.includes('SOPView'))            return `SOPView (id=${p.get('id') || '?'})`;
  if (path.includes('SOPPerform'))         return `SOPPerform (id=${p.get('id') || '?'})`;
  if (path.includes('SOPList'))            return 'SOPList';
  if (path.includes('WorkOrderPage'))      return `WorkOrderPage (id=${p.get('id') || '?'})`;
  if (path.includes('Builds'))             return 'Builds';
  if (path.includes('PartsLibrary'))       return 'PartsLibrary';
  if (path.includes('Inventory'))          return 'Inventory';
  if (path.includes('Stock'))              return 'Stock';
  if (path.includes('Contacts'))           return 'Contacts';
  if (path.includes('MeetingNotes'))       return 'MeetingNotes';
  if (path.includes('MasterSheet'))        return 'MasterSheet';
  if (path.includes('TeamProfiles'))       return 'TeamProfiles';
  if (path.includes('MyProfile'))          return 'MyProfile';
  if (path.includes('Vertex'))             return 'Vertex';
  if (path === '/' || path.includes('Home')) return 'Home';
  return path;
}

export function getContextKey() {
  const path = window.location.pathname;
  const p = new URLSearchParams(window.location.search);
  if (path.includes('BuildDetail') || path.includes('BuildPhases') || path.includes('BuildWorkOrder') || path.includes('BuildPartsLibrary'))
    return `build_${p.get('id') || 'x'}`;
  if (path.includes('PhaseDetail')) return `build_${p.get('buildId') || 'x'}`;
  if (path.includes('Builds')) return 'builds';
  if (path.includes('SOPView')) return `sop_${p.get('id') || 'x'}`;
  if (path.includes('WorkOrderPage')) return `sopfolder_${p.get('id') || 'x'}`;
  if (path.includes('SOP') || path.includes('WorkOrder')) return 'sops';
  if (path.includes('PartsLibrary') || path.includes('Inventory') || path.includes('Stock')) return 'inventory';
  if (path.includes('Contacts')) return 'contacts';
  if (path.includes('MeetingNotes')) return 'meetings';
  return 'home';
}

export function getContextLabel(key) {
  const MAP = { home: 'Vertex AI', builds: 'Builds', sops: 'SOPs', inventory: 'Inventory', contacts: 'Contacts', meetings: 'Meetings' };
  if (MAP[key]) return MAP[key];
  if (key.startsWith('build_')) return 'This Build';
  if (key.startsWith('sop_')) return 'This SOP';
  if (key.startsWith('sopfolder_')) return 'This Dept';
  return 'Vertex AI';
}

export function getContextGreeting(key) {
  if (key === 'builds' || key.startsWith('build_')) return "What do you want to do with builds today?";
  if (key === 'sops' || key.startsWith('sop')) return "Looking for an SOP or want to create one?";
  if (key === 'inventory') return "Need to check stock, find a part, or update quantities?";
  if (key === 'contacts') return "Need to find or add a contact?";
  return "What can I help you get done today?";
}

export function getContextSuggestions(key) {
  if (key === 'builds' || key.startsWith('build_')) return [
    { icon: '🔨', label: 'New build',       prompt: 'I want to create a new build' },
    { icon: '📋', label: 'Active builds',   prompt: 'Show me all active builds' },
    { icon: '✅', label: 'Add a task',       prompt: 'I want to add a task to a build' },
    { icon: '📊', label: 'Build status',    prompt: 'What is the status of current builds?' },
  ];
  if (key === 'sops' || key.startsWith('sop')) return [
    { icon: '📝', label: 'New SOP',         prompt: 'I want to create a new SOP' },
    { icon: '🔍', label: 'Find SOP',        prompt: 'Search for an SOP' },
    { icon: '📎', label: 'Attach to task',  prompt: 'Attach an SOP to a build task' },
    { icon: '📁', label: 'Departments',     prompt: 'Show all SOP departments' },
  ];
  if (key === 'inventory') return [
    { icon: '📦', label: 'Stock levels',    prompt: 'Show current stock levels' },
    { icon: '🔍', label: 'Find a part',     prompt: 'Search for a specific part' },
    { icon: '⚠️', label: 'Low stock',       prompt: 'What parts are running low?' },
    { icon: '✏️', label: 'Update qty',      prompt: 'Update a part quantity' },
  ];
  if (key === 'contacts') return [
    { icon: '👤', label: 'Add contact',     prompt: 'I want to add a new contact' },
    { icon: '🔍', label: 'Find contact',    prompt: 'Search for a contact' },
    { icon: '📞', label: 'All contacts',    prompt: 'Show me all contacts' },
    { icon: '🏢', label: 'Find supplier',   prompt: 'Find a supplier contact' },
  ];
  return [
    { icon: '🔨', label: 'New build',       prompt: 'I want to create a new build' },
    { icon: '📝', label: 'New SOP',         prompt: 'I want to create a new SOP' },
    { icon: '📦', label: 'Inventory',       prompt: 'Show inventory status' },
    { icon: '🔍', label: 'Find anything',   prompt: 'I need to find something' },
  ];
}
