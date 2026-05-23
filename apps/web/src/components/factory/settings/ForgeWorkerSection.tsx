'use client';

import { DollarSign, RotateCw, Zap, Wrench, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FORGE_WORKER_EFFORT_DESCRIPTIONS,
  FORGE_WORKER_EFFORT_LABELS,
  FORGE_WORKER_EFFORT_LEVELS,
  FORGE_WORKER_MODELS,
  FORGE_WORKER_MODEL_LABELS,
  FORGE_WORKER_MODEL_PRICING,
  type ForgeWorkerEffortLevel,
  type ForgeWorkerModel,
} from '@cenzontle/shared';

interface ForgeWorkerSectionProps {
  // Coder agent (Forge Worker)
  model: ForgeWorkerModel;
  effort: ForgeWorkerEffortLevel;
  onModelChange: (model: ForgeWorkerModel) => void;
  onEffortChange: (effort: ForgeWorkerEffortLevel) => void;

  // DoD Verifier (reviewer agent)
  dodVerifierModel: ForgeWorkerModel;
  dodVerifierEffort: ForgeWorkerEffortLevel;
  onDodVerifierModelChange: (model: ForgeWorkerModel) => void;
  onDodVerifierEffortChange: (effort: ForgeWorkerEffortLevel) => void;

  // DoD retry loop — tope de intentos del enforcement loop del worker.
  dodMaxAttempts: number;
  onDodMaxAttemptsChange: (n: number) => void;
}

/**
 * Sección Factory · Agentes del Forge. Contiene 2 sub-secciones:
 *   1. Coder Agent — el que escribe el código (CLI claude `-p`)
 *   2. DoD Verifier — el reviewer (CLI claude `--output-format json`)
 *
 * Ambos usan el mismo set de modelos + effort levels porque ambos invocan
 * el CLI con los mismos parámetros. Los cambios aplican al próximo
 * claim-story del worker (≤30s via cache TTL).
 *
 * El estado vive en el padre (`AgentTokensSection`) que comparte el save
 * button con los demás agentes story-gen.
 */
export function ForgeWorkerSection({
  model,
  effort,
  onModelChange,
  onEffortChange,
  dodVerifierModel,
  dodVerifierEffort,
  onDodVerifierModelChange,
  onDodVerifierEffortChange,
  dodMaxAttempts,
  onDodMaxAttemptsChange,
}: ForgeWorkerSectionProps) {
  const currentPricing = FORGE_WORKER_MODEL_PRICING[model];

  return (
    <div className="space-y-8">
      {/* ═════════════════════════════════════════════════════════════════
          Sub-sección 1: Coder Agent (Forge Worker)
          ═════════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-md bg-amber-500/10 p-1.5">
            <Wrench className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">
              Coder Agent · Escribe el código
            </h4>
            <p className="text-[10px] text-muted-foreground/70">
              El agente que ejecuta los runs del Forge — escribe archivos, corre tests,
              hace commits y abre PRs.
            </p>
          </div>
        </div>

        <ModelCards
          selectedModel={model}
          selectedEffort={effort}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
          ariaLabelPrefix="Coder agent"
        />

        {/* Cost estimate inline del Coder (es la mayor parte del cost del run) */}
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2 shrink-0">
              <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <h5 className="text-xs font-semibold text-foreground">
                Coder actual: {FORGE_WORKER_MODEL_LABELS[model]} ·{' '}
                {FORGE_WORKER_EFFORT_LABELS[effort]}
              </h5>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                Cost relativo: input ${currentPricing.input}/M · output $
                {currentPricing.output}/M.
                {effort === 'high' || effort === 'xhigh' || effort === 'max' ? (
                  <>
                    {' '}
                    Extended thinking activo — esperá ~1.5-2x más tokens output que sin
                    thinking.
                  </>
                ) : (
                  <> Sin extended thinking — output normal.</>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                Estimate por story (varía según complejidad):{' '}
                {model === 'claude-haiku-4-5-20251001'
                  ? '~$1-3'
                  : model === 'claude-sonnet-4-6'
                    ? effort === 'low' || effort === 'medium'
                      ? '~$3-8'
                      : '~$15-25'
                    : effort === 'low' || effort === 'medium'
                      ? '~$15-40'
                      : '~$50-100'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════════
          Sub-sección 2: DoD Verifier (reviewer agent)
          ═════════════════════════════════════════════════════════════════ */}
      <section className="space-y-3 pt-6 border-t border-border/40">
        <div className="flex items-center gap-2.5">
          <div className="rounded-md bg-emerald-500/10 p-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">
              DoD Verifier · Revisa el trabajo del coder
            </h4>
            <p className="text-[10px] text-muted-foreground/70">
              El agente reviewer que evalúa cada criterio del Definition of Done. Hace
              checks atómicos (passed/failed). Default Haiku + bajo — para tasks complejas
              subir a Sonnet detecta bypass del coder.
            </p>
          </div>
        </div>

        <ModelCards
          selectedModel={dodVerifierModel}
          selectedEffort={dodVerifierEffort}
          onModelChange={onDodVerifierModelChange}
          onEffortChange={onDodVerifierEffortChange}
          ariaLabelPrefix="DoD verifier"
        />
      </section>

      {/* ═════════════════════════════════════════════════════════════════
          Sub-sección 3: Reintentos del DoD (enforcement loop del worker)
          ═════════════════════════════════════════════════════════════════ */}
      <section className="space-y-3 pt-6 border-t border-border/40">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 rounded-md bg-cyan-500/10 p-1.5">
            <RotateCw className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">
              Reintentos del DoD · Intentos por run
            </h4>
            <p className="text-[10px] text-muted-foreground/70">
              Máximo de intentos del enforcement loop del worker. <strong>1</strong> =
              una sola pasada, sin reintentos. Súbelo para reintentar ante errores
              duros o criterios DoD sin cumplir. La protección de <em>doom loop</em>
              (cortar el run tras 2 turnos seguidos estancado o con regresión) solo
              opera con <strong>3</strong>: con cap=2 el último attempt finaliza el
              loop antes de alcanzar el threshold.
            </p>
          </div>

          {/* Selector 1/2/3 pegado al borde derecho: `ml-auto` lo empuja al
              borde, `shrink-0` evita que se comprima si la descripción es larga. */}
          <div
            role="radiogroup"
            aria-label="Máximo de intentos del DoD"
            className="ml-auto flex shrink-0 items-center gap-1.5 pl-12"
          >
            {[1, 2, 3].map((n) => {
              const selected = dodMaxAttempts === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onDodMaxAttemptsChange(n)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors',
                    selected
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                      : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-componente reusable: lista de cards de modelo con effort inline
// ─────────────────────────────────────────────────────────────────────────

interface ModelCardsProps {
  selectedModel: ForgeWorkerModel;
  selectedEffort: ForgeWorkerEffortLevel;
  onModelChange: (model: ForgeWorkerModel) => void;
  onEffortChange: (effort: ForgeWorkerEffortLevel) => void;
  /** Prefijo para los aria-labels — distingue radio groups cuando hay 2
   *  instancias del mismo componente en la pantalla (Coder + Verifier). */
  ariaLabelPrefix: string;
}

function ModelCards({
  selectedModel,
  selectedEffort,
  onModelChange,
  onEffortChange,
  ariaLabelPrefix,
}: ModelCardsProps) {
  return (
    <div className="space-y-2">
      {FORGE_WORKER_MODELS.map((m) => {
        const isSelected = selectedModel === m;
        const pricing = FORGE_WORKER_MODEL_PRICING[m];
        const supportsThinking = m !== 'claude-haiku-4-5-20251001';
        return (
          <div
            key={m}
            className={`rounded-xl border transition-all ${
              isSelected
                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                : 'border-border hover:border-border/80'
            }`}
          >
            {/* Card outer: ROLE=button con <div> en lugar de <button> nativo
                porque dentro vamos a renderizar otros <button> (los effort
                buttons inline). HTML/React no permite button-in-button, causa
                hydration error. Manualmente implementamos a11y:
                  - role="button" + aria-pressed para semántica
                  - tabIndex=0 para focus por teclado
                  - onKeyDown captura Enter/Space (como un button real)
                  - cursor-pointer para feedback visual */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`Seleccionar modelo ${FORGE_WORKER_MODEL_LABELS[m]}`}
              onClick={() => onModelChange(m)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onModelChange(m);
                }
              }}
              className="w-full text-left p-4 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded-xl"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 transition-colors ${
                      isSelected ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h5
                        className={`text-sm font-semibold ${
                          isSelected ? 'text-foreground' : 'text-foreground/80'
                        }`}
                      >
                        {FORGE_WORKER_MODEL_LABELS[m]}
                      </h5>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">
                        {m}
                      </span>
                      {!supportsThinking && (
                        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                          Sin thinking
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground/70 flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        input ${pricing.input}/M · output ${pricing.output}/M
                      </span>
                    </p>
                  </div>
                </div>

                {/* Effort inline en el header (reemplaza al "Seleccionado"
                    badge). Solo se renderea cuando esta card está seleccionada
                    Y el modelo soporta extended thinking — Haiku queda sin
                    controles aquí porque su effort es no-op. */}
                {isSelected && supportsThinking && (
                  <div
                    role="radiogroup"
                    aria-label={`${ariaLabelPrefix} · effort level para ${FORGE_WORKER_MODEL_LABELS[m]}`}
                    className="inline-flex rounded-lg border border-border bg-background p-0.5 shrink-0 animate-in fade-in slide-in-from-right-2 duration-200"
                  >
                    {FORGE_WORKER_EFFORT_LEVELS.map((level) => {
                      const isOpus = m === 'claude-opus-4-7';
                      const isMaxOnNonOpus = level === 'max' && !isOpus;
                      const selected = selectedEffort === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={isMaxOnNonOpus}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMaxOnNonOpus) return;
                            onEffortChange(level);
                          }}
                          title={
                            isMaxOnNonOpus
                              ? `'max' solo disponible en Opus 4.6+`
                              : FORGE_WORKER_EFFORT_DESCRIPTIONS[level]
                          }
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                            selected
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : isMaxOnNonOpus
                                ? 'text-muted-foreground/30 cursor-not-allowed'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          {FORGE_WORKER_EFFORT_LABELS[level]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
