import { describe, it, expect } from 'vitest';
import { resolveEditBufferReset, type EditBufferResetTracker } from '../document-viewer-buffer';

// ────────────────────────────────────────────────────────────────────────────
// Lógica pura del reset de `editBuffer`
// ────────────────────────────────────────────────────────────────────────────
//
// Siguiendo la convención del proyecto (ver useDiagramAutoSave.test.ts), se
// testea la decisión pura sin montar el componente ni TipTap: DocumentViewer
// no tiene @testing-library/react instalado, y montar un editor TipTap real
// en jsdom (contentEditable, ProseMirror) exigiría andamiaje considerable
// para un beneficio marginal, porque el bug real vive enteramente en esta
// función de decisión, no en el árbol de render.
//
// COBERTURA: esta suite valida la regla de reset determinista de
// `editBuffer` (esta función) y, con el escenario "REGRESIÓN" de abajo, la
// cadena de falla completa descrita en el bug original a nivel de estado.
// NO cubre (requeriría @testing-library/react + jsdom contentEditable):
//   - Que `editor.commands.setContent` realmente se invoque con
//     `{ emitUpdate: false }` dentro del useEffect del componente.
//   - Que el textarea del modo código (`onChange`) siga escribiendo el
//     buffer directo sin pasar por `resolveEditBufferReset`.
//   - Que `handleSave`/`handleCancel` y el effect de `[showSource]` lean
//     `editBuffer` correctamente en el DOM real.

describe('resolveEditBufferReset', () => {
  it('no resetea si el nodo seleccionado y el modo edición no cambiaron', () => {
    const tracker: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: true };
    const result = resolveEditBufferReset(tracker, { nodeId: 'doc-a', isEditing: true }, 'cualquier cosa');
    expect(result).toBeNull();
  });

  it('resetea al contenido crudo cuando cambia el nodo seleccionado', () => {
    const prev: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: false };
    const next: EditBufferResetTracker = { nodeId: 'doc-b', isEditing: false };
    const result = resolveEditBufferReset(prev, next, '# Documento B');
    expect(result).toEqual({ tracker: next, buffer: '# Documento B' });
  });

  it('resetea al contenido crudo cuando cambia el modo edición sobre el mismo nodo', () => {
    const prev: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: false };
    const next: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: true };
    const result = resolveEditBufferReset(prev, next, '# Hola');
    expect(result).toEqual({ tracker: next, buffer: '# Hola' });
  });

  it('resetea también cuando se deselecciona el nodo (nodeId pasa a undefined)', () => {
    const prev: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: false };
    const next: EditBufferResetTracker = { nodeId: undefined, isEditing: false };
    const result = resolveEditBufferReset(prev, next, '');
    expect(result).toEqual({ tracker: next, buffer: '' });
  });

  it('REGRESIÓN: descarta basura escrita en modo código tras un guardado sin ediciones reales', () => {
    // Reproduce la cadena de falla completa del bug original:
    //
    // 1. Documento A ('# Hola') se abre en modo edición.
    // 2. El usuario entra a "Ver markdown", borra todo y escribe 'basura'
    //    directo en el textarea (esto NUNCA pasa por esta función — el
    //    textarea llama a setEditBuffer directo — así que se simula
    //    corrompiendo `buffer` a mano, tal como pasaría en el componente).
    // 3. El usuario aprieta Guardar. `userHasEdited` sigue en false porque el
    //    textarea no lo marca, así que `handleSave` no persiste nada y solo
    //    sale del modo edición (`isEditing` pasa a false sobre el MISMO
    //    nodo).
    //
    // Con el bug (sin este reset determinista, esperando a que TipTap emita
    // `update`) el buffer seguiría siendo 'basura': TipTap NUNCA emite
    // `update` al recargar el mismo documento porque el doc resultante es
    // igual al actual. Reabrir el documento mostraría 'basura' en vez de
    // '# Hola', y guardar desde ahí corrompería el vault.
    //
    // Con el fix, el reset SIEMPRE dispara al cambiar `isEditing` — sin
    // importar si TipTap emitió algo — y descarta la basura.
    const rawContentDocA = '# Hola';

    let tracker: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: false };
    let buffer = rawContentDocA;

    // Paso 1: entra a modo edición.
    let next: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: true };
    let reset = resolveEditBufferReset(tracker, next, rawContentDocA);
    expect(reset).not.toBeNull();
    tracker = reset!.tracker;
    buffer = reset!.buffer;
    expect(buffer).toBe('# Hola');

    // Paso 2: el textarea del modo código corrompe el buffer directo.
    buffer = 'basura';

    // Paso 3: Guardar sin ediciones reales -> sale del modo edición.
    next = { nodeId: 'doc-a', isEditing: false };
    reset = resolveEditBufferReset(tracker, next, rawContentDocA);

    expect(reset).not.toBeNull();
    tracker = reset!.tracker;
    buffer = reset!.buffer;

    // Assertion clave: el buffer refleja el documento real, NO la basura.
    expect(buffer).toBe('# Hola');
    expect(buffer).not.toBe('basura');
  });

  it('preserva el buffer mientras el usuario sigue en el mismo nodo/modo (no debe pisar ediciones en curso)', () => {
    const tracker: EditBufferResetTracker = { nodeId: 'doc-a', isEditing: true };
    // Simula que el usuario está a mitad de escribir en el textarea: el
    // buffer difiere del contenido crudo, pero como nada cambió en el
    // tracker, resolveEditBufferReset no debe tocarlo.
    const result = resolveEditBufferReset(tracker, { nodeId: 'doc-a', isEditing: true }, '# Hola');
    expect(result).toBeNull();
  });
});
