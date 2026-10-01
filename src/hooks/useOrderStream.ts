import { useEffect, useRef, useState } from 'react';

/**
 * Live order updates over Server-Sent Events.
 *
 * The server notifies on every status transition as soon as its watcher sees
 * it — sub-second feedback instead of the old 2–3 s polling cadence. The hook
 * degrades gracefully: if the stream errors or EventSource is missing, it
 * keeps the connection cycling in the background and the caller can stay on
 * its own poll schedule as a safety net (or pass one via pollMs, which the
 * hook suppresses while the stream is healthy to avoid double traffic).
 */
export function useEventStream<T>(path: string | null): {
  latest: T | null;
  /** True while the SSE socket is healthy; callers may skip polling. */
  streaming: boolean;
} {
  const [latest, setLatest] = useState<T | null>(null);
  const [streaming, setStreaming] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!path || typeof EventSource === 'undefined') return;

    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      if (closed) return;
      const source = new EventSource(path);
      sourceRef.current = source;

      source.onopen = () => setStreaming(true);
      source.onmessage = (event) => {
        try {
          setLatest(JSON.parse(event.data) as T);
        } catch {
          /* malformed frame — ignore */
        }
      };
      source.onerror = () => {
        setStreaming(false);
        source.close();
        // Reconnect with backoff — the drop is usually a proxy idle timeout
        // between keepalives, not server death.
        retry = setTimeout(open, 5_000);
      };
    };

    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      sourceRef.current?.close();
      sourceRef.current = null;
      setStreaming(false);
    };
  }, [path]);

  return { latest, streaming };
}
