import sopSeed from './seed-sops.json';
import workOrderSeed from './seed-workorders.json';
import { getSheetTabs, getSheetCategories } from './googleSheets';
import { buildsEntity } from './buildsDb';

// Seed localStorage — bump version string to force re-seed
const SEED_VERSION = 'v3';
function seed() {
  if (localStorage.getItem('db_seeded') !== SEED_VERSION) {
    localStorage.setItem('localdb_SOP', JSON.stringify(sopSeed));
    localStorage.setItem('localdb_WorkOrder', JSON.stringify(workOrderSeed));
    localStorage.setItem('db_seeded', SEED_VERSION);
  }
}

seed();

function getCollection(name) {
  const raw = localStorage.getItem(`localdb_${name}`);
  return raw ? JSON.parse(raw) : [];
}

function saveCollection(name, records) {
  localStorage.setItem(`localdb_${name}`, JSON.stringify(records));
}

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function matches(record, query) {
  return Object.entries(query).every(([k, v]) => record[k] === v);
}

function makeEntity(name) {
  return {
    filter(query = {}) {
      const all = getCollection(name);
      const results = Object.keys(query).length ? all.filter(r => matches(r, query)) : all;
      return Promise.resolve(results);
    },
    get(id) {
      const all = getCollection(name);
      return Promise.resolve(all.find(r => r.id === id) ?? null);
    },
    create(data) {
      const all = getCollection(name);
      const record = { ...data, id: makeId(), created_date: new Date().toISOString(), updated_date: new Date().toISOString() };
      all.push(record);
      saveCollection(name, all);
      return Promise.resolve(record);
    },
    update(id, data) {
      const all = getCollection(name);
      const idx = all.findIndex(r => r.id === id);
      if (idx === -1) return Promise.reject(new Error(`${name} ${id} not found`));
      all[idx] = { ...all[idx], ...data, updated_date: new Date().toISOString() };
      saveCollection(name, all);
      return Promise.resolve(all[idx]);
    },
    delete(id) {
      const all = getCollection(name);
      saveCollection(name, all.filter(r => r.id !== id));
      return Promise.resolve({ id });
    },
  };
}

const LOCAL_USER = {
  id: 'local-user',
  email: 'local@localhost',
  name: 'Local User',
  company_id: 'vertexvans',
};

export const localClient = {
  auth: {
    me: () => Promise.resolve(LOCAL_USER),
    updateMe: (data) => { Object.assign(LOCAL_USER, data); return Promise.resolve(LOCAL_USER); },
    logout: () => {},
    redirectToLogin: () => {},
  },
  entities: {
    SOP: makeEntity('SOP'),
    WorkOrder: makeEntity('WorkOrder'),
    Build: buildsEntity, // Supabase-backed — syncs across devices

    MeetingNote: makeEntity('MeetingNote'),
    SOPPerformance: makeEntity('SOPPerformance'),
    StockItem: makeEntity('StockItem'),
    User: makeEntity('User'),
  },
  integrations: {
    Core: {
      UploadFile: ({ file }) => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ file_url: reader.result });
          reader.readAsDataURL(file);
        });
      },
      InvokeLLM: () => Promise.resolve({ result: '' }),
    },
  },
  functions: {
    invoke: (fnName, params) => {
      if (fnName === 'getSheetTabs') return getSheetTabs(params.spreadsheetId);
      if (fnName === 'getSheetCategories') return getSheetCategories(params.spreadsheetId, params.sheetName);
      return Promise.reject(new Error(`Unknown function: ${fnName}`));
    },
  },
};
