'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Streamdown } from 'streamdown';
import type { Components } from 'react-markdown';

interface ThinkingBlockProps {
  text: string;
  isActive: boolean;
}

const MAX_COLLAPSED_LENGTH = 400;

/**
 * Component overrides para el renderizado de markdown dentro del bloque de
 * thinking. Declarados a nivel de módulo (NO inline en JSX) para mantener
 * identidad estable — el `memo` interno de Streamdown compara shallowly el
 * `components` prop; si lo recreábamos en cada render, Streamdown volvía a
 * parsear el markdown entero en cada SSE delta, anulando su optimización
 * para streaming.
 *
 * Decisiones de estilo:
 *  - `not-italic` en heading/strong/code porque el contenedor padre es
 *    italic muted y queremos que esos elementos destaquen en vez de
 *    diluirse.
 *  - `ul list-none pl-0` porque el checklist del backend ya emite prefijos
 *    visuales (`✓ ⚠ ℹ`) que actúan como marcadores — los bullets nativos
 *    serían redundantes.
 *  - `h1/h2/h3` como `<div>` no `<h*>`: mantenemos el tamaño xs del padre
 *    y solo marcamos jerarquía con font-weight. Un `<h2>` nativo inflaría
 *    la tipografía y rompería el "agent-whispers" aesthetic.
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <div className="font-semibold not-italic mt-1.5 mb-0.5 text-muted-foreground">{children}</div>
  ),
  h2: ({ children }) => (
    <div className="font-semibold not-italic mt-1.5 mb-0.5 text-muted-foreground">{children}</div>
  ),
  h3: ({ children }) => (
    <div className="font-semibold not-italic mt-1 mb-0.5 text-muted-foreground/90">{children}</div>
  ),
  ul: ({ children }) => <ul className="list-none pl-0 space-y-0.5 my-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 my-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  p: ({ children }) => <p className="my-0.5 whitespace-pre-wrap">{children}</p>,
  code: ({ children }) => (
    <code className="not-italic font-mono text-[11px] bg-muted/30 px-1 rounded">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="not-italic font-mono text-[11px] bg-muted/30 p-2 rounded my-1 overflow-x-auto whitespace-pre-wrap">{children}</pre>
  ),
  strong: ({ children }) => <strong className="not-italic font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="underline hover:text-muted-foreground"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-muted/30" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted/50 pl-2 my-1">{children}</blockquote>
  ),
};

/**
 * Trunca un string respetando code points (no surrogate pairs). `String.slice`
 * opera en UTF-16 code units, así que puede cortar a mitad de un emoji o CJK
 * extendido dejando un surrogate alto huérfano. Iterar con spread expande el
 * string a code points correctamente.
 *
 * Costo: ~2x slower que .slice() pero sigue siendo <100µs para strings de
 * ~400 chars. Invisible vs el render de React.
 */
function truncateByCodePoint(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) return text;
  return codePoints.slice(0, maxChars).join('');
}

/**
 * Renderiza un bloque de "thinking" del agente con markdown streaming.
 *
 * Por qué Streamdown (y no react-markdown plano):
 * El texto llega por SSE delta-por-delta. Un parser estático renderizaría
 * estados intermedios como `## Fas` o `**bold` como literales antes de que
 * lleguen los caracteres restantes, causando flicker visible. Streamdown
 * (Vercel) trata los marcadores incompletos como si estuvieran completos
 * (`parseIncompleteMarkdown`), así el user ve heading/bold/lista formados
 * de inmediato y sin saltos visuales.
 */
export function ThinkingBlock({ text, isActive }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > MAX_COLLAPSED_LENGTH;
  // Mientras el block est\u00e1 STREAMING (`isActive=true`), siempre mostramos
  // texto completo \u2014 el user necesita ver el thinking en vivo aunque pase
  // de 400 chars. Sin esto, el texto se truncaba silenciosamente y el
  // bot\u00f3n "Mostrar m\u00e1s" no aparec\u00eda hasta que el block se cerrara,
  // dando la sensaci\u00f3n de que la generaci\u00f3n estaba "trabada".
  // Solo colapsamos cuando el block ya cerr\u00f3 (isActive=false), que es
  // cuando el bot\u00f3n "Mostrar m\u00e1s" se renderiza para expandir/colapsar.
  const displayText =
    isActive || expanded || !isLong
      ? text
      : truncateByCodePoint(text, MAX_COLLAPSED_LENGTH) + '\u2026';

  return (
    <div className="animate-[agent-slide-in_200ms_ease-out] py-1.5">
      <div className="text-xs text-muted-foreground/80 italic leading-relaxed">
        <Streamdown parseIncompleteMarkdown components={MARKDOWN_COMPONENTS}>
          {displayText}
        </Streamdown>
        {isActive && (
          <span className="inline-block w-[2px] h-3.5 bg-primary ml-0.5 -mb-0.5 animate-[agent-cursor-blink_1s_steps(2)_infinite]" />
        )}
      </div>
      {isLong && !isActive && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Mostrar menos' : 'Mostrar m\u00e1s'}
        </button>
      )}
    </div>
  );
}
