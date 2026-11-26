import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { openEventStream, refreshSession } from './api-client';

const RELOAD_DEBOUNCE_MS = 500;
const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

/**
 * Keeps a stream open to the server and reloads job data whenever a job changes in this branch,
 * so a screen left open never shows an old status. Reconnects on its own with back-off; after a
 * reconnect it reloads once to catch anything missed while it was disconnected.
 */
export function useLiveJobUpdates(active: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let retryTimer: number | undefined;
    let reloadTimer: number | undefined;

    const reloadJobs = () => {
      if (reloadTimer !== undefined) return;
      reloadTimer = window.setTimeout(() => {
        reloadTimer = undefined;
        void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      }, RELOAD_DEBOUNCE_MS);
    };

    const run = async () => {
      let delay = MIN_RETRY_MS;
      let connectedBefore = false;
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await openEventStream(controller.signal);
          if (res.status === 401) await refreshSession();
          if (res.ok && res.body) {
            if (connectedBefore) reloadJobs();
            connectedBefore = true;
            delay = MIN_RETRY_MS;
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = '';
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += value;
              let end: number;
              while ((end = buffer.indexOf('\n\n')) >= 0) {
                const message = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (/^event: job$/m.test(message)) reloadJobs();
              }
            }
          }
        } catch {
          // Network drop or abort: fall through to the retry below.
        }
        if (stopped) break;
        await new Promise<void>((resolve) => {
          retryTimer = window.setTimeout(resolve, delay);
        });
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      }
    };
    void run();

    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(retryTimer);
      window.clearTimeout(reloadTimer);
    };
  }, [active, queryClient]);
}
