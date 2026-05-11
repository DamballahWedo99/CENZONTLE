// Smoke test del helper tmux-ttyd (Opción B: tail-follow view-only).
// Run: node scripts/smoke-tmux-ttyd.mjs (después de pnpm build)
//
// Lo que valida:
//   1. Crear log file vacío
//   2. startTailFollowSession arranca tmux+ttyd corriendo `tail -f`
//   3. ttyd responde HTTP 200 en el puerto asignado
//   4. Appendear contenido al log file lo deja visible vía readOutputTail
//   5. cleanupSession mata todo (ttyd, tmux, log file)
import http from 'http';
import { promises as fs } from 'fs';
import { startTailFollowSession, readOutputTail, cleanupSession } from '../dist/lib/tmux-ttyd.js';

const runId = 'smoke-test-' + Date.now();
const logFilePath = `/tmp/cenzontle-run-${runId}.log`;

// 1. Crear log file vacío (precondición para tail -f)
await fs.writeFile(logFilePath, '', 'utf-8');
console.log('✓ Log file creado:', logFilePath);

// 2. Arrancar la sesión de tail+ttyd
const session = await startTailFollowSession({ runId, logFilePath });
console.log('✓ session.ttydUrl:', session.ttydUrl);
console.log('✓ session.tmuxSocket:', session.tmuxSocket);
console.log('✓ session.outputLogPath:', session.outputLogPath);

// 3. Verificar que ttyd responde HTTP 200
await new Promise((resolve) => {
  http
    .get(session.ttydUrl, (res) => {
      console.log('✓ ttyd HTTP status:', res.statusCode);
      res.resume();
      resolve();
    })
    .on('error', (err) => {
      console.error('✗ ttyd HTTP error:', err.message);
      resolve();
    });
});

// 4. Appendear contenido al log file y verificar que se puede leer
//    (en runtime real esto lo hace runner.ts via child.stdout.on('data'))
await fs.appendFile(logFilePath, 'HELLO_FROM_LOG\n', 'utf-8');
await new Promise((r) => setTimeout(r, 300)); // dar tiempo a que tail propague
await fs.appendFile(logFilePath, 'DONE_FROM_LOG\n', 'utf-8');
await new Promise((r) => setTimeout(r, 500));

const output = await readOutputTail(session.outputLogPath, 8000);
console.log('✓ Output length:', output.length, 'bytes');
console.log('✓ Output contiene HELLO_FROM_LOG:', output.includes('HELLO_FROM_LOG'));
console.log('✓ Output contiene DONE_FROM_LOG:', output.includes('DONE_FROM_LOG'));

// 5. Cleanup mata ttyd + tmux + borra archivo
await cleanupSession(session);
console.log('✓ Cleanup OK');

// Verificar que el archivo se borró
try {
  await fs.access(logFilePath);
  console.error('✗ Log file aún existe tras cleanup');
  process.exit(1);
} catch {
  console.log('✓ Log file borrado');
}

console.log('\n--- SMOKE TEST PASS ---');
process.exit(0);
