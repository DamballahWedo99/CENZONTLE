'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssistantChatEvent,
  AssistantEntityType,
  AssistantProposal,
  AssistantProposalFeedback,
  AssistantSessionSnapshot,
  AssistantTranscriptMessage,
} from '@cenzontle/shared';
import {
  destroyAssistantSession,
  getAssistantSession,
  sendProposalFeedback,
  streamAssistantTurn,
} from '@/lib/assistant-chat';

export type AssistantSegment =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool'; tool: string; label: string; summary?: string; done: boolean }
  | { kind: 'proposal'; proposalId: string };

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  segments: AssistantSegment[];
}

export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'rejected';

export interface TrackedProposal {
  proposal: AssistantProposal;
  status: ProposalStatus;
}

let nextMessageId = 0;
const newMessageId = () => `msg-${++nextMessageId}`;

/**
 * Convierte la transcript persistida (snapshot del backend) al estado del
 * hook: mensajes con segments + mapa de propuestas con su estado resuelto.
 */
function hydrateFromSnapshot(snapshot: AssistantSessionSnapshot): {
  messages: AssistantMessage[];
  proposals: Record<string, TrackedProposal>;
} {
  const proposals: Record<string, TrackedProposal> = {};
  const messages = snapshot.transcript.map((msg: AssistantTranscriptMessage): AssistantMessage => {
    const segments: AssistantSegment[] = msg.segments.map((seg): AssistantSegment => {
      switch (seg.kind) {
        case 'tool':
          return { kind: 'tool', tool: seg.tool, label: seg.label, summary: seg.summary, done: true };
        case 'proposal':
          proposals[seg.proposal.id] = {
            proposal: seg.proposal,
            status: snapshot.proposalStatuses[seg.proposal.id] ?? 'pending',
          };
          return { kind: 'proposal', proposalId: seg.proposal.id };
        default:
          return seg;
      }
    });
    return { id: newMessageId(), role: msg.role, segments };
  });
  return { messages, proposals };
}

/**
 * Estado de la conversación con el asistente editorial de UNA entidad.
 * El historial del modelo vive en el backend (sesión con TTL); aquí solo
 * vive la transcripción para la UI. El feedback de propuestas aplicadas/
 * descartadas se acumula y viaja en el siguiente turno para que el agente
 * tenga continuidad.
 */
export function useAssistantChat(entityType: AssistantEntityType, entityId: string) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [proposals, setProposals] = useState<Record<string, TrackedProposal>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingFeedbackRef = useRef<AssistantProposalFeedback[]>([]);
  /**
   * Bloquea la hidratación tardía: si el usuario ya interactuó (sendMessage o
   * reset) mientras el GET de sesión estaba en vuelo, el snapshot stale NO
   * debe pisar sessionIdRef/messages/proposals (resucitaría una conversación
   * reseteada o desviaría los turnos a una sesión vieja).
   */
  const hydrationBlockedRef = useRef(false);
  /** Serializa los POST de feedback — dos clicks rápidos no deben competir en Redis. */
  const feedbackChainRef = useRef<Promise<void>>(Promise.resolve());

  // Cleanup al desmontar la página: abortar turno en vuelo. La sesión backend
  // NO se destruye — sobrevive recargas/navegación y la rehidratamos al volver
  // (expira sola por TTL si el usuario no regresa).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Rehidratación: si el usuario tiene una sesión activa para esta entidad
  // (recargó la página o navegó y volvió), restaurar transcript + propuestas.
  useEffect(() => {
    let cancelled = false;
    hydrationBlockedRef.current = false; // entidad nueva → hidratación fresca
    setIsHydrating(true);
    getAssistantSession(entityType, entityId)
      .then((snapshot) => {
        // hydrationBlocked: el usuario ya envió un mensaje (sesión nueva en
        // sessionIdRef vía SSE) o hizo reset mientras el GET volaba — aplicar
        // el snapshot stale corrompería la conversación viva.
        if (cancelled || hydrationBlockedRef.current || !snapshot) return;
        sessionIdRef.current = snapshot.sessionId;
        const hydrated = hydrateFromSnapshot(snapshot);
        setMessages(hydrated.messages);
        setProposals(hydrated.proposals);
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  const appendToAssistant = useCallback(
    (updater: (segments: AssistantSegment[]) => AssistantSegment[]) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, segments: updater(last.segments) }];
      });
    },
    [],
  );

  const handleEvent = useCallback(
    (event: AssistantChatEvent) => {
      switch (event.type) {
        case 'session':
          sessionIdRef.current = event.sessionId;
          break;
        case 'text_delta':
          appendToAssistant((segments) => {
            const last = segments[segments.length - 1];
            if (last?.kind === 'text') {
              return [...segments.slice(0, -1), { ...last, content: last.content + event.delta }];
            }
            return [...segments, { kind: 'text', content: event.delta }];
          });
          break;
        case 'thinking_delta':
          appendToAssistant((segments) => {
            const last = segments[segments.length - 1];
            if (last?.kind === 'thinking') {
              return [...segments.slice(0, -1), { ...last, content: last.content + event.delta }];
            }
            return [...segments, { kind: 'thinking', content: event.delta }];
          });
          break;
        case 'tool_start':
          appendToAssistant((segments) => [
            ...segments,
            { kind: 'tool', tool: event.tool, label: event.label, done: false },
          ]);
          break;
        case 'tool_done':
          appendToAssistant((segments) => {
            let idx = -1;
            for (let i = segments.length - 1; i >= 0; i--) {
              const s = segments[i];
              if (s.kind === 'tool' && s.tool === event.tool && !s.done) {
                idx = i;
                break;
              }
            }
            if (idx === -1) return segments;
            const tool = segments[idx] as Extract<AssistantSegment, { kind: 'tool' }>;
            const next = [...segments];
            next[idx] = { ...tool, done: true, summary: event.summary };
            return next;
          });
          break;
        case 'proposal':
          setProposals((prev) => ({
            ...prev,
            [event.proposal.id]: { proposal: event.proposal, status: 'pending' },
          }));
          appendToAssistant((segments) => [
            ...segments,
            { kind: 'proposal', proposalId: event.proposal.id },
          ]);
          break;
        case 'error':
          setError(event.message);
          break;
        case 'done':
          break;
      }
    },
    [appendToAssistant],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || isStreaming) return;

      // El usuario interactuó: una hidratación tardía ya no debe aplicar.
      hydrationBlockedRef.current = true;
      setError(null);
      setIsStreaming(true);
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: 'user', segments: [{ kind: 'text', content: message }] },
        { id: newMessageId(), role: 'assistant', segments: [] },
      ]);

      const feedback = pendingFeedbackRef.current;
      pendingFeedbackRef.current = [];

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        for await (const event of streamAssistantTurn(entityType, entityId, {
          message,
          sessionId: sessionIdRef.current ?? undefined,
          proposalFeedback: feedback,
          signal: abort.signal,
        })) {
          handleEvent(event);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Error de conexión con el asistente');
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [entityType, entityId, handleEvent, isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    // Una hidratación en vuelo no debe resucitar la conversación destruida.
    hydrationBlockedRef.current = true;
    abortRef.current?.abort();
    if (sessionIdRef.current) void destroyAssistantSession(sessionIdRef.current);
    sessionIdRef.current = null;
    pendingFeedbackRef.current = [];
    setMessages([]);
    setProposals({});
    setError(null);
  }, []);

  /** Marca el estado de una propuesta y encola el feedback del próximo turno. */
  const markProposal = useCallback((proposalId: string, status: ProposalStatus) => {
    setProposals((prev) => {
      const tracked = prev[proposalId];
      if (!tracked) return prev;
      return { ...prev, [proposalId]: { ...tracked, status } };
    });
    if (status === 'applied' || status === 'rejected') {
      // Reemplaza feedback previo de la misma propuesta (aplicar tras descartar).
      pendingFeedbackRef.current = [
        ...pendingFeedbackRef.current.filter((f) => f.id !== proposalId),
        { id: proposalId, status },
      ];
      // Reporte inmediato al backend: el estado sobrevive recargas de página
      // aunque no haya un próximo turno. Encadenado para serializar dos
      // clicks rápidos (el endpoint hace read-modify-write sin lock — dos
      // POSTs concurrentes podrían pisarse). El body del siguiente turno
      // viaja como respaldo si algún POST falla (el server dedupea por id).
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        feedbackChainRef.current = feedbackChainRef.current.then(() =>
          sendProposalFeedback(sessionId, [{ id: proposalId, status }]),
        );
      }
    }
  }, []);

  return {
    messages,
    proposals,
    isStreaming,
    isHydrating,
    error,
    sendMessage,
    stop,
    reset,
    markProposal,
  };
}
