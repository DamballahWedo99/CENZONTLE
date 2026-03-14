'use client';

import { useState, Fragment } from 'react';
import { useProyectos } from '@/context/ProyectosContext';
import type { MatrizCell as MatrizCellType } from '@/types/proyectos';
import { StatusBadge } from '../shared/StatusBadge';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function MatrizSeguimiento() {
  const { matrizRows, state } = useProyectos();
  const pods = state.pods;
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  const toggleCell = (key: string) => {
    setExpandedCell((prev) => (prev === key ? null : key));
  };

  // Group rows by initiative
  const groupedRows = state.initiatives.map((init) => ({
    initiative: init,
    rows: matrizRows.filter((r) => r.initiative.id === init.id),
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Matriz de Seguimiento por POD y Epica">
          <thead>
            <tr className="border-b bg-muted/50">
              <th
                scope="col"
                className="text-left p-3 font-medium text-muted-foreground min-w-[250px] sticky left-0 bg-muted/50 z-10"
              >
                Epica
              </th>
              {pods.map((pod) => (
                <th key={pod.id} scope="col" className="text-center p-3 font-medium min-w-[160px]">
                  <div className="flex items-center justify-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: pod.color }}
                      aria-hidden="true"
                    />
                    <span className="text-xs">{pod.name}</span>
                  </div>
                </th>
              ))}
              <th scope="col" className="text-center p-3 font-medium text-muted-foreground min-w-[100px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedRows.map(({ initiative, rows }) => (
              <Fragment key={initiative.id}>
                {/* Initiative group header */}
                <tr className="bg-muted/30">
                  <td colSpan={pods.length + 2} className="p-2 px-3" role="rowheader">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {initiative.name}
                    </span>
                  </td>
                </tr>
                {/* Epic rows */}
                {rows.map((row) => {
                  const totalStories = Object.values(row.cells).reduce(
                    (s, c) => s + c.totalStories,
                    0
                  );
                  const totalDone = Object.values(row.cells).reduce(
                    (s, c) => s + c.doneStories,
                    0
                  );
                  const totalPoints = Object.values(row.cells).reduce(
                    (s, c) => s + c.totalPoints,
                    0
                  );
                  const totalDonePoints = Object.values(row.cells).reduce(
                    (s, c) => s + c.donePoints,
                    0
                  );
                  const totalProgress =
                    totalPoints > 0
                      ? Math.round((totalDonePoints / totalPoints) * 100)
                      : 0;

                  return (
                    <tr key={row.epic.id} className="border-b hover:bg-muted/30">
                      <td className="p-3 sticky left-0 bg-background z-10">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.epic.jiraKey}
                          </span>
                          <span className="font-medium text-sm truncate max-w-[220px]">
                            {row.epic.title}
                          </span>
                        </div>
                      </td>
                      {pods.map((pod) => {
                        const cell = row.cells[pod.id];
                        const cellKey = `${row.epic.id}-${pod.id}`;
                        const isExpanded = expandedCell === cellKey;

                        if (!cell || cell.totalStories === 0) {
                          return (
                            <td
                              key={pod.id}
                              className="p-3 text-center text-muted-foreground"
                              aria-label={`${row.epic.title} - ${pod.name}: sin historias`}
                            >
                              &mdash;
                            </td>
                          );
                        }

                        return (
                          <td key={pod.id} className="p-2">
                            <button
                              onClick={() => toggleCell(cellKey)}
                              className="w-full rounded-md border p-2 hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              aria-expanded={isExpanded}
                              aria-label={`${row.epic.title} - ${pod.name}: ${cell.doneStories} de ${cell.totalStories} historias completadas, ${cell.donePoints} de ${cell.totalPoints} story points`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium">
                                  {cell.doneStories}/{cell.totalStories}
                                </span>
                                {isExpanded ? (
                                  <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                                )}
                              </div>
                              <div
                                className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                                role="progressbar"
                                aria-valuenow={cell.progress}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`Progreso: ${cell.progress}%`}
                              >
                                <div
                                  className="bg-green-500 transition-all"
                                  style={{ width: `${cell.progress}%` }}
                                />
                                {cell.blockedStories > 0 && (
                                  <div
                                    className="bg-red-500"
                                    style={{
                                      width: `${(cell.blockedStories / cell.totalStories) * 100}%`,
                                    }}
                                  />
                                )}
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-xs text-muted-foreground">
                                  {cell.donePoints}/{cell.totalPoints} SP
                                </span>
                                {cell.blockedStories > 0 && (
                                  <span className="text-xs text-red-500 font-medium">
                                    {cell.blockedStories} blocked
                                  </span>
                                )}
                              </div>
                            </button>
                            {/* Expanded stories list */}
                            {isExpanded && (
                              <div className="mt-1 space-y-1" role="list" aria-label="Historias de usuario">
                                {cell.stories.map((story) => (
                                  <div
                                    key={story.id}
                                    className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
                                    role="listitem"
                                  >
                                    <span className="font-mono text-muted-foreground shrink-0">
                                      {story.jiraKey}
                                    </span>
                                    <span className="truncate flex-1">{story.title}</span>
                                    <StoryPointsBadge points={story.storyPoints} />
                                    <StatusBadge status={story.status} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm font-semibold">
                            {totalDone}/{totalStories}
                          </span>
                          <div
                            className="w-16 h-1.5 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-valuenow={totalProgress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Progreso total de epica: ${totalProgress}%`}
                          >
                            <div
                              className="bg-green-500 h-full transition-all"
                              style={{ width: `${totalProgress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {totalDonePoints}/{totalPoints} SP
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
