'use client';

import { useState, useRef, useEffect, useId, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sparkles, X, Globe, Link as LinkIcon, Wand2 } from 'lucide-react';

interface PromptInputProps {
  onSubmit: (prompt: string, webSearch: boolean) => void;
  onCancel: () => void;
  /** Valor inicial del toggle "Busqueda en internet". Default: false. */
  defaultWebSearch?: boolean;
  /**
   * Cuando true, muestra un toggle "Auto" adicional. Cuando Auto esta activo,
   * el textarea se bloquea — el agente decide el foco sin prompt manual.
   * Desactivar Auto habilita la escritura manual. Default: false (no mostrar).
   */
  showAutoToggle?: boolean;
  /** Valor inicial del toggle "Auto" cuando showAutoToggle=true. Default: true. */
  defaultAuto?: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

export function PromptInput({
  onSubmit,
  onCancel,
  defaultWebSearch = false,
  showAutoToggle = false,
  defaultAuto = true,
}: PromptInputProps) {
  const [prompt, setPrompt] = useState('');
  const [webSearch, setWebSearch] = useState(defaultWebSearch);
  const [autoMode, setAutoMode] = useState(defaultAuto);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const switchId = useId();
  const autoSwitchId = useId();

  const isAutoLocked = showAutoToggle && autoMode;

  useEffect(() => {
    // No robar foco si el textarea esta bloqueado por modo Auto.
    if (!isAutoLocked) textareaRef.current?.focus();
  }, [isAutoLocked]);

  // Extrae URLs en tiempo real del prompt. Los <textarea> nativos no soportan
  // estilos inline, así que mostramos los links como chips clickeables debajo
  // para dar feedback visual inmediato + acceso rápido al destino.
  const detectedLinks = useMemo(() => {
    const matches = prompt.match(URL_PATTERN) ?? [];
    return Array.from(new Set(matches));
  }, [prompt]);

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.02] p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          El agente considerara la iniciativa, pods disponibles y epicas existentes.
        </p>
      </div>

      <textarea
        ref={textareaRef}
        value={isAutoLocked ? '' : prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          isAutoLocked
            ? 'Modo auto activo — desactívalo para escribir instrucciones específicas'
            : 'Opcionalmente, guia al agente: foco, numero, restricciones...'
        }
        disabled={isAutoLocked}
        className={`w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30 placeholder:text-muted-foreground ${
          isAutoLocked ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        rows={2}
        maxLength={2000}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isAutoLocked) {
            e.preventDefault();
            onSubmit(prompt, webSearch);
          }
        }}
      />

      {detectedLinks.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
            Links detectados
          </span>
          {detectedLinks.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors max-w-[260px]"
              title={url}
            >
              <LinkIcon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          {showAutoToggle && (
            <div className="flex items-center gap-2">
              <Switch
                id={autoSwitchId}
                checked={autoMode}
                onCheckedChange={setAutoMode}
                aria-label="Modo auto"
              />
              <label
                htmlFor={autoSwitchId}
                className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
              >
                <Wand2 className={`h-3.5 w-3.5 transition-colors ${autoMode ? 'text-primary' : ''}`} />
                <span className={autoMode ? 'text-foreground font-medium' : ''}>Auto</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {autoMode ? '— el agente decide el foco' : '— escribe instrucciones manuales'}
                </span>
              </label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={webSearch}
              onCheckedChange={setWebSearch}
              aria-label="Habilitar búsqueda en internet"
            />
            <label
              htmlFor={switchId}
              className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
            >
              <Globe className={`h-3.5 w-3.5 transition-colors ${webSearch ? 'text-primary' : ''}`} />
              <span>Búsqueda en internet</span>
              <span className="text-[10px] text-muted-foreground/70">
                {webSearch ? '— el agente podrá investigar en la web' : '— solo tools locales (vault, código, docs)'}
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5 text-xs">
            <X className="h-3 w-3" />
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => onSubmit(isAutoLocked ? '' : prompt, webSearch)}
            className="gap-1.5 text-xs"
          >
            <Sparkles className="h-3 w-3" />
            Generar
          </Button>
        </div>
      </div>
    </div>
  );
}
