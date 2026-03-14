'use client';

import { useRouter } from 'next/navigation';
import { useProyectos } from '@/context/ProyectosContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '../shared/StatusBadge';
import { PriorityIndicator } from '../shared/PriorityIndicator';
import { PodBadge } from '../shared/PodBadge';
import { ProgressBar } from '../shared/ProgressBar';
import { ChevronRight } from 'lucide-react';

export function EpicasList() {
  const { epicsWithRelations } = useProyectos();
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Key</TableHead>
              <TableHead>Titulo</TableHead>
              <TableHead>Iniciativa</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24">Prioridad</TableHead>
              <TableHead>PODs</TableHead>
              <TableHead className="w-32">Progreso</TableHead>
              <TableHead className="w-20 text-right">Historias</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {epicsWithRelations.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8"
                >
                  No se encontraron epicas con los filtros actuales
                </TableCell>
              </TableRow>
            ) : (
              epicsWithRelations.map((epic) => (
                <TableRow
                  key={epic.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/proyectos/epicas/${epic.id}`)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {epic.jiraKey}
                  </TableCell>
                  <TableCell className="font-medium">{epic.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {epic.initiative.name}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={epic.status} type="epic" />
                  </TableCell>
                  <TableCell>
                    <PriorityIndicator priority={epic.priority} showLabel={false} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {epic.pods.map((pod) => (
                        <PodBadge key={pod.id} name={pod.name} color={pod.color} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ProgressBar progress={epic.progress} size="sm" />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {epic.stories.length}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
