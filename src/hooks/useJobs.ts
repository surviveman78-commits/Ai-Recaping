import { useState, useEffect, useCallback, useRef } from 'react';
import { Job } from '../types/index.ts';
import { fetchJobs } from '../services/api.ts';

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchJobs();
      setJobs(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();

    // Setup Server-Sent Events for live real-time updates
    let isMounted = true;

    const setupSSE = () => {
      try {
        const es = new EventSource('/api/jobs/events');
        sseRef.current = es;

        es.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === 'job-updated' && parsed.job) {
              const updatedJob: Job = parsed.job;
              setJobs((prev) => {
                const existingIndex = prev.findIndex((j) => j.id === updatedJob.id);
                if (existingIndex >= 0) {
                  const copy = [...prev];
                  copy[existingIndex] = updatedJob;
                  return copy;
                }
                return [updatedJob, ...prev];
              });
            }
          } catch (e) {
            // Non-JSON message or keepalive
          }
        };

        es.onerror = () => {
          // SSE dropped, browser auto-reconnects or fallback
          if (es.readyState === EventSource.CLOSED) {
            setTimeout(() => {
              if (isMounted) setupSSE();
            }, 5000);
          }
        };
      } catch (e) {
        console.warn('SSE not supported or failed to connect:', e);
      }
    };

    setupSSE();

    // Background poll fallback every 8 seconds just in case SSE fails
    const pollInterval = setInterval(() => {
      fetchJobs()
        .then((fresh) => {
          if (isMounted) setJobs(fresh);
        })
        .catch(() => {});
    }, 8000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (sseRef.current) {
        sseRef.current.close();
      }
    };
  }, [loadInitial]);

  return { jobs, loading, error, refreshJobs: loadInitial };
}
