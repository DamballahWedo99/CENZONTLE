'use client';

import { useState, useMemo, useRef, useCallback, useEffect, Fragment, forwardRef, useImperativeHandle } from 'react';
import { useRouter } from 'next/navigation';
import { useProyectos } from '@/context/ProyectosContext';
import type {
  TimelineConfig,
  SprintRange,
  CeremonyColumn,
  ZoomLevel,
  WeekColumn,
  MonthColumn,
} from '@/lib/timeline-utils';
import {
  generateTimelineConfig,
  getStatusLabel,
  mapCeremoniesToColumns,
  CEREMONY_CONFIG,
  ZOOM_CONFIGS,
  generateWeekColumns,
  generateMonthColumns,
  sprintToWeekRange,
  sprintToMonthRange,
  todayWeekPosition,
  todayMonthPosition,
} from '@/lib/timeline-utils';
import { StoryStatus, SprintStatus, EpicStatus } from '@/types/proyectos';
import type { UserStory, Epic, Initiative, Pod, Sprint } from '@/types/proyectos';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { ChevronDown, ChevronRight, CalendarDays, AlertTriangle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FROZEN_WIDTH = 320;
const DAY_COL_WIDTH = 36;
const ROW_HEIGHT = 36;
const EPIC_ROW_HEIGHT = 32;
const INITIATIVE_ROW_HEIGHT = 28;

// ---------------------------------------------------------------------------
// Status color map for the dark-themed Gantt bars
// ---------------------------------------------------------------------------

const STATUS_BAR_COLORS: Record<
  string,
  { bg: string; bgHover: string; dot: string; label: string }
> = {
  [StoryStatus.Backlog]: {
    bg: 'bg-transparent',
    bgHover: 'bg-transparent',
    dot: 'bg-gray-500',
    label: 'Backlog',
  },
  [StoryStatus.ToDo]: {
    bg: 'bg-slate-400/30',
    bgHover: 'hover:bg-slate-400/40',
    dot: 'bg-slate-400',
    label: 'Por hacer',
  },
  [StoryStatus.InProgress]: {
    bg: 'bg-blue-500/70',
    bgHover: 'hover:bg-blue-500/80',
    dot: 'bg-blue-500',
    label: 'En progreso',
  },
  [StoryStatus.InReview]: {
    bg: 'bg-fuchsia-500/70',
    bgHover: 'hover:bg-fuchsia-500/80',
    dot: 'bg-fuchsia-500',
    label: 'En revision',
  },
  [StoryStatus.QA]: {
    bg: 'bg-amber-500/70',
    bgHover: 'hover:bg-amber-500/80',
    dot: 'bg-amber-500',
    label: 'Pruebas QA',
  },
  [StoryStatus.Done]: {
    bg: 'bg-emerald-500/70',
    bgHover: 'hover:bg-emerald-500/80',
    dot: 'bg-emerald-500',
    label: 'Terminado',
  },
  [StoryStatus.Blocked]: {
    bg: 'bg-red-500/70',
    bgHover: 'hover:bg-red-500/80',
    dot: 'bg-red-500',
    label: 'Bloqueado',
  },
};

const EPIC_STATUS_BORDER: Record<string, string> = {
  [EpicStatus.Draft]: 'border-l-2 border-l-gray-400',
  [EpicStatus.InProgress]: 'border-l-2 border-l-blue-500',
  [EpicStatus.Done]: 'border-l-2 border-l-emerald-500',
  [EpicStatus.Blocked]: 'border-l-2 border-l-red-500',
};

// ---------------------------------------------------------------------------
// Legend bar
// ---------------------------------------------------------------------------

function TimelineLegend() {
  const items = [
    { status: StoryStatus.ToDo, label: 'Por hacer' },
    { status: StoryStatus.InProgress, label: 'En progreso' },
    { status: StoryStatus.InReview, label: 'En revisión' },
    { status: StoryStatus.QA, label: 'QA' },
    { status: StoryStatus.Done, label: 'Terminado' },
    { status: StoryStatus.Blocked, label: 'Bloqueado' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3" role="legend" aria-label="Leyenda de estados">
      {items.map(({ status, label }) => {
        const colors = STATUS_BAR_COLORS[status];
        return (
          <div key={status} className="flex items-center gap-1">
            <span className={`h-2 w-4 rounded-sm ${colors.bg} border border-white/10`} aria-hidden="true" />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ceremony legend (compact inline)
// ---------------------------------------------------------------------------

function CeremonyLegend() {
  const items = [
    { type: 'planning', label: 'Pl' },
    { type: 'review', label: 'Rv' },
    { type: 'retro', label: 'Rt' },
    { type: 'release', label: 'Rl' },
    { type: 'pi_planning', label: 'PI' },
    { type: 'e2e', label: 'e2e' },
    { type: 'cvt', label: 'CVT' },
    { type: 'integration', label: 'Int' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" role="legend" aria-label="Leyenda de ceremonias">
      {items.map(({ type, label }) => {
        const config = CEREMONY_CONFIG[type];
        if (!config) return null;
        return (
          <div key={type} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${config.dotColor}`} aria-hidden="true" />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped data types
// ---------------------------------------------------------------------------

interface TimelineStory {
  story: UserStory;
  sprint: Sprint | undefined;
  sprintRange: SprintRange | undefined;
  pod: Pod | undefined;
}

interface TimelineEpicGroup {
  epic: Epic;
  stories: TimelineStory[];
  storyCount: number;
  doneCount: number;
  progress: number;
  totalSP: number;
}

interface TimelineInitiativeGroup {
  initiative: Initiative;
  epics: TimelineEpicGroup[];
}

// ---------------------------------------------------------------------------
// Health calculation
// ---------------------------------------------------------------------------

type EpicHealth = 'on_track' | 'at_risk' | 'off_track';

function calculateEpicHealth(epic: Epic, progress: number, stories: TimelineStory[]): EpicHealth {
  const now = new Date();
  const start = new Date(epic.startDate);
  const target = new Date(epic.targetDate);
  const totalDuration = target.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  const timeProgress = totalDuration > 0 ? Math.min(100, Math.round((elapsed / totalDuration) * 100)) : 0;
  const blockedCount = stories.filter(s => s.story.status === StoryStatus.Blocked).length;
  if (blockedCount > 0 && progress < timeProgress - 20) return 'off_track';
  if (blockedCount > 0) return 'at_risk';
  if (progress >= timeProgress - 10) return 'on_track';
  if (progress >= timeProgress - 25) return 'at_risk';
  return 'off_track';
}

const HEALTH_BADGES: Record<EpicHealth, { label: string; className: string }> = {
  on_track: { label: 'En tiempo', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  at_risk: { label: 'En riesgo', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  off_track: { label: 'Retrasado', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

// ---------------------------------------------------------------------------
// Dependency arrow interface
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Sprint boundary lookup helpers
// ---------------------------------------------------------------------------

function buildSprintLastDaySet(sprintRanges: SprintRange[]): Set<number> {
  const lastDays = new Set<number>();
  for (const sr of sprintRanges) {
    lastDays.add(sr.colStart + sr.colSpan - 1);
  }
  return lastDays;
}

function buildSprintLastWeekSet(
  sprintRanges: SprintRange[],
  weekCols: WeekColumn[],
): Set<number> {
  const lastWeeks = new Set<number>();
  for (const sr of sprintRanges) {
    const mapped = sprintToWeekRange(sr, weekCols);
    if (mapped) {
      lastWeeks.add(mapped.colStart + mapped.colSpan - 1);
    }
  }
  return lastWeeks;
}

// ---------------------------------------------------------------------------
// Spanish month names (for week-zoom month headers)
// ---------------------------------------------------------------------------

const SPANISH_MONTHS: Record<number, string> = {
  0: 'Enero', 1: 'Febrero', 2: 'Marzo', 3: 'Abril',
  4: 'Mayo', 5: 'Junio', 6: 'Julio', 7: 'Agosto',
  8: 'Septiembre', 9: 'Octubre', 10: 'Noviembre', 11: 'Diciembre',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface MatrizTimelineHandle {
  scrollToToday: () => void;
}

export interface MatrizTimelineProps {
  zoomLevel: ZoomLevel;
  showCeremonies: boolean;
}

export const MatrizTimeline = forwardRef<MatrizTimelineHandle, MatrizTimelineProps>(
  function MatrizTimeline({ zoomLevel, showCeremonies }, ref) {
  const router = useRouter();
  const { state, filteredEpics, filteredStories } = useProyectos();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsedEpics, setCollapsedEpics] = useState<Set<string>>(() => new Set(filteredEpics.map(e => e.id)));


  // ---- Timeline config from all sprints (unfiltered) ---------------------
  const timeline: TimelineConfig = useMemo(
    () => generateTimelineConfig(state.sprints),
    [state.sprints],
  );

  // ---- Week and month columns for zoomed views ---------------------------
  const weekColumns: WeekColumn[] = useMemo(
    () => generateWeekColumns(timeline.days),
    [timeline.days],
  );

  const monthColumns: MonthColumn[] = useMemo(
    () => generateMonthColumns(timeline.days),
    [timeline.days],
  );

  // ---- Zoom-dependent derived values -------------------------------------
  const colWidth = ZOOM_CONFIGS[zoomLevel].colWidth;

  const totalCols = useMemo(() => {
    if (zoomLevel === 'day') return timeline.totalDayCols;
    if (zoomLevel === 'week') return weekColumns.length;
    return monthColumns.length;
  }, [zoomLevel, timeline.totalDayCols, weekColumns.length, monthColumns.length]);

  const totalGridWidth = FROZEN_WIDTH + totalCols * colWidth;

  // ---- Sprint boundary sets ----------------------------------------------
  const sprintLastDays = useMemo(
    () => buildSprintLastDaySet(timeline.sprints),
    [timeline.sprints],
  );

  const sprintLastWeeks = useMemo(
    () => buildSprintLastWeekSet(timeline.sprints, weekColumns),
    [timeline.sprints, weekColumns],
  );

  // ---- Sprint capacity indicators -----------------------------------------
  const sprintCapacity = useMemo(() => {
    const capacityMap = new Map<string, { assigned: number; done: number; total: number }>();
    const DEFAULT_CAPACITY = 20;
    for (const sprint of state.sprints) {
      capacityMap.set(sprint.id, { assigned: 0, done: 0, total: DEFAULT_CAPACITY });
    }
    for (const story of filteredStories) {
      if (!story.sprintId) continue;
      const entry = capacityMap.get(story.sprintId);
      if (entry) {
        entry.assigned += story.storyPoints;
        if (story.status === StoryStatus.Done) entry.done += story.storyPoints;
      }
    }
    return capacityMap;
  }, [state.sprints, filteredStories]);

  // ---- Ceremony columns (day zoom only) ----------------------------------
  const ceremonyColumns: CeremonyColumn[] = useMemo(() => {
    if (!showCeremonies || zoomLevel !== 'day') return [];
    return mapCeremoniesToColumns(state.ceremonies ?? [], timeline.days);
  }, [showCeremonies, zoomLevel, state.ceremonies, timeline.days]);

  const showCeremonyRow = showCeremonies && zoomLevel === 'day';

  // ---- Today marker position ---------------------------------------------
  const todayMarkerLeft = useMemo((): number | null => {
    if (timeline.todayColIndex === null) return null;
    if (zoomLevel === 'day') {
      return timeline.todayColIndex * DAY_COL_WIDTH + DAY_COL_WIDTH / 2;
    }
    if (zoomLevel === 'week') {
      return todayWeekPosition(timeline.todayColIndex, weekColumns, ZOOM_CONFIGS.week.colWidth);
    }
    return todayMonthPosition(timeline.todayColIndex, monthColumns, ZOOM_CONFIGS.month.colWidth);
  }, [zoomLevel, timeline.todayColIndex, weekColumns, monthColumns]);

  // ---- Group stories by epic, then by initiative -------------------------
  const timelineData: TimelineInitiativeGroup[] = useMemo(() => {
    const initiativeMap = new Map<string, TimelineInitiativeGroup>();

    for (const epic of filteredEpics) {
      const initiative = state.initiatives.find((i) => i.id === epic.initiativeId);
      if (!initiative) continue;

      const epicStories = filteredStories
        .filter((s) => s.epicId === epic.id && s.sprintId !== null)
        .map((story): TimelineStory => {
          const sprint = state.sprints.find((sp) => sp.id === story.sprintId);
          const sprintRange = timeline.sprints.find((sr) => sr.sprintId === story.sprintId);
          const pod = state.pods.find((p) => p.id === story.podId);
          return { story, sprint, sprintRange, pod };
        });

      const allEpicStories = filteredStories.filter((s) => s.epicId === epic.id);
      const doneCount = allEpicStories.filter((s) => s.status === StoryStatus.Done).length;
      const totalSP = allEpicStories.reduce((sum, s) => sum + s.storyPoints, 0);
      const progress = allEpicStories.length > 0
        ? Math.round((doneCount / allEpicStories.length) * 100)
        : 0;

      const epicGroup: TimelineEpicGroup = {
        epic, stories: epicStories, storyCount: allEpicStories.length,
        doneCount, progress, totalSP,
      };

      if (!initiativeMap.has(initiative.id)) {
        initiativeMap.set(initiative.id, { initiative, epics: [] });
      }
      initiativeMap.get(initiative.id)!.epics.push(epicGroup);
    }

    return Array.from(initiativeMap.values());
  }, [filteredEpics, filteredStories, state.initiatives, state.sprints, state.pods, timeline.sprints]);

  // ---- Scroll to today ---------------------------------------------------
  const scrollToToday = useCallback(() => {
    if (todayMarkerLeft === null || !scrollRef.current) return;
    const targetX = todayMarkerLeft - scrollRef.current.clientWidth / 2;
    scrollRef.current.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' });
  }, [todayMarkerLeft]);

  useEffect(() => {
    const timer = setTimeout(scrollToToday, 100);
    return () => clearTimeout(timer);
  }, [scrollToToday]);

  useImperativeHandle(ref, () => ({ scrollToToday }), [scrollToToday]);

  // ---- Toggle epic collapse ----------------------------------------------
  const toggleEpic = useCallback((epicId: string) => {
    setCollapsedEpics((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }, []);

  // ---- Navigate to epic --------------------------------------------------
  const navigateToEpic = useCallback(
    (epicId: string) => { router.push(`/proyectos/epicas/${epicId}`); },
    [router],
  );

  // ---- Bar position helper -----------------------------------------------
  const getBarPosition = useCallback(
    (sprintRange: SprintRange): { left: number; width: number } | null => {
      if (zoomLevel === 'day') {
        return {
          left: sprintRange.colStart * DAY_COL_WIDTH + 2,
          width: sprintRange.colSpan * DAY_COL_WIDTH - 4,
        };
      }
      if (zoomLevel === 'week') {
        const wr = sprintToWeekRange(sprintRange, weekColumns);
        if (!wr) return null;
        const w = ZOOM_CONFIGS.week.colWidth;
        return { left: wr.colStart * w + 2, width: wr.colSpan * w - 4 };
      }
      const mr = sprintToMonthRange(sprintRange, monthColumns);
      if (!mr) return null;
      const m = ZOOM_CONFIGS.month.colWidth;
      return { left: mr.colStart * m + 2, width: mr.colSpan * m - 4 };
    },
    [zoomLevel, weekColumns, monthColumns],
  );

  // ---- Header height for sticky offsets ----------------------------------
  const headerHeight = useMemo(() => {
    if (zoomLevel === 'day') return 28 + 36 + 32 + (showCeremonyRow ? 22 : 0);
    if (zoomLevel === 'week') return 28 + 24 + 28;
    return 28 + 28;
  }, [zoomLevel, showCeremonyRow]);

  // ---- Empty state -------------------------------------------------------
  if (timeline.totalDayCols === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <CalendarDays className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          No hay sprints configurados para mostrar el timeline.
        </p>
      </div>
    );
  }

  // ---- Grid template string ----------------------------------------------
  const gridTemplate =
    zoomLevel === 'day'
      ? `${FROZEN_WIDTH}px repeat(${timeline.totalDayCols}, ${DAY_COL_WIDTH}px)`
      : zoomLevel === 'week'
        ? `${FROZEN_WIDTH}px repeat(${weekColumns.length}, ${ZOOM_CONFIGS.week.colWidth}px)`
        : `${FROZEN_WIDTH}px repeat(${monthColumns.length}, ${ZOOM_CONFIGS.month.colWidth}px)`;

  // ---- Derived header spans (computed once per render) --------------------

  // Month spans mapped to week columns (week zoom)
  const monthSpansInWeeks: Array<{ monthLabel: string; colStart: number; colSpan: number }> = [];
  if (zoomLevel === 'week') {
    const monthMap = new Map<string, { label: string; weekIndices: number[] }>();
    const monthOrder: string[] = [];
    for (const wc of weekColumns) {
      const mn = wc.startDate.getMonth();
      const yr = wc.startDate.getFullYear();
      const key = `${yr}-${String(mn).padStart(2, '0')}`;
      const existing = monthMap.get(key);
      if (existing) { existing.weekIndices.push(wc.colIndex); }
      else {
        monthMap.set(key, { label: `${SPANISH_MONTHS[mn]} ${yr}`, weekIndices: [wc.colIndex] });
        monthOrder.push(key);
      }
    }
    for (const key of monthOrder) {
      const data = monthMap.get(key)!;
      const s = Math.min(...data.weekIndices);
      const e = Math.max(...data.weekIndices);
      monthSpansInWeeks.push({ monthLabel: data.label, colStart: s, colSpan: e - s + 1 });
    }
  }

  // Sprint spans in week columns (week zoom)
  const sprintSpansInWeeks: Array<{ sprintId: string; sprintName: string; status: string; colStart: number; colSpan: number }> = [];
  if (zoomLevel === 'week') {
    for (const sr of timeline.sprints) {
      const range = sprintToWeekRange(sr, weekColumns);
      if (range) {
        sprintSpansInWeeks.push({
          sprintId: sr.sprintId, sprintName: sr.sprintName, status: sr.status,
          colStart: range.colStart, colSpan: range.colSpan,
        });
      }
    }
  }

  // Year spans (month zoom)
  const yearSpansInMonths: Array<{ yearLabel: string; colStart: number; colSpan: number }> = [];
  if (zoomLevel === 'month') {
    const yearMap = new Map<string, number[]>();
    const yearOrder: string[] = [];
    for (const mc of monthColumns) {
      const existing = yearMap.get(mc.yearLabel);
      if (existing) { existing.push(mc.colIndex); }
      else { yearMap.set(mc.yearLabel, [mc.colIndex]); yearOrder.push(mc.yearLabel); }
    }
    for (const year of yearOrder) {
      const indices = yearMap.get(year)!;
      const s = Math.min(...indices);
      const e = Math.max(...indices);
      yearSpansInMonths.push({ yearLabel: year, colStart: s, colSpan: e - s + 1 });
    }
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div>
      {/* Main timeline container */}
      <div
        className="rounded-lg border border-border/60 bg-background overflow-hidden"
        role="grid"
        aria-label="Timeline de historias de usuario por sprint"
      >
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-auto relative"
          style={{ maxHeight: '72vh' }}
        >
          <div style={{ minWidth: `${totalGridWidth}px`, position: 'relative' }}>
            {/* ============================================================ */}
            {/* STICKY HEADER BLOCK                                          */}
            {/* ============================================================ */}
            <div className="sticky top-0 z-30" role="row">
              <div style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>

                {/* ---- DAY ZOOM HEADERS ---- */}
                {zoomLevel === 'day' && (
                  <>
                    {/* ROW 1: Months */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b border-r border-border/40"
                      style={{ gridRow: '1', gridColumn: '1' }}
                      role="columnheader"
                      aria-label="Informacion de historia"
                    />
                    {timeline.months.map((month) => (
                      <div
                        key={month.monthKey}
                        className="bg-muted border-b border-border/40 flex items-center justify-center text-xs font-semibold text-foreground/80 tracking-wide"
                        style={{ gridRow: '1', gridColumn: `${month.colStart + 2} / span ${month.colSpan}`, height: '28px' }}
                        role="columnheader"
                      >
                        {month.monthLabel}
                      </div>
                    ))}

                    {/* ROW 2: Sprints */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b border-r border-border/40"
                      style={{ gridRow: '2', gridColumn: '1' }}
                      role="columnheader"
                    />
                    {timeline.sprints.map((sr) => {
                      const isActive = sr.status === SprintStatus.Active;
                      const cap = sprintCapacity.get(sr.sprintId);
                      const assignedSP = cap?.assigned ?? 0;
                      const totalSPCap = cap?.total ?? 20;
                      const ratio = totalSPCap > 0 ? assignedSP / totalSPCap : 0;
                      const fillPct = Math.min(ratio * 100, 100);
                      const gaugeColor = ratio <= 0.8 ? 'bg-emerald-500' : ratio <= 1 ? 'bg-amber-500' : 'bg-red-500';

                      return (
                        <div
                          key={sr.sprintId}
                          className={`bg-muted border-b border-border/40 flex flex-col items-center justify-center text-[10px] font-medium ${isActive ? 'text-primary ring-1 ring-inset ring-primary/30 shadow-[0_0_8px_-2px] shadow-primary/20' : 'text-muted-foreground'}`}
                          style={{ gridRow: '2', gridColumn: `${sr.colStart + 2} / span ${sr.colSpan}`, height: '36px' }}
                          role="columnheader"
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <span className="truncate px-1">{sr.sprintName}</span>
                          <div className="w-full px-1.5 mt-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="w-full h-1.5 rounded-full bg-muted/60 overflow-hidden cursor-default">
                                  <div className={`h-full rounded-full transition-all ${gaugeColor}`} style={{ width: `${fillPct}%` }} />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">
                                <p className="font-medium">{sr.sprintName}</p>
                                <p className="text-muted-foreground">{assignedSP} / {totalSPCap} SP asignados{cap && cap.done > 0 ? ` · ${cap.done} SP completados` : ''}</p>
                                {ratio > 1 && <p className="text-red-400 text-[10px]">Sprint sobrecargado</p>}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}

                    {/* ROW 3: Days */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b-2 border-r border-border/50"
                      style={{ gridRow: '3', gridColumn: '1' }}
                      role="columnheader"
                    >
                      <div className="flex items-center h-full px-3">
                        <span className="text-[10px] font-medium text-muted-foreground">Historia</span>
                      </div>
                    </div>
                    {timeline.days.map((day, colIdx) => {
                      const isSprintBoundary = sprintLastDays.has(colIdx);
                      return (
                        <div
                          key={day.dateStr}
                          className={`bg-muted border-b-2 border-border/50 flex flex-col items-center justify-center text-center ${isSprintBoundary ? 'border-r-2 border-r-border/70' : 'border-r border-r-border/20'}`}
                          style={{ gridRow: '3', gridColumn: `${colIdx + 2}`, height: '32px' }}
                          role="columnheader"
                          aria-label={`${day.dayLabel} ${day.dayOfMonth}`}
                        >
                          <span className={`text-[10px] font-semibold leading-none ${day.isToday ? 'text-primary' : 'text-foreground/70'}`}>
                            {day.dayOfMonth}
                          </span>
                          <span className={`text-[8px] leading-none mt-0.5 ${day.isToday ? 'text-primary/80' : 'text-muted-foreground/60'}`}>
                            {day.dayLabel}
                          </span>
                        </div>
                      );
                    })}

                    {/* ROW 4: Ceremonies */}
                    {showCeremonyRow && (
                      <>
                        <div
                          className="sticky left-0 z-40 bg-muted border-b border-r border-border/40 flex items-center px-3"
                          style={{ gridRow: '4', gridColumn: '1', height: '22px' }}
                          role="columnheader"
                        >
                          <span className="text-[9px] font-medium text-muted-foreground/70">Ceremonias</span>
                        </div>
                        {timeline.days.map((day, colIdx) => {
                          const isSprintBoundary = sprintLastDays.has(colIdx);
                          const dayCeremonies = ceremonyColumns.filter(
                            (c) => colIdx >= c.colIndex && colIdx < c.colIndex + c.colSpan,
                          );
                          return (
                            <div
                              key={`cer-${day.dateStr}`}
                              className={`bg-muted border-b border-border/40 flex items-center justify-center ${isSprintBoundary ? 'border-r-2 border-r-border/70' : 'border-r border-r-border/20'}`}
                              style={{ gridRow: '4', gridColumn: `${colIdx + 2}`, height: '22px' }}
                              role="columnheader"
                            >
                              {dayCeremonies.length > 0 && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className={`h-4 w-full mx-0.5 rounded-sm flex items-center justify-center cursor-default ${dayCeremonies[0].bgOverlay.replace('/15', '/40').replace('/20', '/50')} border border-white/10`}>
                                      <span className={`text-[8px] font-bold leading-none ${dayCeremonies[0].textColor}`}>
                                        {dayCeremonies[0].abbreviation}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-xs">
                                    <div className="space-y-1">
                                      {dayCeremonies.map((c) => (
                                        <div key={c.ceremonyId} className="flex items-center gap-1.5">
                                          <span className={`h-2 w-2 rounded-full shrink-0 ${c.dotColor}`} />
                                          <span className="text-xs font-medium">{c.label}</span>
                                          <span className="text-[10px] text-muted-foreground">
                                            {c.scope === 'pi' ? '(PI)' : ''}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}

                {/* ---- WEEK ZOOM HEADERS ---- */}
                {zoomLevel === 'week' && (
                  <>
                    {/* ROW 1: Months */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b border-r border-border/40"
                      style={{ gridRow: '1', gridColumn: '1' }}
                      role="columnheader"
                      aria-label="Informacion de historia"
                    />
                    {monthSpansInWeeks.map((ms, idx) => (
                      <div
                        key={`wm-${idx}`}
                        className="bg-muted border-b border-border/40 flex items-center justify-center text-xs font-semibold text-foreground/80 tracking-wide"
                        style={{ gridRow: '1', gridColumn: `${ms.colStart + 2} / span ${ms.colSpan}`, height: '28px' }}
                        role="columnheader"
                      >
                        {ms.monthLabel}
                      </div>
                    ))}

                    {/* ROW 2: Sprints */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b border-r border-border/40"
                      style={{ gridRow: '2', gridColumn: '1' }}
                      role="columnheader"
                    />
                    {sprintSpansInWeeks.map((ss) => {
                      const isActive = ss.status === SprintStatus.Active;
                      return (
                        <div
                          key={ss.sprintId}
                          className={`bg-muted border-b border-border/40 flex items-center justify-center text-[10px] font-medium ${isActive ? 'text-primary bg-primary/5 ring-1 ring-inset ring-primary/30 shadow-[0_0_8px_-2px] shadow-primary/20' : 'text-muted-foreground'}`}
                          style={{ gridRow: '2', gridColumn: `${ss.colStart + 2} / span ${ss.colSpan}`, height: '24px' }}
                          role="columnheader"
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <span className="truncate px-1">{ss.sprintName}</span>
                        </div>
                      );
                    })}

                    {/* ROW 3: Week labels */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b-2 border-r border-border/50"
                      style={{ gridRow: '3', gridColumn: '1' }}
                      role="columnheader"
                    >
                      <div className="flex items-center h-full px-3">
                        <span className="text-[10px] font-medium text-muted-foreground">Historia</span>
                      </div>
                    </div>
                    {weekColumns.map((wc) => {
                      const isSprintBoundary = sprintLastWeeks.has(wc.colIndex);
                      const hasToday = timeline.todayColIndex !== null && wc.dayIndices.includes(timeline.todayColIndex);
                      return (
                        <div
                          key={wc.weekKey}
                          className={`bg-muted border-b-2 border-border/50 flex items-center justify-center text-center ${isSprintBoundary ? 'border-r-2 border-r-border/70' : 'border-r border-r-border/20'} ${hasToday ? 'bg-primary/10' : ''}`}
                          style={{ gridRow: '3', gridColumn: `${wc.colIndex + 2}`, height: '28px' }}
                          role="columnheader"
                          aria-label={wc.weekLabel}
                        >
                          <span className={`text-[10px] font-semibold leading-none ${hasToday ? 'text-primary' : 'text-foreground/70'}`}>
                            {wc.weekLabel}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* ---- MONTH ZOOM HEADERS ---- */}
                {zoomLevel === 'month' && (
                  <>
                    {/* ROW 1: Years */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b border-r border-border/40"
                      style={{ gridRow: '1', gridColumn: '1' }}
                      role="columnheader"
                      aria-label="Informacion de historia"
                    />
                    {yearSpansInMonths.map((ys) => (
                      <div
                        key={`yr-${ys.yearLabel}`}
                        className="bg-muted border-b border-border/40 flex items-center justify-center text-xs font-semibold text-foreground/80 tracking-wide"
                        style={{ gridRow: '1', gridColumn: `${ys.colStart + 2} / span ${ys.colSpan}`, height: '28px' }}
                        role="columnheader"
                      >
                        {ys.yearLabel}
                      </div>
                    ))}

                    {/* ROW 2: Month names */}
                    <div
                      className="sticky left-0 z-40 bg-muted border-b-2 border-r border-border/50"
                      style={{ gridRow: '2', gridColumn: '1' }}
                      role="columnheader"
                    >
                      <div className="flex items-center h-full px-3">
                        <span className="text-[10px] font-medium text-muted-foreground">Historia</span>
                      </div>
                    </div>
                    {monthColumns.map((mc) => {
                      const hasToday = timeline.todayColIndex !== null && mc.dayIndices.includes(timeline.todayColIndex);
                      return (
                        <div
                          key={mc.monthKey}
                          className={`bg-muted border-b-2 border-border/50 flex items-center justify-center text-center border-r border-r-border/30 ${hasToday ? 'bg-primary/10' : ''}`}
                          style={{ gridRow: '2', gridColumn: `${mc.colIndex + 2}`, height: '28px' }}
                          role="columnheader"
                          aria-label={`${mc.monthLabel} ${mc.yearLabel}`}
                        >
                          <span className={`text-xs font-semibold leading-none ${hasToday ? 'text-primary' : 'text-foreground/70'}`}>
                            {mc.monthLabel}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* ============================================================ */}
            {/* DATA ROWS                                                    */}
            {/* ============================================================ */}
            {timelineData.map(({ initiative, epics }) => (
              <Fragment key={initiative.id}>
                {/* Initiative group header */}
                <div
                  className="z-30 flex items-center bg-muted border-b border-border/30"
                  style={{ position: 'sticky', top: headerHeight, height: `${INITIATIVE_ROW_HEIGHT}px`, minWidth: `${totalGridWidth}px`, isolation: 'isolate' }}
                  role="row"
                >
                  <div
                    className="sticky left-0 z-30 flex items-center h-full px-3 bg-muted"
                    style={{ isolation: 'isolate', width: `${FROZEN_WIDTH}px`, minWidth: `${FROZEN_WIDTH}px`, boxShadow: '0 1px 0 var(--muted)' }}
                    role="rowheader"
                  >
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">
                      {initiative.name}
                    </span>
                  </div>
                </div>

                {epics.map(({ epic, stories, storyCount, doneCount, progress, totalSP }) => {
                  const isCollapsed = collapsedEpics.has(epic.id);

                  return (
                    <Fragment key={epic.id}>
                      {/* Epic group header */}
                      <div
                        className={`flex items-stretch border-b border-border/30 bg-background ${EPIC_STATUS_BORDER[epic.status] ?? ''}`}
                        style={{ minWidth: `${totalGridWidth}px`, height: `${EPIC_ROW_HEIGHT}px`, position: 'relative', zIndex: 1 }}
                        role="row"
                      >
                        <button
                          className="sticky left-0 z-30 flex items-center gap-2 px-3 bg-background border-r border-border/30 hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset"
                          style={{ isolation: 'isolate', width: `${FROZEN_WIDTH}px`, minWidth: `${FROZEN_WIDTH}px`, boxShadow: '0 1px 0 var(--background)' }}
                          onClick={() => toggleEpic(epic.id)}
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? 'Expandir' : 'Colapsar'} epica ${epic.jiraKey ?? epic.title}`}
                          role="rowheader"
                        >
                          {isCollapsed
                            ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                          }
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                            {epic.jiraKey ?? '\u2014'}
                          </span>
                          <span className="text-xs font-medium truncate flex-1 text-left">
                            {epic.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                            {storyCount}h {'\u00B7'} {progress}%
                          </span>
                          {(() => {
                            const blockedCount = stories.filter(s => s.story.status === StoryStatus.Blocked).length;
                            const health = calculateEpicHealth(epic, progress, stories);
                            return (
                              <>
                                {blockedCount > 0 && (
                                  <span className="text-[10px] text-red-400 shrink-0">{'\u00B7'} {blockedCount} bloq</span>
                                )}
                                <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${HEALTH_BADGES[health].className}`}>
                                  {HEALTH_BADGES[health].label}
                                </span>
                              </>
                            );
                          })()}
                        </button>
                        {/* Aggregate bar */}
                        {(() => {
                          const rangedStories = stories.filter(s => s.sprintRange);
                          if (rangedStories.length === 0) return <div className="flex-1" />;

                          const positions = rangedStories
                            .map(s => getBarPosition(s.sprintRange!))
                            .filter((p): p is { left: number; width: number } => p !== null);
                          if (positions.length === 0) return <div className="flex-1" />;

                          const minLeft = Math.min(...positions.map(p => p.left));
                          const maxRight = Math.max(...positions.map(p => p.left + p.width));

                          return (
                            <div className="relative flex-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="absolute top-1 bottom-1 rounded-[3px] border border-primary/40 overflow-hidden cursor-default"
                                    style={{ left: `${minLeft}px`, width: `${maxRight - minLeft}px` }}
                                  >
                                    <div className="absolute inset-y-0 left-0 bg-primary/35 transition-all" style={{ width: `${progress}%` }} />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <span className="text-[9px] font-medium text-primary">{progress}%</span>
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="font-medium text-xs">{epic.title}</p>
                                  <p className="text-[11px] text-muted-foreground">{doneCount}/{storyCount} historias {'\u00B7'} {totalSP} SP {'\u00B7'} {progress}% completado</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Story rows */}
                      {!isCollapsed && stories.map(({ story, sprint, sprintRange, pod }) => {
                        const barColors = STATUS_BAR_COLORS[story.status] ?? STATUS_BAR_COLORS[StoryStatus.Backlog];
                        const isBacklog = story.status === StoryStatus.Backlog;
                        const hasBar = !isBacklog && sprintRange;
                        const barPos = hasBar && sprintRange ? getBarPosition(sprintRange) : null;

                        return (
                          <div
                            key={story.id}
                            className="group border-b border-border/15 hover:bg-muted/10 transition-colors"
                            style={{ display: 'grid', gridTemplateColumns: gridTemplate, height: `${ROW_HEIGHT}px`, minWidth: `${totalGridWidth}px`, position: 'relative', zIndex: 1 }}
                            role="row"
                          >
                            {/* Frozen story info */}
                            <div
                              className="sticky left-0 z-30 flex items-center gap-2 px-3 bg-background border-r border-border/30 cursor-pointer"
                              style={{ isolation: 'isolate', boxShadow: '0 1px 0 var(--background)' }}
                              onClick={() => navigateToEpic(story.epicId)}
                              role="rowheader"
                              aria-label={`${story.jiraKey ?? story.title}: ${story.title}`}
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToEpic(story.epicId); } }}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${barColors.dot}`} aria-hidden="true" />
                              <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0 w-[60px]">
                                {story.jiraKey ?? '\u2014'}
                              </span>
                              <span className="text-xs truncate flex-1 text-foreground/80">{story.title}</span>
                              <StoryPointsBadge points={story.storyPoints} className="shrink-0 h-4 min-w-4 text-[9px]" />
                            </div>

                            {/* Grid background + bar */}
                            <div className="relative col-start-2" style={{ gridColumn: '2 / -1' }}>
                              <div className="absolute inset-0 flex" aria-hidden="true">
                                {zoomLevel === 'day' && timeline.days.map((day, colIdx) => (
                                  <div
                                    key={day.dateStr}
                                    className={`shrink-0 h-full ${sprintLastDays.has(colIdx) ? 'border-r-2 border-r-border/40' : 'border-r border-r-border/10'} ${day.isToday ? 'bg-primary/[0.03]' : ''}`}
                                    style={{ width: `${DAY_COL_WIDTH}px` }}
                                  />
                                ))}
                                {zoomLevel === 'week' && weekColumns.map((wc) => (
                                  <div
                                    key={wc.weekKey}
                                    className={`shrink-0 h-full ${sprintLastWeeks.has(wc.colIndex) ? 'border-r-2 border-r-border/40' : 'border-r border-r-border/10'} ${timeline.todayColIndex !== null && wc.dayIndices.includes(timeline.todayColIndex) ? 'bg-primary/[0.03]' : ''}`}
                                    style={{ width: `${ZOOM_CONFIGS.week.colWidth}px` }}
                                  />
                                ))}
                                {zoomLevel === 'month' && monthColumns.map((mc) => (
                                  <div
                                    key={mc.monthKey}
                                    className={`shrink-0 h-full border-r border-r-border/20 ${timeline.todayColIndex !== null && mc.dayIndices.includes(timeline.todayColIndex) ? 'bg-primary/[0.03]' : ''}`}
                                    style={{ width: `${ZOOM_CONFIGS.month.colWidth}px` }}
                                  />
                                ))}
                              </div>

                              {barPos && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={`absolute top-1 bottom-1 rounded-[3px] cursor-pointer ${barColors.bg} ${barColors.bgHover} border border-white/[0.06] transition-all duration-150 shadow-sm`}
                                      style={{ left: `${barPos.left}px`, width: `${barPos.width}px` }}
                                      onClick={() => navigateToEpic(story.epicId)}
                                      role="gridcell"
                                      aria-label={`${story.jiraKey ?? story.title}: ${getStatusLabel(story.status)}, ${story.storyPoints} SP, Sprint ${sprint?.name ?? ''}`}
                                      tabIndex={0}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToEpic(story.epicId); } }}
                                    >
                                      {story.status === StoryStatus.Blocked && (
                                        <>
                                          <div className="absolute inset-0 pointer-events-none rounded-[3px]"
                                            style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)' }}
                                          />
                                          <div className="absolute left-1 top-1/2 -translate-y-1/2">
                                            <AlertTriangle className="h-3 w-3 text-red-300" />
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="font-medium text-xs">{story.title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className={`h-2 w-2 rounded-full ${barColors.dot}`} aria-hidden="true" />
                                      <span className="text-[11px]">{getStatusLabel(story.status)}</span>
                                      <span className="text-[11px] opacity-60">{story.storyPoints} SP</span>
                                    </div>
                                    <p className="text-[10px] opacity-50 mt-0.5">
                                      {sprint?.name ?? 'Sin sprint'}
                                      {pod ? ` \u00B7 ${pod.name}` : ''}
                                    </p>
                                    {story.status === StoryStatus.Blocked && (
                                      <p className="text-[10px] text-red-400 font-medium mt-1">Historia bloqueada</p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Empty state */}
                      {!isCollapsed && stories.length === 0 && (
                        <div
                          className="flex items-center border-b border-border/15"
                          style={{ height: `${ROW_HEIGHT}px`, minWidth: `${totalGridWidth}px` }}
                          role="row"
                        >
                          <div
                            className="sticky left-0 z-20 flex items-center px-3 bg-background border-r border-border/30"
                            style={{ width: `${FROZEN_WIDTH}px`, minWidth: `${FROZEN_WIDTH}px` }}
                            role="gridcell"
                          >
                            <span className="text-[10px] text-muted-foreground/50 italic">
                              Sin historias asignadas a sprints
                            </span>
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}

            {/* Empty state - no data */}
            {timelineData.length === 0 && (
              <div className="flex items-center justify-center py-16" role="row">
                <div className="text-center" role="gridcell">
                  <CalendarDays className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/60">
                    No hay historias que coincidan con los filtros actuales.
                  </p>
                </div>
              </div>
            )}

            {/* Ceremony vertical overlays (day zoom only) – clipped to timeline area */}
            {showCeremonyRow && (
              <div
                className="absolute pointer-events-none"
                style={{ left: 0, right: 0, top: `${headerHeight}px`, bottom: 0, zIndex: 0 }}
                aria-hidden="true"
              >
                {ceremonyColumns
                  .filter((c) => c.scope === 'pi' || c.type === 'planning' || c.type === 'review' || c.type === 'release')
                  .map((c) => (
                    <div
                      key={`overlay-${c.ceremonyId}`}
                      className={`absolute ${c.bgOverlay}`}
                      style={{ left: `${FROZEN_WIDTH + c.colIndex * DAY_COL_WIDTH}px`, width: `${c.colSpan * DAY_COL_WIDTH}px`, top: 0, bottom: 0 }}
                    />
                  ))}
              </div>
            )}

            {/* Today vertical marker */}
            {todayMarkerLeft !== null && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-[35]"
                style={{ left: `${FROZEN_WIDTH + todayMarkerLeft}px`, width: '0px' }}
                aria-hidden="true"
              >
                <div className="absolute inset-y-0 w-[2px] -translate-x-[1px] bg-red-500/80" />
                <div
                  className="absolute top-0 -translate-x-[5px]"
                  style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid rgb(239 68 68 / 0.8)' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
