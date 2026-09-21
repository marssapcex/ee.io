import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuoteRequest, QuoteResponse } from '../../shared/types';
import { api } from '../lib/api';

interface State {
  quote: QuoteResponse | null;
  loading: boolean;
  /** True on a background refresh, so the UI dims rather than blanks. */
  refreshing: boolean;
  error: string | null;
}

/**
 * Debounced quote fetching with request-generation guarding.
 *
 * Two subtleties this handles that a naive useEffect does not:
 *  - Out-of-order responses. A slow request fired at t=0 must not overwrite a
 *    fast one fired at t=1, so every response is checked against a generation
 *    counter before being committed.
 *  - Typing latency. THORChain's quote endpoint rate-limits at 1 req/s, so we
 *    debounce keystrokes rather than firing per character.
 */
export function useQuote(request: QuoteRequest | null, debounceMs = 420) {
  const [state, setState] = useState<State>({
    quote: null,
    loading: false,
    refreshing: false,
    error: null,
  });

  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const hasQuote = useRef(false);

  const run = useCallback(async (req: QuoteRequest) => {
    const id = ++generation.current;
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;

    setState((prev) => ({
      ...prev,
      loading: !hasQuote.current,
      refreshing: hasQuote.current,
      error: null,
    }));

    try {
      const quote = await api.quote(req, ac.signal);
      if (id !== generation.current) return; // superseded
      hasQuote.current = true;
      setState({ quote, loading: false, refreshing: false, error: null });
    } catch (error) {
      if (ac.signal.aborted || id !== generation.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Quote failed',
      }));
    }
  }, []);

  const key = request
    ? [
        request.fromAssetId,
        request.toAssetId,
        request.amount,
        request.side,
        request.rateType,
        request.takerAddress ?? '',
        request.destinationAddress ?? '',
      ].join('|')
    : '';

  useEffect(() => {
    if (!request || request.amount === '0' || request.amount === '') {
      hasQuote.current = false;
      setState({ quote: null, loading: false, refreshing: false, error: null });
      return;
    }

    const timer = setTimeout(() => void run(request), debounceMs);
    return () => clearTimeout(timer);
    // `key` captures every field that should trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs, run]);

  const refresh = useCallback(() => {
    if (request && request.amount !== '0') void run(request);
  }, [request, run]);

  return { ...state, refresh };
}

/** Countdown to a quote's expiry, in whole seconds. */
export function useCountdown(expiresAt: number | undefined): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}
