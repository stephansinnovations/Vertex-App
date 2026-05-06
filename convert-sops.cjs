const { parse } = require('./node_modules/csv-parse/lib/sync');
const fs = require('fs');

const csv = fs.readFileSync('/Users/stephanfogiel/Desktop/BACKUP. 5/Claude APP/SOP_export.csv', 'utf8');

const records = parse(csv, {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
});

records.forEach(r => {
  ['steps', 'materials'].forEach(f => {
    if (typeof r[f] === 'string') {
      try { r[f] = JSON.parse(r[f]); } catch {}
    }
  });
});

// Get company_id from first SOP
const companyId = records[0]?.company_id || 'local';

// Build unique WorkOrder folders from group values
const groups = [...new Set(records.map(r => r.group).filter(Boolean))];
const workOrders = groups.map((name, i) => ({
  id: 'wo-' + i,
  name,
  company_id: companyId,
  created_date: new Date().toISOString(),
  updated_date: new Date().toISOString(),
}));

fs.writeFileSync('./src/api/seed-sops.json', JSON.stringify(records, null, 2));
fs.writeFileSync('./src/api/seed-workorders.json', JSON.stringify(workOrders, null, 2));

console.log('SOPs:', records.length, '| WorkOrders:', workOrders.length, '| company_id:', companyId);
