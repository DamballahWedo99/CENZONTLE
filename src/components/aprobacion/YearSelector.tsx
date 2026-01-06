/**
 * YearSelector Component
 *
 * Responsibility: Date selection (year, month, day) for filtering dashboard data
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles date selection
 * - KISS: Simple popover with calendar
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface YearSelectorProps {
  selectedDateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
}

export function YearSelector({ selectedDateRange, onDateRangeChange }: YearSelectorProps) {
  const [open, setOpen] = useState(false);

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    onDateRangeChange(range);

    // Close modal only when we have both dates AND they are different
    // This prevents closing when user clicks the first date (from === to)
    if (range?.from && range?.to && range.from.getTime() !== range.to.getTime()) {
      setOpen(false);
    }
  };

  const handleClear = () => {
    onDateRangeChange(undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal",
            !selectedDateRange && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selectedDateRange?.from ? (
            selectedDateRange.to ? (
              <>
                {format(selectedDateRange.from, "dd MMM yyyy", { locale: es })} -{" "}
                {format(selectedDateRange.to, "dd MMM yyyy", { locale: es })}
              </>
            ) : (
              format(selectedDateRange.from, "dd MMM yyyy", { locale: es })
            )
          ) : (
            <span>Seleccionar rango de fechas</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="range"
          selected={selectedDateRange}
          onSelect={handleDateRangeSelect}
          initialFocus
          fromYear={2020}
          toYear={2030}
          locale={es}
          numberOfMonths={2}
        />
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
          <Button
            variant="outline"
            onClick={handleClear}
            className="w-full"
          >
            Limpiar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
