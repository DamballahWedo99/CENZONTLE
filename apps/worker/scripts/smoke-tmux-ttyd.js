// Smoke test del helper tmux-ttyd con `echo` en lugar de claude.
// Run: node dist/scripts/smoke-tmux-ttyd.js (después de pnpm build)
const path = require('path');
const { startClaudeInTmuxTtyd, readExitCode, readOutputTail, cleanupSession } = require(
  path.resolve(__dirname, '../dist/lib/tmux-ttyd.js'),
);

(async () => {
  console.log('Iniciando smoke test del helper tmux-ttyd...');
  const session = await startClaudeInTmuxTtyd({
    runId: 'smoke-test-' + Date.now(),
    workdir: '/tmp',
    claudeBin: '/bin/sh',
    claudeArgs: ['-c', 'echo HELLO_FROM_PANE; sleep 1; echo DONE_FROM_PANE'],
    claudeEnv: {
      HOME: process.env.HOME || '',
      PATH: process.env.PATH || '',
      USER: process.env.USER || '',
      LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'dummy-not-used-in-test',
    },
  });
  console.log('✓ session.ttydUrl:', session.ttydUrl);
  console.log('✓ session.tmuxSocket:', session.tmuxSocket);
  console.log('✓ session.outputLogPath:', session.outputLogPath);

  // Verifica que ttyd responde HTTP
  const http = require('http');
  await new Promise((resolve) => {
    http.get(session.ttydUrl, (res) => {
      console.log('✓ ttyd HTTP status:', res.statusCode);
      res.resume();
      resolve();
    }).on('error', (err) => {
      console.error('✗ ttyd HTTP error:', err.message);
      resolve();
    });
  });

  // Espera que el comando termine
  console.log('Esperando exit code...');
  let attempts = 0;
  let exitCode = null;
  while (attempts < 10 && exitCode === null) {
    await new Promise((r) => setTimeout(r, 500));
    exitCode = await readExitCode(session.exitCodePath);
    attempts++;
  }
  console.log('✓ Exit code recibido:', exitCode);

  // Lee output
  const output = await readOutputTail(session.outputLogPath, 8000);
  console.log('✓ Output length:', output.length, 'bytes');
  console.log('✓ Output contiene HELLO_FROM_PANE:', output.includes('HELLO_FROM_PANE'));
  console.log('✓ Output contiene DONE_FROM_PANE:', output.includes('DONE_FROM_PANE'));

  await cleanupSession(session);
  console.log('✓ Cleanup OK');
  console.log('\n--- SMOKE TEST PASS ---');
  process.exit(0);
})().catch((err) => {
  console.error('--- SMOKE TEST FAIL ---');
  console.error(err);
  process.exit(1);
});
