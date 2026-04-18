'use client';

import * as React from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * DatePicker con UI de calendario consistente con el design system.
 *
 * Reemplaza `<Input type="date" />` (que renderiza el calendario nativo del
 * browser, que varía entre SO y no respeta dark mode ni tipografía).
 *
 * API:
 *   - `value`: string ISO "YYYY-MM-DD" o string vacío (compatible con el shape
 *     de state que ya usan los formularios existentes, así no rompemos callers).
 *   - `onChange`: recibe el string "YYYY-MM-DD" seleccionado, o '' si se limpia.
 *   - `minDate` / `maxDate`: strings ISO para restringir el rango.
 *
 * Muestra la fecha seleccionada en español (ej. "15 abr 2026") y el calendario
 * usa el locale `es` para weekdays y month captions.
 */
interface DatePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
  /** Fecha mínima seleccionable (ISO YYYY-MM-DD, inclusive). */
  minDate?: string;
  /** Fecha máxima seleccionable (ISO YYYY-MM-DD, inclusive). */
  maxDate?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Seleccionar fecha',
  disabled,
  id,
  className,
  'aria-invalid': ariaInvalid,
  minDate,
  maxDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Convertimos el string ISO a Date. Si viene vacío o inválido, undefined.
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : undefined;
  }, [value]);

  // Matcher de fechas deshabilitadas — combina min/max si vienen.
  const isDateDisabled = React.useMemo(() => {
    const min = minDate ? parseISO(minDate) : null;
    const max = maxDate ? parseISO(maxDate) : null;
    const validMin = min && isValid(min) ? min : null;
    const validMax = max && isValid(max) ? max : null;
    if (!validMin && !validMax) return undefined;
    return (date: Date) => {
      if (validMin && date < validMin) return true;
      if (validMax && date > validMax) return true;
      return false;
    };
  }, [minDate, maxDate]);

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      onChange?.('');
      setOpen(false);
      return;
    }
    // Formato YYYY-MM-DD para que el state siga siendo string serializable
    // y compatible con lo que las APIs del backend esperan (schemas Zod).
    onChange?.(format(date, 'yyyy-MM-dd'));
    setOpen(false);
  };

  const display = selectedDate
    ? format(selectedDate, "d 'de' MMMM yyyy", { locale: es })
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          className={cn(
            'w-full justify-start text-left font-normal',
            !selectedDate && 'text-muted-foreground',
            'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{display}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={isDateDisabled}
          defaultMonth={selectedDate}
          locale={es}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
