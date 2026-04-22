'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
import { CreateExternalSecretDialog } from '@/components/secrets/CreateExternalSecretDialog';
import {
  listExternalSecrets,
  deleteExternalSecret,
} from '@/lib/api/external-secrets';
import type { ExternalSecret } from '@cenzontle/shared';

/**
 * Sección de `/factory/settings` para gestionar credenciales externas.
 * Solo accesible a roles con `MANAGE_EXTERNAL_SECRETS` — el backend valida
 * (UI también oculta la entrada del sidebar para usuarios sin permiso).
 *
 * La UI muestra `maskedValue` (nunca plaintext). Operaciones destructivas
 * (eliminar) usan type-to-confirm pidiendo escribir el `name` del secret.
 */
export function ExternalSecretsSection() {
  const [secrets, setSecrets] = useState<ExternalSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<ExternalSecret | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listExternalSecrets();
      setSecrets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar secrets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await deleteExternalSecret(deleting.id);
      toast.success(`Secret ${deleting.name} eliminado`);
      setDeleting(null);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast.error('No se pudo eliminar el secret', { description: message });
      throw err; // mantener dialog abierto
    }
  }, [deleting, refresh]);

  return (
    <div className="space-y-6">
      {/* Header con acción primaria */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-2">
            <KeyRound className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Secretos externos</h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
              API keys de proveedores (Stripe, Twilio), merchant codes, OAuth client_secret —
              credenciales que el backend necesita para integrar con servicios de terceros.
              Se encriptan con AES-256-GCM y se consumen en runtime vía
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[10px]">ExternalSecretsService.getByName()</code>.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Crear nuevo
        </Button>
      </div>

      {/* Lista */}
      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">Cargando secrets...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-6 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        ) : secrets.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Sin secrets registrados</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                Cuando el agente detecte una dependencia con credencial externa, puedes resolverla
                directamente desde la card de la épica. O crea uno manualmente aquí.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Crear primero
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {secrets.map((secret) => (
              <li key={secret.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-xs font-semibold text-foreground">{secret.name}</code>
                    {secret.vendor && (
                      <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {secret.vendor}
                      </span>
                    )}
                  </div>
                  {secret.description && (
                    <p className="mt-1 text-xs text-muted-foreground truncate">{secret.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/70">
                    <code className="font-mono">{secret.maskedValue}</code>
                    <span>
                      Rotado {new Date(secret.lastRotatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleting(secret)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <CreateExternalSecretDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refresh()}
      />

      {deleting && (
        <TypeToConfirmDialog
          open={!!deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Eliminar secret externo"
          resourceLabel="secret"
          expectedValue={deleting.name}
          description={`Se eliminará permanentemente la credencial ${deleting.name}. Cualquier servicio del backend que la consuma vía ExternalSecretsService.getByName() fallará. Esta acción NO se puede deshacer.`}
          confirmText="Eliminar secret"
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
