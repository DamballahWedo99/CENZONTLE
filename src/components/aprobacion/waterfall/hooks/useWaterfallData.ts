/**
 * useWaterfallData Hook
 *
 * SOLID Principles:
 * - Single Responsibility: Transform monthly data into waterfall segments
 * - DRY: Centralized data transformation logic
 */

import { useMemo } from 'react';
import type { TransaccionMensualData } from '@/types/aprobacion';
import type { WaterfallSegment } from '../types';

/**
 * Transforms monthly transaction data into waterfall segments
 * showing the journey from base approval to final approval
 *
 * Logic:
 * 1. Start at aprobacionBase (first approval pass)
 * 2. Add aprobacionRetry (recovery through retry)
 * 3. Add/subtract 3DS contribution (difference to final)
 * 4. End at aprobacionFinal (total approval)
 */
export function useWaterfallData(
  data: TransaccionMensualData
): WaterfallSegment[] {
  return useMemo(() => {
    const segments: WaterfallSegment[] = [];
    let cumulative = 0;

    // Segment 1: Base Approval (starting point)
    const baseApproval = data.aprobacionBase;
    segments.push({
      label: 'Aprobación Base',
      value: baseApproval,
      start: 0,
      end: baseApproval,
      type: 'increase',
      color: 'hsl(142.1 76.2% 36.3%)' // green-600
    });
    cumulative = baseApproval;

    // Connector 1
    segments.push({
      label: '',
      value: 0,
      start: cumulative,
      end: cumulative,
      type: 'total',
      color: 'transparent',
      isConnector: true
    });

    // Segment 2: Retry Recovery (positive contribution)
    const retryRecovery = data.aprobacionRetry;
    segments.push({
      label: 'Recovery Retry',
      value: retryRecovery,
      start: cumulative,
      end: cumulative + retryRecovery,
      type: 'increase',
      color: 'hsl(217.2 91.2% 59.8%)' // blue-600
    });
    cumulative += retryRecovery;

    // Connector 2
    segments.push({
      label: '',
      value: 0,
      start: cumulative,
      end: cumulative,
      type: 'total',
      color: 'transparent',
      isConnector: true
    });

    // Segment 3: 3DS Contribution (can be positive or negative)
    const contribution3DS = data.aprobacionFinal - cumulative;
    segments.push({
      label: 'Contribución 3DS',
      value: contribution3DS,
      start: cumulative,
      end: data.aprobacionFinal,
      type: contribution3DS >= 0 ? 'increase' : 'decrease',
      color: contribution3DS >= 0
        ? 'hsl(262.1 83.3% 57.8%)' // purple-600
        : 'hsl(0 84.2% 60.2%)' // red-600
    });
    cumulative = data.aprobacionFinal;

    // Segment 4: Total (final approval rate)
    segments.push({
      label: 'Aprobación Final',
      value: data.aprobacionFinal,
      start: 0,
      end: data.aprobacionFinal,
      type: 'total',
      color: 'hsl(24.6 95% 53.1%)' // orange-600
    });

    return segments;
  }, [data]);
}
