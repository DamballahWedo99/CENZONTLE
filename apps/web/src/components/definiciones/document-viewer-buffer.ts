/**
 * Lógica pura de reseteo del buffer de edición (`editBuffer`) del
 * DocumentViewer. Extraída del componente para poder testearla sin montar
 * TipTap ni el DOM completo (ver `__tests__/document-viewer-buffer.test.ts`).
 *
 * El componente llama a `resolveEditBufferReset` EN FASE DE RENDER (nunca
 * dentro de un `useEffect`) para decidir si debe resetear `editBuffer` al
 * contenido crudo del vault. Este patrón ("adjusting state when a prop
 * changes": https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
 * reemplaza un `useEffect` anterior que hacía `setEditBuffer(...)`
 * directamente — prohibido por la regla `react-hooks/set-state-in-effect` —
 * y que además dependía (incorrectamente) de que TipTap emitiera su evento
 * `update` para "limpiar" el buffer al recargar un documento. TipTap NO
 * emite `update` cuando el documento resultante es idéntico al actual
 * (`prevState.doc.eq(state.doc)`), así que ese enfoque podía dejar basura de
 * una sesión de "modo código" anterior atascada indefinidamente en el buffer
 * — y esa basura terminaba sobrescribiendo el documento real del vault al
 * guardar.
 */

export interface EditBufferResetTracker {
  nodeId: string | undefined;
  isEditing: boolean;
}

export interface EditBufferReset {
  tracker: EditBufferResetTracker;
  buffer: string;
}

/**
 * Decide si `editBuffer` debe resetearse dado el tracker congelado desde el
 * último reset (`prevTracker`) y los valores actuales de render
 * (`nextTracker`).
 *
 * Devuelve `null` si ni el nodo seleccionado ni el modo edición cambiaron
 * desde el último reset — el caller debe conservar el buffer que ya tenía
 * (p. ej., mientras el usuario sigue escribiendo en el modo código sobre el
 * mismo documento).
 *
 * Si alguno de los dos cambió, devuelve el nuevo tracker junto con el buffer
 * determinista que corresponde: el markdown CRUDO del vault (`rawContent`),
 * nunca el re-serializado por TipTap ni lo que hubiera en el buffer
 * previamente. Esto garantiza que el buffer siempre refleje el documento
 * recién cargado sin depender de que el editor emita ningún evento.
 */
export function resolveEditBufferReset(
  prevTracker: EditBufferResetTracker,
  nextTracker: EditBufferResetTracker,
  rawContent: string,
): EditBufferReset | null {
  if (prevTracker.nodeId === nextTracker.nodeId && prevTracker.isEditing === nextTracker.isEditing) {
    return null;
  }
  return { tracker: nextTracker, buffer: rawContent };
}
