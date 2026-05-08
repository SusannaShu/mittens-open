/**
 * usePendantFeed -- Reactive hook for pendant capture feed.
 *
 * Subscribes to the pendant store and provides captures
 * sorted by timestamp (newest first) for UI consumption.
 */

import { useState, useEffect } from 'react';
import {
  PendantCapture,
  getCaptures,
  getTodayStats,
  onCapturesChanged,
  initPendantStore,
} from '../../services/pendant/pendantStore';

interface PendantFeedState {
  captures: PendantCapture[];
  todayStats: { motionCount: number; audioCount: number; totalCount: number };
  isLoading: boolean;
}

export function usePendantFeed() {
  const [state, setState] = useState<PendantFeedState>({
    captures: [],
    todayStats: { motionCount: 0, audioCount: 0, totalCount: 0 },
    isLoading: true,
  });

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await initPendantStore();
      if (!mounted) return;
      setState({
        captures: getCaptures(),
        todayStats: getTodayStats(),
        isLoading: false,
      });
    };

    init();

    const unsub = onCapturesChanged((newCaptures) => {
      if (!mounted) return;
      setState({
        captures: newCaptures,
        todayStats: getTodayStats(),
        isLoading: false,
      });
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return state;
}
