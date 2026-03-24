'use client';

import { useProyectosFilters } from '@/hooks/useProyectosFilters';
import { useProyectos } from '@/context/ProyectosContext';
import { StoryStatus, EpicStatus, Priority } from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Filter, X, Search } from 'lucide-react';

interface FilterDropdownProps {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  portalContainer?: HTMLElement | null;
}

function FilterDropdown({ label, options, selected, onToggle, portalContainer }: FilterDropdownProps) {
  const count = selected.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          {label}
          {count > 0 && (
            <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start" container={portalContainer}>
        <fieldset>
          <legend className="sr-only">Filtrar por {label}</legend>
          <div className="space-y-1">
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.includes(opt.value)}
                  onCheckedChange={() => onToggle(opt.value)}
                  aria-label={opt.label}
                />
                {opt.color && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                    aria-hidden="true"
                  />
                )}
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

const STATUS_LABELS: Record<StoryStatus, string> = {
  [StoryStatus.Backlog]: 'Backlog',
  [StoryStatus.ToDo]: 'Por hacer',
  [StoryStatus.InProgress]: 'En progreso',
  [StoryStatus.InReview]: 'En revision',
  [StoryStatus.QA]: 'QA',
  [StoryStatus.Done]: 'Completado',
  [StoryStatus.Blocked]: 'Bloqueado',
};

const EPIC_STATUS_LABELS: Record<EpicStatus, string> = {
  [EpicStatus.Draft]: 'Borrador',
  [EpicStatus.InProgress]: 'En progreso',
  [EpicStatus.Done]: 'Completada',
  [EpicStatus.Blocked]: 'Bloqueada',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.Critical]: 'Critica',
  [Priority.High]: 'Alta',
  [Priority.Medium]: 'Media',
  [Priority.Low]: 'Baja',
};

export function ProyectosFilters({ portalContainer }: { portalContainer?: HTMLElement | null } = {}) {
  const {
    filters,
    setFilter,
    toggleArrayFilter,
    resetFilters,
    hasActiveFilters,
    activeFilterCount,
  } = useProyectosFilters();
  const { state } = useProyectos();

  const initiativeOptions = state.initiatives.map((i) => ({
    value: i.id,
    label: i.name,
  }));

  const podOptions = state.pods.map((p) => ({
    value: p.id,
    label: p.name,
    color: p.color,
  }));

  const poOptions = state.productOwners.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const statusOptions = Object.values(StoryStatus).map((s) => ({
    value: s,
    label: STATUS_LABELS[s],
  }));

  const epicStatusOptions = Object.values(EpicStatus).map((s) => ({
    value: s,
    label: EPIC_STATUS_LABELS[s],
  }));

  const priorityOptions = Object.values(Priority).map((p) => ({
    value: p,
    label: PRIORITY_LABELS[p],
  }));

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filtros del proyecto">
      <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />

      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder="Buscar..."
          value={filters.searchQuery}
          onChange={(e) => setFilter('searchQuery', e.target.value)}
          className="h-8 w-40 pl-7 text-xs"
          aria-label="Buscar en el proyecto"
        />
      </div>

      <FilterDropdown
        label="Iniciativa"
        options={initiativeOptions}
        selected={filters.initiativeIds}
        onToggle={(v) => toggleArrayFilter('initiativeIds', v)}
        portalContainer={portalContainer}
      />

      <FilterDropdown
        label="POD"
        options={podOptions}
        selected={filters.podIds}
        onToggle={(v) => toggleArrayFilter('podIds', v)}
        portalContainer={portalContainer}
      />

      <FilterDropdown
        label="Product Owner"
        options={poOptions}
        selected={filters.productOwnerIds}
        onToggle={(v) => toggleArrayFilter('productOwnerIds', v)}
        portalContainer={portalContainer}
      />

      <FilterDropdown
        label="Status Historia"
        options={statusOptions}
        selected={filters.statuses}
        onToggle={(v) => toggleArrayFilter('statuses', v)}
        portalContainer={portalContainer}
      />

      <FilterDropdown
        label="Status Epica"
        options={epicStatusOptions}
        selected={filters.epicStatuses}
        onToggle={(v) => toggleArrayFilter('epicStatuses', v)}
        portalContainer={portalContainer}
      />

      <FilterDropdown
        label="Prioridad"
        options={priorityOptions}
        selected={filters.priorities}
        onToggle={(v) => toggleArrayFilter('priorities', v)}
        portalContainer={portalContainer}
      />

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={resetFilters}
          aria-label={`Limpiar ${activeFilterCount} filtros activos`}
        >
          <X className="h-3 w-3 mr-1" aria-hidden="true" />
          Limpiar ({activeFilterCount})
        </Button>
      )}
    </div>
  );
}
