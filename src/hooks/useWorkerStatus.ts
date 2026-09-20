import { useState, useEffect, useCallback } from 'react';
import { GpuWorkerStatus } from '../types/index.ts';
import { fetchWorkerStatus } from '../services/api.ts';

export function useWorkerStatus() {
  const [status, setStatus] = useState<GpuWorkerStatus>({
    state: 'Worker Offline',
    queuedJobsCount: 0,
    isOnline: false,
  });
  const [loading, setLoading] = useState(true);

  const poll = useCallback(async () => {
    try {
      const data = await fetchWorkerStatus();
      setStatus(data);
    } catch {
      setStatus((prev) => ({ ...prev, state: 'Worker Offline', isOnline: false }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [poll]);

  return { status, loading, refetch: poll };
}
