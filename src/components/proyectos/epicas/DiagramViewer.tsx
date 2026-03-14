'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Position,
  MarkerType,
  Handle,
  Connection,
  addEdge,
  Panel,
  NodeChange,
  EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { EpicDiagram, DiagramNode, DiagramEdge, DiagramNodeType } from '@/types/proyectos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Type, Save, RotateCcw, MousePointer2 } from 'lucide-react';

// --- Handle style ---
const handleStyle = { background: 'rgba(255,255,255,0.3)', width: 6, height: 6, border: 'none' };
const handleStyleEditing = { background: 'rgba(99,102,241,0.7)', width: 8, height: 8, border: '1px solid rgba(99,102,241,1)' };

// --- Service / Process / Gateway Node (dark rectangle) ---
function ServiceNode({ data, selected }: { data: { label: string; description?: string; nodeType: DiagramNodeType; editing?: boolean }; selected?: boolean }) {
  const isFilled = ['service', 'process', 'gateway', 'queue'].includes(data.nodeType);
  const hs = data.editing ? handleStyleEditing : handleStyle;
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" style={hs} />
      <Handle type="target" position={Position.Left} id="left" style={hs} />
      <div
        className={`flex flex-col items-center justify-center text-center px-4 py-3 min-w-[120px] max-w-[160px] rounded-lg border transition-shadow ${
          selected ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20' : ''
        } ${
          isFilled
            ? 'bg-zinc-900 border-zinc-600 text-white dark:bg-zinc-800 dark:border-zinc-600'
            : 'bg-zinc-800/60 border-zinc-500 border-dashed text-zinc-200 dark:bg-zinc-800/40'
        }`}
      >
        <span className="text-[11px] font-semibold leading-tight">{data.label}</span>
        {data.description && (
          <span className="text-[9px] text-zinc-400 leading-tight mt-0.5">{data.description}</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={hs} />
      <Handle type="source" position={Position.Right} id="right" style={hs} />
    </>
  );
}

// --- Decision Node (diamond) ---
function DecisionNode({ data, selected }: { data: { label: string; description?: string; editing?: boolean }; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  return (
    <div className="relative" style={{ width: 120, height: 120 }}>
      <Handle type="target" position={Position.Top} id="top" style={{ ...hs, top: -3 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ ...hs, left: -3 }} />
      <div
        className={`absolute bg-zinc-900 border border-zinc-500 dark:bg-zinc-800 transition-shadow ${
          selected ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20' : ''
        }`}
        style={{
          width: 84,
          height: 84,
          transform: 'rotate(45deg)',
          borderRadius: 4,
          top: 18,
          left: 18,
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10">
        <span className="text-[10px] font-bold text-white leading-tight max-w-[76px]">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ ...hs, bottom: -3 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ ...hs, right: -3 }} />
      <Handle type="source" position={Position.Left} id="left-out" style={{ ...hs, left: -3, top: '60%' }} />
    </div>
  );
}

// --- Actor Node (circle) ---
function ActorNode({ data, selected }: { data: { label: string; description?: string; editing?: boolean }; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" style={hs} />
      <Handle type="target" position={Position.Left} id="left" style={hs} />
      <div
        className={`rounded-full bg-zinc-900 border border-zinc-500 flex flex-col items-center justify-center text-center dark:bg-zinc-800 transition-shadow ${
          selected ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20' : ''
        }`}
        style={{ width: 100, height: 100 }}
      >
        <span className="text-[10px] font-semibold text-white leading-tight max-w-[72px]">{data.label}</span>
        {data.description && (
          <span className="text-[8px] text-zinc-400 leading-tight mt-0.5 max-w-[64px]">{data.description}</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={hs} />
      <Handle type="source" position={Position.Right} id="right" style={hs} />
    </>
  );
}

// --- Database Node (cylinder) ---
function DatabaseNode({ data, selected }: { data: { label: string; description?: string; editing?: boolean }; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" style={hs} />
      <Handle type="target" position={Position.Left} id="left" style={hs} />
      <div className={`flex flex-col items-center transition-shadow ${selected ? 'drop-shadow-[0_0_8px_rgba(99,102,241,0.3)]' : ''}`} style={{ width: 130 }}>
        <div
          className="bg-zinc-900 border border-zinc-500 dark:bg-zinc-800"
          style={{ width: 130, height: 20, borderRadius: '50%', position: 'relative', zIndex: 2 }}
        />
        <div
          className="bg-zinc-900 border-x border-b border-zinc-500 flex flex-col items-center justify-center text-center px-3 pb-2 dark:bg-zinc-800"
          style={{ width: 130, marginTop: -10, paddingTop: 14, borderBottomLeftRadius: '50% 18px', borderBottomRightRadius: '50% 18px' }}
        >
          <span className="text-[11px] font-semibold text-white leading-tight">{data.label}</span>
          {data.description && (
            <span className="text-[9px] text-zinc-400 leading-tight mt-0.5">{data.description}</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={hs} />
      <Handle type="source" position={Position.Right} id="right" style={hs} />
    </>
  );
}

// --- State Node (filled circle for end states) ---
function StateNode({ data, selected }: { data: { label: string; description?: string; editing?: boolean }; selected?: boolean }) {
  const hs = data.editing ? handleStyleEditing : handleStyle;
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" style={hs} />
      <Handle type="target" position={Position.Left} id="left" style={hs} />
      <div
        className={`rounded-full bg-white border-2 border-zinc-300 flex flex-col items-center justify-center text-center dark:bg-zinc-200 transition-shadow ${
          selected ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20' : ''
        }`}
        style={{ width: 90, height: 90 }}
      >
        <span className="text-[10px] font-bold text-zinc-900 leading-tight max-w-[64px]">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={hs} />
      <Handle type="source" position={Position.Right} id="right" style={hs} />
    </>
  );
}

// --- Node type mappings ---

const nodeTypeToShape: Record<DiagramNodeType, string> = {
  service: 'serviceNode',
  database: 'databaseNode',
  queue: 'serviceNode',
  gateway: 'serviceNode',
  external: 'serviceNode',
  client: 'stateNode',
  process: 'serviceNode',
  decision: 'decisionNode',
  actor: 'actorNode',
};

const shapeToNodeType: Record<string, DiagramNodeType> = {
  serviceNode: 'service',
  databaseNode: 'database',
  decisionNode: 'decision',
  actorNode: 'actor',
  stateNode: 'client',
};

const nodeDimensions: Record<string, { width: number; height: number }> = {
  serviceNode: { width: 160, height: 56 },
  decisionNode: { width: 120, height: 120 },
  actorNode: { width: 100, height: 100 },
  databaseNode: { width: 130, height: 70 },
  stateNode: { width: 90, height: 90 },
};

const nodeTypes = {
  serviceNode: ServiceNode,
  decisionNode: DecisionNode,
  actorNode: ActorNode,
  databaseNode: DatabaseNode,
  stateNode: StateNode,
};

const nodeTypeLabels: Record<string, string> = {
  serviceNode: 'Servicio',
  decisionNode: 'Decisión',
  actorNode: 'Actor',
  databaseNode: 'Base de datos',
  stateNode: 'Estado',
};

// --- Dagre layout ---

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 100, edgesep: 30 });

  nodes.forEach((node) => {
    const dims = nodeDimensions[node.type ?? 'serviceNode'] ?? nodeDimensions.serviceNode;
    g.setNode(node.id, { width: dims.width, height: dims.height });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const dims = nodeDimensions[node.type ?? 'serviceNode'] ?? nodeDimensions.serviceNode;
    return {
      ...node,
      position: { x: pos.x - dims.width / 2, y: pos.y - dims.height / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// --- Edge styles ---
function makeEdgeStyle(animated?: boolean) {
  return {
    type: 'smoothstep' as const,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgba(161,161,170,0.7)' },
    style: { strokeWidth: 1.5, stroke: 'rgba(161,161,170,0.5)' },
    labelStyle: { fontSize: 10, fill: 'rgba(161,161,170,0.9)', fontWeight: 600 },
    labelBgStyle: { fill: 'rgba(24,24,27,0.9)', fillOpacity: 1, rx: 4, ry: 4 },
    labelBgPadding: [6, 4] as [number, number],
    animated,
  };
}

// --- Diagram Viewer ---

interface DiagramViewerProps {
  diagram: EpicDiagram;
  editable?: boolean;
  onDiagramChange?: (diagram: EpicDiagram) => void;
  fullHeight?: boolean;
}

export function DiagramViewer({ diagram, editable = false, onDiagramChange, fullHeight = false }: DiagramViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeLabel, setEditingNodeLabel] = useState('');
  const [editingNodeDesc, setEditingNodeDesc] = useState('');
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeType, setNewNodeType] = useState<string>('serviceNode');
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState('');
  const nodeIdCounter = useRef(0);

  const { layoutedNodes, layoutedEdges } = useMemo(() => {
    const rfNodes: Node[] = diagram.nodes.map((n) => ({
      id: n.id,
      type: nodeTypeToShape[n.type] ?? 'serviceNode',
      position: { x: 0, y: 0 },
      data: { label: n.label, description: n.description, nodeType: n.type, editing: isEditing },
      draggable: isEditing,
    }));

    const rfEdges: Edge[] = diagram.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      ...makeEdgeStyle(e.animated),
      deletable: isEditing,
    }));

    const { nodes: ln, edges: le } = getLayoutedElements(rfNodes, rfEdges, 'TB');
    return { layoutedNodes: ln, layoutedEdges: le };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Sync when diagram changes externally
  useMemo(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutedNodes, layoutedEdges]);

  // Toggle editing mode
  const toggleEditing = useCallback(() => {
    if (isEditing) {
      // Exiting edit mode — discard unsaved UI state
      setSelectedNodeId(null);
      setShowAddNode(false);
      setEditingEdgeId(null);
    }
    setIsEditing((v) => !v);
    // Update node draggable + editing data
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        draggable: !isEditing,
        data: { ...n.data, editing: !isEditing },
      }))
    );
  }, [isEditing, setNodes]);

  // Save edits back to parent
  const handleSave = useCallback(() => {
    const updatedNodes: DiagramNode[] = nodes.map((n) => ({
      id: n.id,
      type: (n.data as { nodeType?: DiagramNodeType }).nodeType ?? shapeToNodeType[n.type ?? 'serviceNode'] ?? 'service',
      label: (n.data as { label: string }).label,
      description: (n.data as { description?: string }).description,
    }));
    const updatedEdges: DiagramEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: typeof e.label === 'string' ? e.label : undefined,
      animated: e.animated,
    }));
    const updatedDiagram: EpicDiagram = {
      ...diagram,
      nodes: updatedNodes,
      edges: updatedEdges,
      generatedAt: new Date().toISOString(),
      generatedBy: 'manual',
    };
    onDiagramChange?.(updatedDiagram);
    setIsEditing(false);
    setSelectedNodeId(null);
    setShowAddNode(false);
    setEditingEdgeId(null);
    setNodes((nds) => nds.map((n) => ({ ...n, draggable: false, data: { ...n.data, editing: false } })));
  }, [nodes, edges, diagram, onDiagramChange, setNodes]);

  // Reset to original layout
  const handleReset = useCallback(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setSelectedNodeId(null);
    setShowAddNode(false);
    setEditingEdgeId(null);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Handle new connections
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isEditing) return;
      const newEdge: Edge = {
        id: `edge-new-${Date.now()}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        ...makeEdgeStyle(false),
        deletable: true,
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [isEditing, setEdges]
  );

  // Node click — select for editing
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!isEditing) return;
      setSelectedNodeId(node.id);
      setEditingNodeLabel((node.data as { label: string }).label);
      setEditingNodeDesc((node.data as { description?: string }).description ?? '');
      setEditingEdgeId(null);
    },
    [isEditing]
  );

  // Edge click — select for label editing
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (!isEditing) return;
      setEditingEdgeId(edge.id);
      setEditingEdgeLabel(typeof edge.label === 'string' ? edge.label : '');
      setSelectedNodeId(null);
    },
    [isEditing]
  );

  // Apply node label changes
  const applyNodeEdit = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, label: editingNodeLabel, description: editingNodeDesc || undefined } }
          : n
      )
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, editingNodeLabel, editingNodeDesc, setNodes]);

  // Apply edge label changes
  const applyEdgeEdit = useCallback(() => {
    if (!editingEdgeId) return;
    setEdges((eds) =>
      eds.map((e) =>
        e.id === editingEdgeId ? { ...e, label: editingEdgeLabel || undefined } : e
      )
    );
    setEditingEdgeId(null);
  }, [editingEdgeId, editingEdgeLabel, setEdges]);

  // Delete selected node
  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, setNodes, setEdges]);

  // Delete selected edge
  const deleteSelectedEdge = useCallback(() => {
    if (!editingEdgeId) return;
    setEdges((eds) => eds.filter((e) => e.id !== editingEdgeId));
    setEditingEdgeId(null);
  }, [editingEdgeId, setEdges]);

  // Add new node
  const handleAddNode = useCallback(() => {
    if (!newNodeLabel.trim()) return;
    nodeIdCounter.current += 1;
    const id = `node-new-${Date.now()}-${nodeIdCounter.current}`;
    const nodeType = shapeToNodeType[newNodeType] ?? 'service';
    const dims = nodeDimensions[newNodeType] ?? nodeDimensions.serviceNode;
    const newNode: Node = {
      id,
      type: newNodeType,
      position: { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
      data: { label: newNodeLabel.trim(), nodeType, editing: true },
      draggable: true,
    };
    setNodes((nds) => [...nds, newNode]);
    setNewNodeLabel('');
    setShowAddNode(false);
  }, [newNodeLabel, newNodeType, setNodes]);

  // Handle node changes with custom filtering
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!isEditing) {
        // In view mode, only allow viewport changes (no position/remove)
        const filtered = changes.filter((c) => c.type !== 'position' && c.type !== 'remove');
        onNodesChange(filtered);
      } else {
        onNodesChange(changes);
      }
    },
    [isEditing, onNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!isEditing) {
        const filtered = changes.filter((c) => c.type !== 'remove');
        onEdgesChange(filtered);
      } else {
        onEdgesChange(changes);
      }
    },
    [isEditing, onEdgesChange]
  );

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  return (
    <div className={`relative ${fullHeight ? 'h-full' : ''}`}>
      <div className={`${fullHeight ? 'h-full' : 'h-[600px]'} rounded-xl border bg-zinc-950 dark:bg-zinc-950 ${isEditing ? 'border-indigo-500/50' : 'border-zinc-800'}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={isEditing ? onConnect : undefined}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => { setSelectedNodeId(null); setEditingEdgeId(null); }}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={isEditing}
          nodesConnectable={isEditing}
          elementsSelectable={isEditing}
          className="[&_.react-flow__edge-text]:!fill-zinc-400"
          defaultEdgeOptions={isEditing ? { type: 'smoothstep' } : undefined}
        >
          <Background gap={24} size={1} color="rgba(63,63,70,0.3)" />
          <Controls
            showInteractive={false}
            className="!bg-zinc-900 !border-zinc-700 !shadow-lg !rounded-lg [&>button]:!bg-zinc-900 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-800"
          />
          <MiniMap
            nodeStrokeWidth={2}
            nodeColor="#3f3f46"
            className="!bg-zinc-900 !border-zinc-700 !shadow-lg !rounded-lg"
            maskColor="rgba(0,0,0,0.3)"
          />

          {/* Editing toolbar */}
          {editable && (
            <Panel position="top-right" className="flex gap-1.5">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddNode((v) => !v)}
                    className="h-7 gap-1.5 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  >
                    <Plus className="h-3 w-3" />
                    Nodo
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReset}
                    className="h-7 gap-1.5 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    className="h-7 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Save className="h-3 w-3" />
                    Guardar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={toggleEditing}
                    className="h-7 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleEditing}
                  className="h-7 gap-1.5 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                >
                  <MousePointer2 className="h-3 w-3" />
                  Editar diagrama
                </Button>
              )}
            </Panel>
          )}

          {/* Add node panel */}
          {isEditing && showAddNode && (
            <Panel position="top-left" className="!mt-2 !ml-2">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-2 w-56 shadow-xl">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Agregar nodo</p>
                <Input
                  value={newNodeLabel}
                  onChange={(e) => setNewNodeLabel(e.target.value)}
                  placeholder="Nombre del nodo"
                  className="h-7 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
                />
                <Select value={newNodeType} onValueChange={setNewNodeType}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(nodeTypeLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleAddNode} disabled={!newNodeLabel.trim()} className="w-full h-7 text-xs gap-1.5">
                  <Plus className="h-3 w-3" />
                  Agregar
                </Button>
              </div>
            </Panel>
          )}

          {/* Node edit panel */}
          {isEditing && selectedNode && (
            <Panel position="bottom-left" className="!mb-2 !ml-2">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-2 w-56 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Type className="h-3 w-3" />
                    Editar nodo
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={deleteSelectedNode}
                    className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-950/30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  value={editingNodeLabel}
                  onChange={(e) => setEditingNodeLabel(e.target.value)}
                  placeholder="Nombre"
                  className="h-7 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  onKeyDown={(e) => e.key === 'Enter' && applyNodeEdit()}
                />
                <Input
                  value={editingNodeDesc}
                  onChange={(e) => setEditingNodeDesc(e.target.value)}
                  placeholder="Descripción (opcional)"
                  className="h-7 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  onKeyDown={(e) => e.key === 'Enter' && applyNodeEdit()}
                />
                <Button size="sm" onClick={applyNodeEdit} className="w-full h-7 text-xs">
                  Aplicar
                </Button>
              </div>
            </Panel>
          )}

          {/* Edge edit panel */}
          {isEditing && editingEdgeId && (
            <Panel position="bottom-left" className="!mb-2 !ml-2">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-2 w-56 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Editar conexión</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={deleteSelectedEdge}
                    className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-950/30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  value={editingEdgeLabel}
                  onChange={(e) => setEditingEdgeLabel(e.target.value)}
                  placeholder="Etiqueta (ej: SI, NO)"
                  className="h-7 text-xs bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  onKeyDown={(e) => e.key === 'Enter' && applyEdgeEdit()}
                />
                <Button size="sm" onClick={applyEdgeEdit} className="w-full h-7 text-xs">
                  Aplicar
                </Button>
              </div>
            </Panel>
          )}

          {/* Editing mode indicator */}
          {isEditing && (
            <Panel position="bottom-right" className="!mb-2 !mr-2">
              <div className="bg-indigo-600/90 text-white text-[10px] font-medium px-2.5 py-1 rounded-md flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                Modo edición — arrastra nodos, conecta handles, click para editar
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}
