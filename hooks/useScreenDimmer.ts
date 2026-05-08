import { useState, useEffect } from 'react';
import * as Brightness from 'expo-brightness';

/**
 * useScreenDimmer - dims the screen during bedtime wind-down.
 * Returns { isDimmed } so layouts can apply a dark overlay if needed.
 */
export function useScreenDimmer() {
  const [isDimmed, setIsDimmed] = useState(false);

  useEffect(() => {
    // Future: check current time vs bedtime schedule and dim screen
    // For now this is a no-op stub
    return () => {
      if (isDimmed) {
        Brightness.restoreSystemBrightnessAsync().catch(() => {});
      }
    };
  }, [isDimmed]);

  return { isDimmed, setIsDimmed };
}
