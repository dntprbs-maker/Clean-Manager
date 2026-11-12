import { useLayoutEffect, useRef } from 'react';
import { registerBackLayer } from '../lib/backNavigation';

export function useBackLayer(open, close, priority = 0) {
  const latest = useRef(close);
  useLayoutEffect(() => { latest.current = close; });
  useLayoutEffect(() => {
    if (open) return registerBackLayer(() => latest.current(), priority);
  }, [open, priority]);
}
