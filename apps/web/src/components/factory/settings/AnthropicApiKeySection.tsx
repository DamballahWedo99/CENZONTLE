'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Eye, EyeOff, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import {
  getAnthropicConfig,
  setAnthropicKey,
  type AnthropicConfigResponse,
} from '@/lib/api/factory';

const inputClasses =
  'bg-muted border-border text-foreground placeholder:text-muted-foreground/70';

/**
 * Sección "Anthropic API Key" — configura/rota la API key que el backend
 * forwardea a los workers en cada `claim-story`. Sin esta key, los workers
 * NO pueden correr historias (claimStory rollbackea).
 *
 * Patrón Stripe: el plaintext se introduce UNA VEZ. Backend encripta
 * (AES-256-GCM) y nunca devuelve el plaintext después. UI muestra solo
 * masked (`sk-...XXXX`).
 *
 * Solo Alta Gerencia puede ver/modificar (validado en backend).
 */
export function AnthropicApiKeySection() {
  const [config, setConfig] = useState<AnthropicConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const result = await getAnthropicConfig();
      setConfig(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Solo Alta Gerencia puede ver la configuración de la API key');
      } else if (err instanceof ApiError && err.status !== 401) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    const trimmed = newKey.trim();
    if (!trimmed) {
      toast.error('Pega tu API key antes de guardar');
      return;
    }
    if (trimmed.length < 20) {
      toast.error('API key demasiado corta (mínimo 20 caracteres)');
      return;
    }
    setSaving(true);
    try {
      await setAnthropicKey(trimmed);
      toast.success(
        config?.configured ? 'API key rotada correctamente' : 'API key configurada correctamente',
      );
      setNewKey('');
      setEditing(false);
      setShowKey(false);
      await fetchConfig();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al guardar API key';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setNewKey('');
    setEditing(false);
    setShowKey(false);
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-3 py-8 justify-center text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando configuración...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Brain className="h-5 w-5 text-muted-foreground/70 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Anthropic API Key</h2>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Esta key se forwardea a los workers en cada claim-story para que claude pueda
            llamar a la API de Anthropic. Sin esta configurada, los workers no pueden correr
            historias. Se almacena encriptada con AES-256-GCM.
          </p>
        </div>
      </div>

      {/* Estado actual */}
      <div
        className={cn(
          'rounded-md border px-4 py-3 flex items-start gap-3',
          config?.configured
            ? 'border-green-500/30 bg-green-500/5'
            : 'border-amber-500/30 bg-amber-500/5',
        )}
      >
        {config?.configured ? (
          <ShieldCheck className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0 space-y-0.5">
          {config?.configured ? (
            <>
              <p className="text-xs font-medium text-foreground">API key configurada</p>
              <p className="text-[11px] text-muted-foreground/70">
                <code className="font-mono text-foreground/80">{config.maskedKey}</code>
                {config.updatedAt && (
                  <>
                    {' · '}
                    Actualizada {new Date(config.updatedAt).toLocaleString('es-MX')}
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-foreground">Sin API key configurada</p>
              <p className="text-[11px] text-muted-foreground/70">
                Los workers actualmente no pueden procesar historias. Configura tu API key abajo.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Editor */}
      {editing ? (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">
            {config?.configured ? 'Nueva API key (rota la actual)' : 'API key'}
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                disabled={saving}
                autoFocus
                className={cn(inputClasses, 'h-9 text-xs font-mono pr-10')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                aria-label={showKey ? 'Ocultar key' : 'Mostrar key'}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !newKey.trim()}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Guardar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={saving}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50">
            ⚠️ Esta key se muestra UNA SOLA VEZ aquí mientras la pegas. Después de guardar
            no podrás verla de nuevo — solo el formato masked (sk-...XXXX). Si la pierdes
            tendrás que generar otra en console.anthropic.com y rotar.
          </p>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => setEditing(true)}
          variant={config?.configured ? 'outline' : 'default'}
          className="gap-1.5"
        >
          {config?.configured ? 'Rotar API key' : 'Configurar API key'}
        </Button>
      )}
    </div>
  );
}
