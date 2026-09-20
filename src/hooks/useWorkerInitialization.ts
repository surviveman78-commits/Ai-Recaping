import { useState, useEffect, useCallback, useRef } from 'react';
import { WorkerInitializationStatus, WorkerInitLogEntry, WorkerInitStep } from '../types/index.ts';
import {
  fetchWorkerInitialization,
  initializeWorker,
  retryWorkerInitialization,
  subscribeWorkerInitialization,
} from '../services/api.ts';

export function useWorkerInitialization(workerId: string = 'kaggle-gpu-worker') {
  const [status, setStatus] = useState<WorkerInitializationStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fetchWorkerInitialization(workerId);
      setStatus(data);
      setError(null);
    } catch (err: any) {
      console.warn('[useWorkerInitialization] Fetch error:', err);
      setError(err.message || 'Failed to fetch initialization status');
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    fetchStatus();

    // Subscribe to SSE events
    const unsub = subscribeWorkerInitialization(workerId, {
      onSnapshot: (snap) => {
        setStatus(snap);
        setLoading(false);
      },
      onLog: (newLog: WorkerInitLogEntry) => {
        setStatus((prev) => {
          if (!prev) return prev;
          const updatedLogs = [...prev.logs, newLog];
          if (updatedLogs.length > 500) updatedLogs.shift();
          return { ...prev, logs: updatedLogs };
        });
      },
      onStep: (updatedStep: WorkerInitStep) => {
        setStatus((prev) => {
          if (!prev) return prev;
          const steps = prev.steps.map((s) => (s.id === updatedStep.id ? updatedStep : s));
          return { ...prev, steps, currentStep: updatedStep.name };
        });
      },
      onProgress: ({ progress, currentStep }) => {
        setStatus((prev) => (prev ? { ...prev, progress, currentStep } : prev));
      },
      onState: ({ state, isLocked }) => {
        setStatus((prev) => (prev ? { ...prev, state: state as any, isLocked } : prev));
      },
      onComplete: ({ status: finalStatus }) => {
        setStatus(finalStatus);
      },
      onError: (err) => {
        setStatus((prev) => (prev ? { ...prev, state: 'failed', error: err } : prev));
      },
    });

    unsubscribeRef.current = unsub;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [workerId, fetchStatus]);

  const startInitialization = useCallback(async () => {
    try {
      setLoading(true);
      const res = await initializeWorker(workerId);
      setStatus(res);
    } catch (err: any) {
      setError(err.message || 'Failed to initialize worker');
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  const retryInitialization = useCallback(async () => {
    try {
      setLoading(true);
      const res = await retryWorkerInitialization(workerId);
      setStatus(res);
    } catch (err: any) {
      setError(err.message || 'Failed to retry worker initialization');
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  const isInitializing = status
    ? ['checking', 'installing', 'downloading_models', 'validating', 'registering'].includes(status.state)
    : false;

  const isReady = status?.state === 'ready';
  const isFailed = status?.state === 'failed';

  return {
    status,
    loading,
    error,
    isInitializing,
    isReady,
    isFailed,
    startInitialization,
    retryInitialization,
    refresh: fetchStatus,
  };
}
