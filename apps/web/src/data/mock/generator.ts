import type { BatchMetrics, LogEntry, CostBreakdown } from '@cenzontle/shared';

// =============================================================================
// DETERMINISTIC MOCK DATA GENERATOR
// Produces realistic factory metrics with coherent improvement trends,
// gaussian-like noise, occasional event spikes, and logarithmic decay curves.
// Zero external dependencies — pure TypeScript with seeded PRNG.
// =============================================================================

// --- Seeded PRNG (Linear Congruential Generator) ---

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// --- Utility helpers ---

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Gaussian-like noise using the sum-of-3-uniforms approximation.
 * Produces a bell-curve-distributed multiplier centered at 1.0.
 */
function gaussianNoise(rand: () => number, pct: number): number {
  const u = (rand() + rand() + rand()) / 3; // ~gaussian 0..1, mean 0.5
  const deviation = (u - 0.5) * 2; // -1..1, bell-shaped
  return 1 + deviation * pct;
}

/**
 * Apply gaussian-like noise to a value with a given percentage spread.
 */
function applyNoise(value: number, rand: () => number, pct: number = 0.15): number {
  return value * gaussianNoise(rand, pct);
}

function pickWeighted<T>(items: T[], weights: number[], rand: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickRandom<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)];
}

// --- Progress curve ---

/**
 * Logarithmic decay: fast improvement early, plateau later.
 * Maps linear t (0..1) to a curved progress (0..1).
 */
function logProgress(t: number): number {
  return Math.log(1 + t * 4) / Math.log(5);
}

// --- Event system ---

type BatchEvent = 'rejection_spike' | 'cost_spike' | 'test_dip' | null;

/**
 * Deterministically decide if a batch index triggers an event.
 * Roughly every ~5 batches one event fires (with seeded randomness).
 */
function rollEvent(index: number, rand: () => number): BatchEvent {
  const roll = rand();
  // ~20% chance per batch → on average 1 event every 5 batches
  if (roll > 0.20) return null;
  const kind = rand();
  if (kind < 0.40) return 'rejection_spike';
  if (kind < 0.70) return 'cost_spike';
  return 'test_dip';
}

// --- Prompt version mapping ---

function promptVersionForBatch(batchNum: number): string {
  if (batchNum <= 22) return 'v2.4.0';
  if (batchNum <= 28) return 'v3.0.0';
  if (batchNum <= 35) return 'v3.1.0';
  return 'v3.2.1';
}

// =============================================================================
// 1. BATCH HISTORY GENERATOR
// =============================================================================

export function generateBatchHistory(count: number = 30): BatchMetrics[] {
  const rand = seededRandom(42);
  const startBatch = 18;
  const endDate = new Date('2026-03-23T12:00:00Z');
  const startDate = new Date(endDate.getTime() - 60 * 24 * 60 * 60 * 1000); // ~60 days back

  const batches: BatchMetrics[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1); // linear progress 0..1
    const p = logProgress(t); // curved progress: fast early, plateau late
    const batchNum = startBatch + i;

    // --- Roll for event this batch ---
    const event = rollEvent(i, rand);

    // --- Stories per batch: truly random 3-10, no trend dependency ---
    const stories = 3 + Math.floor(rand() * 8); // integer in [3, 10]

    // --- Cost per story: logarithmic decay from ~$3.50 to ~$1.50, ±25% noise ---
    let costPerStory = applyNoise(lerp(3.5, 1.5, p), rand, 0.25);
    if (event === 'cost_spike') costPerStory *= 1.5;
    const totalCost = parseFloat((stories * costPerStory).toFixed(2));

    // --- Tokens: 150K-250K per story, ±15% noise ---
    const tokensPerStory = applyNoise(lerp(220000, 170000, p), rand, 0.15);
    const totalTokens = Math.round(stories * tokensPerStory);

    // --- Rejection rate: logarithmic decay from 35% to 8%, ±30% noise ---
    let rawRejection = applyNoise(lerp(0.35, 0.08, p), rand, 0.30);
    if (event === 'rejection_spike') rawRejection *= 2.0;
    const rejectionRate = clamp(
      parseFloat(rawRejection.toFixed(3)),
      0.02,
      0.65
    );

    // --- Test pass rate: logarithmic improvement from 78% to 97%, ±10% noise ---
    let rawTestPass = applyNoise(lerp(0.78, 0.97, p), rand, 0.10);
    if (event === 'test_dip') rawTestPass *= 0.88; // new test suite drops pass rate
    const testPassRate = clamp(
      parseFloat(rawTestPass.toFixed(3)),
      0.55,
      1.0
    );

    // --- Avg retries: logarithmic decay from 2.5 to 0.4, ±20% noise ---
    const avgRetries = clamp(
      parseFloat(applyNoise(lerp(2.5, 0.4, p), rand, 0.20).toFixed(1)),
      0,
      4.0
    );

    // --- Avg duration: logarithmic decay from 95min to 50min, ±20% noise ---
    let rawDuration = applyNoise(lerp(95, 50, p), rand, 0.20);
    if (event === 'cost_spike') rawDuration *= 1.3; // complex epic takes longer
    const avgDuration = clamp(
      parseFloat(rawDuration.toFixed(1)),
      30,
      150
    );

    // --- Completion date: spread evenly across the 60-day window ---
    const completedMs = startDate.getTime() + t * (endDate.getTime() - startDate.getTime());
    const completedAt = new Date(completedMs).toISOString();

    batches.push({
      batchId: `batch-${batchNum}`,
      batchName: `Sprint Batch #${batchNum}`,
      promptVersion: promptVersionForBatch(batchNum),
      stories,
      completedAt,
      totalCost,
      totalTokens,
      rejectionRate,
      avgRetries,
      avgDuration,
      testPassRate,
    });
  }

  return batches;
}

// =============================================================================
// 2. LOG ENTRIES GENERATOR
// =============================================================================

const AGENT_MESSAGES: string[] = [
  'Forge-Alpha: Writing auth middleware for session management...',
  'Forge-Beta: Running test suite (12/15 passed)',
  'Forge-Alpha: Generating migration for user_preferences table',
  'Forge-Charlie: Implementing pagination for /api/projects endpoint',
  'Forge-Delta: Refactoring error handler to use Result pattern',
  'Forge-Beta: Story fs-47-005 code generation complete, submitting PR',
  'Forge-Echo: Analyzing acceptance criteria for notification service',
  'Forge-Alpha: Retry #2 — addressing review feedback on input validation',
  'Forge-Foxtrot: Writing integration tests for payment webhook',
  'Forge-Charlie: Generating OpenAPI spec from route definitions',
];

const REVIEW_MESSAGES: string[] = [
  'Claude Review: PR #1206 — Security concern: JWT secret exposed in config, requesting fix',
  'Claude Review: PR #1208 — LGTM, clean separation of concerns. Approved.',
  'Claude Review: PR #1203 — Missing null check on user.email, requesting changes',
  'Claude Review: PR #1210 — SQL injection risk in search query builder. Rejected.',
  'Claude Review: PR #1207 — Good test coverage (92%). Minor: rename `tmp` variable. Approved with suggestions.',
  'Claude Review: PR #1211 — Race condition in concurrent queue processor. Requesting fix.',
];

const CI_MESSAGES: string[] = [
  'CI: All checks passed for PR #1207. Coverage: 94.2%',
  'CI: Build succeeded — 847 tests, 0 failures, 3 skipped',
  'CI: Lint check passed. No new warnings introduced.',
  'CI: Docker image built and pushed to registry (2.1s)',
  'CI: E2E smoke tests passed on staging environment',
  'CI: Type check completed — 0 errors across 342 files',
];

const TEMPORAL_MESSAGES: string[] = [
  'Wave 2 dispatched: 3 stories assigned to agents',
  'Wave 1 completed: 3/3 stories merged. Elapsed: 42min',
  'Batch #47 orchestration started — 3 waves planned, 8 stories total',
  'Wave 2 checkpoint: 1/3 stories in review, 2 in progress',
  'Retry scheduled: fs-47-004 re-queued after review rejection',
  'Wave 3 ready: waiting for Wave 2 gate approval',
];

const QA_MESSAGES: string[] = [
  'QA Agent: E2E suite — 46/48 passed, 2 flaky (cart timeout)',
  'QA Agent: Accessibility audit — 0 critical, 2 minor violations',
  'QA Agent: Performance regression detected — /api/users +320ms p95',
  'QA Agent: Visual diff — 3 snapshots updated, 0 unexpected changes',
];

const WARN_MESSAGES: string[] = [
  'Coverage dropped to 78.4% on module auth/sessions — below 80% threshold',
  'Flaky test detected: test_concurrent_writes failed 2/5 runs',
  'Agent Forge-Delta idle for 8min — possible deadlock in tool call',
  'Memory usage at 82% on worker node forge-pool-3',
  'Rate limit approaching: 847/1000 API calls this minute',
  'PR #1209 has been open for >30min without review assignment',
];

const ERROR_MESSAGES: string[] = [
  'Build failed — TypeScript error in src/services/payment.ts:142: Property "amount" missing',
  'Timeout after 120s waiting for agent Forge-Echo response',
  'CI pipeline failed: PostgreSQL container crashed during migration step',
  'Agent Forge-Delta crashed — unhandled rejection in tool executor. Restarting...',
  'Review service unavailable (503) — retrying in 30s',
  'Story fs-47-006 exceeded max retries (3). Escalating to human review.',
];

type LogSource = 'agent' | 'review' | 'ci' | 'temporal' | 'qa';
type LogLevel = 'info' | 'warn' | 'error';

export function generateLogEntries(count: number = 60): LogEntry[] {
  const rand = seededRandom(1337);
  const endTime = new Date('2026-03-23T17:30:00Z');
  const startTime = new Date(endTime.getTime() - 6 * 60 * 60 * 1000);

  const entries: LogEntry[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);

    // Source distribution: agent 40%, temporal 20%, review 15%, ci 15%, qa 10%
    const source = pickWeighted<LogSource>(
      ['agent', 'review', 'ci', 'temporal', 'qa'],
      [40, 15, 15, 20, 10],
      rand
    );

    // Level distribution: info 65%, warn 20%, error 15%
    const level = pickWeighted<LogLevel>(
      ['info', 'warn', 'error'],
      [65, 20, 15],
      rand
    );

    // Pick message based on level first (errors/warns are special), then source
    let message: string;
    if (level === 'error') {
      message = pickRandom(ERROR_MESSAGES, rand);
    } else if (level === 'warn') {
      message = pickRandom(WARN_MESSAGES, rand);
    } else {
      const sourceMessages: Record<LogSource, string[]> = {
        agent: AGENT_MESSAGES,
        review: REVIEW_MESSAGES,
        ci: CI_MESSAGES,
        temporal: TEMPORAL_MESSAGES,
        qa: QA_MESSAGES,
      };
      message = pickRandom(sourceMessages[source], rand);
    }

    // Timestamp: spread across 6h window with slight clustering toward recent
    const skew = t * t; // quadratic — more entries toward end
    const tsMs = startTime.getTime() + skew * (endTime.getTime() - startTime.getTime());
    // Add small jitter so entries are not perfectly spaced
    const jitter = (rand() - 0.5) * 2 * 60 * 1000; // +/- 1 min
    const timestamp = new Date(tsMs + jitter).toISOString();

    const sourceIdMap: Record<LogSource, string> = {
      agent: pickRandom(['forge-alpha', 'forge-beta', 'forge-charlie', 'forge-delta', 'forge-echo', 'forge-foxtrot'], rand),
      review: 'claude-review',
      ci: 'github-actions',
      temporal: 'temporal-orchestrator',
      qa: 'qa-agent',
    };

    entries.push({
      id: `log-${String(i + 1).padStart(4, '0')}`,
      timestamp,
      source,
      sourceId: sourceIdMap[source],
      level,
      message,
    });
  }

  // Sort chronologically
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return entries;
}

// =============================================================================
// 3. AGENT COSTS GENERATOR
// =============================================================================

export function generateAgentCosts(
  agentNames: string[]
): CostBreakdown['agentCosts'] {
  const rand = seededRandom(7);
  return agentNames.map((name, i) => {
    const efficiency = 0.6 + rand() * 0.4; // 0.6-1.0 multiplier
    const baseCost = 1.2 + rand() * 2.8; // $1.20 - $4.00
    const cost = parseFloat((baseCost * efficiency).toFixed(2));
    const tokens = Math.round(cost * 55000 + rand() * 20000);
    return {
      agentId: `agent-${name.toLowerCase().replace(/\s+/g, '-')}`,
      agentName: name,
      cost,
      tokens,
    };
  });
}

// =============================================================================
// 4. STORY COSTS GENERATOR
// =============================================================================

export function generateStoryCosts(
  storyKeys: string[]
): CostBreakdown['storyCosts'] {
  const rand = seededRandom(13);
  return storyKeys.map((key) => {
    const cost = parseFloat((0.8 + rand() * 3.2).toFixed(2));
    const tokens = Math.round(cost * 60000 + rand() * 15000);
    return {
      storyId: `story-${key.toLowerCase()}`,
      storyKey: key,
      cost,
      tokens,
    };
  });
}

// =============================================================================
// PRE-GENERATED EXPORTS — ready for dashboard consumption
// =============================================================================

export const generatedBatchHistory: BatchMetrics[] = generateBatchHistory(30);
export const generatedLogEntries: LogEntry[] = generateLogEntries(60);
