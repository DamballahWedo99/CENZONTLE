import {
  eachDayOfInterval,
  isSameDay,
  isWeekend,
  format,
  isWithinInterval,
  isBefore,
  isAfter,
  parseISO,
  getISOWeek,
  getISOWeekYear,
  addMonths,
} from "date-fns";
import { es } from "date-fns/locale";

// ---------------------------------------------------------------------------
// Zoom types
// ---------------------------------------------------------------------------

export type ZoomLevel = 'day' | 'week' | 'month';

export interface ZoomConfig {
  level: ZoomLevel;
  colWidth: number;
  label: string;
}

export const ZOOM_CONFIGS: Record<ZoomLevel, ZoomConfig> = {
  day: { level: 'day', colWidth: 36, label: 'Día' },
  week: { level: 'week', colWidth: 120, label: 'Semana' },
  month: { level: 'month', colWidth: 200, label: 'Mes' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineDay {
  date: Date;
  dateStr: string;
  dayOfMonth: number;
  dayLabel: string;
  isWeekend: boolean;
  isToday: boolean;
  monthKey: string;
  monthLabel: string;
}

export interface SprintRange {
  sprintId: string;
  sprintName: string;
  podId: string;
  startDate: Date;
  endDate: Date;
  status: string;
  days: TimelineDay[];
  colStart: number;
  colSpan: number;
}

export interface MonthGroup {
  monthKey: string;
  monthLabel: string;
  colStart: number;
  colSpan: number;
}

export interface TimelineConfig {
  days: TimelineDay[];
  sprints: SprintRange[];
  months: MonthGroup[];
  totalDayCols: number;
  todayColIndex: number | null;
}

export interface CeremonyColumn {
  ceremonyId: string;
  type: string;           // CeremonyType value
  label: string;
  abbreviation: string;
  colIndex: number;       // column index in the business days array
  colSpan: number;        // 1 for single-day, more for multi-day
  bgOverlay: string;      // Tailwind bg class for vertical overlay
  dotColor: string;       // Tailwind bg class for the badge dot
  textColor: string;      // Tailwind text class
  sprintId: string | null;
  scope: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SPANISH_DAY_LABELS: Record<number, string> = {
  1: "lun",
  2: "mar",
  3: "mi\u00e9",
  4: "jue",
  5: "vie",
};

const SPANISH_MONTH_LABELS: Record<number, string> = {
  0: "Enero",
  1: "Febrero",
  2: "Marzo",
  3: "Abril",
  4: "Mayo",
  5: "Junio",
  6: "Julio",
  7: "Agosto",
  8: "Septiembre",
  9: "Octubre",
  10: "Noviembre",
  11: "Diciembre",
};

function buildTimelineDay(date: Date, today: Date): TimelineDay {
  const dayOfWeek = date.getDay(); // 0=Sun .. 6=Sat
  return {
    date,
    dateStr: format(date, "yyyy-MM-dd"),
    dayOfMonth: date.getDate(),
    dayLabel: SPANISH_DAY_LABELS[dayOfWeek] ?? "",
    isWeekend: isWeekend(date),
    isToday: isSameDay(date, today),
    monthKey: format(date, "yyyy-MM"),
    monthLabel: `${SPANISH_MONTH_LABELS[date.getMonth()]}`,
  };
}

// ---------------------------------------------------------------------------
// Ceremony visual config
// ---------------------------------------------------------------------------

export const CEREMONY_CONFIG: Record<string, { label: string; abbreviation: string; bgOverlay: string; dotColor: string; textColor: string }> = {
  planning:     { label: 'Planning',      abbreviation: 'Pl',  bgOverlay: 'bg-yellow-500/15',  dotColor: 'bg-yellow-500',  textColor: 'text-yellow-400' },
  review:       { label: 'Review',        abbreviation: 'Rv',  bgOverlay: 'bg-teal-500/15',    dotColor: 'bg-teal-500',    textColor: 'text-teal-400' },
  retro:        { label: 'Retro',         abbreviation: 'Rt',  bgOverlay: 'bg-orange-500/15',  dotColor: 'bg-orange-500',  textColor: 'text-orange-400' },
  release:      { label: 'Release',       abbreviation: 'Rl',  bgOverlay: 'bg-rose-500/15',    dotColor: 'bg-rose-500',    textColor: 'text-rose-400' },
  pi_planning:  { label: 'PI Planning',   abbreviation: 'PI',  bgOverlay: 'bg-amber-400/20',   dotColor: 'bg-amber-400',   textColor: 'text-amber-300' },
  e2e:          { label: 'e2e Testing',   abbreviation: 'e2e', bgOverlay: 'bg-sky-500/15',     dotColor: 'bg-sky-500',     textColor: 'text-sky-400' },
  cvt:          { label: 'CVT',           abbreviation: 'CVT', bgOverlay: 'bg-cyan-500/15',    dotColor: 'bg-cyan-500',    textColor: 'text-cyan-400' },
  integration:  { label: 'Integración',   abbreviation: 'Int', bgOverlay: 'bg-cyan-500/15',    dotColor: 'bg-cyan-500',    textColor: 'text-cyan-400' },
};

// ---------------------------------------------------------------------------
// generateTimelineConfig
// ---------------------------------------------------------------------------

export function generateTimelineConfig(
  sprints: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    podId: string;
    status: string;
  }>,
  podId?: string
): TimelineConfig {
  const filtered = podId
    ? sprints.filter((s) => s.podId === podId)
    : sprints;

  if (filtered.length === 0) {
    return {
      days: [],
      sprints: [],
      months: [],
      totalDayCols: 0,
      todayColIndex: null,
    };
  }

  // --- 1. Determine overall date range across all sprints ----------------

  let globalStart: Date | null = null;
  let globalEnd: Date | null = null;

  for (const s of filtered) {
    const start = parseISO(s.startDate);
    const end = parseISO(s.endDate);

    if (globalStart === null || isBefore(start, globalStart)) {
      globalStart = start;
    }
    if (globalEnd === null || isAfter(end, globalEnd)) {
      globalEnd = end;
    }
  }

  // Safety: both are guaranteed non-null because filtered.length > 0
  const rangeStart = globalStart as Date;
  // Extend range to at least 12 months from the start date
  const minEnd = addMonths(rangeStart, 12);
  const rangeEnd = isAfter(minEnd, globalEnd as Date) ? minEnd : (globalEnd as Date);

  // --- 2. Generate all calendar days, then keep only business days -------

  const today = new Date();

  const allCalendarDays = eachDayOfInterval({
    start: rangeStart,
    end: rangeEnd,
  });

  const businessDays: TimelineDay[] = [];
  for (const date of allCalendarDays) {
    if (!isWeekend(date)) {
      businessDays.push(buildTimelineDay(date, today));
    }
  }

  // Build a quick lookup: dateStr -> column index (0-based)
  const dateToColIndex = new Map<string, number>();
  for (let i = 0; i < businessDays.length; i++) {
    dateToColIndex.set(businessDays[i].dateStr, i);
  }

  // --- 3. Group months for the top header --------------------------------

  const monthMap = new Map<string, { label: string; indices: number[] }>();

  for (let colIdx = 0; colIdx < businessDays.length; colIdx++) {
    const day = businessDays[colIdx];
    const existing = monthMap.get(day.monthKey);
    if (existing) {
      existing.indices.push(colIdx);
    } else {
      const year = day.date.getFullYear();
      monthMap.set(day.monthKey, {
        label: `${SPANISH_MONTH_LABELS[day.date.getMonth()]} ${year}`,
        indices: [colIdx],
      });
    }
  }

  const months: MonthGroup[] = [];
  for (const [monthKey, data] of monthMap) {
    const colStart = Math.min(...data.indices);
    const colEnd = Math.max(...data.indices);
    months.push({
      monthKey,
      monthLabel: data.label,
      colStart,
      colSpan: colEnd - colStart + 1,
    });
  }

  months.sort((a, b) => a.colStart - b.colStart);

  // --- 4. Map each sprint to its column range ----------------------------

  const sprintRanges: SprintRange[] = [];

  for (const s of filtered) {
    const sprintStart = parseISO(s.startDate);
    const sprintEnd = parseISO(s.endDate);

    // Collect business days that fall within this sprint's interval
    const sprintDays: TimelineDay[] = [];
    const colIndices: number[] = [];

    for (let colIdx = 0; colIdx < businessDays.length; colIdx++) {
      const day = businessDays[colIdx];
      if (
        isWithinInterval(day.date, { start: sprintStart, end: sprintEnd })
      ) {
        sprintDays.push(day);
        colIndices.push(colIdx);
      }
    }

    if (colIndices.length === 0) {
      continue;
    }

    const colStart = Math.min(...colIndices);
    const colEnd = Math.max(...colIndices);

    sprintRanges.push({
      sprintId: s.id,
      sprintName: s.name,
      podId: s.podId,
      startDate: sprintStart,
      endDate: sprintEnd,
      status: s.status,
      days: sprintDays,
      colStart,
      colSpan: colEnd - colStart + 1,
    });
  }

  sprintRanges.sort((a, b) => a.colStart - b.colStart);

  // --- 5. Find today's column index --------------------------------------
  // If today is a weekend, snap to the nearest business day (previous Friday)
  let todayRef = today;
  if (isWeekend(todayRef)) {
    const dayOfWeek = todayRef.getDay(); // 0=Sun, 6=Sat
    const daysBack = dayOfWeek === 0 ? 2 : 1; // Sun→Fri(-2), Sat→Fri(-1)
    todayRef = new Date(todayRef);
    todayRef.setDate(todayRef.getDate() - daysBack);
  }
  const todayStr = format(todayRef, "yyyy-MM-dd");
  const todayColIndex = dateToColIndex.get(todayStr) ?? null;

  return {
    days: businessDays,
    sprints: sprintRanges,
    months,
    totalDayCols: businessDays.length,
    todayColIndex,
  };
}

// ---------------------------------------------------------------------------
// getStatusColor
// ---------------------------------------------------------------------------

export function getStatusColor(status: string): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case "backlog":
      return {
        bg: "bg-gray-500/20",
        text: "text-gray-400",
        border: "border-gray-500/30",
      };
    case "to_do":
      return {
        bg: "bg-slate-400/30",
        text: "text-slate-300",
        border: "border-slate-400/30",
      };
    case "in_progress":
      return {
        bg: "bg-blue-500/60",
        text: "text-blue-300",
        border: "border-blue-500/30",
      };
    case "in_review":
      return {
        bg: "bg-cyan-500/60",
        text: "text-cyan-300",
        border: "border-cyan-500/30",
      };
    case "qa":
      return {
        bg: "bg-amber-500/60",
        text: "text-amber-300",
        border: "border-amber-500/30",
      };
    case "done":
      return {
        bg: "bg-emerald-500/60",
        text: "text-emerald-300",
        border: "border-emerald-500/30",
      };
    case "blocked":
      return {
        bg: "bg-red-500/60",
        text: "text-red-300",
        border: "border-red-500/30",
      };
    default:
      return {
        bg: "bg-gray-500/10",
        text: "text-gray-500",
        border: "border-gray-500/20",
      };
  }
}

// ---------------------------------------------------------------------------
// getStatusLabel
// ---------------------------------------------------------------------------

export function getStatusLabel(status: string): string {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "to_do":
      return "Por hacer";
    case "in_progress":
      return "En progreso";
    case "in_review":
      return "En revisi\u00f3n";
    case "qa":
      return "Pruebas QA";
    case "done":
      return "Terminado";
    case "blocked":
      return "Bloqueado";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// getStoryTimelinePosition
// ---------------------------------------------------------------------------

export function getStoryTimelinePosition(
  sprintId: string | null,
  sprintRanges: SprintRange[]
): { colStart: number; colSpan: number } | null {
  if (sprintId === null) {
    return null;
  }

  const match = sprintRanges.find((sr) => sr.sprintId === sprintId);
  if (!match) {
    return null;
  }

  return {
    colStart: match.colStart,
    colSpan: match.colSpan,
  };
}

// ---------------------------------------------------------------------------
// mapCeremoniesToColumns
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Week columns (for week-level zoom)
// ---------------------------------------------------------------------------

export interface WeekColumn {
  weekKey: string;       // e.g. "2026-W03"
  weekLabel: string;     // e.g. "Sem 3"
  startDate: Date;
  colIndex: number;      // position in the week-level grid
  dayIndices: number[];  // which day columns this week contains
}

export function generateWeekColumns(days: TimelineDay[]): WeekColumn[] {
  if (days.length === 0) return [];

  const weekMap = new Map<string, { startDate: Date; dayIndices: number[] }>();
  const weekOrder: string[] = [];

  for (let i = 0; i < days.length; i++) {
    const d = days[i].date;
    const isoWeek = getISOWeek(d);
    const isoYear = getISOWeekYear(d);
    const weekKey = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;

    const existing = weekMap.get(weekKey);
    if (existing) {
      existing.dayIndices.push(i);
    } else {
      weekMap.set(weekKey, { startDate: d, dayIndices: [i] });
      weekOrder.push(weekKey);
    }
  }

  return weekOrder.map((weekKey, colIndex) => {
    const data = weekMap.get(weekKey)!;
    const isoWeek = getISOWeek(data.startDate);
    return {
      weekKey,
      weekLabel: `Sem ${isoWeek}`,
      startDate: data.startDate,
      colIndex,
      dayIndices: data.dayIndices,
    };
  });
}

// ---------------------------------------------------------------------------
// Month columns (for month-level zoom)
// ---------------------------------------------------------------------------

export interface MonthColumn {
  monthKey: string;      // e.g. "2026-03"
  monthLabel: string;    // e.g. "Marzo"
  yearLabel: string;     // e.g. "2026"
  colIndex: number;
  dayIndices: number[];  // which day columns this month contains
}

export function generateMonthColumns(days: TimelineDay[]): MonthColumn[] {
  if (days.length === 0) return [];

  const monthMap = new Map<string, { label: string; year: string; dayIndices: number[] }>();
  const monthOrder: string[] = [];

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const existing = monthMap.get(day.monthKey);
    if (existing) {
      existing.dayIndices.push(i);
    } else {
      monthMap.set(day.monthKey, {
        label: SPANISH_MONTH_LABELS[day.date.getMonth()],
        year: String(day.date.getFullYear()),
        dayIndices: [i],
      });
      monthOrder.push(day.monthKey);
    }
  }

  return monthOrder.map((monthKey, colIndex) => {
    const data = monthMap.get(monthKey)!;
    return {
      monthKey,
      monthLabel: data.label,
      yearLabel: data.year,
      colIndex,
      dayIndices: data.dayIndices,
    };
  });
}

// ---------------------------------------------------------------------------
// Sprint-to-zoom-column mapping helpers
// ---------------------------------------------------------------------------

/** Map a sprint range (defined by day indices) to week column indices */
export function sprintToWeekRange(
  sprint: SprintRange,
  weekColumns: WeekColumn[],
): { colStart: number; colSpan: number } | null {
  const firstDay = sprint.colStart;
  const lastDay = sprint.colStart + sprint.colSpan - 1;

  let startWeek = -1;
  let endWeek = -1;

  for (const wc of weekColumns) {
    if (startWeek === -1 && wc.dayIndices.some((d) => d >= firstDay && d <= lastDay)) {
      startWeek = wc.colIndex;
    }
    if (wc.dayIndices.some((d) => d >= firstDay && d <= lastDay)) {
      endWeek = wc.colIndex;
    }
  }

  if (startWeek === -1) return null;
  return { colStart: startWeek, colSpan: endWeek - startWeek + 1 };
}

/** Map a sprint range (defined by day indices) to month column indices */
export function sprintToMonthRange(
  sprint: SprintRange,
  monthColumns: MonthColumn[],
): { colStart: number; colSpan: number } | null {
  const firstDay = sprint.colStart;
  const lastDay = sprint.colStart + sprint.colSpan - 1;

  let startMonth = -1;
  let endMonth = -1;

  for (const mc of monthColumns) {
    if (startMonth === -1 && mc.dayIndices.some((d) => d >= firstDay && d <= lastDay)) {
      startMonth = mc.colIndex;
    }
    if (mc.dayIndices.some((d) => d >= firstDay && d <= lastDay)) {
      endMonth = mc.colIndex;
    }
  }

  if (startMonth === -1) return null;
  return { colStart: startMonth, colSpan: endMonth - startMonth + 1 };
}

/** Find the fractional position of today within week columns */
export function todayWeekPosition(
  todayDayIndex: number | null,
  weekColumns: WeekColumn[],
  colWidth: number,
): number | null {
  if (todayDayIndex === null) return null;
  for (const wc of weekColumns) {
    const idx = wc.dayIndices.indexOf(todayDayIndex);
    if (idx !== -1) {
      const fraction = (idx + 0.5) / wc.dayIndices.length;
      return wc.colIndex * colWidth + fraction * colWidth;
    }
  }
  return null;
}

/** Find the fractional position of today within month columns */
export function todayMonthPosition(
  todayDayIndex: number | null,
  monthColumns: MonthColumn[],
  colWidth: number,
): number | null {
  if (todayDayIndex === null) return null;
  for (const mc of monthColumns) {
    const idx = mc.dayIndices.indexOf(todayDayIndex);
    if (idx !== -1) {
      const fraction = (idx + 0.5) / mc.dayIndices.length;
      return mc.colIndex * colWidth + fraction * colWidth;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// mapCeremoniesToColumns
// ---------------------------------------------------------------------------

export function mapCeremoniesToColumns(
  ceremonies: Array<{
    id: string;
    sprintId: string | null;
    type: string;
    date: string;
    endDate?: string;
    scope: string;
  }>,
  businessDays: Array<{ dateStr: string }>,
): CeremonyColumn[] {
  const dateToColIndex = new Map<string, number>();
  for (let i = 0; i < businessDays.length; i++) {
    dateToColIndex.set(businessDays[i].dateStr, i);
  }

  const result: CeremonyColumn[] = [];

  for (const c of ceremonies) {
    const config = CEREMONY_CONFIG[c.type];
    if (!config) continue;

    const startCol = dateToColIndex.get(c.date);
    if (startCol === undefined) continue;

    let colSpan = 1;
    if (c.endDate) {
      const endCol = dateToColIndex.get(c.endDate);
      if (endCol !== undefined) {
        colSpan = endCol - startCol + 1;
      }
    }

    result.push({
      ceremonyId: c.id,
      type: c.type,
      label: config.label,
      abbreviation: config.abbreviation,
      colIndex: startCol,
      colSpan,
      bgOverlay: config.bgOverlay,
      dotColor: config.dotColor,
      textColor: config.textColor,
      sprintId: c.sprintId,
      scope: c.scope,
    });
  }

  return result;
}
