'use client';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { DefinicionNode } from '@/types/definiciones';
import { Network, Maximize2, Focus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  folder: { fill: '#6366f1', stroke: '#4f46e5' },
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
  const { state, selectNode } = useDefiniciones();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [forces, setForces] = useState<ForceSettings>(DEFAULT_FORCES);

  dimensionsRef.current = dimensions;
  forcesRef.current = forces;

  const allGraphData = useMemo(() => extractGraphData(state.tree), [state.tree]);

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
    const currentForces = DEFAULT_FORCES;

    simulationRef.current?.stop();
    svg.selectAll('*').remove();

    // Empty state
    if (nodes.length === 0) return;

    const g = svg.append('g').attr('opacity', 0);
    g.transition().duration(300).attr('opacity', 1);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom as unknown as (selection: typeof svg) => void);

    // Deep copy nodes/links for D3 mutation
    const simNodes: GraphNode[] = nodes.map(n => ({ ...n }));
    const simLinks: GraphLink[] = links.map(l => ({ ...l, source: l.source as string, target: l.target as string }));

    // Force simulation
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force('center', d3.forceCenter(width / 2, height / 2).strength(currentForces.centerStrength))
      .force('charge', d3.forceManyBody().strength(currentForces.repelStrength).distanceMax(350))
      .force('link', d3.forceLink<GraphNode, GraphLink>(simLinks).id(d => d.id).strength(currentForces.linkStrength).distance(currentForces.linkDistance))
      .force('collision', d3.forceCollide().radius(d => getNodeRadius(d as GraphNode, currentForces.nodeSize) + 4))
      .alphaDecay(0.02);

    simulationRef.current = simulation;

    // Draw links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', d => d.type === 'tag' ? '#f59e0b55' : '#6366f155')
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
          .attr('r', getNodeRadius(d, DEFAULT_FORCES.nodeSize) * 1.3)
          .attr('fill', NODE_COLORS.highlighted.fill)
          .attr('stroke', NODE_COLORS.highlighted.stroke);
      })
      .on('mouseleave', () => {
        if (draggingRef.current) return;
        setHoveredNode(null);

        node.select('circle')
          .transition().duration(300)
          .attr('opacity', 0.9)
          .attr('r', n => getNodeRadius(n, DEFAULT_FORCES.nodeSize))
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

    // Initial zoom to fit
    const zoomTimer = setTimeout(() => {
      const bounds = (g.node() as SVGGElement)?.getBBox();
      if (bounds && bounds.width > 0) {
        const padding = 60;
        const scale = Math.min(
          (width - padding * 2) / bounds.width,
          (height - padding * 2) / bounds.height,
          1.5,
        );
        const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
        const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
        svg.transition().duration(500).call(
          zoom.transform as unknown as (transition: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void,
          d3.zoomIdentity.translate(tx, ty).scale(scale),
        );
      }
    }, 800);

    return () => {
      simulation.stop();
      simulationRef.current = null;
      clearTimeout(zoomTimer);
      svg.on('.zoom', null);
    };
  }, [nodes, links]);


  // Handle resize without recreating the simulation
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.attr('width', dimensions.width).attr('height', dimensions.height);

    const sim = simulationRef.current;
    if (sim) {
      sim.force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2).strength(forcesRef.current.centerStrength));
      sim.alpha(0.1).restart();
    }
  }, [dimensions]);

  // Update forces imperatively
  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim) return;
    sim.force('center', d3.forceCenter(dimensionsRef.current.width / 2, dimensionsRef.current.height / 2).strength(forces.centerStrength));
    sim.force('charge', d3.forceManyBody().strength(forces.repelStrength).distanceMax(350));
    (sim.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      ?.strength(forces.linkStrength)
      .distance(forces.linkDistance);
    sim.alpha(0.5).restart();
  }, [forces]);

  const updateForce = useCallback(<K extends keyof ForceSettings>(key: K, value: ForceSettings[K]) => {
    setForces(prev => ({ ...prev, [key]: value }));
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

