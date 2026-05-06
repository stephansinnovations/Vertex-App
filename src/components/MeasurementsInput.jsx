import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

const UNITS = ['g', 'kg', 'lbs', 'oz', 'ml', 'L', 'fl oz', 'cups', 'tsp', 'tbsp', 'mm', 'cm', 'm', 'in', 'ft', 'pcs', 'units'];

export default function MeasurementsInput({ measurements = [], onChange, mode = 'measurements' }) {
  const isTime = mode === 'time';

  const addRow = () => {
    onChange([...measurements, { material: '', amount: isTime ? '00:00' : '', unit: 'g' }]);
  };

  const updateRow = (index, field, value) => {
    const updated = [...measurements];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeRow = (index) => {
    onChange(measurements.filter((_, i) => i !== index));
  };

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
        {isTime ? 'Time' : 'Measurements'}
      </p>
      {measurements.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={row.material || ''}
            onChange={(e) => updateRow(index, 'material', e.target.value)}
            placeholder={isTime ? 'Label' : 'Material'}
            className="flex-1 bg-zinc-900 border-zinc-600 text-white placeholder:text-gray-500 text-sm h-8"
          />
          <Input
            value={row.amount || (isTime ? '00:00' : '')}
            onChange={(e) => {
              if (!isTime) { updateRow(index, 'amount', e.target.value); return; }
              const raw = e.target.value.replace(/[^0-9:]/g, '');
              // Auto-insert colon
              let val = raw.replace(':', '');
              if (val.length > 4) val = val.slice(0, 4);
              if (val.length > 2) val = val.slice(0, 2) + ':' + val.slice(2);
              // Clamp minutes/seconds to 59
              const parts = val.split(':');
              if (parts[0] && parseInt(parts[0]) > 59) parts[0] = '59';
              if (parts[1] && parseInt(parts[1]) > 59) parts[1] = '59';
              updateRow(index, 'amount', parts.join(':'));
            }}
            placeholder={isTime ? '00:00' : 'Value'}
            maxLength={isTime ? 5 : undefined}
            className="w-24 bg-zinc-900 border-zinc-600 text-white placeholder:text-gray-500 text-sm h-8 font-mono"
          />
          {!isTime && (
            <Select value={row.unit || 'g'} onValueChange={(v) => updateRow(index, 'unit', v)}>
              <SelectTrigger className="w-24 h-8 bg-zinc-900 border-zinc-600 text-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {UNITS.map(u => (
                  <SelectItem key={u} value={u} className="text-white text-xs">{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:text-red-500 hover:bg-zinc-800 flex-shrink-0"
            onClick={() => removeRow(index)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addRow}
        className="bg-black border-zinc-700 text-white hover:bg-zinc-800 h-7 text-xs">
        <Plus className="w-3 h-3 mr-1" />Add Row
      </Button>
    </div>
  );
}