"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[80vh] px-6 overflow-hidden select-none">
      {/* Background grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Radial glow behind the number */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[100px]" />

      {/* Floating particles */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[20%] left-[15%] w-1 h-1 rounded-full bg-primary/30 animate-pulse" />
        <div className="absolute top-[35%] right-[20%] w-1.5 h-1.5 rounded-full bg-accent/25 animate-pulse [animation-delay:1s]" />
        <div className="absolute bottom-[30%] left-[25%] w-1 h-1 rounded-full bg-primary/20 animate-pulse [animation-delay:0.5s]" />
        <div className="absolute top-[60%] right-[30%] w-0.5 h-0.5 rounded-full bg-accent/30 animate-pulse [animation-delay:1.5s]" />
        <div className="absolute top-[15%] right-[40%] w-1 h-1 rounded-full bg-primary/15 animate-pulse [animation-delay:2s]" />
        <div className="absolute bottom-[20%] right-[15%] w-1 h-1 rounded-full bg-accent/20 animate-pulse [animation-delay:0.8s]" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center text-center gap-8">
        {/* 404 number — large typographic statement */}
        <div className="relative">
          <span className="text-[10rem] sm:text-[14rem] font-bold leading-none tracking-tighter text-foreground/[0.04] font-mono block">
            404
          </span>
          {/* Overlay with gradient text */}
          <span
            className="absolute inset-0 text-[10rem] sm:text-[14rem] font-bold leading-none tracking-tighter font-mono bg-clip-text text-transparent block"
            style={{
              backgroundImage:
                "linear-gradient(135deg, var(--primary), var(--chart-2))",
            }}
            aria-hidden="true"
          >
            404
          </span>
        </div>

        {/* Divider line */}
        <div
          className="w-24 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent, var(--primary), var(--chart-2), transparent)",
          }}
        />

        {/* Copy */}
        <div className="flex flex-col gap-3 max-w-md">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            Página no encontrada
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            El cenzontle exploró este camino, pero no encontró nada aquí.
            <br />
            Puede que la ruta haya cambiado o no exista.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-2">
          <Button
            variant="outline"
            size="default"
            onClick={() => router.back()}
          >
            <ArrowLeft className="size-4" />
            Volver
          </Button>
          <Button variant="default" size="default" asChild>
            <Link href="/proyectos">
              <Home className="size-4" />
              Ir al inicio
            </Link>
          </Button>
        </div>

        {/* Subtle path hint */}
        <p className="text-muted-foreground/50 text-xs font-mono mt-4">
          Error 404 — recurso no disponible
        </p>
      </div>
    </div>
  );
}
