/**
 * DataSourceFilter Component
 *
 * Responsibility: Filter data by region
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles region selection
 * - KISS: Simple select component
 */

'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type DataSource = 'MIT' | 'DEUNA' | 'Scotiabank' | 'Adyen' | 'Worldpay';

interface DataSourceFilterProps {
  selectedSource: DataSource;
  onSourceChange: (source: DataSource) => void;
}

const REGION_OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'MIT', label: 'MIT (México)' },
  { value: 'DEUNA', label: 'DEUNA (Europa y Japón)' },
  { value: 'Scotiabank', label: 'Scotiabank (EUA)' },
  { value: 'Adyen', label: 'Adyen (Canadá y Brasil)' },
  { value: 'Worldpay', label: 'Worldpay (Resto del mundo)' },
];

export function DataSourceFilter({ selectedSource, onSourceChange }: DataSourceFilterProps) {
  return (
    <Select value={selectedSource} onValueChange={onSourceChange}>
      <SelectTrigger>
        <SelectValue placeholder="Seleccionar región" />
      </SelectTrigger>
      <SelectContent>
        {REGION_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
