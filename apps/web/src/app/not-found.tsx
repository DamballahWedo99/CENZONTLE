"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Compass, Radio } from "lucide-react";

/**
 * 404 — "Señal Perdida"
 *
 * Reporte editorial de telemetría. El cenzontle (del Nahuatl centzontli, "400 voces")
 * es conocido por imitar más de 200 cantos — aquí su señal se perdió.
 *
 * Composición asimétrica tipo mission-control con marcas de registro de imprenta,
 * ondas de canto animadas y panel de telemetría lateral.
 */
export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();

  // Timestamp en vivo para el reporte
  const now = useClock();

  // Hash determinista a partir del pathname para el "ID de reporte"
  const reportId = pathname
    ? pathname
        .split("")
        .reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0)
        .toString(16)
        .replace("-", "")
        .slice(0, 6)
        .toUpperCase()
        .padEnd(6, "0")
    : "000000";

  return (
    <div className="relative flex min-h-[100svh] w-full flex-col overflow-hidden bg-background text-foreground select-none">
      {/* ─────────── Keyframes y animaciones locales ─────────── */}
      <style>{`
        @keyframes nf-rise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes nf-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes nf-scan {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes nf-wave {
          0%, 100% { transform: scaleY(0.3); }
          50%      { transform: scaleY(1); }
        }
        @keyframes nf-blink {
          0%, 49%    { opacity: 1; }
          50%, 100%  { opacity: 0.25; }
        }
        @keyframes nf-glitch {
          0%, 92%, 100% { transform: translate(0, 0); }
          93%           { transform: translate(-1px, 1px); }
          95%           { transform: translate(2px, -1px); }
          97%           { transform: translate(-2px, 0); }
        }
        .nf-rise  { animation: nf-rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .nf-fade  { animation: nf-fade 0.9s ease-out both; }
        .nf-glitch { animation: nf-glitch 6s steps(1, end) infinite; }
        .nf-scan-line {
          animation: nf-scan 8s linear infinite;
        }
        .nf-bar {
          transform-origin: center;
          animation: nf-wave 1.4s ease-in-out infinite;
        }
        .nf-dot-blink {
          animation: nf-blink 1.2s ease-in-out infinite;
        }
      `}</style>

      {/* ─────────── Capa 1: grano SVG sutil ─────────── */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.035] mix-blend-overlay"
      >
        <filter id="nf-noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#nf-noise)" />
      </svg>

      {/* ─────────── Capa 2: rejilla de fondo ─────────── */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      {/* ─────────── Capa 3: glow radial del centro ─────────── */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, var(--primary) 0%, transparent 60%)",
          opacity: 0.12,
        }}
      />

      {/* ─────────── Capa 4: línea de scan CRT ─────────── */}
      <div
        aria-hidden="true"
        className="nf-scan-line pointer-events-none absolute inset-x-0 h-[2px] opacity-[0.04] dark:opacity-[0.08]"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--primary) 50%, transparent)",
        }}
      />

      {/* ─────────── Marcas de registro (corner ticks) ─────────── */}
      <CornerMark className="top-6 left-6" />
      <CornerMark className="top-6 right-6" />
      <CornerMark className="bottom-6 left-6" />
      <CornerMark className="bottom-6 right-6" />

      {/* ─────────── Header: badge de estado + timestamp ─────────── */}
      <header
        className="nf-fade relative z-10 flex items-start justify-between gap-4 px-8 pt-10 sm:px-14 sm:pt-12"
        style={{ animationDelay: "0ms" }}
      >
        <div className="flex items-center gap-2.5 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive/60 nf-dot-blink" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
          </span>
          <span>SEÑAL · PERDIDA</span>
        </div>

        <div className="hidden font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground sm:block">
          CENZONTLE · FIELD REPORT
        </div>

        <div className="font-mono text-[10px] tabular-nums tracking-[0.18em] uppercase text-muted-foreground">
          {now}
        </div>
      </header>

      {/* ─────────── Contenido principal ─────────── */}
      <main className="relative z-10 flex flex-1 items-center px-8 sm:px-14">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-14 lg:grid-cols-[1.35fr_1fr] lg:gap-20">
          {/* ───── Columna izquierda: 404 masivo + copy + CTAs ───── */}
          <div className="flex flex-col gap-10">
            {/* Etiqueta de sección */}
            <div
              className="nf-fade flex items-center gap-3 font-mono text-[11px] tracking-[0.25em] uppercase text-muted-foreground"
              style={{ animationDelay: "80ms" }}
            >
              <span className="h-px w-8 bg-muted-foreground/40" />
              <span>Error · 404</span>
            </div>

            {/* 404 masivo con capa glitch */}
            <div
              className="nf-rise relative"
              style={{ animationDelay: "160ms" }}
            >
              <h1 className="font-mono text-[clamp(7rem,22vw,18rem)] font-bold leading-[0.82] tracking-[-0.06em] text-foreground">
                <span className="nf-glitch inline-block">4</span>
                <span
                  className="inline-block bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(180deg, var(--primary), var(--chart-2))",
                  }}
                >
                  0
                </span>
                <span className="nf-glitch inline-block" style={{ animationDelay: "3s" }}>
                  4
                </span>
              </h1>
              {/* Línea descriptor bajo el número */}
              <div
                className="mt-1 flex items-baseline gap-3 font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground/70"
              >
                <span className="h-px flex-1 bg-gradient-to-r from-muted-foreground/40 to-transparent" />
                <span>recurso no encontrado en esta ruta</span>
              </div>
            </div>

            {/* Copy */}
            <div
              className="nf-rise flex max-w-xl flex-col gap-4"
              style={{ animationDelay: "240ms" }}
            >
              <h2 className="font-sans text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                El cenzontle se quedó sin canto aquí.
              </h2>
              <p className="font-sans text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                Intentaste acceder a un recurso que no existe, fue movido, o
                nunca llegó a formar parte del repertorio. Desde aquí puedes
                regresar al punto anterior o volver al inicio de la plataforma.
              </p>
            </div>

            {/* Acciones */}
            <div
              className="nf-rise flex flex-wrap items-center gap-3"
              style={{ animationDelay: "320ms" }}
            >
              <Button
                variant="outline"
                size="lg"
                onClick={() => router.back()}
                className="group font-mono text-[11px] tracking-[0.18em] uppercase"
              >
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
                Ruta anterior
              </Button>
              <Button
                variant="default"
                size="lg"
                asChild
                className="group font-mono text-[11px] tracking-[0.18em] uppercase"
              >
                <Link href="/proyectos">
                  <Compass className="size-4 transition-transform group-hover:rotate-45" />
                  Ir al dashboard
                </Link>
              </Button>
            </div>
          </div>

          {/* ───── Columna derecha: panel de telemetría ───── */}
          <aside
            className="nf-rise relative hidden lg:block"
            style={{ animationDelay: "400ms" }}
          >
            <div className="relative rounded-lg border border-border/60 bg-card/30 p-6 backdrop-blur-sm">
              {/* Etiqueta de panel */}
              <div className="mb-5 flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                  <Radio className="size-3" />
                  <span>Telemetría</span>
                </div>
                <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60">
                  RPT · {reportId}
                </span>
              </div>

              {/* Entradas de telemetría */}
              <dl className="flex flex-col gap-3.5">
                <TelemetryRow label="Estado" value="SEÑAL PERDIDA" accent />
                <TelemetryRow label="Código" value="HTTP · 404" />
                <TelemetryRow
                  label="Ruta"
                  value={pathname || "/"}
                  truncate
                />
                <TelemetryRow label="Coordenadas" value="—— · ——" />
                <TelemetryRow label="Cantos restaurados" value="0 / 200+" />
                <TelemetryRow label="Último contacto" value={now} mono />
              </dl>

              {/* Ondas de sonido — el canto del cenzontle */}
              <div className="mt-6 border-t border-border/40 pt-5">
                <div className="mb-3 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                  Espectro de canto
                </div>
                <div className="flex h-10 items-center justify-between gap-[3px]">
                  {WAVE_HEIGHTS.map((h, i) => (
                    <span
                      key={i}
                      className="nf-bar block w-[3px] rounded-full bg-gradient-to-t from-primary/30 to-chart-2"
                      style={{
                        height: `${h}%`,
                        animationDelay: `${i * 70}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ─────────── Footer ─────────── */}
      <footer
        className="nf-fade relative z-10 flex items-center justify-between gap-4 px-8 pb-10 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground/60 sm:px-14 sm:pb-12"
        style={{ animationDelay: "520ms" }}
      >
        <span>CENZONTLE · SOFTWARE FACTORY</span>
        <span className="hidden sm:inline">
          centzontli · 400 voces · 200+ cantos
        </span>
        <span>v.404</span>
      </footer>
    </div>
  );
}

/* ─────────────── Reloj ─────────────── */

/** Placeholder del timestamp: es lo que se pinta en SSR y durante la
 *  hidratación (el reloj del servidor no coincidiría con el del cliente). */
const CLOCK_PLACEHOLDER = "——:——:——";

function formatClock(): string {
  return new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * El reloj es un sistema externo a React, así que se lee con
 * `useSyncExternalStore` en vez de sincronizarlo a state desde un effect:
 * el snapshot lo escribe únicamente el tick del interval (y la suscripción
 * inicial, para no esperar un segundo al primer valor).
 */
function useClock(): string {
  const clockRef = useRef(CLOCK_PLACEHOLDER);

  const subscribe = useCallback((onStoreChange: () => void) => {
    const tick = () => {
      const next = formatClock();
      if (next !== clockRef.current) {
        clockRef.current = next;
        onStoreChange();
      }
    };
    tick(); // primer valor apenas monta, igual que antes
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => clockRef.current,
    () => CLOCK_PLACEHOLDER,
  );
}

/* ─────────────── Subcomponentes ─────────────── */

function CornerMark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute text-muted-foreground/40 ${className ?? ""}`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 2V16M2 9H16"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function TelemetryRow({
  label,
  value,
  accent = false,
  mono = false,
  truncate = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[11px]">
      <dt className="shrink-0 font-mono tracking-[0.18em] uppercase text-muted-foreground/70">
        {label}
      </dt>
      <dd
        className={[
          "min-w-0 font-mono tabular-nums tracking-[0.08em]",
          truncate ? "truncate" : "",
          mono ? "text-foreground/90" : "",
          accent ? "text-destructive" : "text-foreground",
        ].join(" ")}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

/* Alturas del espectro de canto (porcentajes). Patrón semi-aleatorio
 * pero determinista para que el render sea consistente en SSR. */
const WAVE_HEIGHTS = [
  35, 55, 75, 90, 65, 45, 30, 55, 80, 70, 50, 65, 85, 95, 70, 45, 30, 50, 75,
  90, 80, 60, 40, 55, 70, 85, 75, 55, 35, 45, 65, 80,
];
