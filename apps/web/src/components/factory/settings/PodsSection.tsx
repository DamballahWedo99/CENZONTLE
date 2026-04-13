'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MoreHorizontal, Pencil, Trash2, Loader2, Boxes } from 'lucide-react';
import { getPods, createPod, updatePod, deletePod, type PodResponse } from '@/lib/api/pods';

const PRESET_COLORS = ['#3b82f6', '#1e40af', '#06b6d4', '#0891b2', '#10b981', '#f59e0b', '#ef4444', '#6b7280'];

const podSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100, 'Máximo 100 caracteres'),
  description: z.string().min(1, 'La descripción es obligatoria'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido'),
});

export function PodsSection() {
  const [pods, setPods] = useState<PodResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingPod, setEditingPod] = useState<PodResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PodResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'description' | 'color', string>>>({});

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');

  const fetchData = useCallback(async () => {
    try {
      const podsData = await getPods();
      setPods(podsData);
    } catch (err) {
      toast.error('Error cargando células');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function openCreate() {
    setEditingPod(null);
    setName('');
    setDescription('');
    setColor('#3b82f6');
    setErrors({});
    setShowDialog(true);
  }

  function openEdit(pod: PodResponse) {
    setEditingPod(pod);
    setName(pod.name);
    setDescription(pod.description);
    setColor(pod.color);
    setErrors({});
    setShowDialog(true);
  }

  async function handleSave() {
    const result = podSchema.safeParse({ name: name.trim(), description: description.trim(), color });
    if (!result.success) {
      const fieldErrors: typeof errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof typeof errors;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (editingPod) {
        await updatePod(editingPod.id, { name, description, color });
        toast.success('Célula actualizada');
      } else {
        await createPod({ name, description, color });
        toast.success('Célula creada');
      }
      setShowDialog(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Error guardando célula');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deletePod(deleteTarget.id);
      toast.success('Célula eliminada');
      setDeleteTarget(null);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Error eliminando célula');
    } finally {
      setSaving(false);
    }
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Boxes className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Células</h2>
            <p className="text-sm text-muted-foreground">Células de trabajo y sus product owners asignados</p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nueva Célula
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 rounded-lg border border-border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Color</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-center">Épicas</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pods.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No hay células configuradas
                </TableCell>
              </TableRow>
            ) : (
              pods.map((pod) => (
                <TableRow key={pod.id}>
                  <TableCell>
                    <div className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: pod.color }} />
                  </TableCell>
                  <TableCell className="font-medium">{pod.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-[250px] truncate">{pod.description}</TableCell>
                  <TableCell className="text-center tabular-nums">{pod.epicCount}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(pod)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(pod)} disabled={pod.epicCount > 0}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" />Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPod ? 'Editar Célula' : 'Nueva Célula'}</DialogTitle>
            <DialogDescription>
              {editingPod ? 'Modifica los datos de la célula' : 'Crea una nueva célula de trabajo'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }} placeholder="Ej: Payments Backend" aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input value={description} onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: undefined })); }} placeholder="Descripción de la célula" aria-invalid={!!errors.description} />
              {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setColor(c); setErrors((p) => ({ ...p, color: undefined })); }}
                    className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ backgroundColor: c, borderColor: color === c ? 'var(--foreground)' : 'transparent' }}
                  />
                ))}
                <Input value={color} onChange={(e) => { setColor(e.target.value); setErrors((p) => ({ ...p, color: undefined })); }} className="w-24 ml-2 font-mono text-xs" aria-invalid={!!errors.color} />
              </div>
              {errors.color && <p className="text-xs text-destructive">{errors.color}</p>}
            </div>
          </div>
          <div className="border-t border-border" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editingPod ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar Célula</DialogTitle>
            <DialogDescription>
              Se eliminará la célula &quot;{deleteTarget?.name}&quot; permanentemente. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
