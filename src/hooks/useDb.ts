import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe } from '../lib/db';

// 任意 IndexedDB 写入都会让 version 递增
let version = 0;
subscribe(() => {
  version++;
});

export function useDbVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): T | undefined {
  const [data, setData] = useState<T>();
  const v = useDbVersion();
  useEffect(() => {
    let alive = true;
    fn().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, v]);
  return data;
}
