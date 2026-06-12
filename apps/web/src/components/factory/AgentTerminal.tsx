'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getAccessToken } from '@auth0/nextjs-auth0/client';
import { cn } from '@/lib/utils';
import type { FactoryAgent } from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import { X, Circle, AlertTriangle, Loader2, ArrowDown, ImagePlus, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentTerminal } from '@/hooks/use-agent-terminal';
import { useFactory } from '@/context/FactoryContext';
import {
  AgentDetailDrawer,
  deriveDod,
  deriveMilestones,
} from './AgentDetailDrawer';
import type { RunDrawerDetail } from '@/lib/api/factory';
import { ClaudeCodeTerminal } from './ClaudeCodeTerminal';
import { RunCompletedSummary } from './RunCompletedSummary';
import { MilestoneDrawer } from './MilestoneDrawer';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Raíz del repo en el host del API — solo el modo mock/legacy de este
 * componente la usa para resolver el workdir de un worktree mock. DEBE venir
 * de NEXT_PUBLIC_PROJECT_ROOT; SIN fallback hardcoded — un path absoluto de
 * una máquina concreta se filtraría al bundle público (CWE-200) y rompería
 * en cualquier otro host. Si no está, el auto-start legacy degrada con un
 * aviso en vez de arrancar `claude` en un path inválido.
 */
const PROJECT_ROOT = process.env.NEXT_PUBLIC_PROJECT_ROOT ?? '';

async function authFetch(path: string, options?: RequestInit): Promise<Response> {
  let token: string | undefined;
  try { token = await getAccessToken(); } catch { /* no token */ }
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

interface AgentTerminalProps {
  agent: FactoryAgent;
  onClose: () => void;
  /**
   * Override opcional para runs reales del backend (HITO 1.5/1.6).
   * Cuando se provee, el componente NO llama `useAgentTerminal` legacy
   * (que arrancaría una nueva sesión ttyd contra el backend dashboard).
   * En su lugar usa los valores aquí — `ttydUrl` apunta al ttyd que el
   * worker del Forge ya arrancó, y `dod`/`milestones` vienen del run real.
   *
   * Cuando `runOverride` es undefined → comportamiento legacy del agent mock.
   */
  runOverride?: {
    ttydUrl: string | null;
    /**
     * Branch del run real. Cuando el run YA terminó, el worker cerró su
     * ttyd — no hay terminal vivo. El componente entonces NO muestra un
     * spinner: si el run falló (failed/abandoned) embebe un Claude Code
     * NUEVO sobre esta branch para trabajar la deuda; si completó con
     * éxito muestra un resumen estático que también referencia la branch.
     */
    branch: string;
    dod: { text: string; done: boolean }[];
    /**
     * Combinado de acceptance criteria (`source: 'story'`) y workflow
     * milestones técnicos (`source: 'worker'`). El header renderiza dos
     * pills separadas filtrando por source: "acceptance" (primaria) y
     * "workflow" (secundaria, técnica).
     */
    milestones: { text: string; done: boolean; source: 'worker' | 'agent' | 'story' }[];
    prNumber: number | null;
    loading: boolean;
    error: string | null;
    /**
     * Datos reales del run para el AgentDetailDrawer (Identity / Context /
     * Performance). En run mode el FactoryContext mock no tiene la story ni
     * el batch reales, así que el drawer los toma de aquí.
     */
    drawer: RunDrawerDetail;
  };
}

const statusColors: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'text-muted-foreground/70',
  [AgentStatus.Coding]: 'text-blue-400',
  [AgentStatus.Testing]: 'text-amber-400',
  [AgentStatus.CreatingPR]: 'text-cyan-400',
  [AgentStatus.InReview]: 'text-cyan-400',
  [AgentStatus.Rejected]: 'text-red-400',
  [AgentStatus.Done]: 'text-green-400',
  [AgentStatus.Error]: 'text-red-400',
};

const statusLabels: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'Idle',
  [AgentStatus.Coding]: 'Coding',
  [AgentStatus.Testing]: 'Testing',
  [AgentStatus.CreatingPR]: 'Creating PR',
  [AgentStatus.InReview]: 'In Review',
  [AgentStatus.Rejected]: 'Rejected',
  [AgentStatus.Done]: 'Done',
  [AgentStatus.Error]: 'Error',
};

export function AgentTerminal({ agent, onClose, runOverride }: AgentTerminalProps) {
  // Hook legacy SIEMPRE se llama (rules of hooks) pero sus efectos se
  // anulan cuando hay runOverride: el `startSession` no se dispara, el
  // copy-mode polling no corre, y los valores expuestos se sobrescriben
  // con los del run real abajo.
  const legacyHook = useAgentTerminal(agent.id);
  const isRunMode = !!runOverride;

  // Sesión de terminal del workspace de Claude Code (un run con error abre
  // un `ClaudeCodeTerminal` embebido). El hook vive AQUÍ —no dentro de
  // `ClaudeCodeTerminal`— para que el botón de subir imagen del header pueda
  // operar sobre la MISMA sesión (lifting state up). `enabled: false`: sin
  // hidratación; el auto-start de `ClaudeCodeTerminal` la arranca. En mock
  // mode o run completado el hook se llama igual (rules of hooks) pero su
  // sesión nunca se usa.
  const runWorkspaceSessionId = `run-ws-${agent.id}`;
  const runWorkspace = useAgentTerminal(runWorkspaceSessionId, false);

  // Valores efectivos: si hay runOverride → del backend real; si no → legacy.
  const ttydUrl = isRunMode ? runOverride!.ttydUrl : legacyHook.ttydUrl;
  const sessionActive = isRunMode ? !!runOverride!.ttydUrl : legacyHook.sessionActive;

  // SEC (security-reviewer 2026-05-22, Finding 2): defensa-en-profundidad
  // contra una URL maliciosa que haya pasado la validación del backend (bug
  // futuro, race condition, valor legacy en DB pre-fix). Antes de usar como
  // `<iframe src>`, parseamos y rechazamos cualquier scheme distinto de
  // http/https. Si rechaza, `safeTtydUrl` queda null y la UI cae al
  // fallback (no se renderiza el iframe).
  const safeTtydUrl = useMemo(() => {
    if (!ttydUrl) return null;
    try {
      const u = new URL(ttydUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? ttydUrl : null;
    } catch {
      return null;
    }
  }, [ttydUrl]);
  const loading = isRunMode ? runOverride!.loading : legacyHook.loading;
  const worktreePath = isRunMode ? null : legacyHook.worktreePath;
  const startSession = isRunMode ? async () => {} : legacyHook.startSession;
  // En run mode los key-sends van a la sesión del workspace de Claude Code
  // (el `ClaudeCodeTerminal` embebido) — lo usa el upload de imagen.
  const sendKeys = isRunMode ? runWorkspace.sendKeys : legacyHook.sendKeys;
  // Id de la sesión de terminal para operaciones HTTP (upload de imagen,
  // copy-mode): en run mode el workspace de Claude Code, en mock el legacy.
  const terminalSessionId = isRunMode ? runWorkspaceSessionId : agent.id;

  // Workdir del modo mock/legacy. Un worktree mock (/worktrees/..., /forge/...)
  // no es un path real del filesystem — se sustituye por PROJECT_ROOT; un
  // worktree real pasa tal cual. El modo run real NO usa esto: su ttyd lo
  // arranca el worker (ver `if (isRunMode) return` en el auto-start).
  const needsProjectRoot =
    agent.worktree.startsWith('/worktrees/') ||
    agent.worktree.startsWith('/forge/');
  const defaultWorkdir = needsProjectRoot ? PROJECT_ROOT : agent.worktree;
  // Sin PROJECT_ROOT, un worktree mock no se puede resolver: `defaultWorkdir`
  // sería '' y `startSession` arrancaría `claude` en el CWD del API server.
  // Bloqueamos el auto-start y mostramos un aviso accionable.
  const workdirMissing = needsProjectRoot && PROJECT_ROOT.length === 0;

  // Valor efectivo del error: en modo mock, si falta PROJECT_ROOT mostramos
  // un mensaje accionable en vez de dejar al operador en un spinner infinito.
  const error = isRunMode
    ? runOverride!.error
    : workdirMissing
      ? 'Configura la variable NEXT_PUBLIC_PROJECT_ROOT para abrir la terminal de este agente.'
      : legacyHook.error;

  // Estados terminales del run real — el worker ya cerró su ttyd, así que
  // `ttydUrl` queda null. La página los trata distinto:
  //  · runFailed (status Error ← failed | abandoned): embebe un Claude Code
  //    NUEVO sobre la branch para que el operador trabaje la deuda técnica.
  //  · runCompleted (status Done ← completed): muestra un resumen estático,
  //    no hay deuda que trabajar.
  // Ambos reemplazan al spinner infinito que se mostraba antes para cualquier
  // run ya terminado.
  const runFailed = agent.status === AgentStatus.Error;
  const runCompleted = agent.status === AgentStatus.Done;
  // El botón de subir imagen solo aplica cuando hay una terminal interactiva
  // del TerminalService del dashboard donde inyectar la foto: en run mode, la
  // sesión del `ClaudeCodeTerminal` (solo un run con error la abre); en mock,
  // la sesión legacy. El ttyd del worker (run en curso) NO la acepta — esa
  // sesión la controla el worker, no este backend.
  const canUploadImage = isRunMode
    ? runFailed && !!runWorkspace.ttydUrl
    : !!ttydUrl;
  const { state } = useFactory();

  // `state.stories` se retiró del contexto (slice mock siempre vacío): el
  // lookup por storyId devolvía siempre undefined. Los milestones y el
  // drawer derivan del agent/run real.
  const story = null;
  const batch = state.factory.currentBatch;

  const [detailOpen, setDetailOpen] = useState(false);
  // Drawer de milestones — estado único `{ bar, open }`. Un solo objeto (no
  // dos useState) para que `toggleBar` haga la transición con UN updater
  // funcional atómico: nunca lee estado viejo aunque lleguen dos clicks
  // antes del re-render. `bar` nunca es null → el contenido no parpadea
  // durante la animación de cierre del Sheet. Categorías:
  //   'acceptance' = criterios de aceptación · 'workflow' = milestones del
  //   worker · 'dod' = catálogo DoD del operador (cross-cutting).
  const [drawer, setDrawer] = useState<{
    bar: 'dod' | 'acceptance' | 'workflow';
    open: boolean;
  }>({ bar: 'workflow', open: false });

  function toggleBar(bar: 'dod' | 'acceptance' | 'workflow') {
    // Click en el chip ya activo → cerrar; en otro → abrir / cambiar categoría.
    setDrawer((prev) =>
      prev.open && prev.bar === bar
        ? { bar: prev.bar, open: false }
        : { bar, open: true },
    );
  }

  // ---------------------------------------------------------------------------
  // Copy-mode polling (scroll-to-bottom button)
  // ---------------------------------------------------------------------------
  const [inCopyMode, setInCopyMode] = useState(false);

  useEffect(() => {
    if (!ttydUrl) return;
    // En modo run real, el backend no tiene endpoint de copy-mode contra
    // el agent.id — el ttyd lo arrancó el worker, no el backend dashboard.
    // Skip el polling para evitar 404 spam.
    if (isRunMode) return;
    const interval = setInterval(async () => {
      try {
        const res = await authFetch(`/api/factory/terminal/copy-mode/${agent.id}`);
        if (res.ok) {
          const data = await res.json();
          setInCopyMode(data.inCopyMode);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [ttydUrl, agent.id, isRunMode]);

  async function scrollToBottom() {
    try {
      const res = await authFetch(`/api/factory/terminal/copy-mode/${agent.id}`);
      const data = await res.json();
      if (data.inCopyMode) {
        sendKeys('q');
      }
    } catch { /* best-effort */ }
    setInCopyMode(false);
  }

  // ---------------------------------------------------------------------------
  // Image upload via file picker
  // ---------------------------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipOpen(true);
    // Auto-close after 2s to prevent it from sticking when mouse goes to iframe
    tooltipTimer.current = setTimeout(() => setTooltipOpen(false), 2000);
  }

  function hideTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipOpen(false);
  }

  const handleImageUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await authFetch(`/api/factory/terminal/upload/${terminalSessionId}`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        // Exit copy-mode only if actually in copy-mode, to avoid injecting a stray 'q'
        try {
          const cmRes = await authFetch(`/api/factory/terminal/copy-mode/${terminalSessionId}`);
          if (cmRes.ok) {
            const cm = await cmRes.json();
            if (cm.inCopyMode) {
              sendKeys('q');
              await new Promise((r) => setTimeout(r, 200));
            }
          }
        } catch { /* best-effort */ }
        sendKeys(' ' + data.filepath);
      }
    } catch {
      // Best-effort
    } finally {
      setUploading(false);
    }
  }, [terminalSessionId, sendKeys]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    handleImageUpload(file);
    // Reset after a delay so we don't trigger re-render loops
    setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Auto-start with worktree isolation
  // ---------------------------------------------------------------------------
  // Derive branch from story key (e.g. "CENZ-42" → "feat/CENZ-42")
  const agentBranch = agent.storyKey ? `feat/${agent.storyKey}` : undefined;

  useEffect(() => {
    // En modo run real, el ttyd ya está arrancado por el worker — no
    // queremos llamar al endpoint /factory/terminal/start del backend
    // dashboard porque eso arrancaría OTRO ttyd encima del que ya existe.
    if (isRunMode) return;
    // Sin PROJECT_ROOT no podemos resolver el workdir de un worktree mock —
    // no arrancamos; el render ya muestra el aviso accionable vía `error`.
    if (workdirMissing) return;
    if (!sessionActive && !loading && !ttydUrl) {
      startSession(defaultWorkdir, undefined, agentBranch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="relative overflow-hidden flex flex-col h-full bg-card">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Circle
              className={cn('h-2.5 w-2.5 fill-current shrink-0', statusColors[agent.status])}
            />
            <h3 className="text-sm font-semibold text-foreground truncate">{agent.name}</h3>
            <span
              className={cn(
                'text-xs font-medium shrink-0 rounded-full px-2 py-0.5',
                statusColors[agent.status],
                'bg-current/10',
              )}
            >
              {statusLabels[agent.status]}
            </span>
            {agent.storyKey && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {agent.storyKey}
              </span>
            )}
            {batch?.branch && (
              <a
                href={`https://github.com/DamballahWedo99/AeroDemo-App/tree/${batch.branch}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title={`Open branch ${batch.branch} on GitHub`}
              >
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>
                {batch.branch}
              </a>
            )}
            {/* DoD pill */}
            {(() => {
              // En modo run real, los criterios DoD vienen del backend
              // (HITO 2.5 cuando esté implementado, mientras tanto derivados
              // del status del run en page.tsx). En mock, derivamos del
              // status del FactoryAgent.
              const dod = isRunMode ? runOverride!.dod : deriveDod(agent);
              const dodDone = dod.filter((c) => c.done).length;
              return (
                <button
                  onClick={() => toggleBar('dod')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                    drawer.open && drawer.bar === 'dod'
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                      : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <span className="font-medium">{dodDone}/{dod.length}</span>
                  <span>DoD</span>
                </button>
              );
            })()}
            {/* Acceptance criteria pill — pill PRIMARIA en run mode */}
            {isRunMode && (() => {
              const acceptance = runOverride!.milestones.filter((c) => c.source === 'story');
              const acceptDone = acceptance.filter((c) => c.done).length;
              // Si la story no trae acceptance criteria (vault sin parsear o
              // legacy), escondemos la pill — `0/0` es UX confuso.
              if (acceptance.length === 0) return null;
              return (
                <button
                  onClick={() => toggleBar('acceptance')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                    drawer.open && drawer.bar === 'acceptance'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                  title="Criterios de aceptación de la story — marcados per-criterio por el verifier"
                >
                  <span className="font-medium">{acceptDone}/{acceptance.length}</span>
                  <span>acceptance</span>
                </button>
              );
            })()}
            {/* Workflow pill — pill SECUNDARIA (milestones técnicos del worker).
                En mock, sigue siendo "milestones" del FactoryAgent legacy. */}
            {(() => {
              const items = isRunMode
                ? runOverride!.milestones.filter((c) => c.source === 'worker')
                : deriveMilestones(story, agent);
              const doneCount = items.filter((c) => c.done).length;
              if (items.length === 0) return null;
              return (
                <button
                  onClick={() => toggleBar('workflow')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                    drawer.open && drawer.bar === 'workflow'
                      ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                      : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                  title={isRunMode ? 'Milestones técnicos del worker (clone, spawn, push, ...)' : 'Milestones'}
                >
                  <span className="font-medium">{doneCount}/{items.length}</span>
                  <span>{isRunMode ? 'workflow' : 'milestones'}</span>
                </button>
              );
            })()}
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-3">
            {/* Upload image button — also accepts drag-and-drop */}
            <TooltipProvider delayDuration={200}>
              <Tooltip open={tooltipOpen}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'h-7 w-7 p-0 text-muted-foreground hover:text-foreground transition-colors',
                      isDragging && 'ring-2 ring-blue-500 text-blue-400',
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onMouseEnter={showTooltip}
                    onMouseLeave={hideTooltip}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
                      if (file) handleImageUpload(file);
                    }}
                    disabled={uploading || !canUploadImage}
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="text-xs">
                  Upload image — click or drag & drop
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Agent detail */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDetailOpen(true)}
              title="Agent details"
            >
              <Info className="h-3.5 w-3.5" />
            </Button>

            {/* Close */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Close terminal"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/50 border-b border-red-800/40 text-xs text-red-300 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {/* Terminal */}
      {safeTtydUrl ? (
        <div className="relative flex-1 min-h-0">
          <iframe
            src={safeTtydUrl}
            className="absolute inset-0 w-full h-full border-0 bg-[#0d1117]"
            // SEC (Finding 2): sandbox del iframe. `allow-scripts` necesario
            // para xterm.js; `allow-same-origin` para el WebSocket del ttyd.
            // SIN `allow-top-navigation` ni `allow-popups` — bloquea phishing/
            // clickjacking si la URL aún así apuntase a contenido hostil.
            sandbox="allow-scripts allow-same-origin"
            allow="clipboard-read; clipboard-write"
            title={`Terminal — ${agent.name}`}
          />

          {/* Scroll to bottom */}
          {inCopyMode && (
            <button
              onClick={scrollToBottom}
              className="absolute right-4 bottom-4 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-foreground/90 text-background shadow-lg hover:bg-foreground transition-colors"
              title="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : isRunMode && runFailed ? (
        /* Run con error (failed | abandoned): el worker cerró su ttyd. En
           vez de un spinner infinito embebemos un Claude Code NUEVO sobre
           la branch del run (worktree aislado del host del API) — ahí el
           operador trabaja la deuda técnica de la story. `ClaudeCodeTerminal`
           valida internamente que la branch no esté vacía. */
        <ClaudeCodeTerminal
          terminal={runWorkspace}
          branch={runOverride!.branch}
        />
      ) : isRunMode && runCompleted ? (
        /* Run completado con éxito: no hay deuda que trabajar ni terminal
           en vivo — mostramos un resumen estático del cierre del run. */
        <RunCompletedSummary
          branch={runOverride!.branch}
          prNumber={runOverride!.prNumber}
          dod={runOverride!.dod}
        />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-[#0d1117]">
          {error ? (
            <>
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <p className="text-xs text-red-400/80 max-w-sm text-center px-4">{error}</p>
              {/* Sin PROJECT_ROOT, reintentar no cambia nada — el operador
                  debe configurar la env var. Ocultamos el Retry en ese caso. */}
              {!workdirMissing && (
                <button
                  onClick={() => startSession(defaultWorkdir, undefined, agentBranch)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Retry
                </button>
              )}
            </>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-[#484f58]" />
          )}
        </div>
      )}

      {/* Drawer de milestones — reimagina la vieja barra inferior como un
          panel lateral (Sheet) con timeline de progreso. Controlado por
          `activeBar`: los chips del header lo abren y cambian su categoría;
          funciona en cualquier estado del cuerpo (ttyd, completado, fallido)
          porque el Sheet portalea fuera del árbol del terminal. */}
      <MilestoneDrawer
        open={drawer.open}
        bar={drawer.bar}
        onOpenChange={(open) => setDrawer((prev) => ({ ...prev, open }))}
        dod={isRunMode ? runOverride!.dod : deriveDod(agent)}
        acceptance={
          isRunMode
            ? runOverride!.milestones.filter((c) => c.source === 'story')
            : []
        }
        workflow={
          isRunMode
            ? runOverride!.milestones.filter((c) => c.source === 'worker')
            : deriveMilestones(story, agent)
        }
      />

      {/* Agent detail drawer */}
      <AgentDetailDrawer
        agent={agent}
        story={story}
        batch={batch}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        worktreePath={worktreePath}
        runDetail={isRunMode ? runOverride!.drawer : null}
      />
    </div>
  );
}
