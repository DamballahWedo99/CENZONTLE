import type Anthropic from '@anthropic-ai/sdk';
import {
  appendNudgeToLastUserMessage,
  extractResultPreview,
  getToolLabel,
  sanitizeToolArgs,
  summarizeToolResult,
  toolTimeout,
} from './agent-loop.util';

describe('sanitizeToolArgs', () => {
  it('trunca strings largos a 100 chars con elipsis', () => {
    const long = 'x'.repeat(150);
    const out = sanitizeToolArgs({ pattern: long });
    expect(out.pattern).toBe('x'.repeat(100) + '…');
  });

  it('recorre objetos y arrays anidados', () => {
    const out = sanitizeToolArgs({
      nested: { list: ['corto', 'y'.repeat(120)] },
      num: 42,
      flag: true,
      nil: null,
    });
    expect((out.nested as { list: string[] }).list[0]).toBe('corto');
    expect((out.nested as { list: string[] }).list[1]).toBe('y'.repeat(100) + '…');
    expect(out.num).toBe(42);
    expect(out.flag).toBe(true);
    expect(out.nil).toBeNull();
  });

  it('redacta secretos en string leaves (scrubSecrets)', () => {
    const out = sanitizeToolArgs({ pattern: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(String(out.pattern)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('extractResultPreview', () => {
  it('lista titles/paths de results', () => {
    const result = JSON.stringify({
      results: [{ path: 'src/a.ts' }, { title: 'Doc B' }, { name: 'c' }],
    });
    expect(extractResultPreview(result)).toBe('src/a.ts · Doc B · c');
  });

  it('extrae excerpt de content con cap de 300', () => {
    const result = JSON.stringify({ content: 'a'.repeat(400) });
    expect(extractResultPreview(result)).toBe('a'.repeat(300) + '…');
  });

  it('JSON no parseable cae al slice del raw', () => {
    expect(extractResultPreview('texto plano')).toBe('texto plano');
  });

  it('objeto vacío retorna undefined', () => {
    expect(extractResultPreview('{}')).toBeUndefined();
  });

  it('pin: documents=[] salta el branch de documents y cae al stringify fallback', () => {
    expect(extractResultPreview(JSON.stringify({ documents: [] }))).toBe('{"documents":[]}');
  });
});

describe('getToolLabel', () => {
  const LABELS = { vault_read: 'Leyendo del Vault' };
  it('usa el mapa del caller', () => {
    expect(getToolLabel(LABELS, 'vault_read')).toBe('Leyendo del Vault');
  });
  it('cae al nombre crudo sin entrada en el mapa', () => {
    expect(getToolLabel(LABELS, 'tool_desconocida')).toBe('tool_desconocida');
  });
});

describe('summarizeToolResult', () => {
  it('cuenta results y documents', () => {
    expect(summarizeToolResult(JSON.stringify({ results: [1, 2, 3] }))).toBe('3 resultados');
    expect(summarizeToolResult(JSON.stringify({ documents: [1] }))).toBe('1 documentos');
  });
  it('resume content por longitud', () => {
    expect(summarizeToolResult(JSON.stringify({ content: 'abcd' }))).toBe(
      'Contenido leído (4 chars)',
    );
  });
  it('fallback Completado para JSON sin shape conocida o no-JSON', () => {
    expect(summarizeToolResult('{}')).toBe('Completado');
    expect(summarizeToolResult('no json')).toBe('Completado');
  });
  it('pin de edge cases: results=[] es truthy (0 resultados); results=0 es falsy (Completado)', () => {
    expect(summarizeToolResult(JSON.stringify({ results: [] }))).toBe('0 resultados');
    expect(summarizeToolResult(JSON.stringify({ results: 0 }))).toBe('Completado');
  });
});

describe('toolTimeout', () => {
  it('rechaza al vencer el plazo', async () => {
    jest.useFakeTimers();
    const timer = toolTimeout(5_000);
    const assertion = expect(timer).rejects.toThrow('Tool timeout (5000ms)');
    jest.advanceTimersByTime(5_001);
    await assertion;
    jest.useRealTimers();
  });

  it('clear() cancela el timer (la race ganada no deja rechazo pendiente)', async () => {
    jest.useFakeTimers();
    const timer = toolTimeout(5_000);
    timer.clear();
    // Consumir el promise para que un reject inesperado falle el test.
    const settled = Promise.race([timer, Promise.resolve('ok')]);
    jest.advanceTimersByTime(10_000);
    await expect(settled).resolves.toBe('ok');
    jest.useRealTimers();
  });
});

describe('appendNudgeToLastUserMessage', () => {
  it('anexa como bloque de texto cuando el último user tiene content array', () => {
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
      },
    ];
    expect(appendNudgeToLastUserMessage(messages, 'NUDGE')).toBe(true);
    const content = messages[0].content as Anthropic.Messages.ContentBlockParam[];
    expect(content).toHaveLength(2);
    expect(content[1]).toEqual({ type: 'text', text: 'NUDGE' });
  });

  it('concatena cuando el último user tiene content string', () => {
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: 'hola' }];
    expect(appendNudgeToLastUserMessage(messages, 'NUDGE')).toBe(true);
    expect(messages[0].content).toBe('hola\n\nNUDGE');
  });

  it('retorna false sin mutar cuando el último mensaje es assistant (el caller decide)', () => {
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'respuesta' }] },
    ];
    expect(appendNudgeToLastUserMessage(messages, 'NUDGE')).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('retorna false con messages vacío', () => {
    expect(appendNudgeToLastUserMessage([], 'NUDGE')).toBe(false);
  });
});
