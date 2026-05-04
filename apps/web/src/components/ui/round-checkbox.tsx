'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Variante redonda del Checkbox — patrón visual estilo Linear/Notion para
 * "selected from a list" (bulk selection). El cuadrado con check del Checkbox
 * default comunica "toggle ON/OFF"; el círculo comunica "este item está
 * marcado entre N hermanos seleccionables".
 *
 * Uso típico: en filas de listas con selección múltiple (épicas, historias,
 * dependencias). Para bind a un Set<string> de IDs:
 *
 *     <RoundCheckbox
 *       checked={selectedIds.has(item.id)}
 *       onCheckedChange={(checked) => toggleId(item.id, checked)}
 *     />
 */
function RoundCheckbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="round-checkbox"
      className={cn(
        'peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-[18px] shrink-0 rounded-full border-[1.5px] shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 hover:border-primary/60',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="round-checkbox-indicator"
        className="grid place-content-center text-current"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { RoundCheckbox };
