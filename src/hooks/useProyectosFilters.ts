'use client';

import { useCallback } from 'react';
import { useProyectos } from '@/context/ProyectosContext';
import {
  ProyectosFilters, StoryStatus, EpicStatus, Priority,
} from '@/types/proyectos';

export function useProyectosFilters() {
  const { state, dispatch } = useProyectos();
  const { filters } = state;

  const setFilter = useCallback(
    <K extends keyof ProyectosFilters>(key: K, value: ProyectosFilters[K]) => {
      dispatch({ type: 'SET_FILTERS', payload: { [key]: value } });
    },
    [dispatch]
  );

  const toggleArrayFilter = useCallback(
    <T extends string>(key: keyof ProyectosFilters, value: T) => {
      const current = filters[key] as T[];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      dispatch({ type: 'SET_FILTERS', payload: { [key]: updated } });
    },
    [dispatch, filters]
  );

  const resetFilters = useCallback(() => {
    dispatch({ type: 'RESET_FILTERS' });
  }, [dispatch]);

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'dateRange') return (value as ProyectosFilters['dateRange']).from !== null;
    if (key === 'storyPointsRange') return (value as ProyectosFilters['storyPointsRange']).min !== null;
    if (typeof value === 'string') return value !== '';
    if (Array.isArray(value)) return value.length > 0;
    return value !== null;
  });

  const activeFilterCount = Object.entries(filters).reduce((count, [key, value]) => {
    if (key === 'dateRange' && (value as ProyectosFilters['dateRange']).from !== null) return count + 1;
    if (key === 'storyPointsRange' && (value as ProyectosFilters['storyPointsRange']).min !== null) return count + 1;
    if (typeof value === 'string' && value !== '') return count + 1;
    if (Array.isArray(value) && value.length > 0) return count + 1;
    return count;
  }, 0);

  return {
    filters,
    setFilter,
    toggleArrayFilter,
    resetFilters,
    hasActiveFilters,
    activeFilterCount,
  };
}
