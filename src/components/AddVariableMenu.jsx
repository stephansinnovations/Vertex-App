import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Ruler } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function AddVariableMenu({ onSelect, size = 'sm', className = '' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          className={`h-7 text-xs text-gray-500 hover:text-white hover:bg-zinc-800 ${className}`}
        >
          <Ruler className="w-3 h-3 mr-1" />
          Add Variable
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
        <DropdownMenuItem
          onClick={() => onSelect('measurements')}
          className="text-white hover:bg-zinc-800 cursor-pointer text-xs"
        >
          Measurements
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onSelect('time')}
          className="text-white hover:bg-zinc-800 cursor-pointer text-xs"
        >
          Time
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}