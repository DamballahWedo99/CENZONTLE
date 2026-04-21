'use client';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { DefinicionNode } from '@/types/definiciones';
import { Network, Maximize2, Focus, ExternalLink, Save, RotateCcw, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: 'folder' | 'document';
  tags: string[];
  linkCount: number;
  parentFolder?: string;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  type: 'tag' | 'folder';
  label?: string;
}

interface ForceSettings {
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
  nodeSize: number;
}

const DEFAULT_FORCES: ForceSettings = {
  centerStrength: 0.04,
  repelStrength: -300,
  linkStrength: 0.2,
  linkDistance: 100,
  nodeSize: 1,
};

/**
 * localStorage key para persistir configuracion de fuerzas del grafo.
 * Versionado por si el shape de ForceSettings cambia en el futuro — al
 * bumpear la version se ignoran valores viejos y se usan los defaults.
 */
const FORCES_STORAGE_KEY = 'definiciones:graph-forces:v1';

function loadForcesFromStorage(): ForceSettings {
  if (typeof window === 'undefined') return DEFAULT_FORCES;
  try {
    const raw = window.localStorage.getItem(FORCES_STORAGE_KEY);
    if (!raw) return DEFAULT_FORCES;
    const parsed = JSON.parse(raw) as Partial<ForceSettings>;
    return {
      centerStrength: typeof parsed.centerStrength === 'number' ? parsed.centerStrength : DEFAULT_FORCES.centerStrength,
      repelStrength: typeof parsed.repelStrength === 'number' ? parsed.repelStrength : DEFAULT_FORCES.repelStrength,
      linkStrength: typeof parsed.linkStrength === 'number' ? parsed.linkStrength : DEFAULT_FORCES.linkStrength,
      linkDistance: typeof parsed.linkDistance === 'number' ? parsed.linkDistance : DEFAULT_FORCES.linkDistance,
      nodeSize: typeof parsed.nodeSize === 'number' ? parsed.nodeSize : DEFAULT_FORCES.nodeSize,
    };
  } catch {
    return DEFAULT_FORCES;
  }
}

function saveForcesToStorage(forces: ForceSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FORCES_STORAGE_KEY, JSON.stringify(forces));
  } catch {
    /* ignore — quota exceeded o disabled */
  }
}

function extractGraphData(tree: DefinicionNode[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const tagMap = new Map<string, string[]>();
  const createdTagLinks = new Set<string>();

  function traverse(items: DefinicionNode[], parent?: string) {
    for (const item of items) {
      if (item.type === 'document') {
        nodes.push({
          id: item.id,
          name: item.name,
          type: 'document',
          tags: item.tags || [],
          linkCount: 0,
          parentFolder: parent,
        });

        for (const tag of item.tags || []) {
          if (!tagMap.has(tag)) tagMap.set(tag, []);
          tagMap.get(tag)!.push(item.id);
        }
      } else if (item.type === 'folder') {
        nodes.push({
          id: item.id,
          name: item.name,
          type: 'folder',
          tags: [],
          linkCount: 0,
          parentFolder: parent,
        });

        if (item.children) {
          for (const child of item.children) {
            links.push({ source: item.id, target: child.id, type: 'folder' });
          }
          traverse(item.children, item.id);
        }
      }
    }
  }

  traverse(tree);

  // Create tag-based links between documents sharing tags (skip overly common tags)
  for (const [tag, docIds] of tagMap) {
    if (docIds.length > 5) continue;
    for (let i = 0; i < docIds.length; i++) {
      for (let j = i + 1; j < docIds.length; j++) {
        const key = `${docIds[i]}::${docIds[j]}`;
        if (!createdTagLinks.has(key)) {
          createdTagLinks.add(key);
          links.push({ source: docIds[i], target: docIds[j], type: 'tag', label: tag });
        }
      }
    }
  }

  // Count links per node
  for (const link of links) {
    const sourceId = link.source as string;
    const targetId = link.target as string;
    const sourceNode = nodes.find(n => n.id === sourceId);
    const targetNode = nodes.find(n => n.id === targetId);
    if (sourceNode) sourceNode.linkCount++;
    if (targetNode) targetNode.linkCount++;
  }

  return { nodes, links };
}

const NODE_COLORS = {
  folder: { fill: '#2563eb', stroke: '#1d4ed8' },
  document: { fill: '#06b6d4', stroke: '#0891b2' },
  highlighted: { fill: '#f59e0b', stroke: '#d97706' },
};

export function GraphView({ showForceControls = false, onNavigateToNode }: { showForceControls?: boolean; onNavigateToNode?: (nodeId: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const dimensionsRef = useRef({ width: 800, height: 600 });
  const forcesRef = useRef<ForceSettings>(DEFAULT_FORCES);
  // Flag que marca si ya hidratamos `forces` desde localStorage. El main D3
  // useEffect NO crea la simulacion hasta que isHydrated sea true. Esto
  // garantiza que la sim se cree UNA SOLA VEZ con los valores correctos,
  // en lugar de crearse con defaults + reactualizarse con stored (lo cual
  // causaba que los nodos arrancaran con layout de defaults y no alcanzaran
  // a reorganizarse visualmente).
  const [isHydrated, setIsHydrated] = useState(false);
  // Refs para detectar si nodes/links cambiaron semanticamente (por IDs),
  // no solo por referencia.
  const prevNodeIdsRef = useRef<string>('');
  const prevLinkIdsRef = useRef<string>('');
  // True solo cuando el user mueve sliders o dispara reset; false durante
  // hidratacion inicial y mount. Los useEffects de resize y update-forces
  // usan esto como guard para no hacer alpha().restart() parasitos que
  // interrumpirian la convergencia del main D3 useEffect (Issue #94 +
  // stacking de restarts interrumpe la fase de convergencia inicial).
  const hasUserInteractedRef = useRef(false);
  const { state, selectNode, filteredTree } = useDefiniciones();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  // Forces arranca con DEFAULT_FORCES — NO leemos localStorage en el
  // initializer del useState porque en SSR de Next.js (aun en 'use client')
  // el initializer corre en el server con window=undefined, retorna
  // DEFAULT_FORCES, y el cliente hidrata con ese valor sin re-ejecutar.
  // La carga real viene en un useEffect post-mount (ver hydration effect
  // abajo) que garantiza acceso a window y dispara el update correcto.
  const [forces, setForces] = useState<ForceSettings>(DEFAULT_FORCES);
  // Flash de confirmacion cuando el user guarda — el boton muestra el check
  // por 1.5 seg antes de volver al icono de Save.
  const [justSaved, setJustSaved] = useState(false);

  // Hydration: lee localStorage al mount en el cliente y actualiza `forces` +
  // marca isHydrated=true. Solo despues de esto el main D3 useEffect creara
  // la simulacion (ver check `if (!isHydrated) return` al inicio del main
  // useEffect). Esto garantiza que la sim se cree UNA sola vez con los
  // valores correctos, sin defaults intermedios que perturben la
  // convergencia visual.
  useEffect(() => {
    const stored = loadForcesFromStorage();
    forcesRef.current = stored;
    setForces(stored);
    setIsHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  dimensionsRef.current = dimensions;
  forcesRef.current = forces;

  const allGraphData = useMemo(() => extractGraphData(filteredTree), [filteredTree]);

  // Filter to local graph when a node is focused
  const { nodes, links } = useMemo(() => {
    if (!focusedNodeId) return allGraphData;

    const connectedIds = new Set<string>();
    connectedIds.add(focusedNodeId);

    // Collect all directly connected node IDs (depth 1)
    for (const link of allGraphData.links) {
      const srcId = link.source as string;
      const tgtId = link.target as string;
      if (srcId === focusedNodeId) connectedIds.add(tgtId);
      if (tgtId === focusedNodeId) connectedIds.add(srcId);
    }

    // Also collect depth 2 — neighbors of neighbors
    const depth1Ids = new Set(connectedIds);
    for (const link of allGraphData.links) {
      const srcId = link.source as string;
      const tgtId = link.target as string;
      if (depth1Ids.has(srcId)) connectedIds.add(tgtId);
      if (depth1Ids.has(tgtId)) connectedIds.add(srcId);
    }

    const nodes = allGraphData.nodes.filter(n => connectedIds.has(n.id));
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = allGraphData.links.filter(l => {
      const srcId = l.source as string;
      const tgtId = l.target as string;
      return nodeIds.has(srcId) && nodeIds.has(tgtId);
    });

    return { nodes, links };
  }, [allGraphData, focusedNodeId]);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(entries => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }, 100);
    });
    observer.observe(container);
    return () => { observer.disconnect(); clearTimeout(resizeTimer); };
  }, []);

  // Main D3 render — only depends on data (not dimensions)
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const { width, height } = dimensionsRef.current;

    // BLOQUEO hasta hydration: el hydration useEffect lee localStorage y
    // setea forces + isHydrated. Hasta entonces no creamos la sim para que
    // la PRIMERA creacion use los valores persistidos (no DEFAULT_FORCES).
    if (!isHydrated) return;

    // Early return si nodes/links no cambiaron semanticamente (solo ref).
    // Esto evita re-crear la sim y perder el layout convergido cuando el
    // arbol del vault se re-fetcha pero los IDs son los mismos.
    const newNodeIds = nodes.map((n) => n.id).sort().join('|');
    const newLinkIds = links
      .map((l) => {
        const s = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
        const t = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
        return `${s}->${t}`;
      })
      .sort()
      .join('|');
    if (
      simulationRef.current &&
      prevNodeIdsRef.current === newNodeIds &&
      prevLinkIdsRef.current === newLinkIds
    ) {
      return;
    }
    prevNodeIdsRef.current = newNodeIds;
    prevLinkIdsRef.current = newLinkIds;

    const currentForces = forces;

    simulationRef.current?.stop();
    svg.selectAll('*').remove();

    // Empty state
    if (nodes.length === 0) return;

    // Background rect transparente que cubre todo el SVG. Captura eventos de
    // pan (mousedown+drag en espacios vacios) + zoom (wheel). Sin este rect,
    // D3 zoom solo recibe eventos cuando el mouse esta sobre un nodo, y los
    // `d3.drag` de los nodos tienen precedencia — resultado: solo podias
    // mover nodos individuales, nunca hacer pan del canvas (como Figma).
    //
    // Con fill='transparent' el rect es invisible pero intercepta pointer
    // events. pointer-events='all' asegura que capte incluso cuando no tiene
    // fill real (quirk de SVG).
    svg.append('rect')
      .attr('class', 'pan-background')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .style('cursor', 'grab');

    const g = svg.append('g').attr('opacity', 0);
    g.transition().duration(300).attr('opacity', 1);

    // Zoom + pan behavior estilo Figma/ReactFlow/Excalidraw.
    //
    // Regla: wheel sin modifier = PAN horizontal/vertical. Con Cmd/Ctrl = ZOOM.
    // Es exactamente como se comporta el DiagramViewer de epicas (ReactFlow
    // con props `panOnScroll` + `zoomOnScroll={false}`). d3.zoom por default
    // hace wheel→zoom, invertir el mapping requiere:
    //   1. `filter()` rechaza wheel events SIN modifier (no llegan a d3.zoom).
    //   2. `wheel.pan` listener los intercepta y hace translateBy manual.
    //   3. `filter()` acepta wheel events CON modifier → d3.zoom zoomea.
    // Drag (click en espacio vacio) sigue haciendo pan como siempre.
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .filter((event: Event) => {
        // Rechazar right-click (button 2) siempre.
        if ('button' in event && (event as MouseEvent).button !== 0 && event.type !== 'wheel') return false;
        // Wheel: solo con modifier (zoom). Sin modifier lo maneja wheel.pan.
        if (event.type === 'wheel') {
          const we = event as WheelEvent;
          return we.ctrlKey || we.metaKey;
        }
        return true;
      })
      .on('start', () => {
        svg.select('.pan-background').style('cursor', 'grabbing');
      })
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      })
      .on('end', () => {
        svg.select('.pan-background').style('cursor', 'grab');
      });

    svg.call(zoom as unknown as (selection: typeof svg) => void);

    // Pan-on-scroll: sin Cmd/Ctrl, el wheel mueve el canvas (no zoomea).
    // translateBy trabaja en unidades del viewport — el deltaX/deltaY del
    // trackpad ya vienen en esas unidades. Negamos porque un scroll "hacia
    // abajo" significa "el contenido sube" (como en cualquier scroll normal).
    svg.on('wheel.pan', (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      zoom.translateBy(svg as never, -event.deltaX, -event.deltaY);
    });

    // Deep copy nodes/links for D3 mutation. CRITICAL: explicitamente
    // limpiar fx/fy de los nodos. Si quedaron seteados de una sesion
    // anterior (por drag del user con "Obsidian pinning"), los nodos
    // estarian FIJADOS y no se reorganizarian con las nuevas fuerzas —
    // sintoma exacto del bug que el user reporto (ver Issue #94 d3-force).
    const simNodes: GraphNode[] = nodes.map(n => {
      const copy = { ...n };
      // Borrar posiciones fijas si existen — forzar fresh layout con los
      // nuevos force parameters.
      delete (copy as Partial<d3.SimulationNodeDatum>).fx;
      delete (copy as Partial<d3.SimulationNodeDatum>).fy;
      delete (copy as Partial<d3.SimulationNodeDatum>).x;
      delete (copy as Partial<d3.SimulationNodeDatum>).y;
      delete (copy as Partial<d3.SimulationNodeDatum>).vx;
      delete (copy as Partial<d3.SimulationNodeDatum>).vy;
      return copy;
    });
    const simLinks: GraphLink[] = links.map(l => ({ ...l, source: l.source as string, target: l.target as string }));

    // Force simulation.
    //
    // IMPORTANTE: `forceCollide.radius` se calcula dinamicamente en funcion
    // de `linkDistance` para evitar el conflicto fisico descrito en la doc
    // de d3-force: collide es un separador DURO que garantiza
    // `dist(a,b) >= radius(a)+radius(b)`. Con nodos de radio base ~10-20px,
    // `r+4` obliga a >= 48px minimo entre pares — imposible con
    // linkDistance=30.
    //
    // Solucion: tope el radio de colision a `linkDistance * 0.35` para que
    // linkDistance pequenios (cluster compacto) realmente produzcan nodos
    // cercanos. linkDistance grande no aplica tope porque `baseRadius+4`
    // lo cumple naturalmente.
    const collideRadius = (d: GraphNode): number => {
      const baseRadius = getNodeRadius(d, currentForces.nodeSize) + 4;
      const distanceCap = currentForces.linkDistance * 0.35;
      return Math.min(baseRadius, distanceCap);
    };

    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force('center', d3.forceCenter(width / 2, height / 2).strength(currentForces.centerStrength))
      .force('charge', d3.forceManyBody().strength(currentForces.repelStrength).distanceMax(350))
      .force('link', d3.forceLink<GraphNode, GraphLink>(simLinks).id(d => d.id).strength(currentForces.linkStrength).distance(currentForces.linkDistance))
      .force('collision', d3.forceCollide<GraphNode>().radius(collideRadius).iterations(2))
      .alphaDecay(0.02);

    simulationRef.current = simulation;

    // Issue #94 de d3-force: con params distintos de los defaults anteriores
    // de la sim, alpha bajo no alcanza a reorganizar. alpha(1).restart()
    // fuerza convergencia completa desde positions random (limpiadas arriba).
    simulation.alpha(1).restart();

    // Draw links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', d => d.type === 'tag' ? '#f59e0b55' : '#2563eb55')
      .attr('stroke-width', d => d.type === 'tag' ? 1 : 1.5)
      .attr('stroke-dasharray', d => d.type === 'tag' ? '4,3' : 'none');

    // Draw nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            draggingRef.current = true;
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            draggingRef.current = false;
            if (!event.active) simulation.alphaTarget(0);
            // Keep node pinned where dropped (Obsidian behavior)
            // d.fx and d.fy remain set
          }),
      );

    // Node circles
    node.append('circle')
      .attr('r', d => getNodeRadius(d, currentForces.nodeSize))
      .attr('fill', d => d.type === 'folder' ? NODE_COLORS.folder.fill : NODE_COLORS.document.fill)
      .attr('stroke', d => d.type === 'folder' ? NODE_COLORS.folder.stroke : NODE_COLORS.document.stroke)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.9);

    // Node labels
    node.append('text')
      .text(d => d.name.length > 20 ? d.name.slice(0, 18) + '…' : d.name)
      .attr('x', 0)
      .attr('y', d => getNodeRadius(d, currentForces.nodeSize) + 16)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.6)
      .attr('pointer-events', 'none');

    // Double-click to unpin node
    node.on('dblclick', (event, d) => {
      event.stopPropagation();
      d.fx = null;
      d.fy = null;
      simulation.alpha(0.3).restart();
    });

    // Hover interactions (guarded against drag)
    node
      .on('mouseenter', (event, d) => {
        if (draggingRef.current) return;
        setHoveredNode(d.id);

        const connectedIds = new Set<string>();
        connectedIds.add(d.id);
        simLinks.forEach(l => {
          const srcId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
          const tgtId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
          if (srcId === d.id) connectedIds.add(tgtId as string);
          if (tgtId === d.id) connectedIds.add(srcId as string);
        });

        node.select('circle')
          .transition().duration(150)
          .attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.15);
        node.select('text')
          .transition().duration(150)
          .attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.1);
        link
          .transition().duration(150)
          .attr('stroke-opacity', l => {
            const srcId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
            const tgtId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
            return srcId === d.id || tgtId === d.id ? 1 : 0.05;
          })
          .attr('stroke-width', l => {
            const srcId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
            const tgtId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
            return srcId === d.id || tgtId === d.id ? 2.5 : (l.type === 'tag' ? 1 : 1.5);
          });

        d3.select(event.currentTarget).select('circle')
          .transition().duration(150)
          .attr('r', getNodeRadius(d, forcesRef.current.nodeSize) * 1.3)
          .attr('fill', NODE_COLORS.highlighted.fill)
          .attr('stroke', NODE_COLORS.highlighted.stroke);
      })
      .on('mouseleave', () => {
        if (draggingRef.current) return;
        setHoveredNode(null);

        node.select('circle')
          .transition().duration(300)
          .attr('opacity', 0.9)
          .attr('r', n => getNodeRadius(n, forcesRef.current.nodeSize))
          .attr('fill', n => n.type === 'folder' ? NODE_COLORS.folder.fill : NODE_COLORS.document.fill)
          .attr('stroke', n => n.type === 'folder' ? NODE_COLORS.folder.stroke : NODE_COLORS.document.stroke);
        node.select('text')
          .transition().duration(300)
          .attr('opacity', 0.8);
        link
          .transition().duration(300)
          .attr('stroke-opacity', 1)
          .attr('stroke-width', l => l.type === 'tag' ? 1 : 1.5);
      })
      .on('click', (_event, d) => {
        selectNode(d.id);
        setFocusedNodeId(d.id);
      });

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // AUTO-FIT ZOOM DESACTIVADO:
    // El auto-fit calcula el bounding box del grafo y escala el zoom para
    // que llene el viewport. Esto OCULTABA las diferencias de layout entre
    // configs de fuerzas distintas — si las fuerzas hacian los nodos mas
    // compactos, el zoom in compensaba; si mas dispersos, zoom out. Net:
    // el grafo se veia "igual" visualmente, aunque las fuerzas SI se
    // aplicaban correctamente.
    //
    // El user tiene pan+zoom manual (tipo Figma) para ajustar viewport.
    // Con scale=1 como default, las diferencias de fuerzas son visibles
    // naturalmente — el grafo compacto se ve chico en el centro, el
    // disperso se extiende mas alla del viewport.
    //
    // Si en el futuro se quisiera un auto-fit opcional, debe ser
    // triggered manualmente (boton "Centrar") no auto.
    const zoomTimer = setTimeout(() => {
      // Centra el grafo en el viewport con scale=1 (no escala).
      svg.transition().duration(500).call(
        zoom.transform as unknown as (transition: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
        d3.zoomIdentity.translate(width / 2, height / 2).scale(1),
      );
    }, 800);

    return () => {
      simulation.stop();
      simulationRef.current = null;
      clearTimeout(zoomTimer);
      svg.on('.zoom', null);
      svg.on('wheel.pan', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, isHydrated]);


  // Handle resize without recreating the simulation.
  //
  // GUARD: al mount, ResizeObserver dispara cuando el contenedor recibe sus
  // dimensiones reales. Si re-kickeamos alpha aqui (0.1), INTERRUMPIMOS la
  // convergencia del main D3 (alpha=1). Solo ajustamos el SVG width/height
  // en ese caso. Una vez que el user interactuo, ya podemos aplicar el
  // kick por resize porque la sim ya convergio.
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.attr('width', dimensions.width).attr('height', dimensions.height);

    if (!hasUserInteractedRef.current) return;

    const sim = simulationRef.current;
    if (sim) {
      sim.force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2).strength(forcesRef.current.centerStrength));
      sim.alpha(0.1).restart();
    }
  }, [dimensions]);

  // Update forces imperatively — reacciona a cambios de sliders del user.
  //
  // GUARD: skip durante la hidratacion inicial. El main D3 useEffect ya
  // crea la sim con `forces=stored` y hace `alpha(1).restart()`. Si este
  // useEffect tambien corre al post-hydration render (porque `forces`
  // cambio de DEFAULT a stored), su `alpha(0.5).restart()` INTERRUMPE la
  // convergencia antes de que termine, dejando el layout semi-convergido.
  // Solo aplicamos cambios cuando el user mueve sliders manualmente.
  useEffect(() => {
    if (!isHydrated) return;
    if (!hasUserInteractedRef.current) return;
    const sim = simulationRef.current;
    if (!sim) return;
    sim.force('center', d3.forceCenter(dimensionsRef.current.width / 2, dimensionsRef.current.height / 2).strength(forces.centerStrength));
    sim.force('charge', d3.forceManyBody().strength(forces.repelStrength).distanceMax(350));
    (sim.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      ?.strength(forces.linkStrength)
      .distance(forces.linkDistance);
    // Actualizar collide radius con linkDistance nuevo (mismo algoritmo que
    // la creacion inicial). Sin esto, bajar linkDistance no se reflejaria
    // porque el collide seguiria con el radio absoluto viejo.
    (sim.force('collision') as d3.ForceCollide<GraphNode>)
      ?.radius((d) => Math.min(getNodeRadius(d, forces.nodeSize) + 4, forces.linkDistance * 0.35));
    sim.alpha(0.5).restart();
  }, [forces, isHydrated]);

  const updateForce = useCallback(<K extends keyof ForceSettings>(key: K, value: ForceSettings[K]) => {
    hasUserInteractedRef.current = true;
    setForces(prev => ({ ...prev, [key]: value }));
  }, []);

  /**
   * Guarda la config actual como predeterminada en localStorage — la proxima
   * vez que el user abra el grafo arranca con estos valores en vez de los
   * DEFAULT_FORCES del codigo.
   */
  const saveAsDefault = useCallback(() => {
    hasUserInteractedRef.current = true;
    saveForcesToStorage(forces);
    setJustSaved(true);
    toast.success('Configuración guardada como predeterminada');
    setTimeout(() => setJustSaved(false), 1500);
  }, [forces]);

  /**
   * Restablece a los defaults del codigo y limpia el localStorage.
   */
  const resetToDefaults = useCallback(() => {
    hasUserInteractedRef.current = true;
    setForces(DEFAULT_FORCES);
    try {
      window.localStorage.removeItem(FORCES_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    toast.info('Configuración restablecida a los valores originales');
  }, []);

  const hoveredInfo = useMemo(() => {
    if (!hoveredNode) return null;
    return nodes.find(n => n.id === hoveredNode) || null;
  }, [hoveredNode, nodes]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-background rounded-lg overflow-hidden">
      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full"
        style={{ color: 'var(--foreground)' }}
      />

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <Network className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">Sin nodos para mostrar</p>
          </div>
        </div>
      )}

      {/* Local graph indicator + reset */}
      {focusedNodeId && (
        <div className="absolute top-3 left-3 bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-2 shadow-lg flex items-center gap-2">
          <Focus className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {allGraphData.nodes.find(n => n.id === focusedNodeId)?.name}
          </span>
          {onNavigateToNode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => onNavigateToNode(focusedNodeId)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ir
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setFocusedNodeId(null)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Ver todo
          </Button>
        </div>
      )}


      {/* Force Controls Panel */}
      {showForceControls && (
        <div className="absolute top-3 right-3 bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-3 w-52 shadow-lg">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Fuerzas</p>
          <ForceSlider label="Centro" value={forces.centerStrength} min={0} max={0.2} step={0.005}
            onChange={v => updateForce('centerStrength', v)} />
          <ForceSlider label="Repulsión" value={forces.repelStrength} min={-800} max={-50} step={10}
            onChange={v => updateForce('repelStrength', v)} />
          <ForceSlider label="Atracción" value={forces.linkStrength} min={0.01} max={0.5} step={0.01}
            onChange={v => updateForce('linkStrength', v)} />
          <ForceSlider label="Distancia" value={forces.linkDistance} min={30} max={300} step={5}
            onChange={v => updateForce('linkDistance', v)} />

          {/* Botones de persistencia */}
          <div className="flex gap-1.5 mt-3 pt-2 border-t border-border/40">
            <Button
              variant="default"
              size="sm"
              className="flex-1 h-7 gap-1 text-xs"
              onClick={saveAsDefault}
              disabled={justSaved}
            >
              {justSaved ? (
                <>
                  <Check className="h-3 w-3" />
                  Guardado
                </>
              ) : (
                <>
                  <Save className="h-3 w-3" />
                  Guardar
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs px-2"
              onClick={resetToDefaults}
              title="Restablecer valores originales"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredInfo && (
        <div className={`absolute ${showForceControls ? 'bottom-12 right-3' : 'top-3 right-3'} bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-3 shadow-lg max-w-64`}>
          <p className="font-medium text-sm">{hoveredInfo.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hoveredInfo.type === 'folder' ? 'Carpeta' : 'Documento'} · {hoveredInfo.linkCount} conexiones
          </p>
          {hoveredInfo.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {hoveredInfo.tags.map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getNodeRadius(node: GraphNode, sizeMultiplier: number): number {
  const base = node.type === 'folder' ? 10 : 7;
  const linkBonus = Math.min(node.linkCount * 1.5, 10);
  return Math.max((base + linkBonus) * sizeMultiplier, 5);
}

function ForceSlider({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground/70">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}

