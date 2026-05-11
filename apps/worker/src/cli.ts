#!/usr/bin/env node
import { Command } from 'commander';
import { logger } from './lib/logger.js';
import { registerCommand } from './commands/register.js';
import { startCommand } from './commands/start.js';

/**
 * CLI entry point del CENZONTLE Factory Worker.
 *
 * Comandos:
 *   factory-worker register --dashboard <url> --token <token>
 *     Handshake inicial con el dashboard. Guarda config en ~/.factory-worker/.
 *
 *   factory-worker start
 *     Daemon que mantiene el nodo "online" mediante heartbeats periódicos.
 *     Sprint 2 añadirá poll de claim-story.
 *
 * Flags globales:
 *   -v, --verbose    Log nivel debug (eventos detallados).
 */
const program = new Command();

program
  .name('factory-worker')
  .description('CENZONTLE Factory Worker — connects a compute node to the dashboard.')
  .version('0.1.0')
  .option('-v, --verbose', 'enable debug logging')
  .hook('preAction', (cmd) => {
    if (cmd.opts().verbose) {
      logger.level = 'debug';
      logger.debug({ event: 'cli.verbose' }, 'Verbose logging enabled');
    }
  });

program
  .command('register')
  .description('Register this machine as a compute node in the dashboard')
  .requiredOption('-d, --dashboard <url>', 'Dashboard URL (e.g. http://localhost:3001)')
  .requiredOption('-t, --token <token>', 'Worker token (worker_xxx)')
  .option('-s, --slots <count>', 'Concurrent slots this node accepts', '1')
  .action(async (opts: { dashboard: string; token: string; slots: string }) => {
    const totalSlots = parseInt(opts.slots, 10);
    if (Number.isNaN(totalSlots) || totalSlots < 1 || totalSlots > 32) {
      logger.error({ event: 'cli.invalid_arg', arg: 'slots', value: opts.slots }, 'slots must be 1-32');
      process.exit(1);
    }
    await registerCommand({
      dashboardUrl: opts.dashboard,
      token: opts.token,
      totalSlots,
    });
  });

program
  .command('start')
  .description('Start the worker daemon (heartbeat + future claim-story polling)')
  .option(
    '-s, --slots <count>',
    'Override registered slot count (1-32) for this run only. Useful in dev to test concurrency without re-registering.',
  )
  .action(async (opts: { slots?: string }) => {
    let slotsOverride: number | undefined;
    if (opts.slots !== undefined) {
      const parsed = parseInt(opts.slots, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 32) {
        logger.error({ event: 'cli.invalid_arg', arg: 'slots', value: opts.slots }, 'slots must be 1-32');
        process.exit(1);
      }
      slotsOverride = parsed;
    }
    await startCommand({ slotsOverride });
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error({ event: 'cli.fatal', error: err.message }, 'Fatal error');
  process.exit(1);
});
